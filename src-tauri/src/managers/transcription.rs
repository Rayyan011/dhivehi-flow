use crate::audio_toolkit::{apply_custom_words, filter_transcription_output};
use crate::managers::model::{EngineType, ModelManager};
use crate::settings::{get_settings, ModelUnloadTimeout};
use anyhow::Result;
use log::{debug, error, info, warn};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};
use transcribe_rs::{
    engines::{
        moonshine::{ModelVariant, MoonshineEngine, MoonshineModelParams},
        parakeet::{
            ParakeetEngine, ParakeetInferenceParams, ParakeetModelParams, TimestampGranularity,
        },
        sense_voice::{
            Language as SenseVoiceLanguage, SenseVoiceEngine, SenseVoiceInferenceParams,
            SenseVoiceModelParams,
        },
        whisper::{WhisperEngine, WhisperInferenceParams},
    },
    TranscriptionEngine,
};

#[derive(Clone, Debug, Serialize)]
pub struct ModelStateEvent {
    pub event_type: String,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
    pub error: Option<String>,
}

enum LoadedEngine {
    Whisper(WhisperEngine),
    Parakeet(ParakeetEngine),
    Moonshine(MoonshineEngine),
    SenseVoice(SenseVoiceEngine),
}

const WHISPER_SAMPLE_RATE: usize = 16_000;
const WHISPER_CHUNK_SECONDS: usize = 10;
const WHISPER_CHUNK_SAMPLES: usize = WHISPER_SAMPLE_RATE * WHISPER_CHUNK_SECONDS;
const WHISPER_MIN_RETRY_CHUNK_SECONDS: usize = 2;
const WHISPER_MIN_RETRY_CHUNK_SAMPLES: usize =
    WHISPER_SAMPLE_RATE * WHISPER_MIN_RETRY_CHUNK_SECONDS;
const WHISPER_MAX_RETRY_SPLIT_DEPTH: u8 = 5;

fn append_non_empty_transcription(merged: &mut String, text: &str) {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }

    if !merged.is_empty() {
        merged.push(' ');
    }
    merged.push_str(trimmed);
}

fn is_retryable_whisper_error(error_message: &str) -> bool {
    error_message.contains("Invalid UTF-8 detected in a string from Whisper")
        || error_message.contains("FailedToDecode")
        || error_message.contains("UnableToCalculateSpectrogram")
}

fn transcribe_whisper_chunk_with_retry<F>(
    chunk: &[f32],
    params: &WhisperInferenceParams,
    depth: u8,
    transcribe_chunk: &mut F,
) -> Result<String>
where
    F: FnMut(&[f32], &WhisperInferenceParams) -> Result<String>,
{
    match transcribe_chunk(chunk, params) {
        Ok(text) => Ok(text),
        Err(err) => {
            let error_message = err.to_string();
            let can_split = depth < WHISPER_MAX_RETRY_SPLIT_DEPTH
                && chunk.len() >= WHISPER_MIN_RETRY_CHUNK_SAMPLES * 2;

            if !can_split || !is_retryable_whisper_error(&error_message) {
                return Err(anyhow::anyhow!(
                    "Whisper chunk failed at depth {} ({} samples): {}",
                    depth,
                    chunk.len(),
                    error_message
                ));
            }

            let split_index = chunk.len() / 2;
            warn!(
                "Retrying Whisper chunk after error by splitting (depth={}, samples={}, error={})",
                depth,
                chunk.len(),
                error_message
            );

            let left_result = transcribe_whisper_chunk_with_retry(
                &chunk[..split_index],
                params,
                depth + 1,
                transcribe_chunk,
            );
            let right_result = transcribe_whisper_chunk_with_retry(
                &chunk[split_index..],
                params,
                depth + 1,
                transcribe_chunk,
            );

            let mut recovered = String::new();
            match left_result {
                Ok(text) => append_non_empty_transcription(&mut recovered, &text),
                Err(left_err) => {
                    warn!("Left sub-chunk failed at depth {}: {}", depth + 1, left_err)
                }
            }
            match right_result {
                Ok(text) => append_non_empty_transcription(&mut recovered, &text),
                Err(right_err) => {
                    warn!(
                        "Right sub-chunk failed at depth {}: {}",
                        depth + 1,
                        right_err
                    )
                }
            }

            if recovered.is_empty() {
                Err(anyhow::anyhow!(
                    "Whisper chunk failed after split retries ({} samples): {}",
                    chunk.len(),
                    error_message
                ))
            } else {
                Ok(recovered)
            }
        }
    }
}

