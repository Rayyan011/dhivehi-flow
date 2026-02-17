pub mod audio;
pub mod history;
pub mod model;
pub mod transcription;
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub mod whisperkit_sidecar;
