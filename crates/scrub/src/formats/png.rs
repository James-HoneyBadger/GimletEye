use gimlet_eye_core::{GimletEyeError, Result};

use crate::format::{Format, FormatHandler, ScanResult, Segment, SegmentCategory};

pub const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// PNG chunk walker.
///
/// Removable: `tEXt`, `zTXt`, `iTXt`, `eXIf`, `tIME`. Everything that affects
/// rendering (`IHDR`, `PLTE`, `IDAT`, `IEND`, colour/transparency chunks) is
/// preserved, and because chunks are independently CRC'd, removal requires no
/// re-encoding.
#[derive(Debug, Default, Clone, Copy)]
pub struct PngHandler;

impl FormatHandler for PngHandler {
    fn format(&self) -> Format {
        Format::Png
    }

    fn scan(&self, bytes: &[u8]) -> Result<ScanResult> {
        if !bytes.starts_with(&SIGNATURE) {
            return Err(GimletEyeError::InvalidArgs(
                "not a PNG (bad signature)".into(),
            ));
        }

        let mut segments = Vec::new();
        let mut metadata_bytes = 0usize;
        let mut pos = SIGNATURE.len();

        while pos + 12 <= bytes.len() {
            let length =
                u32::from_be_bytes([bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]])
                    as usize;
            let kind = String::from_utf8_lossy(&bytes[pos + 4..pos + 8]).to_string();
            let total = 12 + length;
            if pos + total > bytes.len() {
                return Err(GimletEyeError::InvalidArgs(format!(
                    "malformed PNG: truncated '{kind}' chunk at offset {pos}"
                )));
            }

            let (label, category) = classify(&kind);
            if category.is_removable() {
                metadata_bytes += total;
            }
            segments.push(Segment::new(kind.clone(), label, category, pos, total));
            pos += total;

            if kind == "IEND" {
                break;
            }
        }

        if segments.is_empty() {
            return Err(GimletEyeError::InvalidArgs(
                "malformed PNG: no chunks found".into(),
            ));
        }

        Ok(ScanResult {
            format: Format::Png,
            segments,
            metadata_bytes,
        })
    }
}

fn classify(kind: &str) -> (String, SegmentCategory) {
    match kind {
        "IHDR" => ("Image header".into(), SegmentCategory::Structural),
        "PLTE" => ("Palette".into(), SegmentCategory::Structural),
        "IDAT" => ("Image data".into(), SegmentCategory::Structural),
        "IEND" => ("End of image".into(), SegmentCategory::Structural),
        "tEXt" => ("Uncompressed text".into(), SegmentCategory::Text),
        "zTXt" => ("Compressed text".into(), SegmentCategory::Text),
        "iTXt" => ("International text".into(), SegmentCategory::Text),
        "eXIf" => ("EXIF".into(), SegmentCategory::Identity),
        "tIME" => ("Last modified time".into(), SegmentCategory::Time),
        "gAMA" => ("Gamma".into(), SegmentCategory::Color),
        "cHRM" => ("Chromaticity".into(), SegmentCategory::Color),
        "sRGB" => ("sRGB rendering intent".into(), SegmentCategory::Color),
        "iCCP" => ("ICC profile".into(), SegmentCategory::Color),
        "pHYs" => ("Pixel dimensions".into(), SegmentCategory::Color),
        "bKGD" => ("Background colour".into(), SegmentCategory::Color),
        "sBIT" => ("Significant bits".into(), SegmentCategory::Color),
        "tRNS" => ("Transparency".into(), SegmentCategory::Color),
        other => (other.to_string(), SegmentCategory::Structural),
    }
}

/// Build a PNG chunk with a correct CRC-32. Used by tests and pack authors.
pub fn chunk(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 12);
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(payload);

    let mut crc_source = Vec::with_capacity(payload.len() + 4);
    crc_source.extend_from_slice(kind);
    crc_source.extend_from_slice(payload);
    out.extend_from_slice(&crc32(&crc_source).to_be_bytes());
    out
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::format::RemovalPolicy;

    fn sample() -> Vec<u8> {
        let mut bytes = SIGNATURE.to_vec();
        bytes.extend_from_slice(&chunk(b"IHDR", &[0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
        bytes.extend_from_slice(&chunk(b"tEXt", b"Author\0Jane Doe"));
        bytes.extend_from_slice(&chunk(b"eXIf", b"FAKE-EXIF"));
        bytes.extend_from_slice(&chunk(b"tIME", &[0x07, 0xE9, 1, 1, 0, 0, 0]));
        bytes.extend_from_slice(&chunk(b"IDAT", &[1, 2, 3, 4, 5]));
        bytes.extend_from_slice(&chunk(b"IEND", &[]));
        bytes
    }

    #[test]
    fn finds_text_and_exif_chunks() {
        let scan = PngHandler.scan(&sample()).expect("scan");
        assert_eq!(scan.format, Format::Png);
        let labels = scan.removable_labels();
        assert!(labels.contains(&"Uncompressed text".to_string()));
        assert!(labels.contains(&"EXIF".to_string()));
    }

    #[test]
    fn strip_preserves_image_chunks() {
        let original = sample();
        let stripped = PngHandler.strip(&original).expect("strip");

        assert!(!stripped.windows(4).any(|w| w == b"tEXt"));
        assert!(!stripped.windows(4).any(|w| w == b"eXIf"));
        assert!(stripped.windows(4).any(|w| w == b"IHDR"));
        assert!(stripped.windows(4).any(|w| w == b"IDAT"));
        assert!(stripped.ends_with(&chunk(b"IEND", &[])));
        assert_eq!(
            PngHandler.scan(&stripped).expect("rescan").metadata_bytes,
            0
        );
    }

    #[test]
    fn sharing_profile_keeps_time_chunk_only() {
        let policy = RemovalPolicy::profile("sharing").expect("profile");
        let stripped = PngHandler.strip_with(&sample(), &policy).expect("strip");
        assert!(!stripped.windows(4).any(|w| w == b"tEXt"));
        assert!(stripped.windows(4).any(|w| w == b"tIME"));
    }

    #[test]
    fn crc32_matches_reference_vector() {
        assert_eq!(crc32(b"IEND"), 0xAE42_6082);
    }

    #[test]
    fn rejects_non_png() {
        let err = PngHandler.scan(b"\xFF\xD8\xFF").expect_err("must fail");
        assert_eq!(err.code(), "invalid_args");
    }
}
