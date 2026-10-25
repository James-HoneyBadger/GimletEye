use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::PathBuf;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::Config;
use crate::error::{MellivoraError, Result};
use crate::paths::AppPaths;
use crate::report::Report;

/// Functional grouping used by every surface (CLI listing, UI navigation, docs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Sysadmin,
    Crypto,
    Privacy,
    Forensics,
    Automation,
    Developer,
}

impl Category {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sysadmin => "sysadmin",
            Self::Crypto => "crypto",
            Self::Privacy => "privacy",
            Self::Forensics => "forensics",
            Self::Automation => "automation",
            Self::Developer => "developer",
        }
    }
}

impl fmt::Display for Category {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(self.as_str())
    }
}

impl FromStr for Category {
    type Err = MellivoraError;

    fn from_str(value: &str) -> Result<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "sysadmin" | "system" => Ok(Self::Sysadmin),
            "crypto" => Ok(Self::Crypto),
            "privacy" => Ok(Self::Privacy),
            "forensics" => Ok(Self::Forensics),
            "automation" => Ok(Self::Automation),
            "developer" | "dev" => Ok(Self::Developer),
            other => Err(MellivoraError::InvalidArgs(format!(
                "unknown category '{other}'"
            ))),
        }
    }
}

/// A permission a tool needs before it may run. Plugin packs declare these in
/// their manifest and the host refuses to dispatch a tool whose pack was not
/// granted the capability, which is the sandbox boundary between packs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Capability {
    #[serde(rename = "fs:read")]
    FsRead,
    #[serde(rename = "fs:write")]
    FsWrite,
    #[serde(rename = "process:exec")]
    ProcessExec,
    #[serde(rename = "network")]
    Network,
    #[serde(rename = "secrets")]
    Secrets,
    #[serde(rename = "system")]
    System,
}

impl Capability {
    pub const ALL: [Capability; 6] = [
        Self::FsRead,
        Self::FsWrite,
        Self::ProcessExec,
        Self::Network,
        Self::Secrets,
        Self::System,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::FsRead => "fs:read",
            Self::FsWrite => "fs:write",
            Self::ProcessExec => "process:exec",
            Self::Network => "network",
            Self::Secrets => "secrets",
            Self::System => "system",
        }
    }
}

impl fmt::Display for Capability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(self.as_str())
    }
}

impl FromStr for Capability {
    type Err = MellivoraError;

    fn from_str(value: &str) -> Result<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "fs:read" => Ok(Self::FsRead),
            "fs:write" => Ok(Self::FsWrite),
            "process:exec" | "exec" => Ok(Self::ProcessExec),
            "network" | "net" => Ok(Self::Network),
            "secrets" => Ok(Self::Secrets),
            "system" => Ok(Self::System),
            other => Err(MellivoraError::InvalidArgs(format!(
                "unknown capability '{other}'"
            ))),
        }
    }
}

/// The set of capabilities a caller is permitted to exercise.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CapabilitySet(BTreeSet<Capability>);

impl CapabilitySet {
    pub fn none() -> Self {
        Self(BTreeSet::new())
    }

    pub fn all() -> Self {
        Self(Capability::ALL.into_iter().collect())
    }

    pub fn insert(&mut self, capability: Capability) -> &mut Self {
        self.0.insert(capability);
        self
    }

    pub fn contains(&self, capability: Capability) -> bool {
        self.0.contains(&capability)
    }

    /// Capabilities in `required` that are missing from this set.
    pub fn missing<'a>(&'a self, required: &'a [Capability]) -> Vec<Capability> {
        required
            .iter()
            .copied()
            .filter(|c| !self.contains(*c))
            .collect()
    }

    pub fn iter(&self) -> impl Iterator<Item = &Capability> {
        self.0.iter()
    }
}

impl FromIterator<Capability> for CapabilitySet {
    fn from_iter<I: IntoIterator<Item = Capability>>(iter: I) -> Self {
        Self(iter.into_iter().collect())
    }
}

