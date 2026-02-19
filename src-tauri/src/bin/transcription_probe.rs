use std::path::{Path, PathBuf};

use transcribe_rs::{
    audio::read_wav_samples,
    engines::{
        moonshine::{ModelVariant, MoonshineEngine, MoonshineModelParams},
        whisper::{WhisperEngine, WhisperInferenceParams, WhisperModelParams},
    },
    TranscriptionEngine,
};

type AnyError = Box<dyn std::error::Error>;

const WHISPER_SAMPLE_RATE: usize = 16_000;
const WHISPER_CHUNK_SECONDS: usize = 10;
const WHISPER_CHUNK_SAMPLES: usize = WHISPER_SAMPLE_RATE * WHISPER_CHUNK_SECONDS;
const WHISPER_MIN_RETRY_CHUNK_SECONDS: usize = 2;
const WHISPER_MIN_RETRY_CHUNK_SAMPLES: usize =
    WHISPER_SAMPLE_RATE * WHISPER_MIN_RETRY_CHUNK_SECONDS;
const WHISPER_MAX_RETRY_SPLIT_DEPTH: u8 = 5;

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .expect("HOME not set")
}

fn recordings_dir() -> PathBuf {
    home()
        .join("Library")
        .join("Application Support")
        .join("com.pais.handy")
        .join("recordings")
}

fn model_path(name: &str) -> PathBuf {
    home()
        .join("Library")
        .join("Application Support")
        .join("com.pais.handy")
        .join("models")
        .join(name)
}

fn wav_duration_seconds(path: &Path) -> Result<f32, AnyError> {
    let reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    let samples = reader.duration();
    let secs = samples as f32 / spec.sample_rate as f32;
    Ok(secs)
}

fn short_text(s: &str, max_chars: usize) -> String {
    let trimmed = s.trim();
    let mut out = String::new();
    for (count, ch) in trimmed.chars().enumerate() {
        if count >= max_chars {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

fn is_retryable_whisper_error(error_message: &str) -> bool {
    error_message.contains("Invalid UTF-8 detected in a string from Whisper")
        || error_message.contains("FailedToDecode")
        || error_message.contains("UnableToCalculateSpectrogram")
}

fn append_non_empty(merged: &mut String, text: &str) {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }
    if !merged.is_empty() {
        merged.push(' ');
    }
    merged.push_str(trimmed);
}

fn transcribe_whisper_direct_samples(
    engine: &mut WhisperEngine,
    samples: &[f32],
    params: &WhisperInferenceParams,
) -> Result<String, AnyError> {
    let result = engine.transcribe_samples(samples.to_vec(), Some(params.clone()))?;
    Ok(result.text)
}

fn transcribe_whisper_chunk_with_retry(
    engine: &mut WhisperEngine,
    chunk: &[f32],
    params: &WhisperInferenceParams,
    depth: u8,
) -> Result<String, AnyError> {
    match transcribe_whisper_direct_samples(engine, chunk, params) {
        Ok(text) => Ok(text),
        Err(err) => {
            let error_message = err.to_string();
            let can_split = depth < WHISPER_MAX_RETRY_SPLIT_DEPTH
                && chunk.len() >= WHISPER_MIN_RETRY_CHUNK_SAMPLES * 2;

            if !can_split || !is_retryable_whisper_error(&error_message) {
                return Err(format!(
                    "Whisper chunk failed at depth {} ({} samples): {}",
                    depth,
                    chunk.len(),
                    error_message
                )
                .into());
            }

            let split_index = chunk.len() / 2;
            let left_result = transcribe_whisper_chunk_with_retry(
                engine,
                &chunk[..split_index],
                params,
                depth + 1,
            );
            let right_result = transcribe_whisper_chunk_with_retry(
                engine,
                &chunk[split_index..],
                params,
                depth + 1,
            );

            let mut recovered = String::new();
            if let Ok(text) = left_result {
                append_non_empty(&mut recovered, &text);
            }
            if let Ok(text) = right_result {
                append_non_empty(&mut recovered, &text);
            }

            if recovered.is_empty() {
                Err(format!(
                    "Whisper chunk failed after split retries ({} samples): {}",
                    chunk.len(),
                    error_message
                )
                .into())
            } else {
                Ok(recovered)
            }
        }
    }
}

fn transcribe_whisper_resilient(
    engine: &mut WhisperEngine,
    samples: &[f32],
    params: &WhisperInferenceParams,
) -> Result<String, AnyError> {
    let mut merged = String::new();
    for chunk in samples.chunks(WHISPER_CHUNK_SAMPLES) {
        let chunk_text = transcribe_whisper_chunk_with_retry(engine, chunk, params, 0)?;
        append_non_empty(&mut merged, &chunk_text);
    }
    Ok(merged)
}

fn transcribe_moonshine(
    engine: &mut MoonshineEngine,
    wav: &Path,
) -> Result<String, Box<dyn std::error::Error>> {
    let audio = read_wav_samples(wav)?;
    let result = engine.transcribe_samples(audio, None)?;
    Ok(result.text)
}

fn main() -> Result<(), AnyError> {
    let mut wavs: Vec<PathBuf> = std::fs::read_dir(recordings_dir())?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.extension().and_then(|e| e.to_str()) == Some("wav"))
        .collect();

    wavs.sort();

    if wavs.is_empty() {
        println!("No recordings found.");
        return Ok(());
    }

    let whisper_model = model_path("ggml-whisper-small-dv.bin");
    let moonshine_model = model_path("moonshine-base");

    println!("Loading Whisper model: {}", whisper_model.display());
    let mut whisper = WhisperEngine::new();
    whisper.load_model_with_params(&whisper_model, WhisperModelParams { use_gpu: false })?;

    println!("Loading Moonshine model: {}", moonshine_model.display());
    let mut moonshine = MoonshineEngine::new();
    moonshine.load_model_with_params(
        &moonshine_model,
        MoonshineModelParams::variant(ModelVariant::Base),
    )?;

    println!("\n=== Transcription Probe ===");
    for wav in wavs {
        let duration = wav_duration_seconds(&wav).unwrap_or(0.0);
        let name = wav
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("<unknown>");
        let audio = read_wav_samples(&wav)?;
        let whisper_params = WhisperInferenceParams {
            language: Some("dv".to_string()),
            translate: false,
            ..Default::default()
        };

        println!("\n{} ({:.2}s)", name, duration);

        match transcribe_whisper_direct_samples(&mut whisper, &audio, &whisper_params) {
            Ok(text) => println!(
                "  whisper-small-dv (direct):    OK len={} text='{}'",
                text.chars().count(),
                short_text(&text, 80)
            ),
            Err(e) => println!("  whisper-small-dv (direct):    ERR {}", e),
        }

        match transcribe_whisper_resilient(&mut whisper, &audio, &whisper_params) {
            Ok(text) => println!(
                "  whisper-small-dv (resilient): OK len={} text='{}'",
                text.chars().count(),
                short_text(&text, 80)
            ),
            Err(e) => println!("  whisper-small-dv (resilient): ERR {}", e),
        }

        match transcribe_moonshine(&mut moonshine, &wav) {
            Ok(text) => println!(
                "  moonshine-base:               OK len={} text='{}'",
                text.chars().count(),
                short_text(&text, 80)
            ),
            Err(e) => println!("  moonshine-base:               ERR {}", e),
        }
    }

    Ok(())
}