fn transcribe_whisper_with_chunking_internal<F>(
    audio: &[f32],
    params: &WhisperInferenceParams,
    transcribe_chunk: &mut F,
) -> Result<String>
where
    F: FnMut(&[f32], &WhisperInferenceParams) -> Result<String>,
{
    let total_chunks = audio.len().div_ceil(WHISPER_CHUNK_SAMPLES);
    if total_chunks > 1 {
        info!(
            "Long Whisper input detected ({} samples). Processing in {} chunks of up to {}s.",
            audio.len(),
            total_chunks,
            WHISPER_CHUNK_SECONDS
        );
    }

    let mut merged = String::new();
    for (chunk_index, chunk) in audio.chunks(WHISPER_CHUNK_SAMPLES).enumerate() {
        let chunk_text = transcribe_whisper_chunk_with_retry(chunk, params, 0, transcribe_chunk)
            .map_err(|e| {
                anyhow::anyhow!(
                    "Whisper transcription failed on chunk {}/{}: {}",
                    chunk_index + 1,
                    total_chunks,
                    e
                )
            })?;

        append_non_empty_transcription(&mut merged, &chunk_text);
    }

    Ok(merged)
}

fn transcribe_whisper_with_chunking(
    whisper_engine: &mut WhisperEngine,
    audio: Vec<f32>,
    params: WhisperInferenceParams,
) -> Result<String> {
    let mut transcribe_chunk = |chunk: &[f32], params: &WhisperInferenceParams| -> Result<String> {
        let result = whisper_engine
            .transcribe_samples(chunk.to_vec(), Some(params.clone()))
            .map_err(|e| anyhow::anyhow!("Whisper transcription failed: {}", e))?;
        Ok(result.text)
    };

    transcribe_whisper_with_chunking_internal(&audio, &params, &mut transcribe_chunk)
}

#[derive(Clone)]
pub struct TranscriptionManager {
    engine: Arc<Mutex<Option<LoadedEngine>>>,
    model_manager: Arc<ModelManager>,
    app_handle: AppHandle,
    current_model_id: Arc<Mutex<Option<String>>>,
    last_activity: Arc<AtomicU64>,
    shutdown_signal: Arc<AtomicBool>,
    watcher_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,
    is_loading: Arc<Mutex<bool>>,
    loading_condvar: Arc<Condvar>,
}

struct LoadingStateGuard {
    is_loading: Arc<Mutex<bool>>,
    loading_condvar: Arc<Condvar>,
}

impl Drop for LoadingStateGuard {
    fn drop(&mut self) {
        let mut is_loading = self.is_loading.lock().unwrap();
        *is_loading = false;
        self.loading_condvar.notify_all();
    }
}

