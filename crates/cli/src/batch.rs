//! Batch execution: run one tool over many files.
//!
//! Privacy work is per-directory in practice, not per-file. This keeps the
//! per-file report — so a failure names its file — and folds the results into
//! one aggregate [`Report`] that every surface already knows how to render.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use mellivora_core::{
    Args, MellivoraError, OutputFormat, Report, Result, Severity, Status, Tool, ToolContext,
};
use serde_json::json;

const MAX_CONCURRENCY: usize = 32;
const MAX_WALK_DEPTH: usize = 16;

#[derive(Debug)]
pub struct BatchOptions {
    pub tool: String,
    pub paths: Vec<PathBuf>,
    pub args: Args,
    pub input_arg: String,
    pub concurrency: usize,
    pub fail_fast: bool,
    pub extensions: Vec<String>,
    pub recursive: bool,
}

struct Outcome {
    index: usize,
    path: PathBuf,
    duration_ms: u64,
    result: Result<Report>,
}

/// What a batch run produced. The caller decides the exit code, so the same
/// summary serves the CLI and any future surface.
#[derive(Debug, Clone)]
pub struct BatchSummary {
    pub status: Status,
    pub duration_ms: u64,
}

/// Run `tool` once per file and print an aggregate report.
pub fn execute(
    tool: Arc<dyn Tool>,
    context: &ToolContext,
    options: &BatchOptions,
    format: OutputFormat,
) -> Result<BatchSummary> {
    if options.args.as_map().contains_key(&options.input_arg) {
        return Err(MellivoraError::InvalidArgs(format!(
            "--arg {0}=… conflicts with --input-arg {0}: the file path would replace it",
            options.input_arg
        )));
    }

    let files = collect_files(&options.paths, &options.extensions, options.recursive)?;
    if files.is_empty() {
        return Err(MellivoraError::NotFound(format!(
            "no files to process in {}",
            describe_paths(&options.paths)
        )));
    }

    let started = Instant::now();
    let outcomes = run_all(&tool, context, options, &files);
    // Wall time, not the sum of per-file times: with `--concurrency 4` the two
    // differ by a factor of four, and the report's `duration_ms` is what the
    // audit trail records.
    let elapsed = started.elapsed();
    let report = aggregate(options, context.dry_run, &files, &outcomes, elapsed);
    let status = report.status;

    if format == OutputFormat::Text {
        for outcome in &outcomes {
            crate::outln!("{}", outcome_line(outcome));
        }
        crate::outln!();
        // Per-file lines already covered the file list; keep the summary tight.
        let mut display = report.clone();
        if let Some(map) = display.data.as_object_mut() {
            map.remove("files");
        }
        crate::out!("{}", display.render(format));
    } else {
        crate::out!("{}", report.render(format));
    }

    let skipped = files.len().saturating_sub(outcomes.len());
    if skipped > 0 {
        eprintln!("stopped after the first failure ({skipped} file(s) not processed)");
    }

    Ok(BatchSummary {
        status,
        duration_ms: report.duration_ms,
    })
}

/// Expand paths into a deterministic file list.
pub fn collect_files(
    paths: &[PathBuf],
    extensions: &[String],
    recursive: bool,
) -> Result<Vec<PathBuf>> {
    let wanted: Vec<String> = extensions
        .iter()
        .map(|ext| ext.trim_start_matches('.').to_ascii_lowercase())
        .filter(|ext| !ext.is_empty())
        .collect();

    let mut files = Vec::new();
    // Symlinks are followed, because a path the user names and a path found by
    // walking a directory should behave the same way. The visited set stops a
    // link cycle from walking forever.
    let mut visited: Vec<PathBuf> = Vec::new();
    for path in paths {
        if path.is_file() {
            if accepts(path, &wanted) {
                files.push(path.clone());
            }
            continue;
        }
        if path.is_dir() {
            let depth = if recursive { MAX_WALK_DEPTH } else { 1 };
            walk(path, &wanted, depth, &mut visited, &mut files)?;
            continue;
        }
        return Err(MellivoraError::NotFound(format!(
            "{} does not exist",
            path.display()
        )));
    }

    files.sort();
    files.dedup();
    Ok(files)
}

