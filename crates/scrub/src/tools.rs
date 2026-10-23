use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use mellivora_core::{
    ArgKind, ArgSpec, Args, Capability, Category, MellivoraError, Report, Result, Severity, Tool,
    ToolContext, ToolManifest,
};
use serde_json::{json, Value};

use crate::format::{handler_for, ScanResult};

/// Inspect metadata without modifying anything.
pub struct MetadataScan {
    manifest: ToolManifest,
}

impl MetadataScan {
    pub fn new() -> Self {
        Self {
            manifest: ToolManifest::new(
                "privacy.metadata-scan",
                "Inspect metadata",
                "Report embedded EXIF, GPS, text, and comment regions in a container",
                Category::Privacy,
            )
            .with_capabilities([Capability::FsRead])
            .with_args([ArgSpec::new("input", ArgKind::Path)
                .required()
                .help("File to inspect")])
            .with_tags(["hb-scrub", "exif", "inspection"]),
        }
    }
}

impl Default for MetadataScan {
    fn default() -> Self {
        Self::new()
    }
}

impl Tool for MetadataScan {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::FsRead)?;
        let started = Instant::now();
        let (path, bytes) = read_input(args)?;
        let handler = handler_for(&bytes)?;
        let scan = handler.scan(&bytes)?;

        let mut report = Report::new(&self.manifest.id);
        if scan.metadata_bytes > 0 {
            report.add_finding(
                Severity::Medium,
                "metadata.present",
                format!(
                    "{} bytes of removable metadata: {}",
                    scan.metadata_bytes,
                    scan.removable_labels().join(", ")
                ),
            );
        }

        Ok(report
            .with_summary(format!(
                "{} · {} · {} segments · {} metadata bytes",
                path.display(),
                scan.format.as_str(),
                scan.segments.len(),
                scan.metadata_bytes
            ))
            .with_data(json!({
                "path": path.display().to_string(),
                "format": scan.format,
                "size_bytes": bytes.len(),
                "metadata_bytes": scan.metadata_bytes,
                "segments": scan.segments,
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

/// Fail if any removable metadata survives. This is the gate to run in CI.
pub struct MetadataVerify {
    manifest: ToolManifest,
}

impl MetadataVerify {
    pub fn new() -> Self {
        Self {
            manifest: ToolManifest::new(
                "privacy.metadata-verify",
                "Verify metadata removal",
                "Assert that a file carries no removable metadata",
                Category::Privacy,
            )
            .with_capabilities([Capability::FsRead])
            .with_args([ArgSpec::new("input", ArgKind::Path)
                .required()
                .help("File to verify")])
            .with_tags(["hb-scrub", "verification", "ci"]),
        }
    }
}

impl Default for MetadataVerify {
    fn default() -> Self {
        Self::new()
    }
}

impl Tool for MetadataVerify {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::FsRead)?;
        let started = Instant::now();
        let (path, bytes) = read_input(args)?;
        let handler = handler_for(&bytes)?;
        let scan = handler.scan(&bytes)?;

        let mut report = Report::new(&self.manifest.id);
        if scan.metadata_bytes > 0 {
            report.add_finding(
                Severity::High,
                "metadata.remaining",
                format!(
                    "{} still carries {} bytes of metadata: {}",
                    path.display(),
                    scan.metadata_bytes,
                    scan.removable_labels().join(", ")
                ),
            );
        }

        Ok(report
            .with_summary(if scan.metadata_bytes == 0 {
                format!("{} is clean ({})", path.display(), scan.format.as_str())
            } else {
                format!("{} carries metadata", path.display())
            })
            .with_data(json!({
                "path": path.display().to_string(),
                "format": scan.format,
                "metadata_bytes": scan.metadata_bytes,
                "removable_segments": scan.removable().map(|s| s.kind.clone()).collect::<Vec<_>>(),
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

/// Strip metadata in place or into a new file.
pub struct MetadataStrip {
    manifest: ToolManifest,
}

impl MetadataStrip {
    pub fn new() -> Self {
        Self {
            manifest: ToolManifest::new(
                "privacy.metadata-strip",
                "Remove metadata",
                "Rewrite a file without EXIF, GPS, XMP, comments, or text chunks",
                Category::Privacy,
            )
            .with_capabilities([Capability::FsRead, Capability::FsWrite])
            .with_args([
                ArgSpec::new("input", ArgKind::Path)
                    .required()
                    .help("File to clean"),
                ArgSpec::new("output", ArgKind::Path).help("Destination path"),
                ArgSpec::new("in_place", ArgKind::Boolean)
                    .default_value(Value::Bool(false))
                    .help("Overwrite the input file"),
            ])
            .with_tags(["hb-scrub", "exif", "privacy", "batch"]),
        }
    }
}

impl Default for MetadataStrip {
    fn default() -> Self {
        Self::new()
    }
}

impl Tool for MetadataStrip {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::FsRead)?;
        let started = Instant::now();
        let (input, bytes) = read_input(args)?;
        let target = target_path(&input, args)?;

        let handler = handler_for(&bytes)?;
        let before = handler.scan(&bytes)?;
        if before.metadata_bytes == 0 {
            return Ok(Report::new(&self.manifest.id)
                .with_summary(format!(
                    "{} already carries no removable metadata",
                    input.display()
                ))
                .with_data(json!({
                    "input": input.display().to_string(),
                    "output": Value::Null,
                    "format": before.format,
                    "removed_bytes": 0,
                    "dry_run": ctx.dry_run,
                }))
                .with_duration(started.elapsed())
                .sealed());
        }

        let cleaned = handler.strip(&bytes)?;
        verify_clean(&cleaned, &before)?;

        if !ctx.dry_run {
            ctx.require(Capability::FsWrite)?;
            if let Some(parent) = target.parent() {
                if !parent.as_os_str().is_empty() {
                    fs::create_dir_all(parent)?;
                }
            }
            fs::write(&target, &cleaned)?;
        }

        Ok(Report::new(&self.manifest.id)
            .with_summary(format!(
                "{} {} — removed {} bytes ({})",
                if ctx.dry_run { "would clean" } else { "cleaned" },
                input.display(),
                bytes.len().saturating_sub(cleaned.len()),
                before.removable_labels().join(", ")
            ))
            .with_data(json!({
                "input": input.display().to_string(),
                "output": if ctx.dry_run { Value::Null } else { Value::String(target.display().to_string()) },
                "format": before.format,
                "original_bytes": bytes.len(),
                "cleaned_bytes": cleaned.len(),
                "removed_bytes": bytes.len().saturating_sub(cleaned.len()),
                "dry_run": ctx.dry_run,
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

fn read_input(args: &Args) -> Result<(PathBuf, Vec<u8>)> {
    let path = args.require_path("input")?;
    if !path.exists() {
        return Err(MellivoraError::NotFound(path.display().to_string()));
    }
    let bytes = fs::read(&path)?;
    Ok((path, bytes))
}

fn target_path(input: &Path, args: &Args) -> Result<PathBuf> {
    let in_place = args.bool_or("in_place", false)?;
    let output = args.opt_path("output")?;
    match (in_place, output) {
        (true, Some(_)) => Err(MellivoraError::InvalidArgs(
            "'in_place' and 'output' are mutually exclusive".into(),
        )),
        (true, None) => Ok(input.to_path_buf()),
        (false, Some(path)) => Ok(path),
        (false, None) => Ok(default_output(input)),
    }
}

fn default_output(input: &Path) -> PathBuf {
    let stem = input
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    match input.extension() {
        Some(extension) => {
            input.with_file_name(format!("{stem}.clean.{}", extension.to_string_lossy()))
        }
        None => input.with_file_name(format!("{stem}.clean")),
    }
}

/// Re-scan the output before it is written: a strip that fails to strip is a
/// privacy bug, so it must surface as an error rather than a warning.
fn verify_clean(cleaned: &[u8], before: &ScanResult) -> Result<()> {
    let handler = handler_for(cleaned)?;
    let after = handler.scan(cleaned)?;
    if after.metadata_bytes > 0 {
        return Err(MellivoraError::Tool(format!(
            "strip incomplete for {}: {} bytes of metadata remain",
            before.format.as_str(),
            after.metadata_bytes
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mellivora_core::AppPaths;

    fn workspace() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mellivora-scrub-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("dir");
        dir
    }

    fn context() -> ToolContext {
        ToolContext::new(AppPaths::under(workspace())).with_dry_run(false)
    }

    fn jpeg_with_exif() -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xD8];
        let exif = b"Exif\0\0GPS-PAYLOAD";
        bytes.extend_from_slice(&[0xFF, 0xE1]);
        bytes.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        bytes.extend_from_slice(exif);
        bytes.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]);
        bytes.extend_from_slice(&[9, 9, 9, 9]);
        bytes.extend_from_slice(&[0xFF, 0xD9]);
        bytes
    }

    #[test]
    fn scan_flags_metadata() {
        let dir = workspace();
        let path = dir.join("scan.jpg");
        fs::write(&path, jpeg_with_exif()).expect("write");

        let mut args = Args::new();
        args.insert("input", path.display().to_string());
        let report = MetadataScan::new().run(&context(), &args).expect("scan");

        assert_eq!(report.status, mellivora_core::Status::Warning);
        assert!(report.data["metadata_bytes"].as_u64().unwrap() > 0);
    }

    #[test]
    fn strip_writes_a_clean_copy_by_default() {
        let dir = workspace();
        let path = dir.join("strip.jpg");
        fs::write(&path, jpeg_with_exif()).expect("write");

        let mut args = Args::new();
        args.insert("input", path.display().to_string());
        let report = MetadataStrip::new().run(&context(), &args).expect("strip");

        let output = dir.join("strip.clean.jpg");
        assert_eq!(
            report.data["output"].as_str(),
            Some(output.display().to_string().as_str())
        );

        let cleaned = fs::read(&output).expect("read output");
        assert!(!cleaned.windows(4).any(|w| w == b"Exif"));
        // The original is untouched.
        assert_eq!(fs::read(&path).expect("read input"), jpeg_with_exif());

        let mut verify_args = Args::new();
        verify_args.insert("input", output.display().to_string());
        let verified = MetadataVerify::new()
            .run(&context(), &verify_args)
            .expect("verify");
        assert_eq!(verified.status, mellivora_core::Status::Ok);
    }

    #[test]
    fn dry_run_does_not_write() {
        let dir = workspace();
        let path = dir.join("dry.jpg");
        fs::write(&path, jpeg_with_exif()).expect("write");

        let mut args = Args::new();
        args.insert("input", path.display().to_string());
        let report = MetadataStrip::new()
            .run(&context().with_dry_run(true), &args)
            .expect("dry run");

        assert_eq!(report.data["dry_run"], Value::Bool(true));
        assert!(!dir.join("dry.clean.jpg").exists());
    }

    #[test]
    fn conflicting_destination_is_rejected() {
        let dir = workspace();
        let path = dir.join("conflict.jpg");
        fs::write(&path, jpeg_with_exif()).expect("write");

        let mut args = Args::new();
        args.insert("input", path.display().to_string());
        args.insert("in_place", true);
        args.insert("output", dir.join("out.jpg").display().to_string());
        let err = MetadataStrip::new()
            .run(&context(), &args)
            .expect_err("must fail");
        assert_eq!(err.code(), "invalid_args");
    }

    #[test]
    fn unsupported_format_explains_itself() {
        let dir = workspace();
        let path = dir.join("notes.txt");
        fs::write(&path, b"plain text").expect("write");

        let mut args = Args::new();
        args.insert("input", path.display().to_string());
        let err = MetadataScan::new()
            .run(&context(), &args)
            .expect_err("must fail");
        assert_eq!(err.code(), "unsupported");
        assert!(err.to_string().contains("hb-scrub"));
    }

    #[test]
    fn in_place_overwrites_input() {
        let dir = workspace();
        let path = dir.join("inplace.jpg");
        fs::write(&path, jpeg_with_exif()).expect("write");

        let mut args = Args::new();
        args.insert("input", path.display().to_string());
        args.insert("in_place", true);
        MetadataStrip::new().run(&context(), &args).expect("strip");

        let cleaned = fs::read(&path).expect("read");
        assert!(!cleaned.windows(4).any(|w| w == b"Exif"));
    }
}