impl TranscriptionManager {
    pub fn new(app_handle: &AppHandle, model_manager: Arc<ModelManager>) -> Result<Self> {
        let manager = Self {
            engine: Arc::new(Mutex::new(None)),
            model_manager,
            app_handle: app_handle.clone(),
            current_model_id: Arc::new(Mutex::new(None)),
            last_activity: Arc::new(AtomicU64::new(
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64,
            )),
            shutdown_signal: Arc::new(AtomicBool::new(false)),
            watcher_handle: Arc::new(Mutex::new(None)),
            is_loading: Arc::new(Mutex::new(false)),
            loading_condvar: Arc::new(Condvar::new()),
        };

        // Start the idle watcher
        {
            let app_handle_cloned = app_handle.clone();
            let manager_cloned = manager.clone();
            let shutdown_signal = manager.shutdown_signal.clone();
            let handle = thread::spawn(move || {
                while !shutdown_signal.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_secs(10)); // Check every 10 seconds

                    // Check shutdown signal again after sleep
                    if shutdown_signal.load(Ordering::Relaxed) {
                        break;
                    }

                    let settings = get_settings(&app_handle_cloned);
                    let timeout_seconds = settings.model_unload_timeout.to_seconds();

                    if let Some(limit_seconds) = timeout_seconds {
                        // Skip polling-based unloading for immediate timeout since it's handled directly in transcribe()
                        if settings.model_unload_timeout == ModelUnloadTimeout::Immediately {
                            continue;
                        }

                        let last = manager_cloned.last_activity.load(Ordering::Relaxed);
                        let now_ms = SystemTime::now()
                            .duration_since(SystemTime::UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as u64;

                        if now_ms.saturating_sub(last) > limit_seconds * 1000 {
                            // idle -> unload
                            if manager_cloned.is_model_loaded() {
                                let unload_start = std::time::Instant::now();
                                debug!("Starting to unload model due to inactivity");

                                if let Ok(()) = manager_cloned.unload_model() {
                                    let _ = app_handle_cloned.emit(
                                        "model-state-changed",
                                        ModelStateEvent {
                                            event_type: "unloaded".to_string(),
                                            model_id: None,
                                            model_name: None,
                                            error: None,
                                        },
                                    );
                                    let unload_duration = unload_start.elapsed();
                                    debug!(
                                        "Model unloaded due to inactivity (took {}ms)",
                                        unload_duration.as_millis()
                                    );
                                }
                            }
                        }
                    }
                }
                debug!("Idle watcher thread shutting down gracefully");
            });
            *manager.watcher_handle.lock().unwrap() = Some(handle);
        }

