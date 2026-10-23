use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::report::Status;
use crate::util::now_rfc3339;

/// One audit record. Argument *names* are recorded, never values, so secrets
/// and file contents can never leak into the trail.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditEntry {
    pub ts: String,
    pub tool: String,
    pub status: Status,
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub arg_keys: Vec<String>,
}

impl AuditEntry {
    pub fn new(tool: impl Into<String>, status: Status, duration_ms: u64) -> Self {
        Self {
            ts: now_rfc3339(),
            tool: tool.into(),
            status,
            duration_ms,
            arg_keys: Vec::new(),
        }
    }

    pub fn with_arg_keys<I: IntoIterator<Item = String>>(mut self, keys: I) -> Self {
        self.arg_keys = keys.into_iter().collect();
        self
    }
}

/// Append-only JSON Lines audit trail, shared by every module.
#[derive(Debug, Clone)]
pub struct AuditLog {
    path: PathBuf,
    max_entries: usize,
}

impl AuditLog {
    pub fn new(path: impl Into<PathBuf>, max_entries: usize) -> Self {
        Self {
            path: path.into(),
            max_entries,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn record(&self, entry: &AuditEntry) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let line = serde_json::to_string(entry)?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        writeln!(file, "{line}")?;
        drop(file);
        self.prune()?;
        Ok(())
    }

    /// Most recent entries first, up to `limit`.
    pub fn tail(&self, limit: usize) -> Result<Vec<AuditEntry>> {
        let mut entries = self.read_all()?;
        entries.reverse();
        entries.truncate(limit);
        Ok(entries)
    }

    pub fn read_all(&self) -> Result<Vec<AuditEntry>> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let file = fs::File::open(&self.path)?;
        let mut entries = Vec::new();
        for line in BufReader::new(file).lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<AuditEntry>(&line) {
                Ok(entry) => entries.push(entry),
                Err(err) => tracing::warn!(%err, "skipping malformed audit record"),
            }
        }
        Ok(entries)
    }

    fn prune(&self) -> Result<()> {
        if self.max_entries == 0 {
            return Ok(());
        }
        let entries = self.read_all()?;
        if entries.len() <= self.max_entries {
            return Ok(());
        }
        let keep = &entries[entries.len() - self.max_entries..];
        let mut body = String::new();
        for entry in keep {
            body.push_str(&serde_json::to_string(entry)?);
            body.push('\n');
        }
        fs::write(&self.path, body)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mellivora-audit-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn records_and_reads_back() {
        let dir = temp_dir("basic");
        let log = AuditLog::new(dir.join("audit.jsonl"), 100);

        log.record(&AuditEntry::new("sysadmin.system-info", Status::Ok, 12))
            .expect("record");

        let entries = log.tail(10).expect("tail");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].tool, "sysadmin.system-info");
        assert_eq!(entries[0].status, Status::Ok);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn enforces_max_entries() {
        let dir = temp_dir("prune");
        let log = AuditLog::new(dir.join("audit.jsonl"), 3);
        for index in 0..10 {
            log.record(&AuditEntry::new(format!("tool-{index}"), Status::Ok, 1))
                .expect("record");
        }

        let entries = log.read_all().expect("read");
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[2].tool, "tool-9");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn argument_values_are_never_serialized() {
        let entry =
            AuditEntry::new("crypto.passgen", Status::Ok, 1).with_arg_keys(["length".to_string()]);
        let encoded = serde_json::to_string(&entry).expect("serialize");
        assert!(encoded.contains("arg_keys"));
        assert!(!encoded.contains("password"));
    }
}
