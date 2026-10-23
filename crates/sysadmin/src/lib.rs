//! System administration module: native ports of the Perl Den script catalogue.
//!
//! Porting order is driven by risk, not by file count: read-only inspection
//! tools land first, anything that mutates state lands after it has a
//! `--dry-run` path and a test.

mod disk_usage;
mod parse;
mod system_info;

pub use disk_usage::DiskUsage;
pub use system_info::SystemInfo;

use std::sync::Arc;

use mellivora_core::{Result, Tool};

/// Every tool this module contributes.
pub fn tools() -> Result<Vec<Arc<dyn Tool>>> {
    Ok(vec![
        Arc::new(SystemInfo::new()),
        Arc::new(DiskUsage::new()),
    ])
}
