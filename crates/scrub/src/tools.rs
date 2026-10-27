use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use gimlet_eye_core::{
    ArgKind, ArgSpec, Args, Capability, Category, GimletEyeError, Report, Result, Severity, Tool,
    ToolContext, ToolManifest,
};
use serde_json::{json, Value};

use crate::exif::{self, GpsPrecision, GpsRedaction};
use crate::format::{handler_for, RemovalPolicy, SegmentCategory};

const PROFILES: [&str; 3] = ["privacy", "sharing", "archive"];
const GPS_PRECISIONS: [&str; 4] = ["off", "country", "region", "city"];

fn profile_arg() -> ArgSpec {
    ArgSpec::new(
        "profile",
        ArgKind::Enum {
            values: PROFILES.iter().map(|v| v.to_string()).collect(),
        },
    )
    .default_value(Value::from("privacy"))
    .help("privacy removes identity, text, and time; sharing keeps time; archive keeps all")
}

fn remove_arg() -> ArgSpec {
    ArgSpec::new("remove", ArgKind::String)
        .help("Comma-separated kinds or labels to remove regardless of profile (e.g. EXIF,tEXt)")
}

fn keep_arg() -> ArgSpec {
    ArgSpec::new("keep", ArgKind::String)
        .help("Comma-separated kinds or labels to keep; always wins over remove")
}

/// Resolve the profile plus explicit overrides into one policy.
fn policy_from_args(args: &Args) -> Result<RemovalPolicy> {
    let profile = args.str_or("profile", "privacy")?;
    let remove = args.opt_str("remove")?;
    let keep = args.opt_str("keep")?;
    let policy = RemovalPolicy::profile(&profile)?;
    Ok(policy.with_overrides(remove.as_deref(), keep.as_deref()))
}