/// Argument shape advertised by a tool so the CLI, UI, and API can render a
/// form or validate input without knowing anything about the implementation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ArgKind {
    String,
    Integer,
    Boolean,
    Path,
    Enum { values: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArgSpec {
    pub name: String,
    /// Flattened so the wire shape is `{ "name": "path", "type": "path" }`
    /// rather than a nested `kind` object. Consumers build forms from this.
    #[serde(flatten)]
    pub kind: ArgKind,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
}

impl ArgSpec {
    pub fn new(name: impl Into<String>, kind: ArgKind) -> Self {
        Self {
            name: name.into(),
            kind,
            required: false,
            default: None,
            help: None,
        }
    }

    pub fn required(mut self) -> Self {
        self.required = true;
        self
    }

    pub fn default_value(mut self, value: Value) -> Self {
        self.default = Some(value);
        self
    }

    pub fn help(mut self, help: impl Into<String>) -> Self {
        self.help = Some(help.into());
        self
    }
}

/// Untyped argument bag. `k=v` pairs from the CLI, JSON objects from the HTTP
/// API, and plugin payloads all normalize into this.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Args(BTreeMap<String, Value>);

impl Args {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, key: impl Into<String>, value: impl Into<Value>) -> &mut Self {
        self.0.insert(key.into(), value.into());
        self
    }

    pub fn as_map(&self) -> &BTreeMap<String, Value> {
        &self.0
    }

    pub fn from_map(map: BTreeMap<String, Value>) -> Self {
        Self(map)
    }

    pub fn into_map(self) -> BTreeMap<String, Value> {
        self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Parse `key=value` pairs from a CLI.
    ///
    /// Only text that survives a round trip is coerced: `true`/`false` and
    /// canonical integers (`32`, `-5`) become typed values, so tools and packs
    /// get numbers without a JSON detour. Everything else stays a string —
    /// `0123`, `+5`, and `-0` are what the user typed, and rewriting them would
    /// silently change a passphrase, a PIN, or a file name.
    pub fn from_pairs<I, K, V>(pairs: I) -> Result<Self>
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        let mut args = Self::new();
        for (key, raw) in pairs {
            let key = key.into();
            if key.is_empty() {
                return Err(MellivoraError::InvalidArgs("empty argument name".into()));
            }
            let raw = raw.into();
            let value = match raw.as_str() {
                "true" => Value::Bool(true),
                "false" => Value::Bool(false),
                other => match other.parse::<i64>() {
                    Ok(number) if number.to_string() == other => Value::from(number),
                    _ => Value::String(other.to_string()),
                },
            };
            args.0.insert(key, value);
        }
        Ok(args)
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.0.get(key)
    }

    pub fn opt_str(&self, key: &str) -> Result<Option<String>> {
        match self.0.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(value)) => Ok(Some(value.clone())),
            Some(other) => Ok(Some(match other {
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                _ => {
                    return Err(MellivoraError::InvalidArgs(format!(
                        "argument '{key}' must be a string"
                    )))
                }
            })),
        }
    }

    pub fn str_or(&self, key: &str, default: &str) -> Result<String> {
        Ok(self.opt_str(key)?.unwrap_or_else(|| default.to_string()))
    }

    pub fn require_str(&self, key: &str) -> Result<String> {
        self.opt_str(key)?.ok_or_else(|| {
            MellivoraError::InvalidArgs(format!("missing required argument '{key}'"))
        })
    }

    pub fn opt_bool(&self, key: &str) -> Result<Option<bool>> {
        match self.0.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Bool(value)) => Ok(Some(*value)),
            Some(Value::String(value)) => match value.to_ascii_lowercase().as_str() {
                "true" | "yes" | "1" => Ok(Some(true)),
                "false" | "no" | "0" => Ok(Some(false)),
                _ => Err(MellivoraError::InvalidArgs(format!(
                    "argument '{key}' must be a boolean"
                ))),
            },
            Some(_) => Err(MellivoraError::InvalidArgs(format!(
                "argument '{key}' must be a boolean"
            ))),
        }
    }

    pub fn bool_or(&self, key: &str, default: bool) -> Result<bool> {
        Ok(self.opt_bool(key)?.unwrap_or(default))
    }

    pub fn opt_u64(&self, key: &str) -> Result<Option<u64>> {
        match self.0.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Number(number)) => number.as_u64().map(Some).ok_or_else(|| {
                MellivoraError::InvalidArgs(format!(
                    "argument '{key}' must be a non-negative integer"
                ))
            }),
            Some(Value::String(value)) => value.parse::<u64>().map(Some).map_err(|_| {
                MellivoraError::InvalidArgs(format!(
                    "argument '{key}' must be a non-negative integer"
                ))
            }),
            Some(_) => Err(MellivoraError::InvalidArgs(format!(
                "argument '{key}' must be a non-negative integer"
            ))),
        }
    }

    pub fn u64_or(&self, key: &str, default: u64) -> Result<u64> {
        Ok(self.opt_u64(key)?.unwrap_or(default))
    }

    pub fn opt_path(&self, key: &str) -> Result<Option<PathBuf>> {
        Ok(self.opt_str(key)?.map(PathBuf::from))
    }

    pub fn require_path(&self, key: &str) -> Result<PathBuf> {
        self.opt_path(key)?.ok_or_else(|| {
            MellivoraError::InvalidArgs(format!("missing required argument '{key}'"))
        })
    }
}

