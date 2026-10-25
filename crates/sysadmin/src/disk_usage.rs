use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

use mellivora_core::{
    Args, Capability, Category, MellivoraError, Report, Result, Severity, Tool, ToolContext,
    ToolManifest,
};
use serde_json::{json, Value};

use crate::parse::{parse_df, DiskRow};

/// Filesystem utilisation with configurable warning and critical thresholds.
pub struct DiskUsage {
    manifest: ToolManifest,
}

impl DiskUsage {
    pub fn new() -> Self {
        Self {
            manifest: ToolManifest::new(
                "sysadmin.disk-usage",
                "Disk usage",
                "Filesystem utilisation with warning and critical thresholds",
                Category::Sysadmin,
            )
            .with_capabilities([Capability::System, Capability::ProcessExec])
            .with_args([
                mellivora_core::ArgSpec::new("path", mellivora_core::ArgKind::Path)
                    .help("Restrict the report to the filesystem holding this path"),
                mellivora_core::ArgSpec::new("all", mellivora_core::ArgKind::Boolean)
                    .help("Include pseudo filesystems such as tmpfs")
                    .default_value(Value::Bool(false)),
            ])
            .with_tags(["inspection", "capacity", "filesystem"]),
        }
    }

    fn rows(&self, include_pseudo: bool) -> Result<Vec<DiskRow>> {
        let output = Command::new("df")
            .args(["-kP"])
            .output()
            .map_err(|err| MellivoraError::Tool(format!("failed to execute `df`: {err}")))?;
        if !output.status.success() {
            return Err(MellivoraError::Tool(format!(
                "`df` exited with status {}",
                output.status
            )));
        }
        let raw = String::from_utf8_lossy(&output.stdout);
        let rows = parse_df(&raw);

        Ok(rows
            .into_iter()
            .filter(|row| row.total_kb > 0)
            .filter(|row| include_pseudo || !is_pseudo(&row.filesystem))
            .collect())
    }
}

impl Default for DiskUsage {
    fn default() -> Self {
        Self::new()
    }
}

impl Tool for DiskUsage {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::System)?;
        let started = Instant::now();
        let include_pseudo = args.bool_or("all", false)?;
        let wanted_path = args.opt_path("path")?;

        let mut rows = self.rows(include_pseudo)?;
        if let Some(path) = &wanted_path {
            if !path.exists() {
                return Err(MellivoraError::NotFound(format!(
                    "{} does not exist",
                    path.display()
                )));
            }
            // `df` reports absolute mount points, so a relative `path=.` would
            // never match one until it is resolved.
            let path = absolute(path);
            rows.retain(|row| contains_path(&row.mount, &path));
            if rows.is_empty() {
                return Err(MellivoraError::NotFound(format!(
                    "no mounted filesystem contains {}",
                    path.display()
                )));
            }
            rows.sort_by_key(|row| std::cmp::Reverse(row.mount.len()));
            rows.truncate(1);
        }

        let warn = setting(ctx, "disk_warn_percent", 80.0);
        let critical = setting(ctx, "disk_critical_percent", 92.0);

        let mut report = Report::new(&self.manifest.id);
        for row in &rows {
            let percent = f64::from(row.use_percent);
            if percent >= critical {
                report.add_finding(
                    Severity::High,
                    "disk.critical",
                    format!("{} is {percent:.0}% full", row.mount),
                );
            } else if percent >= warn {
                report.add_finding(
                    Severity::Medium,
                    "disk.warning",
                    format!("{} is {percent:.0}% full", row.mount),
                );
            }
        }

        let tightest = rows.iter().map(|row| row.use_percent).max().unwrap_or(0);
        let data: Vec<Value> = rows
            .iter()
            .map(|row| {
                json!({
                    "filesystem": row.filesystem,
                    "mount": row.mount,
                    "total_kb": row.total_kb,
                    "used_kb": row.used_kb,
                    "available_kb": row.available_kb,
                    "use_percent": row.use_percent,
                })
            })
            .collect();

        Ok(report
            .with_summary(format!(
                "{} filesystem(s) checked, highest utilisation {tightest}%",
                rows.len()
            ))
            .with_data(Value::Array(data))
            .with_duration(started.elapsed())
            .sealed())
    }
}

fn is_pseudo(filesystem: &str) -> bool {
    matches!(
        filesystem,
        "tmpfs" | "devtmpfs" | "devfs" | "udev" | "none" | "efivarfs" | "squashfs"
    ) || filesystem.starts_with("cgroup")
}

fn contains_path(mount: &str, path: &Path) -> bool {
    path.starts_with(mount)
}

/// Resolve a user-supplied path so it can be compared with `df`'s mounts.
fn absolute(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn setting(ctx: &ToolContext, key: &str, default: f64) -> f64 {
    ctx.config
        .module("sysadmin")
        .and_then(|module| module.get(key))
        .and_then(|value| {
            value
                .as_float()
                .or_else(|| value.as_integer().map(|n| n as f64))
        })
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mellivora_core::AppPaths;

    #[test]
    fn filters_pseudo_filesystems() {
        assert!(is_pseudo("tmpfs"));
        assert!(is_pseudo("cgroup2"));
        assert!(!is_pseudo("/dev/nvme0n1p2"));
        assert!(!is_pseudo("overlay"));
    }

    #[test]
    fn matches_nested_paths() {
        assert!(contains_path("/", Path::new("/home/user")));
        assert!(contains_path("/home", Path::new("/home/user")));
        assert!(!contains_path("/home", Path::new("/var/log")));
    }

    #[test]
    fn relative_paths_are_resolved_before_matching() {
        let resolved = absolute(Path::new("."));
        assert!(resolved.is_absolute());
        assert_eq!(
            resolved,
            std::env::current_dir()
                .expect("cwd")
                .canonicalize()
                .expect("canonical cwd")
        );
    }

    #[test]
    fn a_relative_path_selects_its_filesystem() {
        if Command::new("df").arg("-kP").output().is_err() {
            return;
        }
        let ctx = ToolContext::new(AppPaths::under(
            std::env::temp_dir().join("mellivora-disk-relative"),
        ));
        let mut args = Args::new();
        args.insert("path", ".");
        let report = DiskUsage::new()
            .run(&ctx, &args)
            .expect("a relative path must resolve to its mount");
        assert_eq!(report.data.as_array().map(Vec::len), Some(1));
    }

    #[test]
    fn reports_real_filesystems() {
        if Command::new("df").arg("-kP").output().is_err() {
            return;
        }
        let ctx = ToolContext::new(AppPaths::under(std::env::temp_dir().join("mellivora-disk")));
        let report = DiskUsage::new().run(&ctx, &Args::new()).expect("run");
        let rows = report.data.as_array().expect("array");
        assert!(!rows.is_empty());
        assert!(rows.iter().any(|row| row["mount"] == "/"));
    }

    #[test]
    fn unknown_path_is_not_found() {
        if Command::new("df").arg("-kP").output().is_err() {
            return;
        }
        let ctx = ToolContext::new(AppPaths::under(
            std::env::temp_dir().join("mellivora-disk2"),
        ));
        let mut args = Args::new();
        args.insert("path", "/definitely/not/a/mount/point");
        let err = DiskUsage::new().run(&ctx, &args).expect_err("must fail");
        assert_eq!(err.code(), "not_found");
    }
}
