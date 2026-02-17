use anyhow::{Context, Result};
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::io::Seek;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use tempfile::{Builder, NamedTempFile};

// MARK: - JSON Protocol Types

#[derive(Serialize)]
struct SidecarRequest {
    #[serde(rename = "type")]
    request_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    model_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    audio_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
}

#[derive(Deserialize, Debug)]
struct SidecarResponse {
    #[serde(rename = "type")]
    #[allow(dead_code)]
    response_type: String,
    success: Option<bool>,
    text: Option<String>,
    error: Option<String>,
    #[allow(dead_code)]
    model_loaded: Option<bool>,
}

// MARK: - Sidecar Manager

pub struct WhisperKitSidecar {
    process: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout_reader: Option<BufReader<ChildStdout>>,
    sidecar_path: PathBuf,
    loaded_model_path: Option<String>,
}

impl WhisperKitSidecar {
    pub fn new(sidecar_path: PathBuf) -> Self {
        Self {
            process: None,
            stdin: None,
            stdout_reader: None,
            sidecar_path,
            loaded_model_path: None,
        }
    }

    /// Spawn the sidecar process
    pub fn start(&mut self) -> Result<()> {
        if self.is_running() {
            debug!("WhisperKit sidecar already running");
            return Ok(());
        }

        info!("Starting WhisperKit sidecar: {:?}", self.sidecar_path);

        let mut child = Command::new(&self.sidecar_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit()) // sidecar logs go to app's stderr
            .spawn()
            .with_context(|| {
                format!(
                    "Failed to spawn WhisperKit sidecar at {:?}",
                    self.sidecar_path
                )
            })?;

        info!("WhisperKit sidecar started (pid: {})", child.id());

        // Take ownership of stdin/stdout for persistent use
        self.stdin = child.stdin.take();
        self.stdout_reader = child.stdout.take().map(BufReader::new);
        self.process = Some(child);
        Ok(())
    }

    /// Load a model in the sidecar
    pub fn load_model(&mut self, model_path: &str) -> Result<()> {
        self.ensure_running()?;
        self.send_load_request(model_path)?;
        self.loaded_model_path = Some(model_path.to_string());
        info!("WhisperKit model loaded: {}", model_path);
        Ok(())
    }

    /// Send a load-model command to an already-running sidecar process.
    fn send_load_request(&mut self, model_path: &str) -> Result<()> {
        let request = SidecarRequest {
            request_type: "load".to_string(),
            model_path: Some(model_path.to_string()),
            audio_path: None,
            language: None,
        };

        let response = self.send_request(&request)?;

        if response.success == Some(true) {
            Ok(())
        } else {
            let error_msg = response
                .error
                .unwrap_or_else(|| "Unknown error loading model".to_string());
            Err(anyhow::anyhow!("WhisperKit load failed: {}", error_msg))
        }
    }

    /// Transcribe audio samples via the sidecar.
    ///
    /// Writes audio to a secure temp file and passes the path to the sidecar.
    ///
    /// Primary format is 16 kHz mono WAV (PCM16). If that call fails or returns an
    /// empty transcript for clearly non-silent input, it retries with raw f32 PCM
    /// for compatibility with older sidecar builds.
    pub fn transcribe(&mut self, audio: &[f32], language: &str) -> Result<String> {
        self.ensure_running()?;

        let wav_file = Builder::new()
            .prefix("whisperkit_audio_")
            .suffix(".wav")
            .tempfile_in(std::env::temp_dir())
            .with_context(|| "Failed to create secure temp WAV file")?;
        let mut wav_file = wav_file;
        Self::write_wav_audio_file(&mut wav_file, audio)?;

        let wav_response = self.send_transcribe_request(wav_file.path(), language);
        match wav_response {
            Ok(response) if response.success == Some(true) => {
                let text = response.text.unwrap_or_default();
                let rms = Self::audio_rms(audio);

                // Non-silent input with an empty transcript is suspicious;
                // retry with raw PCM to maximize compatibility.
                if text.trim().is_empty() && rms > 0.01 {
                    warn!(
                        "WhisperKit returned empty WAV transcript for non-silent audio (rms {:.5}); retrying raw PCM fallback",
                        rms
                    );
                } else {
                    return Ok(text);
                }
            }
            Ok(response) => {
                warn!(
                    "WhisperKit WAV transcription failed ({}); retrying raw PCM fallback",
                    response
                        .error
                        .unwrap_or_else(|| "unknown error".to_string())
                );
            }
            Err(e) => {
                warn!(
                    "WhisperKit WAV request failed ({}); retrying raw PCM fallback",
                    e
                );
            }
        }

        let raw_file = Builder::new()
            .prefix("whisperkit_audio_")
            .suffix(".raw")
            .tempfile_in(std::env::temp_dir())
            .with_context(|| "Failed to create secure temp raw file")?;
        let mut raw_file = raw_file;
        Self::write_raw_f32_audio_file(&mut raw_file, audio)?;

        let response = self.send_transcribe_request(raw_file.path(), language)?;

        if response.success == Some(true) {
            Ok(response.text.unwrap_or_default())
        } else {
            let error_msg = response
                .error
                .unwrap_or_else(|| "Unknown transcription error".to_string());
            Err(anyhow::anyhow!(
                "WhisperKit transcription failed: {}",
                error_msg
            ))
        }
    }

    fn send_transcribe_request(
        &mut self,
        audio_path: &Path,
        language: &str,
    ) -> Result<SidecarResponse> {
        let request = SidecarRequest {
            request_type: "transcribe".to_string(),
            model_path: None,
            audio_path: Some(audio_path.to_string_lossy().to_string()),
            language: Some(language.to_string()),
        };

        self.send_request(&request)
    }

