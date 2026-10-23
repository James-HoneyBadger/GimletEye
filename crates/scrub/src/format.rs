use mellivora_core::{MellivoraError, Result};
use serde::Serialize;

use crate::formats::{jpeg, png, webp};

/// Formats the native engine understands today.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Jpeg,
    Png,
    Webp,
}

impl Format {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Jpeg => "jpeg",
            Self::Png => "png",
            Self::Webp => "webp",
        }
    }

    /// Identify by magic bytes. Extension-based detection is deliberately not
    /// used: a `.jpg` that is really a PNG must not be mis-stripped.
    pub fn detect(bytes: &[u8]) -> Option<Self> {
        if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
            Some(Self::Jpeg)
        } else if bytes.starts_with(&png::SIGNATURE) {
            Some(Self::Png)
        } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            Some(Self::Webp)
        } else {
            None
        }
    }

    pub fn handler(self) -> Box<dyn FormatHandler> {
        match self {
            Self::Jpeg => Box::new(jpeg::JpegHandler),
            Self::Png => Box::new(png::PngHandler),
            Self::Webp => Box::new(webp::WebpHandler),
        }
    }
}

/// One structural region of a file: kept or removable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Segment {
    /// Container-specific tag, e.g. `APP1`, `tEXt`, `EXIF`.
    pub kind: String,
    /// Human-readable description.
    pub label: String,
    pub offset: usize,
    pub size: usize,
    pub removable: bool,
}

impl Segment {
    pub fn new(
        kind: impl Into<String>,
        label: impl Into<String>,
        offset: usize,
        size: usize,
        removable: bool,
    ) -> Self {
        Self {
            kind: kind.into(),
            label: label.into(),
            offset,
            size,
            removable,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanResult {
    pub format: Format,
    pub segments: Vec<Segment>,
    pub metadata_bytes: usize,
}

impl ScanResult {
    pub fn removable(&self) -> impl Iterator<Item = &Segment> {
        self.segments.iter().filter(|segment| segment.removable)
    }

    pub fn removable_labels(&self) -> Vec<String> {
        let mut labels: Vec<String> = self
            .removable()
            .map(|segment| segment.label.clone())
            .collect();
        labels.sort();
        labels.dedup();
        labels
    }
}

pub trait FormatHandler {
    fn format(&self) -> Format;
    fn scan(&self, bytes: &[u8]) -> Result<ScanResult>;
    fn strip(&self, bytes: &[u8]) -> Result<Vec<u8>>;
}

/// Resolve a handler or explain precisely what is supported.
pub fn handler_for(bytes: &[u8]) -> Result<Box<dyn FormatHandler>> {
    Format::detect(bytes).map(Format::handler).ok_or_else(|| {
        MellivoraError::Unsupported(
            "unrecognised container; native support covers JPEG, PNG, and WebP \
             (install the hb-scrub pack for HEIC, AVIF, TIFF, PDF, MP4, RAW, and others)"
                .to_string(),
        )
    })
}

/// Drop the removable ranges identified by `scan`, preserving every other byte.
pub fn strip_ranges(bytes: &[u8], scan: &ScanResult) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len().saturating_sub(scan.metadata_bytes));
    let mut cursor = 0usize;
    for segment in scan.removable() {
        if segment.offset < cursor {
            continue;
        }
        out.extend_from_slice(&bytes[cursor..segment.offset]);
        cursor = segment.offset + segment.size;
    }
    out.extend_from_slice(&bytes[cursor.min(bytes.len())..]);
    out
}