/// Metadata every tool exposes. Mirrored over the plugin protocol, so this is
/// also the wire schema for a pack's tool listing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolManifest {
    /// Fully-qualified, stable identifier, e.g. `sysadmin.system-info`.
    pub id: String,
    pub title: String,
    pub summary: String,
    pub category: Category,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<Capability>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<ArgSpec>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// `builtin` or `plugin:<pack-name>`.
    #[serde(default = "default_origin")]
    pub origin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Whether the tool may write to the host. Surfaces use this to offer a
    /// dry run only where it changes the outcome, and to warn before a run.
    #[serde(default)]
    pub mutates: bool,
    /// Operating systems this tool supports, by `std::env::consts::OS` name.
    /// Empty means everywhere; anything else is enforced by the registry.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub platforms: Vec<String>,
}

fn default_origin() -> String {
    "builtin".to_string()
}

impl ToolManifest {
    pub fn new(
        id: impl Into<String>,
        title: impl Into<String>,
        summary: impl Into<String>,
        category: Category,
    ) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            summary: summary.into(),
            category,
            capabilities: Vec::new(),
            args: Vec::new(),
            tags: Vec::new(),
            origin: default_origin(),
            version: None,
            mutates: false,
            platforms: Vec::new(),
        }
    }

    pub fn with_capabilities<I: IntoIterator<Item = Capability>>(mut self, caps: I) -> Self {
        self.capabilities = caps.into_iter().collect();
        self
    }

    pub fn with_args<I: IntoIterator<Item = ArgSpec>>(mut self, args: I) -> Self {
        self.args = args.into_iter().collect();
        self
    }

    pub fn with_tags<I: IntoIterator<Item = impl Into<String>>>(mut self, tags: I) -> Self {
        self.tags = tags.into_iter().map(Into::into).collect();
        self
    }

    pub fn with_origin(mut self, origin: impl Into<String>) -> Self {
        self.origin = origin.into();
        self
    }

    /// Declare that this tool can write to the host.
    pub fn mutating(mut self) -> Self {
        self.mutates = true;
        self
    }

    /// Restrict the tool to the given operating systems (`linux`, `macos`, …).
    pub fn with_platforms<I: IntoIterator<Item = impl Into<String>>>(
        mut self,
        platforms: I,
    ) -> Self {
        self.platforms = platforms.into_iter().map(Into::into).collect();
        self
    }
}