fn walk(
    dir: &Path,
    wanted: &[String],
    depth: usize,
    visited: &mut Vec<PathBuf>,
    out: &mut Vec<PathBuf>,
) -> Result<()> {
    if depth == 0 {
        return Ok(());
    }
    if let Ok(canonical) = dir.canonicalize() {
        if visited.contains(&canonical) {
            return Ok(());
        }
        visited.push(canonical);
    }

    let entries = std::fs::read_dir(dir)?;
    let mut real_dirs: Vec<PathBuf> = Vec::new();
    let mut linked_dirs: Vec<PathBuf> = Vec::new();

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        // `metadata` follows a link; `file_type` does not, which is how a
        // linked directory is told apart from a real one.
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        if metadata.is_dir() {
            if entry
                .file_type()
                .map(|kind| kind.is_symlink())
                .unwrap_or(false)
            {
                linked_dirs.push(path);
            } else {
                real_dirs.push(path);
            }
        } else if metadata.is_file() && accepts(&path, wanted) {
            out.push(path);
        }
    }

    // Real directories first: when a link and its target are both reachable,
    // the tree is walked once, by the real path. A link is only followed when
    // it points outside what has already been seen.
    for path in real_dirs.into_iter().chain(linked_dirs) {
        walk(&path, wanted, depth - 1, visited, out)?;
    }
    Ok(())
}

fn accepts(path: &Path, wanted: &[String]) -> bool {
    if wanted.is_empty() {
        return true;
    }
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            wanted
                .iter()
                .any(|candidate| candidate == &ext.to_ascii_lowercase())
        })
        .unwrap_or(false)
}

fn run_all(
    tool: &Arc<dyn Tool>,
    context: &ToolContext,
    options: &BatchOptions,
    files: &[PathBuf],
) -> Vec<Outcome> {
    let workers = options
        .concurrency
        .clamp(1, MAX_CONCURRENCY)
        .min(files.len().max(1));

    let queue = Mutex::new(files.iter().cloned().enumerate().collect::<VecDeque<_>>());
    let collected: Mutex<Vec<Outcome>> = Mutex::new(Vec::with_capacity(files.len()));
    let stop = AtomicBool::new(false);

    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| loop {
                if options.fail_fast && stop.load(Ordering::Relaxed) {
                    break;
                }
                let Some((index, path)) = queue.lock().expect("batch queue").pop_front() else {
                    break;
                };

                let mut args = options.args.clone();
                args.insert(&options.input_arg, path.display().to_string());

                let started = Instant::now();
                let result = tool.run(context, &args);
                let duration_ms = started.elapsed().as_millis() as u64;

                let failed = match &result {
                    Err(_) => true,
                    Ok(report) => report.status == Status::Error,
                };
                if failed && options.fail_fast {
                    stop.store(true, Ordering::Relaxed);
                }

                collected.lock().expect("batch results").push(Outcome {
                    index,
                    path,
                    duration_ms,
                    result,
                });
            });
        }
    });

    let mut outcomes = collected.into_inner().expect("batch results");
    outcomes.sort_by_key(|outcome| outcome.index);
    outcomes
}

fn aggregate(
    options: &BatchOptions,
    dry_run: bool,
    files: &[PathBuf],
    outcomes: &[Outcome],
    duration: Duration,
) -> Report {
    let mut report = Report::new(&options.tool);
    let (mut ok, mut warnings, mut errors) = (0usize, 0usize, 0usize);
    let mut entries = Vec::with_capacity(outcomes.len());

    for outcome in outcomes {
        let input = outcome.path.display().to_string();
        match &outcome.result {
            Ok(result) => {
                match result.status {
                    Status::Ok => ok += 1,
                    Status::Warning => {
                        warnings += 1;
                        // Findings drive the sealed status, so a warning
                        // file must leave one behind.
                        report.add_finding(
                            Severity::Medium,
                            "file-warning",
                            format!("{input}: {}", result.summary),
                        );
                    }
                    Status::Error => {
                        errors += 1;
                        report.add_finding(
                            Severity::High,
                            "file-failed",
                            format!("{input}: {}", result.summary),
                        );
                    }
                }
                entries.push(json!({
                    "input": input,
                    "status": result.status,
                    "summary": result.summary,
                    "findings": result.findings.len(),
                    "duration_ms": outcome.duration_ms,
                }));
            }
            Err(err) => {
                errors += 1;
                let message = err.to_string();
                report.add_finding(Severity::High, "file-failed", format!("{input}: {message}"));
                entries.push(json!({
                    "input": input,
                    "status": "error",
                    "error": message,
                    "duration_ms": outcome.duration_ms,
                }));
            }
        }
    }

    let processed = outcomes.len();
    let skipped = files.len().saturating_sub(processed);
    let mut summary = format!(
        "{processed} of {} file(s): {ok} ok, {warnings} warning(s), {errors} error(s)",
        files.len()
    );
    if options.fail_fast && skipped > 0 {
        summary.push_str(&format!(
            "; stopped after the first failure, {skipped} skipped"
        ));
    }

    report
        .with_summary(summary)
        .with_data(json!({
            "tool": options.tool,
            "input_arg": options.input_arg,
            "dry_run": dry_run,
            "total": files.len(),
            "processed": processed,
            "skipped": skipped,
            "ok": ok,
            "warning": warnings,
            "error": errors,
            "files": entries,
        }))
        .with_duration(duration)
        .sealed()
}

