//! Language-agnostic plugin packs.
//!
//! A pack is any executable that speaks the line-delimited JSON-RPC protocol in
//! [`protocol`]. That is how the Perl Den script catalogue and the TypeScript
//! metadata scrubber join the toolkit without being rewritten first.

pub mod conformance;
pub mod host;
pub mod manifest;
pub mod protocol;

pub use conformance::{check as check_conformance, Check, ConformanceReport, Outcome};
pub use host::{discover, PackFailure, PackSummary, PluginHost, PluginTool, RunningPack};
pub use manifest::{
    find_manifest, manifest_path, PackManifest, LEGACY_MANIFEST_FILENAME, MANIFEST_FILENAME,
    MANIFEST_FILENAMES,
};
pub use protocol::PROTOCOL_VERSION;