        Ok(manager)
    }

    pub fn is_model_loaded(&self) -> bool {
        let engine = self.engine.lock().unwrap();
        engine.is_some()
    }

    pub fn unload_model(&self) -> Result<()> {
        let unload_start = std::time::Instant::now();
        debug!("Starting to unload model");

        {
            let mut engine = self.engine.lock().unwrap();
            if let Some(ref mut loaded_engine) = *engine {
                match loaded_engine {
                    LoadedEngine::Whisper(ref mut e) => e.unload_model(),
                    LoadedEngine::Parakeet(ref mut e) => e.unload_model(),
                    LoadedEngine::Moonshine(ref mut e) => e.unload_model(),
                    LoadedEngine::SenseVoice(ref mut e) => e.unload_model(),
                }
            }
            *engine = None; // Drop the engine to free memory
        }
        {
            let mut current_model = self.current_model_id.lock().unwrap();
            *current_model = None;
        }

        // Emit unloaded event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "unloaded".to_string(),
                model_id: None,
                model_name: None,
                error: None,
            },
        );

        let unload_duration = unload_start.elapsed();
        debug!(
            "Model unloaded manually (took {}ms)",
            unload_duration.as_millis()
        );
        Ok(())
    }

    /// Unloads the model immediately if the setting is enabled and the model is loaded
    pub fn maybe_unload_immediately(&self, context: &str) {
        let settings = get_settings(&self.app_handle);
        if settings.model_unload_timeout == ModelUnloadTimeout::Immediately
            && self.is_model_loaded()
        {
            info!("Immediately unloading model after {}", context);
            if let Err(e) = self.unload_model() {
                warn!("Failed to immediately unload model: {}", e);
            }
        }
    }

    fn is_requested_model_loaded(&self, model_id: &str) -> bool {
        self.is_model_loaded() && self.get_current_model().as_deref() == Some(model_id)
    }

    fn load_model_inner(&self, model_id: &str) -> Result<()> {
        let load_start = std::time::Instant::now();
        debug!("Starting to load model: {}", model_id);

        // Emit loading started event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "loading_started".to_string(),
                model_id: Some(model_id.to_string()),
                model_name: None,
                error: None,
            },
        );

        let model_info = self
            .model_manager
            .get_model_info(model_id)
            .ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        if !model_info.is_downloaded {
            let error_msg = "Model not downloaded";
            let _ = self.app_handle.emit(
                "model-state-changed",
                ModelStateEvent {
                    event_type: "loading_failed".to_string(),
                    model_id: Some(model_id.to_string()),
                    model_name: Some(model_info.name.clone()),
                    error: Some(error_msg.to_string()),
                },
            );
            return Err(anyhow::anyhow!(error_msg));
        }

        let model_path = self.model_manager.get_model_path(model_id)?;

        // Create appropriate engine based on model type
        let loaded_engine = match model_info.engine_type {
            EngineType::Whisper => {
                let mut engine = WhisperEngine::new();
                engine.load_model(&model_path).map_err(|e| {
                    let error_msg = format!("Failed to load whisper model {}: {}", model_id, e);
                    let _ = self.app_handle.emit(
                        "model-state-changed",
                        ModelStateEvent {
                            event_type: "loading_failed".to_string(),
                            model_id: Some(model_id.to_string()),
                            model_name: Some(model_info.name.clone()),
                            error: Some(error_msg.clone()),
                        },
                    );
                    anyhow::anyhow!(error_msg)
                })?;
                LoadedEngine::Whisper(engine)
            }
            EngineType::Parakeet => {
                let mut engine = ParakeetEngine::new();
                engine
                    .load_model_with_params(&model_path, ParakeetModelParams::int8())
                    .map_err(|e| {
                        let error_msg =
                            format!("Failed to load parakeet model {}: {}", model_id, e);
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                LoadedEngine::Parakeet(engine)
            }
            EngineType::Moonshine => {
                let mut engine = MoonshineEngine::new();
                engine
                    .load_model_with_params(
                        &model_path,
                        MoonshineModelParams::variant(ModelVariant::Base),
                    )
                    .map_err(|e| {
                        let error_msg =
                            format!("Failed to load moonshine model {}: {}", model_id, e);
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                LoadedEngine::Moonshine(engine)
            }
            EngineType::SenseVoice => {
                let mut engine = SenseVoiceEngine::new();
                engine
                    .load_model_with_params(&model_path, SenseVoiceModelParams::int8())
                    .map_err(|e| {
                        let error_msg =
                            format!("Failed to load SenseVoice model {}: {}", model_id, e);
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                LoadedEngine::SenseVoice(engine)
            }
        };

        // Update the current engine and model ID
        {
            let mut engine = self.engine.lock().unwrap();
            *engine = Some(loaded_engine);
        }
        {
            let mut current_model = self.current_model_id.lock().unwrap();
            *current_model = Some(model_id.to_string());
        }

        // Emit loading completed event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "loading_completed".to_string(),
                model_id: Some(model_id.to_string()),
                model_name: Some(model_info.name.clone()),
                error: None,
            },
        );

        let load_duration = load_start.elapsed();
        debug!(
            "Successfully loaded transcription model: {} (took {}ms)",
            model_id,
            load_duration.as_millis()
        );
        Ok(())
    }

    pub fn load_model(&self, model_id: &str) -> Result<()> {
        {
            let mut is_loading = self.is_loading.lock().unwrap();
            while *is_loading {
                is_loading = self.loading_condvar.wait(is_loading).unwrap();
            }

            if self.is_requested_model_loaded(model_id) {
                debug!(
                    "Model '{}' is already loaded and active; skipping redundant load",
                    model_id
                );
                return Ok(());
            }

            *is_loading = true;
        }

        let _loading_guard = LoadingStateGuard {
            is_loading: Arc::clone(&self.is_loading),
            loading_condvar: Arc::clone(&self.loading_condvar),
        };

        self.load_model_inner(model_id)
    }

    /// Kicks off the model loading in a background thread if it's not already loaded
    pub fn initiate_model_load(&self) {
        {
            let is_loading = self.is_loading.lock().unwrap();
            if *is_loading || self.is_model_loaded() {
                return;
            }
        }

        let self_clone = self.clone();
        thread::spawn(move || {
            let settings = get_settings(&self_clone.app_handle);
            if let Err(e) = self_clone.load_model(&settings.selected_model) {
                error!("Failed to load model: {}", e);
            }
        });
    }

    pub fn get_current_model(&self) -> Option<String> {
        let current_model = self.current_model_id.lock().unwrap();
        current_model.clone()
    }

    pub fn transcribe(&self, audio: Vec<f32>) -> Result<String> {
        // Update last activity timestamp
        self.last_activity.store(
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            Ordering::Relaxed,
        );

        let st = std::time::Instant::now();

        debug!("Audio vector length: {}", audio.len());

        if audio.is_empty() {
            debug!("Empty audio vector");
            self.maybe_unload_immediately("empty audio");
            return Ok(String::new());
        }

        // Check if model is loaded, if not try to load it
        {
            // If the model is loading, wait for it to complete.
            let mut is_loading = self.is_loading.lock().unwrap();
            while *is_loading {
                is_loading = self.loading_condvar.wait(is_loading).unwrap();
            }

            let engine_guard = self.engine.lock().unwrap();
            if engine_guard.is_none() {
                return Err(anyhow::anyhow!("Model is not loaded for transcription."));
            }
        }

        // Get current settings for configuration
        let settings = get_settings(&self.app_handle);

        // Perform transcription with the appropriate engine
        let result = {
            let mut engine_guard = self.engine.lock().unwrap();
            let engine = engine_guard.as_mut().ok_or_else(|| {
                anyhow::anyhow!(
                    "Model failed to load after auto-load attempt. Please check your model settings."
                )
            })?;

            match engine {
                LoadedEngine::Whisper(whisper_engine) => {
                    let is_dhivehi = settings.selected_language == "dv";

                    let whisper_language = if settings.selected_language == "auto" {
                        None
                    } else {
                        let normalized = if settings.selected_language == "zh-Hans"
                            || settings.selected_language == "zh-Hant"
                        {
                            "zh".to_string()
                        } else if is_dhivehi {
                            "si".to_string()
                        } else {
                            settings.selected_language.clone()
                        };
                        Some(normalized)
                    };

                    let params = WhisperInferenceParams {
                        language: whisper_language,
                        translate: settings.translate_to_english,
                        no_speech_thold: 0.6,
                        entropy_thold: if is_dhivehi { Some(0.0) } else { None },
                        ..Default::default()
                    };

                    let text = transcribe_whisper_with_chunking(whisper_engine, audio, params)?;
                    transcribe_rs::TranscriptionResult {
                        text,
                        segments: None,
                    }
                }
                LoadedEngine::Parakeet(parakeet_engine) => {
                    let params = ParakeetInferenceParams {
                        timestamp_granularity: TimestampGranularity::Segment,
                        ..Default::default()
                    };
                    parakeet_engine
                        .transcribe_samples(audio, Some(params))
                        .map_err(|e| anyhow::anyhow!("Parakeet transcription failed: {}", e))?
                }
                LoadedEngine::Moonshine(moonshine_engine) => moonshine_engine
                    .transcribe_samples(audio, None)
                    .map_err(|e| anyhow::anyhow!("Moonshine transcription failed: {}", e))?,
                LoadedEngine::SenseVoice(sense_voice_engine) => {
                    let language = match settings.selected_language.as_str() {
                        "zh" | "zh-Hans" | "zh-Hant" => SenseVoiceLanguage::Chinese,
                        "en" => SenseVoiceLanguage::English,
                        "ja" => SenseVoiceLanguage::Japanese,
                        "ko" => SenseVoiceLanguage::Korean,
                        "yue" => SenseVoiceLanguage::Cantonese,
                        _ => SenseVoiceLanguage::Auto,
                    };
                    let params = SenseVoiceInferenceParams {
                        language,
                        use_itn: true,
                    };
                    sense_voice_engine
                        .transcribe_samples(audio, Some(params))
                        .map_err(|e| anyhow::anyhow!("SenseVoice transcription failed: {}", e))?
                }
            }
        };

        // Apply word correction if custom words are configured
        let corrected_result = if !settings.custom_words.is_empty() {
            apply_custom_words(
                &result.text,
                &settings.custom_words,
                settings.word_correction_threshold,
            )
        } else {
            result.text
        };

        // Filter out filler words and hallucinations
        let filtered_result = filter_transcription_output(&corrected_result);

        let et = std::time::Instant::now();
        let translation_note = if settings.translate_to_english {
            " (translated)"
        } else {
            ""
        };
        info!(
            "Transcription completed in {}ms{}",
            (et - st).as_millis(),
            translation_note
        );

        let final_result = filtered_result;

        if final_result.is_empty() {
            info!("Transcription result is empty");
        } else {
            info!("Transcription result: {}", final_result);
        }

        self.maybe_unload_immediately("transcription");

        Ok(final_result)
    }
}

impl Drop for TranscriptionManager {
    fn drop(&mut self) {
        debug!("Shutting down TranscriptionManager");

        // Signal the watcher thread to shutdown
        self.shutdown_signal.store(true, Ordering::Relaxed);

        // Wait for the thread to finish gracefully
        if let Some(handle) = self.watcher_handle.lock().unwrap().take() {
            if let Err(e) = handle.join() {
                warn!("Failed to join idle watcher thread: {:?}", e);
            } else {
                debug!("Idle watcher thread joined successfully");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whisper_chunking_splits_long_audio_into_multiple_calls() {
        let audio = vec![0.0; WHISPER_CHUNK_SAMPLES * 2 + 123];
        let params = WhisperInferenceParams::default();

        let mut call_count = 0usize;
        let mut mock_transcriber = |_: &[f32], _: &WhisperInferenceParams| -> Result<String> {
            call_count += 1;
            Ok(format!("chunk{}", call_count))
        };

        let result =
            transcribe_whisper_with_chunking_internal(&audio, &params, &mut mock_transcriber)
                .expect("chunked transcription should succeed");

        assert_eq!(call_count, 3);
        assert_eq!(result, "chunk1 chunk2 chunk3");
    }

    #[test]
    fn whisper_chunking_recovers_retryable_errors_by_splitting() {
        let audio = vec![0.0; WHISPER_CHUNK_SAMPLES];
        let params = WhisperInferenceParams::default();

        let mut call_count = 0usize;
        let mut mock_transcriber = |chunk: &[f32], _: &WhisperInferenceParams| -> Result<String> {
            call_count += 1;
            if chunk.len() >= WHISPER_CHUNK_SAMPLES {
                return Err(anyhow::anyhow!(
                    "Invalid UTF-8 detected in a string from Whisper. Index: 0, Length: 1."
                ));
            }
            Ok("ok".to_string())
        };

        let result =
            transcribe_whisper_with_chunking_internal(&audio, &params, &mut mock_transcriber)
                .expect("retryable errors should be recoverable via splitting");

        assert_eq!(call_count, 3);
        assert_eq!(result, "ok ok");
    }

    #[test]
    fn whisper_chunking_returns_error_when_retry_fails_completely() {
        let audio = vec![0.0; WHISPER_MIN_RETRY_CHUNK_SAMPLES];
        let params = WhisperInferenceParams::default();

        let mut mock_transcriber = |_: &[f32], _: &WhisperInferenceParams| -> Result<String> {
            Err(anyhow::anyhow!(
                "Invalid UTF-8 detected in a string from Whisper. Index: 0, Length: 1."
            ))
        };

        let err = transcribe_whisper_with_chunking_internal(&audio, &params, &mut mock_transcriber)
            .expect_err("expected unrecoverable chunk to return an error");

        assert!(err
            .to_string()
            .contains("Whisper transcription failed on chunk 1/1"));
    }
}