fn gps_from_args(args: &Args) -> Result<GpsPrecision> {
    match args.opt_str("redact_gps")? {
        Some(value) => GpsPrecision::parse(&value),
        None => Ok(GpsPrecision::Off),
    }
}

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
            .with_args([
                ArgSpec::new("input", ArgKind::Path)
                    .required()
                    .help("File to inspect"),
                profile_arg(),
                remove_arg(),
                keep_arg(),
            ])
            .with_tags(["metadata", "exif", "inspection"]),
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
        let policy = policy_from_args(args)?;
        let (path, bytes) = read_input(args)?;
        let handler = handler_for(&bytes)?;
        let scan = handler.scan(&bytes)?;
        let planned = scan.removable_bytes(&policy);

        let mut report = Report::new(&self.manifest.id);
        if planned > 0 {
            report.add_finding(
                Severity::Medium,
                "metadata.present",
                format!(
                    "{} bytes removable under this policy: {}",
                    planned,
                    scan.planned_labels(&policy).join(", ")
                ),
            );
        }

        Ok(report
            .with_summary(format!(
                "{} · {} · {} segments · {} bytes removable ({})",
                path.display(),
                scan.format.as_str(),
                scan.segments.len(),
                planned,
                policy.describe()
            ))
            .with_data(json!({
                "path": path.display().to_string(),
                "format": scan.format,
                "size_bytes": bytes.len(),
                "metadata_bytes": scan.metadata_bytes,
                "removable_bytes": planned,
                "policy": policy,
                "segments": scan.segments,
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

/// Fail if any metadata selected by the policy survives. This is the gate to
/// run in CI, usually with the default `privacy` profile.
pub struct MetadataVerify {
    manifest: ToolManifest,
}

impl MetadataVerify {
    pub fn new() -> Self {
        Self {
            manifest: ToolManifest::new(
                "privacy.metadata-verify",
                "Verify metadata removal",
                "Assert that a file carries no metadata selected by the policy",
                Category::Privacy,
            )
            .with_capabilities([Capability::FsRead])
            .with_args([
                ArgSpec::new("input", ArgKind::Path)
                    .required()
                    .help("File to verify"),
                profile_arg(),
                remove_arg(),
                keep_arg(),
            ])
            .with_tags(["metadata", "verification", "ci"]),
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
        let policy = policy_from_args(args)?;
        let (path, bytes) = read_input(args)?;
        let handler = handler_for(&bytes)?;
        let scan = handler.scan(&bytes)?;
        let planned = scan.removable_bytes(&policy);

        let mut report = Report::new(&self.manifest.id);
        if planned > 0 {
            report.add_finding(
                Severity::High,
                "metadata.remaining",
                format!(
                    "{} still carries {} bytes of metadata: {}",
                    path.display(),
                    planned,
                    scan.planned_labels(&policy).join(", ")
                ),
            );
        }

        Ok(report
            .with_summary(if planned == 0 {
                format!("{} is clean under {} ({})", path.display(), policy.describe(), scan.format.as_str())
            } else {
                format!("{} carries metadata ({})", path.display(), policy.describe())
            })
            .with_data(json!({
                "path": path.display().to_string(),
                "format": scan.format,
                "metadata_bytes": scan.metadata_bytes,
                "removable_bytes": planned,
                "policy": policy,
                "removable_segments": scan.planned(&policy).map(|s| s.kind.clone()).collect::<Vec<_>>(),
            }))
            .with_duration(started.elapsed())
            .sealed())
    }
}

/// Strip metadata in place or into a new file, optionally redacting GPS first.
pub struct MetadataStrip {
    manifest: ToolManifest,
}

impl MetadataStrip {
    pub fn new() -> Self {
        Self {
            manifest: ToolManifest::new(
                "privacy.metadata-strip",
                "Remove metadata",
                "Rewrite a file without selected metadata, optionally reducing GPS precision instead of deleting it",
                Category::Privacy,
            )
            .with_capabilities([Capability::FsRead, Capability::FsWrite])
            .with_args([
                ArgSpec::new("input", ArgKind::Path).required().help("File to clean"),
                ArgSpec::new("output", ArgKind::Path).help("Destination path"),
                ArgSpec::new("in_place", ArgKind::Boolean)
                    .default_value(Value::Bool(false))
                    .help("Overwrite the input file"),
                ArgSpec::new("overwrite", ArgKind::Boolean)
                    .default_value(Value::Bool(false))
                    .help("Replace the output file if it exists"),
                profile_arg(),
                remove_arg(),
                keep_arg(),
                ArgSpec::new(
                    "redact_gps",
                    ArgKind::Enum { values: GPS_PRECISIONS.iter().map(|v| v.to_string()).collect() },
                )
                .default_value(Value::from("off"))
                .help("Reduce GPS precision in place instead of deleting EXIF (off, country, region, city)"),
            ])
            .with_tags(["metadata", "exif", "gps", "privacy", "batch"])
            .mutating(),
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
        let in_place = args.bool_or("in_place", false)?;
        let overwrite = args.bool_or("overwrite", false)?;
        let policy = policy_from_args(args)?;
        let precision = gps_from_args(args)?;

        // Rewriting the source in place is a decision the caller makes explicitly
        // with `in_place`; an `output` that happens to be the input would destroy
        // it by accident, since the byte-level rewrite starts from the file we
        // just read.
        if !in_place && same_file(&input, &target) {
            return Err(GimletEyeError::InvalidArgs(format!(
                "output {} is the input file; use in_place=true to rewrite it",
                target.display()
            )));
        }

        let handler = handler_for(&bytes)?;
        let before = handler.scan(&bytes)?;
        let planned_before = before.removable_bytes(&policy);

        let mut working = bytes.clone();
        let mut warnings: Vec<String> = Vec::new();
        let mut gps: Option<GpsRedaction> = None;

        if precision != GpsPrecision::Off {
            match redact_gps(&mut working, precision)? {
                Some(redaction) => gps = Some(redaction),
                None => warnings.push(format!(
                    "no GPS coordinates found; nothing to redact at '{}' precision",
                    precision.as_str()
                )),
            }
        }

        if let Some(redaction) = &gps {
            let strips_exif = before.segments.iter().any(|segment| {
                segment.category == SegmentCategory::Identity
                    && segment.label.to_uppercase().contains("EXIF")
                    && policy.should_remove(segment)
            });
            if strips_exif {
                warnings.push(format!(
                    "GPS was redacted to {} but the policy also removes EXIF, so the coordinates are gone entirely",
                    redaction.precision
                ));
            }
        }

        let cleaned = handler.strip_with(&working, &policy)?;
        verify_clean(&cleaned, &policy)?;

        let changed = cleaned != bytes;
        if !changed && planned_before == 0 {
            let mut report = Report::new(&self.manifest.id)
                .with_summary(format!(
                    "{} already carries no removable metadata ({})",
                    input.display(),
                    policy.describe()
                ))
                .with_data(json!({
                    "input": input.display().to_string(),
                    "output": Value::Null,
                    "format": before.format,
                    "removed_bytes": 0,
                    "policy": policy,
                    "gps": gps,
                    "dry_run": ctx.dry_run,
                }))
                .with_duration(started.elapsed());
            for warning in warnings {
                report.warn(warning);
            }
            return Ok(report.sealed());
        }

        if !ctx.dry_run && changed {
            ctx.require(Capability::FsWrite)?;
            // `in_place` is the explicit permission to replace the input; every
            // other destination is only replaceable on request.
            if !in_place && target.exists() && !overwrite {
                return Err(GimletEyeError::Config(format!(
                    "{} already exists (use overwrite=true to replace it)",
                    target.display()
                )));
            }
            if let Some(parent) = target.parent() {
                if !parent.as_os_str().is_empty() {
                    fs::create_dir_all(parent)?;
                }
            }
            write_atomic(&target, &cleaned)?;
        }

        let mut report = Report::new(&self.manifest.id)
            .with_summary(format!(
                "{} {} — removed {} bytes ({}){}",
                if ctx.dry_run { "would clean" } else { "cleaned" },
                input.display(),
                bytes.len().saturating_sub(cleaned.len()),
                policy.describe(),
                gps.as_ref()
                    .map(|g| format!(" · GPS reduced to {}", g.precision))
                    .unwrap_or_default()
            ))
            .with_data(json!({
                "input": input.display().to_string(),
                "output": if ctx.dry_run || !changed { Value::Null } else { Value::String(target.display().to_string()) },
                "format": before.format,
                "original_bytes": bytes.len(),
                "cleaned_bytes": cleaned.len(),
                "removed_bytes": bytes.len().saturating_sub(cleaned.len()),
                "policy": policy,
                "gps": gps,
                "dry_run": ctx.dry_run,
            }))
            .with_duration(started.elapsed());

        for warning in warnings {
            report.warn(warning);
        }

        Ok(report.sealed())
    }
}

/// Redact GPS in every EXIF block of the container, in place.
fn redact_gps(bytes: &mut [u8], precision: GpsPrecision) -> Result<Option<GpsRedaction>> {
    let ranges = exif::exif_ranges(bytes)?;
    let mut redaction = None;
    for range in ranges {
        if let Some(result) = exif::redact_gps_payload(&mut bytes[range], precision)? {
            redaction = Some(result);
        }
    }
    Ok(redaction)
}

fn read_input(args: &Args) -> Result<(PathBuf, Vec<u8>)> {
    let path = args.require_path("input")?;
    if !path.exists() {
        return Err(GimletEyeError::NotFound(path.display().to_string()));
    }
    let bytes = fs::read(&path)?;
    Ok((path, bytes))
}

fn target_path(input: &Path, args: &Args) -> Result<PathBuf> {
    let in_place = args.bool_or("in_place", false)?;
    let output = args.opt_path("output")?;
    match (in_place, output) {
        (true, Some(_)) => Err(GimletEyeError::InvalidArgs(
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

/// Do two paths name the same file? Compared after canonicalisation so a
/// relative spelling of the input is still recognised as the input.
fn same_file(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => left == right,
    }
}

/// Write beside the destination and rename into place.
///
/// A strip that stops halfway — a full disk, a signal, a bug — must not leave a
/// truncated photo at the destination, and with `in_place` the destination is
/// the only copy. The temporary file inherits the original's permissions, so
/// rewriting a `0600` file does not widen it.
fn write_atomic(target: &Path, bytes: &[u8]) -> Result<()> {
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let temp = target.with_file_name(format!("{name}.tmp"));
    let existing = fs::metadata(target).ok();

    let outcome = fs::write(&temp, bytes).and_then(|()| {
        if let Some(metadata) = &existing {
            fs::set_permissions(&temp, metadata.permissions())?;
        }
        fs::rename(&temp, target)
    });
    if let Err(err) = outcome {
        let _ = fs::remove_file(&temp);
        return Err(err.into());
    }
    Ok(())
}

/// Re-scan the output before it is written: a strip that fails to strip is a
/// privacy bug, so it must surface as an error rather than a warning.
fn verify_clean(cleaned: &[u8], policy: &RemovalPolicy) -> Result<()> {
    // The input scanned, so a failure here is about what the strip produced —
    // say that rather than reporting the caller's file as malformed.
    let handler = handler_for(cleaned)
        .map_err(|err| GimletEyeError::Tool(format!("strip left no readable container: {err}")))?;
    let after = handler
        .scan(cleaned)
        .map_err(|err| GimletEyeError::Tool(format!("strip left no readable container: {err}")))?;
    let remaining = after.removable_bytes(policy);
    if remaining > 0 {
        return Err(GimletEyeError::Tool(format!(
            "strip incomplete for {}: {} bytes of metadata remain",
            after.format.as_str(),
            remaining
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use gimlet_eye_core::AppPaths;

    fn workspace() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gimlet-eye-scrub-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("dir");
        dir
    }

    fn context() -> ToolContext {
        ToolContext::new(AppPaths::under(workspace())).with_dry_run(false)
    }

    /// JPEG whose EXIF block is a valid TIFF container without GPS.
    fn jpeg_with_exif() -> Vec<u8> {
        jpeg_with_segments(&crate::exif::fixtures::build_exif_without_gps(), None)
    }

    fn jpeg_with_exif_and_comment() -> Vec<u8> {
        jpeg_with_segments(
            &crate::exif::fixtures::build_exif_without_gps(),
            Some(b"hello"),
        )
    }

    fn jpeg_with_segments(exif: &[u8], comment: Option<&[u8]>) -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xD8];
        bytes.extend_from_slice(&[0xFF, 0xE1]);
        bytes.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        bytes.extend_from_slice(exif);
        if let Some(comment) = comment {
            bytes.extend_from_slice(&[0xFF, 0xFE]);
            bytes.extend_from_slice(&((comment.len() + 2) as u16).to_be_bytes());
            bytes.extend_from_slice(comment);
        }
        bytes.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]);
        bytes.extend_from_slice(&[9, 9, 9, 9]);
        bytes.extend_from_slice(&[0xFF, 0xD9]);
        bytes
    }

    fn jpeg_with_gps() -> Vec<u8> {
        use crate::exif::fixtures::build_exif;
        let exif = build_exif((51.0, 30.0, 26.46), (0.0, 7.0, 39.93), Some(35.0), "N", "W");
        let mut bytes = vec![0xFF, 0xD8];
        bytes.extend_from_slice(&[0xFF, 0xE1]);
        bytes.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        bytes.extend_from_slice(&exif);
        bytes.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]);
        bytes.extend_from_slice(&[9, 9, 9, 9]);
        bytes.extend_from_slice(&[0xFF, 0xD9]);
        bytes
    }

    fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, bytes).expect("write");
        path
    }

    fn args_for(path: &Path) -> Args {
        let mut args = Args::new();
        args.insert("input", path.display().to_string());
        args
    }

    #[test]
    fn scan_flags_metadata() {
        let dir = workspace();
        let path = write(&dir, "scan.jpg", &jpeg_with_exif());

        let report = MetadataScan::new()
            .run(&context(), &args_for(&path))
            .expect("scan");
        assert_eq!(report.status, gimlet_eye_core::Status::Warning);
        assert!(report.data["removable_bytes"].as_u64().unwrap() > 0);
    }

    #[test]
    fn archive_profile_reports_nothing_removable() {
        let dir = workspace();
        let path = write(&dir, "archive-scan.jpg", &jpeg_with_exif());

        let mut args = args_for(&path);
        args.insert("profile", "archive");
        let report = MetadataScan::new().run(&context(), &args).expect("scan");
        assert_eq!(report.status, gimlet_eye_core::Status::Ok);
        assert_eq!(report.data["removable_bytes"], Value::from(0));
    }

    #[test]
    fn strip_writes_a_clean_copy_by_default() {
        let dir = workspace();
        let path = write(&dir, "strip.jpg", &jpeg_with_exif());

        let report = MetadataStrip::new()
            .run(&context(), &args_for(&path))
            .expect("strip");
        let output = dir.join("strip.clean.jpg");
        assert_eq!(
            report.data["output"].as_str(),
            Some(output.display().to_string().as_str())
        );

        let cleaned = fs::read(&output).expect("read output");
        assert!(!cleaned.windows(4).any(|w| w == b"Exif"));
        assert_eq!(fs::read(&path).expect("read input"), jpeg_with_exif());

        let verified = MetadataVerify::new()
            .run(&context(), &args_for(&output))
            .expect("verify");
        assert_eq!(verified.status, gimlet_eye_core::Status::Ok);
    }

    #[test]
    fn archive_profile_keeps_metadata() {
        let dir = workspace();
        let path = write(&dir, "keep.jpg", &jpeg_with_exif());

        let mut args = args_for(&path);
        args.insert("profile", "archive");
        let report = MetadataStrip::new().run(&context(), &args).expect("strip");

        assert_eq!(report.data["removed_bytes"], Value::from(0));
        assert!(!dir.join("keep.clean.jpg").exists());
        assert_eq!(fs::read(&path).expect("read"), jpeg_with_exif());
    }

    #[test]
    fn keep_override_preserves_exif_while_removing_other_metadata() {
        let dir = workspace();
        let path = write(&dir, "keep-exif.jpg", &jpeg_with_exif_and_comment());

        let mut args = args_for(&path);
        args.insert("keep", "EXIF");
        MetadataStrip::new().run(&context(), &args).expect("strip");

        let cleaned = fs::read(dir.join("keep-exif.clean.jpg")).expect("read");
        assert!(cleaned.windows(4).any(|w| w == b"Exif"));
        assert!(!cleaned.windows(5).any(|w| w == b"hello"));
    }

    #[test]
    fn gps_redaction_keeps_exif_and_reduces_precision() {
        let dir = workspace();
        let path = write(&dir, "gps.jpg", &jpeg_with_gps());

        let mut args = args_for(&path);
        args.insert("profile", "archive");
        args.insert("redact_gps", "city");
        let report = MetadataStrip::new().run(&context(), &args).expect("redact");

        assert_eq!(report.data["gps"]["precision"], Value::from("city"));
        assert_eq!(report.data["gps"]["latitude"], Value::from(51.5));
        assert_eq!(report.data["gps"]["longitude"], Value::from(-0.12));
        assert!(report.warnings.is_empty(), "{:?}", report.warnings);

        let cleaned = fs::read(dir.join("gps.clean.jpg")).expect("read");
        assert!(
            cleaned.windows(4).any(|w| w == b"Exif"),
            "EXIF must survive redaction"
        );
        assert_ne!(cleaned, fs::read(&path).expect("original"));
    }

    #[test]
    fn gps_redaction_warns_when_policy_also_removes_exif() {
        let dir = workspace();
        let path = write(&dir, "gps-conflict.jpg", &jpeg_with_gps());

        let mut args = args_for(&path);
        args.insert("redact_gps", "region");
        let report = MetadataStrip::new().run(&context(), &args).expect("redact");
        assert!(
            report.warnings.iter().any(|w| w.contains("gone entirely")),
            "{:?}",
            report.warnings
        );
    }

    #[test]
    fn gps_redaction_warns_when_the_file_has_no_gps() {
        let dir = workspace();
        let path = write(&dir, "no-gps.jpg", &jpeg_with_exif());

        let mut args = args_for(&path);
        args.insert("profile", "archive");
        args.insert("redact_gps", "country");
        let report = MetadataStrip::new().run(&context(), &args).expect("redact");
        assert!(
            report.warnings.iter().any(|w| w.contains("no GPS")),
            "{:?}",
            report.warnings
        );
    }

    #[test]
    fn dry_run_does_not_write() {
        let dir = workspace();
        let path = write(&dir, "dry.jpg", &jpeg_with_exif());

        let report = MetadataStrip::new()
            .run(&context().with_dry_run(true), &args_for(&path))
            .expect("dry run");

        assert_eq!(report.data["dry_run"], Value::Bool(true));
        assert!(!dir.join("dry.clean.jpg").exists());
    }

    #[test]
    fn conflicting_destination_is_rejected() {
        let dir = workspace();
        let path = write(&dir, "conflict.jpg", &jpeg_with_exif());

        let mut args = args_for(&path);
        args.insert("in_place", true);
        args.insert("output", dir.join("out.jpg").display().to_string());
        let err = MetadataStrip::new()
            .run(&context(), &args)
            .expect_err("must fail");
        assert_eq!(err.code(), "invalid_args");
    }

    #[test]
    fn an_output_that_is_the_input_is_refused() {
        let dir = workspace();
        let path = write(&dir, "alias.jpg", &jpeg_with_exif());
        let original = fs::read(&path).expect("read");

        let mut args = args_for(&path);
        args.insert("output", path.display().to_string());
        let err = MetadataStrip::new()
            .run(&context(), &args)
            .expect_err("must refuse");
        assert_eq!(err.code(), "invalid_args");
        assert!(err.to_string().contains("in_place"), "{err}");
        assert_eq!(fs::read(&path).expect("intact"), original);
    }

    #[test]
    fn strip_refuses_to_replace_an_existing_output() {
        let dir = workspace();
        let path = write(&dir, "guard.jpg", &jpeg_with_exif());
        let output = write(&dir, "existing.jpg", b"do not touch");

        let mut args = args_for(&path);
        args.insert("output", output.display().to_string());
        let err = MetadataStrip::new()
            .run(&context(), &args)
            .expect_err("must refuse");
        assert_eq!(err.code(), "config");
        assert_eq!(fs::read(&output).expect("unchanged"), b"do not touch");

        args.insert("overwrite", true);
        MetadataStrip::new()
            .run(&context(), &args)
            .expect("overwrite");
        assert!(!fs::read(&output)
            .expect("read")
            .windows(4)
            .any(|w| w == b"Exif"));
    }

    #[test]
    fn a_rewrite_leaves_no_temporary_file_behind() {
        let dir = workspace();
        let path = write(&dir, "tidy.jpg", &jpeg_with_exif());

        let mut args = args_for(&path);
        args.insert("in_place", true);
        MetadataStrip::new().run(&context(), &args).expect("strip");

        assert!(!dir.join("tidy.jpg.tmp").exists(), "temp file removed");
    }

    #[cfg(unix)]
    #[test]
    fn in_place_rewrite_keeps_the_original_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = workspace();
        let path = write(&dir, "private.jpg", &jpeg_with_exif());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).expect("chmod");

        let mut args = args_for(&path);
        args.insert("in_place", true);
        MetadataStrip::new().run(&context(), &args).expect("strip");

        let mode = fs::metadata(&path).expect("metadata").permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn unknown_profile_is_rejected() {
        let dir = workspace();
        let path = write(&dir, "bad-profile.jpg", &jpeg_with_exif());

        let mut args = args_for(&path);
        args.insert("profile", "paranoid");
        let err = MetadataStrip::new()
            .run(&context(), &args)
            .expect_err("must fail");
        assert_eq!(err.code(), "invalid_args");
    }

    #[test]
    fn unsupported_format_explains_itself() {
        let dir = workspace();
        let path = write(&dir, "notes.txt", b"plain text");

        let err = MetadataScan::new()
            .run(&context(), &args_for(&path))
            .expect_err("must fail");
        assert_eq!(err.code(), "unsupported");
        assert!(err.to_string().contains("metadata pack"));
    }

    #[test]
    fn in_place_overwrites_input() {
        let dir = workspace();
        let path = write(&dir, "inplace.jpg", &jpeg_with_exif());

        let mut args = args_for(&path);
        args.insert("in_place", true);
        MetadataStrip::new().run(&context(), &args).expect("strip");

        let cleaned = fs::read(&path).expect("read");
        assert!(!cleaned.windows(4).any(|w| w == b"Exif"));
    }
}
