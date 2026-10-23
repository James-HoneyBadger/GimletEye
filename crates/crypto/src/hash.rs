use std::fs;
use std::sync::Arc;
use std::time::Instant;

use mellivora_core::{
    ArgKind, ArgSpec, Args, Capability, Category, MellivoraError, Report, Result, Tool,
    ToolContext, ToolManifest,
};
use serde_json::json;

use crate::backend::CryptoBackend;

/// SHA-256 digest of text or a file. The integrity half of the signing pair
/// that [`CryptoBackend`] will provide once the native engine lands.
pub struct Sha256 {
    manifest: ToolManifest,
    backend: Arc<dyn CryptoBackend>,
}

impl Sha256 {
    pub fn new(backend: Arc<dyn CryptoBackend>) -> Self {
        Self {
            manifest: ToolManifest::new(
                "crypto.sha256",
                "SHA-256 digest",
                "Hash text or a file with SHA-256",
                Category::Crypto,
            )
            .with_capabilities([Capability::FsRead])
            .with_args([
                ArgSpec::new("path", ArgKind::Path).help("File to hash"),
                ArgSpec::new("text", ArgKind::String).help("Literal text to hash"),
            ])
            .with_tags(["hash", "integrity", "fingerprint"]),
            backend,
        }
    }
}

impl Tool for Sha256 {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        let started = Instant::now();
        let path = args.opt_path("path")?;
        let text = args.opt_str("text")?;

        let (digest, size, source) = match (path, text) {
            (Some(_), Some(_)) => {
                return Err(MellivoraError::InvalidArgs(
                    "provide either 'path' or 'text', not both".into(),
                ))
            }
            (None, None) => {
                return Err(MellivoraError::InvalidArgs(
                    "one of 'path' or 'text' is required".into(),
                ))
            }
            (Some(path), None) => {
                ctx.require(Capability::FsRead)?;
                if !path.exists() {
                    return Err(MellivoraError::NotFound(path.display().to_string()));
                }
                let bytes = fs::read(&path)?;
                (
                    self.backend.sha256_hex(&bytes),
                    bytes.len() as u64,
                    path.display().to_string(),
                )
            }
            (None, Some(text)) => {
                let bytes = text.into_bytes();
                (
                    self.backend.sha256_hex(&bytes),
                    bytes.len() as u64,
                    "text".to_string(),
                )
            }
        };

        Ok(Report::new(&self.manifest.id)
            .with_summary(format!("sha256:{digest}"))
            .with_data(json!({
                "sha256": digest,
                "size_bytes": size,
                "source": source,
                "backend": self.backend.name(),
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mellivora_core::AppPaths;

    fn tool() -> Sha256 {
        Sha256::new(Arc::new(crate::OsBackend))
    }

    fn context() -> ToolContext {
        ToolContext::new(AppPaths::under(
            std::env::temp_dir().join("mellivora-sha256"),
        ))
    }

    #[test]
    fn hashes_text() {
        let mut args = Args::new();
        args.insert("text", "abc");
        let report = tool().run(&context(), &args).expect("run");
        assert_eq!(
            report.data["sha256"].as_str().unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn requires_exactly_one_input() {
        let err = tool().run(&context(), &Args::new()).expect_err("must fail");
        assert_eq!(err.code(), "invalid_args");

        let mut args = Args::new();
        args.insert("text", "abc");
        args.insert("path", "/tmp/whatever");
        let err = tool().run(&context(), &args).expect_err("must fail");
        assert_eq!(err.code(), "invalid_args");
    }

    #[test]
    fn hashes_a_file() {
        let dir = std::env::temp_dir().join(format!("mellivora-hash-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("dir");
        let path = dir.join("sample.txt");
        fs::write(&path, "abc").expect("write");

        let mut args = Args::new();
        args.insert("path", path.display().to_string());
        let report = tool().run(&context(), &args).expect("run");
        assert_eq!(report.data["size_bytes"], 3);

        let _ = fs::remove_dir_all(&dir);
    }
}
