//! Privacy module: byte-level metadata inspection and removal.
//!
//! Ported from HB_Scrub (NakiByte). The scaffold covers JPEG, PNG, and WebP
//! natively — the formats where a structure-aware strip is small and safe. The
//! remaining eleven formats stay in the TypeScript pack until they are ported,
//! which is exactly what the plugin protocol exists for.

mod format;
mod formats;
mod tools;

pub use format::{Format, FormatHandler, ScanResult, Segment};
pub use formats::png::{chunk as png_chunk, SIGNATURE as PNG_SIGNATURE};
pub use tools::{MetadataScan, MetadataStrip, MetadataVerify};

use std::sync::Arc;

use mellivora_core::{Result, Tool};

pub fn tools() -> Result<Vec<Arc<dyn Tool>>> {
    Ok(vec![
        Arc::new(MetadataScan::new()),
        Arc::new(MetadataStrip::new()),
        Arc::new(MetadataVerify::new()),
    ])
}
