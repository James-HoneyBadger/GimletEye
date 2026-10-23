use mellivora_core::{MellivoraError, Result};

use crate::format::{strip_ranges, Format, FormatHandler, ScanResult, Segment};

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
            return Err(MellivoraError::InvalidArgs(
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
                return Err(MellivoraError::InvalidArgs(format!(
                    "malformed PNG: truncated '{kind}' chunk at offset {pos}"
                )));
            }

            let (label, removable) = classify(&kind);
            if removable {
                metadata_bytes += total;
            }
            segments.push(Segment::new(kind.clone(), label, pos, total, removable));
            pos += total;

            if kind == "IEND" {
                break;
            }
        }

        if segments.is_empty() {
            return Err(MellivoraError::InvalidArgs(
                "malformed PNG: no chunks found".into(),
            ));
        }

        Ok(ScanResult {
            format: Format::Png,
            segments,
            metadata_bytes,
        })
    }

    fn strip(&self, bytes: &[u8]) -> Result<Vec<u8>> {
        let scan = self.scan(bytes)?;
        Ok(strip_ranges(bytes, &scan))
    }
}

fn classify(kind: &str) -> (String, bool) {
    match kind {
        "IHDR" => ("Image header".into(), false),
        "PLTE" => ("Palette".into(), false),
        "IDAT" => ("Image data".into(), false),
        "IEND" => ("End of image".into(), false),
        "tEXt" => ("Uncompressed text".into(), true),
        "zTXt" => ("Compressed text".into(), true),
        "iTXt" => ("International text".into(), true),
        "eXIf" => ("EXIF".into(), true),
        "tIME" => ("Last modified time".into(), true),
        "gAMA" => ("Gamma".into(), false),
        "cHRM" => ("Chromaticity".into(), false),
        "sRGB" => ("sRGB rendering intent".into(), false),
        "iCCP" => ("ICC profile".into(), false),
        "pHYs" => ("Pixel dimensions".into(), false),
        "bKGD" => ("Background colour".into(), false),
        "sBIT" => ("Significant bits".into(), false),
        "tRNS" => ("Transparency".into(), false),
        other => (other.to_string(), false),
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

    fn sample() -> Vec<u8> {
        let mut bytes = SIGNATURE.to_vec();
        bytes.extend_from_slice(&chunk(b"IHDR", &[0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
        bytes.extend_from_slice(&chunk(b"tEXt", b"Author\0Jane Doe"));
        bytes.extend_from_slice(&chunk(b"eXIf", b"FAKE-EXIF"));
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
    fn crc32_matches_reference_vector() {
        assert_eq!(crc32(b"IEND"), 0xAE42_6082);
    }

    #[test]
    fn rejects_non_png() {
        let err = PngHandler.scan(b"\xFF\xD8\xFF").expect_err("must fail");
        assert_eq!(err.code(), "invalid_args");
    }
}
