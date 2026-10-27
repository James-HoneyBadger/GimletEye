use gimlet_eye_core::{GimletEyeError, Result};
use serde::{Deserialize, Serialize};

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

/// Why a segment exists, which is what a removal policy reasons about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SegmentCategory {
    /// Device, author, or location identity: EXIF, XMP, IPTC, vendor blocks.
    Identity,
    /// Free-form text or comments.
    Text,
    /// Timestamps.
    Time,
    /// Container structure required to decode the image.
    Structural,
    /// Colour and rendering information.
    Color,
}

impl SegmentCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Identity => "identity",
            Self::Text => "text",
            Self::Time => "time",
            Self::Structural => "structural",
            Self::Color => "color",
        }
    }

    /// Only these may ever be removed; structure and colour are load-bearing.
    pub fn is_removable(self) -> bool {
        matches!(self, Self::Identity | Self::Text | Self::Time)
    }
}

impl std::fmt::Display for SegmentCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.pad(self.as_str())
    }
}

/// One structural region of a file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Segment {
    /// Container-specific tag, e.g. `APP1`, `tEXt`, `EXIF`.
    pub kind: String,
    /// Human-readable description.
    pub label: String,
    pub category: SegmentCategory,
    pub offset: usize,
    pub size: usize,
}

impl Segment {
    pub fn new(
        kind: impl Into<String>,
        label: impl Into<String>,
        category: SegmentCategory,
        offset: usize,
        size: usize,
    ) -> Self {
        Self {
            kind: kind.into(),
            label: label.into(),
            category,
            offset,
            size,
        }
    }

    /// Metadata that a policy is allowed to remove.
    pub fn is_metadata(&self) -> bool {
        self.category.is_removable()
    }
}

/// Which metadata a run should remove.
///
/// A profile sets the baseline; `remove` and `keep` are explicit overrides that
/// match either the segment kind (`tEXt`, `eXIf`, `COM`) or the start of its
/// label (`EXIF`, `XMP`, `Comment`), case-insensitively. `keep` always wins, so
/// a broad profile cannot be overridden by accident.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemovalPolicy {
    pub categories: Vec<SegmentCategory>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub remove: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keep: Vec<String>,
}

impl Default for RemovalPolicy {
    fn default() -> Self {
        Self::all()
    }
}

impl RemovalPolicy {
    /// Everything removable. The default, and what `privacy` means.
    pub fn all() -> Self {
        Self {
            categories: vec![
                SegmentCategory::Identity,
                SegmentCategory::Text,
                SegmentCategory::Time,
            ],
            remove: Vec::new(),
            keep: Vec::new(),
        }
    }

    /// Remove nothing (metadata is preserved).
    pub fn none() -> Self {
        Self {
            categories: Vec::new(),
            remove: Vec::new(),
            keep: Vec::new(),
        }
    }

    pub fn profile(name: &str) -> Result<Self> {
        match name.trim().to_ascii_lowercase().as_str() {
            "privacy" => Ok(Self::all()),
            // Sharing keeps timestamps (useful for sorting/archives) but drops
            // identity, location, and text.
            "sharing" => Ok(Self {
                categories: vec![SegmentCategory::Identity, SegmentCategory::Text],
                ..Self::none()
            }),
            // Archive keeps everything; pair it with GPS redaction to remove
            // location without losing camera and date information.
            "archive" => Ok(Self::none()),
            other => Err(GimletEyeError::InvalidArgs(format!(
                "unknown profile '{other}' (use privacy, sharing, or archive)"
            ))),
        }
    }

    /// Add explicit overrides; both lists accept comma-separated values.
    pub fn with_overrides(mut self, remove: Option<&str>, keep: Option<&str>) -> Self {
        self.remove.extend(split_list(remove));
        self.keep.extend(split_list(keep));
        self
    }

