use std::fs;
use std::time::Instant;

use mellivora_core::{
    Args, Capability, Category, Report, Result, Severity, Tool, ToolContext, ToolManifest,
};
use serde_json::{json, Map, Value};

use crate::parse::{self, human_uptime};

/// Host snapshot: identity, kernel, uptime, load, CPU, and memory.
pub struct SystemInfo {
    manifest: ToolManifest,
}

impl SystemInfo {
    pub fn new() -> Self {
        Self {
            manifest: ToolManifest::new(
                "sysadmin.system-info",
                "System information",
                "Host identity, kernel, uptime, load, CPU, and memory snapshot",
                Category::Sysadmin,
            )
            .with_capabilities([Capability::System])
            .with_platforms(["linux"])
            .with_tags(["inspection", "snapshot", "host"]),
        }
    }
}

impl Default for SystemInfo {
    fn default() -> Self {
        Self::new()
    }
}

impl Tool for SystemInfo {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, _args: &Args) -> Result<Report> {
        ctx.require(Capability::System)?;
        let started = Instant::now();
        let mut report = Report::new(&self.manifest.id);
        let mut data = Map::new();

        let hostname = read_trim("/proc/sys/kernel/hostname");
        let kernel = read_trim("/proc/sys/kernel/osrelease");
        let os = fs::read_to_string("/etc/os-release")
            .ok()
            .map(|raw| parse::parse_os_release(&raw))
            .unwrap_or_default();

        data.insert("hostname".into(), json!(hostname));
        data.insert("kernel".into(), json!(kernel));
        data.insert("arch".into(), json!(std::env::consts::ARCH));
        if !os.is_empty() {
            data.insert(
                "os".into(),
                json!({
                    "id": os.get("ID"),
                    "name": os.get("NAME"),
                    "version": os.get("VERSION_ID"),
                    "pretty_name": os.get("PRETTY_NAME"),
                }),
            );
        }

        let uptime_seconds = fs::read_to_string("/proc/uptime")
            .ok()
            .and_then(|raw| parse::parse_uptime(&raw));
        if let Some(seconds) = uptime_seconds {
            data.insert(
                "uptime".into(),
                json!({ "seconds": seconds as u64, "human": human_uptime(seconds as u64) }),
            );
        } else {
            report.warn("/proc/uptime is not readable on this host");
        }

        let load = fs::read_to_string("/proc/loadavg")
            .ok()
            .and_then(|raw| parse::parse_loadavg(&raw));
        if let Some(load) = &load {
            data.insert(
                "load".into(),
                json!({
                    // `avg_` keeps the keys snake_case, which `Report.data`
                    // requires of every tool.
                    "avg_1m": load.load_1,
                    "avg_5m": load.load_5,
                    "avg_15m": load.load_15,
                    "running": load.running,
                    "total": load.total,
                }),
            );
        }

        let cpu = fs::read_to_string("/proc/cpuinfo")
            .ok()
            .map(|raw| parse::parse_cpuinfo(&raw))
            .unwrap_or_default();
        if cpu.cores > 0 {
            data.insert(
                "cpu".into(),
                json!({ "model": cpu.model, "cores": cpu.cores, "mhz": cpu.mhz }),
            );
        }

        let mem = fs::read_to_string("/proc/meminfo")
            .ok()
            .map(|raw| parse::parse_meminfo(&raw))
            .unwrap_or_default();
        let mut used_percent = 0.0_f64;
        if let (Some(total), Some(available)) = (mem.get("MemTotal"), mem.get("MemAvailable")) {
            if *total > 0 {
                let used = total.saturating_sub(*available);
                used_percent = used as f64 / *total as f64 * 100.0;
                data.insert(
                    "memory".into(),
                    json!({
                        "total_kb": total,
                        "available_kb": available,
                        "used_kb": used,
                        "used_percent": round1(used_percent),
                    }),
                );
            }
        }
        if let (Some(total), Some(free)) = (mem.get("SwapTotal"), mem.get("SwapFree")) {
            if *total > 0 {
                data.insert(
                    "swap".into(),
                    json!({
                        "total_kb": total,
                        "free_kb": free,
                        "used_percent": round1(total.saturating_sub(*free) as f64 / *total as f64 * 100.0),
                    }),
                );
            }
        }

        let memory_warn = setting(ctx, "memory_warn_percent", 90.0);
        if used_percent >= memory_warn {
            report.add_finding(
                Severity::High,
                "memory.pressure",
                format!(
                    "memory use is {:.1}% (threshold {memory_warn:.0}%)",
                    used_percent
                ),
            );
        }

        if let (Some(load), true) = (&load, cpu.cores > 0) {
            let per_core = load.load_1 / cpu.cores as f64;
            let load_warn = setting(ctx, "load_warn_per_core", 2.0);
            if per_core >= load_warn {
                report.add_finding(
                    Severity::Medium,
                    "load.high",
                    format!("1m load is {per_core:.2} per core (threshold {load_warn:.2})"),
                );
            }
        }

        if data.is_empty() {
            return Err(mellivora_core::MellivoraError::Unsupported(
                "no readable /proc entries; system-info targets Linux".into(),
            ));
        }

        let summary = format!(
            "{} · {} · {} cores · up {}",
            hostname.as_deref().unwrap_or("unknown host"),
            os.get("PRETTY_NAME")
                .cloned()
                .unwrap_or_else(|| "unknown OS".into()),
            cpu.cores,
            uptime_seconds
                .map(|s| human_uptime(s as u64))
                .unwrap_or_else(|| "unknown".into()),
        );

        Ok(report
            .with_summary(summary)
            .with_data(Value::Object(data))
            .with_duration(started.elapsed())
            .sealed())
    }
}

fn read_trim(path: &str) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
}

fn setting(ctx: &ToolContext, key: &str, default: f64) -> f64 {
    ctx.config
        .module("sysadmin")
        .and_then(|module| module.get(key))
        .and_then(|value| {
            value
                .as_float()
                .or_else(|| value.as_integer().map(|number| number as f64))
        })
        .unwrap_or(default)
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use mellivora_core::AppPaths;

    #[test]
    fn runs_on_linux_and_reports_host_data() {
        if !std::path::Path::new("/proc/uptime").exists() {
            return;
        }
        let ctx = ToolContext::new(AppPaths::under(
            std::env::temp_dir().join("mellivora-sysinfo"),
        ));
        let report = SystemInfo::new().run(&ctx, &Args::new()).expect("run");

        assert_eq!(report.tool, "sysadmin.system-info");
        assert!(report.data.get("hostname").is_some());
        assert!(report.data.get("cpu").is_some());
        assert!(report.summary.contains("cores"));
    }

    #[test]
    fn missing_capability_is_denied() {
        let ctx = ToolContext::new(AppPaths::under(
            std::env::temp_dir().join("mellivora-sysinfo2"),
        ))
        .with_capabilities(mellivora_core::CapabilitySet::none());
        let err = SystemInfo::new()
            .run(&ctx, &Args::new())
            .expect_err("denied");
        assert_eq!(err.code(), "capability_denied");
    }
}
