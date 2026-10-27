use gimlet_eye_core::{GimletEyeError, Result};

use crate::format::{Format, FormatHandler, RemovalPolicy, ScanResult, Segment, SegmentCategory};

/// WebP (RIFF container) walker.
///
/// Removable: `EXIF` and `XMP ` chunks. When the file has a `VP8X` header, the
/// corresponding presence flags are cleared — but only for chunks actually
/// removed, so an `archive` profile leaves the header truthful.
#[derive(Debug, Default, Clone, Copy)]
pub struct WebpHandler;

impl FormatHandler for WebpHandler {
    fn format(&self) -> Format {
        Format::Webp
    }

    fn scan(&self, bytes: &[u8]) -> Result<ScanResult> {
        if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
            return Err(GimletEyeError::InvalidArgs(
                "not a WebP (bad RIFF header)".into(),
            ));
        }

        let mut segments = Vec::new();
        let mut metadata_bytes = 0usize;
        let mut pos = 12usize;

        while pos + 8 <= bytes.len() {
            let fourcc = String::from_utf8_lossy(&bytes[pos..pos + 4]).to_string();
            let size = u32::from_le_bytes([
                bytes[pos + 4],
                bytes[pos + 5],
                bytes[pos + 6],
                bytes[pos + 7],
            ]) as usize;
            let padded = size + (size % 2);
            let total = 8 + padded;
            if pos + total > bytes.len() {
                return Err(GimletEyeError::InvalidArgs(format!(
                    "malformed WebP: truncated '{fourcc}' chunk at offset {pos}"
                )));
            }

            let (label, category) = classify(&fourcc);
            if category.is_removable() {
                metadata_bytes += total;
            }
            segments.push(Segment::new(fourcc.clone(), label, category, pos, total));
            pos += total;
        }

        if segments.is_empty() {
            return Err(GimletEyeError::InvalidArgs(
                "malformed WebP: no chunks found".into(),
            ));
        }

        Ok(ScanResult {
            format: Format::Webp,
            segments,
            metadata_bytes,
        })
    }

    fn strip_with(&self, bytes: &[u8], policy: &RemovalPolicy) -> Result<Vec<u8>> {
        let scan = self.scan(bytes)?;

        let clears_exif = scan
            .segments
            .iter()
            .any(|segment| segment.kind == "EXIF" && policy.should_remove(segment));
        let clears_xmp = scan
            .segments
            .iter()
            .any(|segment| segment.kind == "XMP " && policy.should_remove(segment));

        let mut out = Vec::with_capacity(bytes.len());
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&[0, 0, 0, 0]);
        out.extend_from_slice(b"WEBP");

        for segment in &scan.segments {
            if policy.should_remove(segment) {
                continue;
            }
            let chunk = &bytes[segment.offset..segment.offset + segment.size];
            if segment.kind == "VP8X" && segment.size >= 9 && (clears_exif || clears_xmp) {
                // Copy the chunk, clearing only the flags for chunks we removed.
                let mut copy = chunk.to_vec();
                if clears_exif {
                    copy[8] &= !0x08;
                }
                if clears_xmp {
                    copy[8] &= !0x04;
                }
                out.extend_from_slice(&copy);
            } else {
                out.extend_from_slice(chunk);
            }
        }

        let riff_size = (out.len() - 8) as u32;
        out[4..8].copy_from_slice(&riff_size.to_le_bytes());
        Ok(out)
    }
}

fn classify(fourcc: &str) -> (String, SegmentCategory) {
    match fourcc {
        "VP8 " => ("Lossy image data".into(), SegmentCategory::Structural),
        "VP8L" => ("Lossless image data".into(), SegmentCategory::Structural),
        "VP8X" => ("Extended header".into(), SegmentCategory::Structural),
        "ALPH" => ("Alpha channel".into(), SegmentCategory::Structural),
        "ANIM" => ("Animation parameters".into(), SegmentCategory::Structural),
        "ANMF" => ("Animation frame".into(), SegmentCategory::Structural),
        "ICCP" => ("ICC profile".into(), SegmentCategory::Color),
        "EXIF" => ("EXIF (including GPS)".into(), SegmentCategory::Identity),
        "XMP " => ("XMP".into(), SegmentCategory::Identity),
        other => (other.to_string(), SegmentCategory::Structural),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(fourcc: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(fourcc);
        out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        out.extend_from_slice(payload);
        if payload.len() % 2 == 1 {
            out.push(0);
        }
        out
    }

    fn sample() -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(b"WEBP");
        // VP8X: flags byte with EXIF + XMP set, then reserved bytes.
        body.extend_from_slice(&chunk(b"VP8X", &[0x0C, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        body.extend_from_slice(&chunk(b"EXIF", b"FAKE-EXIF-DATA"));
        body.extend_from_slice(&chunk(b"XMP ", b"<xmp>fake</xmp>"));
        body.extend_from_slice(&chunk(b"VP8 ", b"pixel-data"));

        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend_from_slice(&body);
        out
    }

    #[test]
    fn finds_exif_and_xmp() {
        let scan = WebpHandler.scan(&sample()).expect("scan");
        assert_eq!(scan.removable_labels().len(), 2);
        assert!(scan.metadata_bytes > 0);
    }

    #[test]
    fn strip_removes_metadata_clears_flags_and_fixes_size() {
        let stripped = WebpHandler.strip(&sample()).expect("strip");
        assert!(!stripped.windows(4).any(|w| w == b"EXIF"));
        assert!(!stripped.windows(4).any(|w| w == b"XMP "));
        assert!(stripped.windows(4).any(|w| w == b"VP8 "));

        let declared = u32::from_le_bytes([stripped[4], stripped[5], stripped[6], stripped[7]]);
        assert_eq!(declared as usize, stripped.len() - 8);

        let vp8x = &stripped[20..29];
        assert_eq!(vp8x[0] & 0x0C, 0, "EXIF/XMP flags must be cleared");
        assert_eq!(
            WebpHandler.scan(&stripped).expect("rescan").metadata_bytes,
            0
        );
    }

    #[test]
    fn archive_profile_leaves_file_untouched() {
        let original = sample();
        let policy = RemovalPolicy::profile("archive").expect("profile");
        let kept = WebpHandler.strip_with(&original, &policy).expect("strip");
        assert_eq!(kept, original);
    }

    #[test]
    fn removing_only_xmp_keeps_the_exif_flag() {
        // The fixture has both flags set; remove just XMP.
        let policy = RemovalPolicy::none().with_overrides(Some("XMP"), None);
        let stripped = WebpHandler.strip_with(&sample(), &policy).expect("strip");
        assert!(stripped.windows(4).any(|w| w == b"EXIF"));
        assert!(!stripped.windows(4).any(|w| w == b"XMP "));
        // EXIF (0x08) stays set, XMP (0x04) is cleared.
        assert_eq!(stripped[20] & 0x08, 0x08);
        assert_eq!(stripped[20] & 0x04, 0x00);
    }

    #[test]
    fn rejects_non_webp() {
        let err = WebpHandler.scan(b"RIFFxxxxNOPE").expect_err("must fail");
        assert_eq!(err.code(), "invalid_args");
    }
}
