//! Pure parsers for `/proc` and `df` output.
//!
//! Kept free of I/O so they can be tested against fixtures, which is the
//! lesson worth carrying over from Perl Den's test suite.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub struct LoadAverage {
    pub load_1: f64,
    pub load_5: f64,
    pub load_15: f64,
    pub running: u64,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CpuInfo {
    pub model: Option<String>,
    pub cores: usize,
    pub mhz: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DiskRow {
    pub filesystem: String,
    pub total_kb: u64,
    pub used_kb: u64,
    pub available_kb: u64,
    pub use_percent: u8,
    pub mount: String,
}

/// `/proc/uptime` → seconds.
pub fn parse_uptime(raw: &str) -> Option<f64> {
    raw.split_whitespace().next()?.parse::<f64>().ok()
}

/// `/proc/loadavg` → load averages plus task counts.
pub fn parse_loadavg(raw: &str) -> Option<LoadAverage> {
    let mut fields = raw.split_whitespace();
    let load_1 = fields.next()?.parse().ok()?;
    let load_5 = fields.next()?.parse().ok()?;
    let load_15 = fields.next()?.parse().ok()?;
    let tasks = fields.next()?;
    let (running, total) = tasks.split_once('/')?;
    Some(LoadAverage {
        load_1,
        load_5,
        load_15,
        running: running.parse().ok()?,
        total: total.parse().ok()?,
    })
}

/// `/proc/meminfo` → field name to kilobytes.
pub fn parse_meminfo(raw: &str) -> BTreeMap<String, u64> {
    let mut values = BTreeMap::new();
    for line in raw.lines() {
        let Some((key, rest)) = line.split_once(':') else {
            continue;
        };
        let Some(first) = rest.split_whitespace().next() else {
            continue;
        };
        if let Ok(value) = first.parse::<u64>() {
            values.insert(key.trim().to_string(), value);
        }
    }
    values
}

/// `/proc/cpuinfo` → model, logical core count, and first reported clock.
pub fn parse_cpuinfo(raw: &str) -> CpuInfo {
    let mut info = CpuInfo::default();
    for line in raw.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        match key {
            "processor" => info.cores += 1,
            "model name" | "Processor" | "cpu model" if info.model.is_none() => {
                info.model = Some(value.to_string());
            }
            "cpu MHz" | "clock" if info.mhz.is_none() => {
                info.mhz = value.split_whitespace().next().and_then(|v| v.parse().ok());
            }
            _ => {}
        }
    }
    info
}

/// `/etc/os-release` → key/value pairs with quoting removed.
pub fn parse_os_release(raw: &str) -> BTreeMap<String, String> {
    let mut values = BTreeMap::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        values.insert(key.trim().to_string(), value);
    }
    values
}

/// `df -kP` output → rows. Long device names wrap onto their own line on some
/// systems; continuation lines are joined back onto the pending row instead of
/// being dropped.
pub fn parse_df(raw: &str) -> Vec<DiskRow> {
    let mut rows = Vec::new();
    let mut pending = String::new();

    for line in raw.lines().skip(1) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !pending.is_empty() {
            pending.push(' ');
        }
        pending.push_str(trimmed);

        let fields: Vec<&str> = pending.split_whitespace().collect();
        if fields.len() < 6 {
            continue;
        }

        let (Ok(total_kb), Ok(used_kb), Ok(available_kb)) = (
            fields[1].parse::<u64>(),
            fields[2].parse::<u64>(),
            fields[3].parse::<u64>(),
        ) else {
            pending.clear();
            continue;
        };
        let use_percent = fields[4].trim_end_matches('%').parse::<u8>().unwrap_or(0);
        rows.push(DiskRow {
            filesystem: fields[0].to_string(),
            total_kb,
            used_kb,
            available_kb,
            use_percent,
            // Mount points can contain spaces; everything after the capacity
            // column belongs to the mount point.
            mount: fields[5..].join(" "),
        });
        pending.clear();
    }

    rows
}

/// `86400` → `1d 0h 0m`.
pub fn human_uptime(seconds: u64) -> String {
    let days = seconds / 86_400;
    let hours = (seconds % 86_400) / 3_600;
    let minutes = (seconds % 3_600) / 60;
    format!("{days}d {hours}h {minutes}m")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_uptime() {
        assert_eq!(parse_uptime("12345.67 98765.43\n"), Some(12345.67));
        assert_eq!(parse_uptime("garbage"), None);
    }

    #[test]
    fn parses_loadavg() {
        let load = parse_loadavg("0.52 0.58 0.59 2/812 4321\n").expect("parse");
        assert!((load.load_1 - 0.52).abs() < f64::EPSILON);
        assert_eq!(load.running, 2);
        assert_eq!(load.total, 812);
    }

    #[test]
    fn parses_meminfo_kilobytes() {
        let mem = parse_meminfo(
            "MemTotal:       16316384 kB\nMemAvailable:    8123456 kB\nHugePages_Total:       0\n",
        );
        assert_eq!(mem.get("MemTotal"), Some(&16_316_384));
        assert_eq!(mem.get("MemAvailable"), Some(&8_123_456));
        // A field without a unit is still numeric.
        assert_eq!(mem.get("HugePages_Total"), Some(&0));
    }

    #[test]
    fn parses_cpuinfo_cores_and_model() {
        let raw = "\
processor\t: 0
model name\t: AMD Ryzen 7 PRO
cpu MHz\t\t: 3200.000

processor\t: 1
model name\t: AMD Ryzen 7 PRO
cpu MHz\t\t: 3200.000
";
        let cpu = parse_cpuinfo(raw);
        assert_eq!(cpu.cores, 2);
        assert_eq!(cpu.model.as_deref(), Some("AMD Ryzen 7 PRO"));
        assert_eq!(cpu.mhz, Some(3200.0));
    }

    #[test]
    fn parses_os_release_quotes() {
        let os = parse_os_release("NAME=\"Arch Linux\"\nID=arch\nPRETTY_NAME=\"Arch Linux\"\n");
        assert_eq!(os.get("NAME").map(String::as_str), Some("Arch Linux"));
        assert_eq!(os.get("ID").map(String::as_str), Some("arch"));
    }

    #[test]
    fn parses_df_rows_and_joins_wrapped_device_names() {
        let raw = "\
Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/nvme0n1p2   491226992 201234567 264922425      44% /
/dev/mapper/very-long-name
                102400     51200     51200      50% /mnt/data
tmpfs              8192000         0   8192000       0% /dev/shm
";
        let rows = parse_df(raw);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].mount, "/");
        assert_eq!(rows[0].use_percent, 44);
        assert_eq!(rows[1].mount, "/mnt/data");
        assert_eq!(rows[1].filesystem, "/dev/mapper/very-long-name");
        assert_eq!(rows[1].use_percent, 50);
        assert_eq!(rows[2].mount, "/dev/shm");
    }

    #[test]
    fn parses_df_mount_with_spaces() {
        let raw = "\
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/sdb1 1024 512 512 50% /media/My Disk
";
        let rows = parse_df(raw);
        assert_eq!(rows[0].mount, "/media/My Disk");
    }

    #[test]
    fn formats_uptime() {
        assert_eq!(human_uptime(90_061), "1d 1h 1m");
    }
}
