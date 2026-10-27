use std::fmt;
use std::str::FromStr;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{GimletEyeError, Result};

/// How urgent a single finding is. Distinct from [`Status`], which is the
/// aggregate verdict for a whole run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Critical => "critical",
        }
    }

    pub fn symbol(self) -> &'static str {
        match self {
            Self::Info => "i",
            Self::Low => "-",
            Self::Medium => "!",
            Self::High => "▲",
            Self::Critical => "✖",
        }
    }
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(self.as_str())
    }
}

/// Aggregate verdict for a run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Ok,
    Warning,
    Error,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Warning => "warning",
            Self::Error => "error",
        }
    }

    pub fn symbol(self) -> &'static str {
        match self {
            Self::Ok => "✔",
            Self::Warning => "!",
            Self::Error => "✖",
        }
    }
}

impl fmt::Display for Status {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Finding {
    pub severity: Severity,
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

impl Finding {
    pub fn new(severity: Severity, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            severity,
            code: code.into(),
            message: message.into(),
            target: None,
        }
    }

    pub fn with_target(mut self, target: impl Into<String>) -> Self {
        self.target = Some(target.into());
        self
    }
}

/// Output selectors shared by the CLI (`--format`) and the HTTP API.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    #[default]
    Text,
    Json,
    Markdown,
    Csv,
}

impl OutputFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Json => "json",
            Self::Markdown => "markdown",
            Self::Csv => "csv",
        }
    }
}

impl fmt::Display for OutputFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(self.as_str())
    }
}

impl FromStr for OutputFormat {
    type Err = GimletEyeError;

    fn from_str(value: &str) -> Result<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "text" | "plain" => Ok(Self::Text),
            "json" => Ok(Self::Json),
            "markdown" | "md" => Ok(Self::Markdown),
            "csv" => Ok(Self::Csv),
            other => Err(GimletEyeError::InvalidArgs(format!(
                "unknown output format '{other}'"
            ))),
        }
    }
}

/// The normalized result of every tool run. This is what makes one CLI, one
/// HTTP API, and one UI able to serve sysadmin checks, crypto operations, and
/// metadata scrubbing without special cases.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Report {
    pub tool: String,
    pub status: Status,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub findings: Vec<Finding>,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub data: Value,
    /// Human-facing body produced by the tool itself (for example a formatted
    /// report from a compat pack). Text/Markdown surfaces prefer it over a dump
    /// of `data`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub duration_ms: u64,
}

impl Report {
    pub fn new(tool: impl Into<String>) -> Self {
        Self {
            tool: tool.into(),
            status: Status::Ok,
            summary: String::new(),
            findings: Vec::new(),
            data: Value::Null,
            body: None,
            warnings: Vec::new(),
            duration_ms: 0,
        }
    }

    pub fn with_summary(mut self, summary: impl Into<String>) -> Self {
        self.summary = summary.into();
        self
    }

    pub fn with_body(mut self, body: impl Into<String>) -> Self {
        self.body = Some(body.into());
        self
    }

    pub fn with_data(mut self, data: impl Into<Value>) -> Self {
        self.data = data.into();
        self
    }

    pub fn with_status(mut self, status: Status) -> Self {
        self.status = status;
        self
    }

    pub fn with_duration(mut self, duration: Duration) -> Self {
        self.duration_ms = duration.as_millis().min(u128::from(u64::MAX)) as u64;
        self
    }

    pub fn push_finding(&mut self, finding: Finding) -> &mut Self {
        self.findings.push(finding);
        self
    }

    pub fn add_finding(&mut self, severity: Severity, code: &str, message: impl Into<String>) {
        self.findings.push(Finding::new(severity, code, message));
    }

    pub fn warn(&mut self, warning: impl Into<String>) -> &mut Self {
        self.warnings.push(warning.into());
        self
    }

    /// Derive the aggregate status from the findings, then return self. Tools
    /// call this last so a single `High` finding can never be reported as OK.
    pub fn sealed(mut self) -> Self {
        self.status = if self.findings.iter().any(|f| f.severity >= Severity::High) {
            Status::Error
        } else if self.findings.iter().any(|f| f.severity >= Severity::Medium) {
            Status::Warning
        } else {
            Status::Ok
        };
        self
    }

    pub fn render(&self, format: OutputFormat) -> String {
        match format {
            OutputFormat::Text => self.render_text(),
            OutputFormat::Json => serde_json::to_string_pretty(self)
                .unwrap_or_else(|err| format!("{{\"error\":\"{err}\"}}")),
            OutputFormat::Markdown => self.render_markdown(),
            OutputFormat::Csv => self.render_csv(),
        }
    }

    fn render_text(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!(
            "{} {}  ({} ms)\n",
            self.status.symbol(),
            self.tool,
            self.duration_ms
        ));
        if !self.summary.is_empty() {
            out.push_str(&format!("  {}\n", self.summary));
        }