fn outcome_line(outcome: &Outcome) -> String {
    match &outcome.result {
        Ok(report) => format!(
            "{} {:<7} {}  ({})",
            report.status.symbol(),
            report.status.as_str(),
            outcome.path.display(),
            mellivora_core::util::human_duration(outcome.duration_ms)
        ),
        Err(err) => format!(
            "{} {:<7} {}  ({err})",
            Status::Error.symbol(),
            Status::Error.as_str(),
            outcome.path.display()
        ),
    }
}

fn describe_paths(paths: &[PathBuf]) -> String {
    let mut parts: Vec<String> = paths
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    if parts.len() > 3 {
        parts.truncate(3);
        parts.push("…".to_string());
    }
    parts.join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::Arc;

    use mellivora_core::{AppPaths, Tool};
    use serde_json::Value;

    fn workspace(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mellivora-batch-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    /// A tool that records the `input` argument it was given.
    struct Echo;

    impl Tool for Echo {
        fn manifest(&self) -> &mellivora_core::ToolManifest {
            static MANIFEST: std::sync::OnceLock<mellivora_core::ToolManifest> =
                std::sync::OnceLock::new();
            MANIFEST.get_or_init(|| {
                mellivora_core::ToolManifest::new(
                    "test.echo",
                    "Echo",
                    "reports the input",
                    mellivora_core::Category::Sysadmin,
                )
            })
        }

        fn run(&self, _ctx: &ToolContext, args: &Args) -> Result<Report> {
            let input = args
                .as_map()
                .get("input")
                .and_then(Value::as_str)
                .unwrap_or("<none>")
                .to_string();
            if input.contains("boom") {
                return Ok(Report::new("test.echo")
                    .with_summary(format!("failed on {input}"))
                    .with_status(Status::Error));
            }
            Ok(Report::new("test.echo")
                .with_summary(format!("saw {input}"))
                .sealed())
        }
    }

    fn options(paths: Vec<PathBuf>, concurrency: usize, fail_fast: bool) -> BatchOptions {
        BatchOptions {
            tool: "test.echo".into(),
            paths,
            args: Args::new(),
            input_arg: "input".into(),
            concurrency,
            fail_fast,
            extensions: Vec::new(),
            recursive: true,
        }
    }

    #[test]
    fn expands_directories_and_filters_extensions() {
        let dir = workspace("walk");
        fs::create_dir_all(dir.join("nested")).expect("mkdir");
        fs::write(dir.join("a.jpg"), b"x").expect("write");
        fs::write(dir.join("b.txt"), b"x").expect("write");
        fs::write(dir.join("nested/c.jpg"), b"x").expect("write");

        let all = collect_files(std::slice::from_ref(&dir), &[], true).expect("collect");
        assert_eq!(all.len(), 3);

        let jpgs =
            collect_files(std::slice::from_ref(&dir), &[".JPG".into()], true).expect("collect");
        assert_eq!(jpgs.len(), 2);
        assert!(jpgs.iter().all(|path| path.extension().unwrap() == "jpg"));

        let flat = collect_files(std::slice::from_ref(&dir), &[], false).expect("collect");
        assert_eq!(flat.len(), 2, "non-recursive skips nested entries");

        fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_followed_without_looping() {
        use std::os::unix::fs::symlink;

        let dir = workspace("symlinks");
        fs::create_dir_all(dir.join("real")).expect("mkdir");
        fs::write(dir.join("real/inside.png"), b"x").expect("write");

        // A link to a file, a link to a directory, and a cycle back to the root.
        symlink(dir.join("real/inside.png"), dir.join("file-link.png")).expect("symlink");
        symlink(dir.join("real"), dir.join("dir-link")).expect("symlink");
        symlink(&dir, dir.join("real/loop")).expect("symlink");

        let files = collect_files(std::slice::from_ref(&dir), &[], true).expect("collect");
        let names: Vec<String> = files
            .iter()
            .map(|path| {
                path.strip_prefix(&dir)
                    .unwrap_or(path)
                    .display()
                    .to_string()
            })
            .collect();

        // The tree is walked once, by its real path; the link to it is not a
        // second copy, and the cycle back to the root terminates.
        assert!(names.contains(&"real/inside.png".to_string()), "{names:?}");
        assert_eq!(
            names
                .iter()
                .filter(|name| name.ends_with("inside.png"))
                .count(),
            1,
            "each file is listed once: {names:?}"
        );
        assert!(names.contains(&"file-link.png".to_string()), "{names:?}");
        assert!(names.len() < 10, "the cycle must stop: {names:?}");

        fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn a_colliding_input_arg_is_refused() {
        let dir = workspace("collide");
        fs::create_dir_all(&dir).expect("mkdir");
        fs::write(dir.join("a.png"), b"x").expect("write");

        let mut opts = options(vec![dir.clone()], 1, false);
        opts.args.insert("input", "/somewhere/else.png");

        let tool: Arc<dyn Tool> = Arc::new(Echo);
        let context = ToolContext::new(AppPaths::under(&dir));
        let err = execute(tool, &context, &opts, OutputFormat::Text)
            .expect_err("a colliding argument must not be silently replaced");
        assert!(matches!(err, MellivoraError::InvalidArgs(_)), "{err}");
        assert!(err.to_string().contains("--input-arg"));

        fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn missing_paths_are_reported() {
        let missing = workspace("missing").join("nope");
        let err = collect_files(&[missing], &[], true).expect_err("must fail");
        assert!(matches!(err, MellivoraError::NotFound(_)));
    }

    #[test]
    fn aggregate_counts_every_outcome() {
        let dir = workspace("aggregate");
        fs::create_dir_all(&dir).expect("mkdir");
        for name in ["one.jpg", "two.jpg", "boom.jpg"] {
            fs::write(dir.join(name), b"x").expect("write");
        }

        let opts = options(vec![dir.clone()], 2, false);
        let files = collect_files(&opts.paths, &opts.extensions, true).expect("collect");
        let tool: Arc<dyn Tool> = Arc::new(Echo);
        let context = ToolContext::new(AppPaths::under(&dir));
        let outcomes = run_all(&tool, &context, &opts, &files);
        let report = aggregate(&opts, false, &files, &outcomes, Duration::from_millis(7));

        // The report carries the wall-clock duration it was given, not the sum
        // of the per-file times (which would be 7 * 3 here).
        assert_eq!(report.duration_ms, 7);
        assert_eq!(outcomes.len(), 3, "concurrency must not drop work");
        assert_eq!(report.data["total"], 3);
        assert_eq!(report.data["ok"], 2);
        assert_eq!(report.data["error"], 1);
        assert_eq!(report.data["skipped"], 0);
        assert_eq!(report.status, Status::Error);
        assert!(report
            .findings
            .iter()
            .any(|f| f.message.contains("boom.jpg")));

        fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn fail_fast_stops_early() {
        let dir = workspace("fail-fast");
        fs::create_dir_all(&dir).expect("mkdir");
        // Sorted order puts boom.jpg first, so the run stops immediately.
        for name in ["boom.jpg", "later-a.jpg", "later-b.jpg"] {
            fs::write(dir.join(name), b"x").expect("write");
        }

        let opts = options(vec![dir.clone()], 1, true);
        let files = collect_files(&opts.paths, &opts.extensions, true).expect("collect");
        let tool: Arc<dyn Tool> = Arc::new(Echo);
        let context = ToolContext::new(AppPaths::under(&dir));
        let outcomes = run_all(&tool, &context, &opts, &files);

        assert_eq!(outcomes.len(), 1, "single worker stops after the failure");
        let report = aggregate(&opts, false, &files, &outcomes, Duration::from_millis(1));
        assert_eq!(report.data["skipped"], 2);
        assert!(report.summary.contains("stopped after the first failure"));

        fs::remove_dir_all(&dir).expect("cleanup");
    }
}
