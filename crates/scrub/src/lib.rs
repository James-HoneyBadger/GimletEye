//! Privacy module: byte-level metadata inspection, redaction, and removal.
//!
//! Metadata is removed at the container level, so pixel data is never
//! re-encoded. JPEG, PNG, and WebP are handled natively; other containers are
//! served by packs, which is exactly what the plugin protocol exists for.

mod exif;
mod format;
mod formats;
mod tools;

pub use exif::{exif_ranges, redact_gps_payload, GpsPrecision, GpsRedaction};
pub use format::{
    handler_for, Format, FormatHandler, RemovalPolicy, ScanResult, Segment, SegmentCategory,
};
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