        if !self.findings.is_empty() {
            out.push_str("\nFindings\n");
            for finding in &self.findings {
                out.push_str(&format!(
                    "  {} [{:<8}] {}: {}",
                    finding.severity.symbol(),
                    finding.severity.as_str(),
                    finding.code,
                    finding.message
                ));
                if let Some(target) = &finding.target {
                    out.push_str(&format!("  ({target})"));
                }
                out.push('\n');
            }
        }

        if let Some(body) = &self.body {
            out.push('\n');
            out.push_str(body.trim_end());
            out.push('\n');
        } else if !self.data.is_null() {
            out.push_str("\nData\n");
            let pretty = serde_json::to_string_pretty(&self.data).unwrap_or_default();
            for line in pretty.lines() {
                out.push_str("  ");
                out.push_str(line);
                out.push('\n');
            }
        }

        if !self.warnings.is_empty() {
            out.push_str("\nWarnings\n");
            for warning in &self.warnings {
                out.push_str(&format!("  - {warning}\n"));
            }
        }

        out
    }

    fn render_markdown(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!("## {}\n\n", self.tool));
        out.push_str(&format!(
            "**Status:** {} · **Duration:** {} ms\n\n",
            self.status, self.duration_ms
        ));
        if !self.summary.is_empty() {
            out.push_str(&format!("{}\n\n", self.summary));
        }

        if !self.findings.is_empty() {
            out.push_str("| Severity | Code | Message | Target |\n|---|---|---|---|\n");
            for finding in &self.findings {
                out.push_str(&format!(
                    "| {} | `{}` | {} | {} |\n",
                    finding.severity,
                    finding.code,
                    finding.message,
                    finding.target.clone().unwrap_or_default()
                ));
            }
            out.push('\n');
        }

        if let Some(body) = &self.body {
            out.push_str(body.trim_end());
            out.push_str("\n\n");
        } else if !self.data.is_null() {
            out.push_str("```json\n");
            out.push_str(&serde_json::to_string_pretty(&self.data).unwrap_or_default());
            out.push_str("\n```\n\n");
        }

        if !self.warnings.is_empty() {
            out.push_str("**Warnings**\n\n");
            for warning in &self.warnings {
                out.push_str(&format!("- {warning}\n"));
            }
        }

        out
    }

    fn render_csv(&self) -> String {
        let mut out = String::new();
        if let Value::Array(items) = &self.data {
            if items.iter().all(Value::is_object) {
                let mut columns: Vec<String> = Vec::new();
                for item in items {
                    if let Value::Object(map) = item {
                        for key in map.keys() {
                            if !columns.contains(key) {
                                columns.push(key.clone());
                            }
                        }
                    }
                }
                out.push_str(&columns.join(","));
                out.push('\n');
                for item in items {
                    let row: Vec<String> = columns
                        .iter()
                        .map(|column| csv_escape(item.get(column).unwrap_or(&Value::Null)))
                        .collect();
                    out.push_str(&row.join(","));
                    out.push('\n');
                }
                return out;
            }
        }

        out.push_str("key,value\n");
        if let Value::Object(map) = &self.data {
            for (key, value) in map {
                out.push_str(&format!(
                    "{},{}",
                    csv_escape(&Value::String(key.clone())),
                    csv_escape(value)
                ));
                out.push('\n');
            }
        }
        out
    }
}

fn csv_escape(value: &Value) -> String {
    let raw = match value {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    };
    if raw.contains(['"', ',', '\n']) {
        format!("\"{}\"", raw.replace('"', "\"\""))
    } else {
        raw
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_is_derived_from_findings() {
        let mut report = Report::new("demo");
        report.add_finding(Severity::Info, "info", "nothing to see");
        assert_eq!(report.clone().sealed().status, Status::Ok);

        report.add_finding(Severity::Medium, "warn", "watch this");
        assert_eq!(report.clone().sealed().status, Status::Warning);

        report.add_finding(Severity::Critical, "boom", "fix this");
        assert_eq!(report.sealed().status, Status::Error);
    }

    #[test]
    fn json_round_trip_preserves_report() {
        let report = Report::new("sysadmin.system-info")
            .with_summary("host example")
            .with_data(serde_json::json!({ "hostname": "example" }))
            .sealed();

        let encoded = serde_json::to_string(&report).expect("serialize");
        let decoded: Report = serde_json::from_str(&encoded).expect("deserialize");
        assert_eq!(report, decoded);
    }

    #[test]
    fn csv_renders_array_of_objects() {
        let report = Report::new("demo").with_data(
            serde_json::json!([{ "path": "/", "used": 10 }, { "path": "/home", "used": 3 }]),
        );
        let csv = report.render(OutputFormat::Csv);
        assert_eq!(csv, "path,used\n/,10\n/home,3\n");
    }

    #[test]
    fn text_rendering_marks_failures() {
        let mut report = Report::new("demo").with_summary("checked");
        report.add_finding(Severity::High, "perm", "world writable");
        let text = report.sealed().render(OutputFormat::Text);
        assert!(text.contains("✖ demo"));
        assert!(text.contains("[high    ] perm: world writable"));
    }
}