    pub fn should_remove(&self, segment: &Segment) -> bool {
        if !segment.is_metadata() {
            return false;
        }
        if self
            .keep
            .iter()
            .any(|needle| matches_segment(needle, segment))
        {
            return false;
        }
        if self
            .remove
            .iter()
            .any(|needle| matches_segment(needle, segment))
        {
            return true;
        }
        self.categories.contains(&segment.category)
    }

    /// Short description used in reports.
    pub fn describe(&self) -> String {
        let mut parts: Vec<String> = self.categories.iter().map(|c| c.to_string()).collect();
        if parts.is_empty() {
            parts.push("none".to_string());
        }
        let mut text = parts.join(", ");
        if !self.remove.is_empty() {
            text.push_str(&format!(" (+remove: {})", self.remove.join(",")));
        }
        if !self.keep.is_empty() {
            text.push_str(&format!(" (keep: {})", self.keep.join(",")));
        }
        text
    }
}

fn split_list(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

fn matches_segment(needle: &str, segment: &Segment) -> bool {
    let needle = needle.trim().to_ascii_lowercase();
    !needle.is_empty()
        && (segment.kind.to_ascii_lowercase() == needle
            || segment.label.to_ascii_lowercase().starts_with(&needle))
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanResult {
    pub format: Format,
    pub segments: Vec<Segment>,
    /// Bytes of metadata a default (remove-everything) policy would drop.
    pub metadata_bytes: usize,
}

impl ScanResult {
    pub fn metadata(&self) -> impl Iterator<Item = &Segment> {
        self.segments.iter().filter(|segment| segment.is_metadata())
    }

    /// Segments the given policy would remove.
    pub fn planned<'a>(&'a self, policy: &'a RemovalPolicy) -> impl Iterator<Item = &'a Segment> {
        self.segments
            .iter()
            .filter(move |segment| policy.should_remove(segment))
    }

    pub fn removable_bytes(&self, policy: &RemovalPolicy) -> usize {
        self.planned(policy).map(|segment| segment.size).sum()
    }

    pub fn removable_labels(&self) -> Vec<String> {
        let mut labels: Vec<String> = self
            .metadata()
            .map(|segment| segment.label.clone())
            .collect();
        labels.sort();
        labels.dedup();
        labels
    }

    pub fn planned_labels(&self, policy: &RemovalPolicy) -> Vec<String> {
        let mut labels: Vec<String> = self
            .planned(policy)
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

    /// Remove everything removable.
    fn strip(&self, bytes: &[u8]) -> Result<Vec<u8>> {
        self.strip_with(bytes, &RemovalPolicy::all())
    }

    /// Remove what the policy selects.
    fn strip_with(&self, bytes: &[u8], policy: &RemovalPolicy) -> Result<Vec<u8>> {
        let scan = self.scan(bytes)?;
        Ok(strip_ranges(bytes, &scan, policy))
    }
}

/// Resolve a handler or explain precisely what is supported.
pub fn handler_for(bytes: &[u8]) -> Result<Box<dyn FormatHandler>> {
    Format::detect(bytes).map(Format::handler).ok_or_else(|| {
        GimletEyeError::Unsupported(
            "unrecognised container; native support covers JPEG, PNG, and WebP \
             (install a metadata pack for HEIC, AVIF, TIFF, PDF, MP4, RAW, and others)"
                .to_string(),
        )
    })
}

/// Copy every byte the policy keeps, in order. Removed ranges never overlap
/// because they are whole container segments.
pub fn strip_ranges(bytes: &[u8], scan: &ScanResult, policy: &RemovalPolicy) -> Vec<u8> {
    let planned: Vec<&Segment> = scan.planned(policy).collect();
    let removed: usize = planned.iter().map(|segment| segment.size).sum();
    let mut out = Vec::with_capacity(bytes.len().saturating_sub(removed));
    let mut cursor = 0usize;
    for segment in planned {
        if segment.offset < cursor {
            continue;
        }
        out.extend_from_slice(&bytes[cursor..segment.offset]);
        cursor = segment.offset + segment.size;
    }
    out.extend_from_slice(&bytes[cursor.min(bytes.len())..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(kind: &str, label: &str, category: SegmentCategory) -> Segment {
        Segment::new(kind, label, category, 0, 10)
    }

    #[test]
    fn privacy_removes_all_metadata_categories() {
        let policy = RemovalPolicy::profile("privacy").expect("profile");
        assert!(policy.should_remove(&segment(
            "APP1",
            "EXIF (including GPS)",
            SegmentCategory::Identity
        )));
        assert!(policy.should_remove(&segment("COM", "Comment", SegmentCategory::Text)));
        assert!(policy.should_remove(&segment(
            "tIME",
            "Last modified time",
            SegmentCategory::Time
        )));
    }

    #[test]
    fn sharing_keeps_timestamps() {
        let policy = RemovalPolicy::profile("sharing").expect("profile");
        assert!(policy.should_remove(&segment(
            "APP1",
            "EXIF (including GPS)",
            SegmentCategory::Identity
        )));
        assert!(!policy.should_remove(&segment(
            "tIME",
            "Last modified time",
            SegmentCategory::Time
        )));
    }

    #[test]
    fn archive_keeps_everything() {
        let policy = RemovalPolicy::profile("archive").expect("profile");
        assert!(!policy.should_remove(&segment(
            "APP1",
            "EXIF (including GPS)",
            SegmentCategory::Identity
        )));
        assert!(!policy.should_remove(&segment(
            "tEXt",
            "Uncompressed text",
            SegmentCategory::Text
        )));
    }

    #[test]
    fn structural_and_colour_are_never_removed() {
        let policy = RemovalPolicy::all().with_overrides(Some("IHDR,gAMA"), None);
        assert!(!policy.should_remove(&segment(
            "IHDR",
            "Image header",
            SegmentCategory::Structural
        )));
        assert!(!policy.should_remove(&segment("gAMA", "Gamma", SegmentCategory::Color)));
    }

    #[test]
    fn keep_always_wins_over_explicit_remove() {
        let policy = RemovalPolicy::all().with_overrides(Some("tEXt"), Some("tEXt"));
        assert!(!policy.should_remove(&segment(
            "tEXt",
            "Uncompressed text",
            SegmentCategory::Text
        )));
    }

    #[test]
    fn overrides_can_widen_or_narrow_a_profile() {
        let archive = RemovalPolicy::profile("archive")
            .expect("profile")
            .with_overrides(Some("eXIf"), None);
        assert!(archive.should_remove(&segment("eXIf", "EXIF", SegmentCategory::Identity)));
        assert!(!archive.should_remove(&segment(
            "tEXt",
            "Uncompressed text",
            SegmentCategory::Text
        )));

        let privacy = RemovalPolicy::all().with_overrides(None, Some("EXIF"));
        assert!(!privacy.should_remove(&segment(
            "APP1",
            "EXIF (including GPS)",
            SegmentCategory::Identity
        )));
        assert!(privacy.should_remove(&segment("COM", "Comment", SegmentCategory::Text)));
    }

    #[test]
    fn rejects_unknown_profile() {
        let err = RemovalPolicy::profile("paranoid").expect_err("must reject");
        assert_eq!(err.code(), "invalid_args");
    }

    #[test]
    fn strip_ranges_keeps_bytes_outside_planned_segments() {
        let bytes: Vec<u8> = (0..10u8).collect();
        let scan = ScanResult {
            format: Format::Jpeg,
            segments: vec![
                Segment::new("A", "keep", SegmentCategory::Structural, 0, 3),
                Segment::new("B", "drop", SegmentCategory::Identity, 3, 2),
                Segment::new("C", "keep", SegmentCategory::Structural, 5, 5),
            ],
            metadata_bytes: 2,
        };
        let out = strip_ranges(&bytes, &scan, &RemovalPolicy::all());
        assert_eq!(out, vec![0, 1, 2, 5, 6, 7, 8, 9]);
    }
}