/// Runtime context handed to a tool. Tools must not reach for globals; paths,
/// dry-run intent, and the granted capability set all arrive here, which makes
/// tools trivially testable.
#[derive(Debug, Clone)]
pub struct ToolContext {
    pub paths: AppPaths,
    pub config: Config,
    pub dry_run: bool,
    pub granted: CapabilitySet,
}

impl ToolContext {
    pub fn new(paths: AppPaths) -> Self {
        Self {
            paths,
            config: Config::default(),
            dry_run: false,
            granted: CapabilitySet::all(),
        }
    }

    pub fn with_config(mut self, config: Config) -> Self {
        self.config = config;
        self
    }

    pub fn with_dry_run(mut self, dry_run: bool) -> Self {
        self.dry_run = dry_run;
        self
    }

    pub fn with_capabilities(mut self, granted: CapabilitySet) -> Self {
        self.granted = granted;
        self
    }

    pub fn require(&self, capability: Capability) -> Result<()> {
        if self.granted.contains(capability) {
            Ok(())
        } else {
            Err(MellivoraError::CapabilityDenied(capability.to_string()))
        }
    }
}

/// The one trait every capability implements.
pub trait Tool: Send + Sync {
    fn manifest(&self) -> &ToolManifest;

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arg_spec_serializes_with_a_flat_type_field() {
        let spec = ArgSpec::new("path", ArgKind::Path).required();
        let value = serde_json::to_value(&spec).expect("serialize");

        assert_eq!(value["name"], "path");
        assert_eq!(value["type"], "path");
        assert_eq!(value["required"], true);
        assert!(value.get("kind").is_none(), "kind must be flattened");

        let decoded: ArgSpec = serde_json::from_value(value).expect("deserialize");
        assert_eq!(decoded, spec);
    }

    #[test]
    fn manifests_default_to_read_only() {
        let plain = ToolManifest::new("demo", "Demo", "reads only", Category::Sysadmin);
        assert!(!plain.mutates);
        assert!(
            ToolManifest::new("demo", "Demo", "writes", Category::Crypto)
                .mutating()
                .mutates
        );

        // Packs that predate the field stay loadable and read-only.
        let legacy: ToolManifest =
            serde_json::from_value(serde_json::json!({ "id": "pack.tool", "title": "T", "summary": "S", "category": "sysadmin" }))
                .expect("legacy manifest deserializes");
        assert!(!legacy.mutates);
    }

    #[test]
    fn cli_pairs_keep_text_that_only_looks_numeric() {
        let args = Args::from_pairs([
            ("passphrase", "0123"),
            ("text", "+5"),
            ("input", "-0"),
            ("length", "32"),
            ("negative", "-5"),
            ("flag", "true"),
        ])
        .expect("parse");

        // Text the user typed survives verbatim.
        assert_eq!(args.get("passphrase"), Some(&Value::from("0123")));
        assert_eq!(args.get("text"), Some(&Value::from("+5")));
        assert_eq!(args.get("input"), Some(&Value::from("-0")));
        assert_eq!(args.require_str("input").expect("input"), "-0");

        // Canonical numbers still arrive typed.
        assert_eq!(args.get("length"), Some(&Value::from(32)));
        assert_eq!(args.get("negative"), Some(&Value::from(-5)));
        assert_eq!(args.u64_or("length", 0).expect("length"), 32);
        assert_eq!(args.get("flag"), Some(&Value::Bool(true)));
        assert!(args.bool_or("flag", false).expect("flag"));
    }

    #[test]
    fn enum_arguments_carry_their_values() {
        let spec = ArgSpec::new(
            "algorithm",
            ArgKind::Enum {
                values: vec!["a".into(), "b".into()],
            },
        )
        .default_value(Value::from("a"));
        let value = serde_json::to_value(&spec).expect("serialize");

        assert_eq!(value["type"], "enum");
        assert_eq!(value["values"][1], "b");
        assert_eq!(value["default"], "a");
    }
}