    fn write_wav_audio_file(file: &mut NamedTempFile, audio: &[f32]) -> Result<()> {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        file.as_file_mut()
            .rewind()
            .with_context(|| "Failed to rewind WhisperKit WAV tempfile")?;
        file.as_file_mut()
            .set_len(0)
            .with_context(|| "Failed to truncate WhisperKit WAV tempfile")?;
        let mut writer = hound::WavWriter::new(file.as_file_mut(), spec)
            .with_context(|| "Failed to create WAV writer for WhisperKit audio")?;

        for sample in audio {
            let sample_i16 = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            writer
                .write_sample(sample_i16)
                .with_context(|| "Failed to write WAV sample")?;
        }

        writer
            .finalize()
            .with_context(|| "Failed to finalize WhisperKit WAV file")?;

        Ok(())
    }

    fn write_raw_f32_audio_file(file: &mut NamedTempFile, audio: &[f32]) -> Result<()> {
        file.as_file_mut()
            .rewind()
            .with_context(|| "Failed to rewind WhisperKit raw tempfile")?;
        file.as_file_mut()
            .set_len(0)
            .with_context(|| "Failed to truncate WhisperKit raw tempfile")?;
        for sample in audio {
            file.as_file_mut()
                .write_all(&sample.to_le_bytes())
                .with_context(|| "Failed to write raw audio sample")?;
        }
        Ok(())
    }

    fn audio_rms(audio: &[f32]) -> f32 {
        if audio.is_empty() {
            return 0.0;
        }

        let sum_sq = audio.iter().map(|sample| sample * sample).sum::<f32>();
        (sum_sq / audio.len() as f32).sqrt()
    }

    /// Unload the model in the sidecar
    pub fn unload_model(&mut self) {
        self.loaded_model_path = None;

        if !self.is_running() {
            return;
        }

        let request = SidecarRequest {
            request_type: "unload".to_string(),
            model_path: None,
            audio_path: None,
            language: None,
        };

        match self.send_request(&request) {
            Ok(_) => info!("WhisperKit model unloaded"),
            Err(e) => warn!("Failed to unload WhisperKit model: {}", e),
        }
    }

    /// Check if the sidecar process is still alive
    fn is_running(&mut self) -> bool {
        if let Some(ref mut child) = self.process {
            match child.try_wait() {
                Ok(None) => true, // still running
                Ok(Some(status)) => {
                    warn!("WhisperKit sidecar exited with status: {}", status);
                    self.process = None;
                    self.stdin = None;
                    self.stdout_reader = None;
                    false
                }
                Err(e) => {
                    warn!("Failed to check sidecar status: {}", e);
                    false
                }
            }
        } else {
            false
        }
    }

    /// Ensure the sidecar is running, restart if needed
    fn ensure_running(&mut self) -> Result<()> {
        if !self.is_running() {
            warn!("WhisperKit sidecar not running, attempting restart");
            self.start()?;

            if let Some(model_path) = self.loaded_model_path.clone() {
                info!(
                    "Restoring WhisperKit model after sidecar restart: {}",
                    model_path
                );
                self.send_load_request(&model_path).with_context(|| {
                    format!(
                        "Failed to restore WhisperKit model after sidecar restart: {}",
                        model_path
                    )
                })?;
            }
        }
        Ok(())
    }

    /// Send a JSON request to the sidecar and read the response
    fn send_request(&mut self, request: &SidecarRequest) -> Result<SidecarResponse> {
        // Serialize request as a single JSON line
        let mut request_json =
            serde_json::to_string(request).with_context(|| "Failed to serialize request")?;
        request_json.push('\n');

        // Write to stdin
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("Sidecar stdin not available"))?;
        stdin
            .write_all(request_json.as_bytes())
            .with_context(|| "Failed to write to sidecar stdin")?;
        stdin
            .flush()
            .with_context(|| "Failed to flush sidecar stdin")?;

        // Read one line from stdout
        let reader = self
            .stdout_reader
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("Sidecar stdout not available"))?;
        let mut response_line = String::new();
        reader
            .read_line(&mut response_line)
            .with_context(|| "Failed to read from sidecar stdout")?;

        if response_line.is_empty() {
            return Err(anyhow::anyhow!(
                "Sidecar returned empty response (process may have crashed)"
            ));
        }

        let response: SidecarResponse =
            serde_json::from_str(response_line.trim()).with_context(|| {
                format!("Failed to parse sidecar response: {}", response_line.trim())
            })?;

        debug!("Sidecar response: {:?}", response);
        Ok(response)
    }

    /// Shutdown the sidecar process gracefully
    fn shutdown(&mut self) {
        if !self.is_running() {
            return;
        }

        let request = SidecarRequest {
            request_type: "shutdown".to_string(),
            model_path: None,
            audio_path: None,
            language: None,
        };

        // Try graceful shutdown
        if self.send_request(&request).is_ok() {
            // Give it a moment to exit
            if let Some(ref mut child) = self.process {
                let _ = child.wait();
            }
        } else {
            // Force kill if graceful shutdown fails
            if let Some(ref mut child) = self.process {
                let _ = child.kill();
                let _ = child.wait();
            }
        }

        self.process = None;
        self.stdin = None;
        self.stdout_reader = None;
        info!("WhisperKit sidecar shut down");
    }
}

impl Drop for WhisperKitSidecar {
    fn drop(&mut self) {
        self.shutdown();
    }
}
