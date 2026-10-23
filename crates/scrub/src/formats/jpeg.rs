use mellivora_core::{MellivoraError, Result};

use crate::format::{strip_ranges, Format, FormatHandler, ScanResult, Segment};

/// JPEG segment walker.
///
/// Removable: EXIF and XMP (APP1), IPTC/Photoshop (APP13), Ducky (APP12), and
/// COM. Kept: JFIF (APP0), ICC profile (APP2), Adobe colour transform (APP14),
/// and everything from the start-of-scan marker onward. ICC and the Adobe
/// marker change how pixels are interpreted, so stripping them would corrupt
/// rendering — one of the ways metadata removal goes wrong.
#[derive(Debug, Default, Clone, Copy)]
pub struct JpegHandler;

impl FormatHandler for JpegHandler {
    fn format(&self) -> Format {
        Format::Jpeg
    }

    fn scan(&self, bytes: &[u8]) -> Result<ScanResult> {
        if !bytes.starts_with(&[0xFF, 0xD8]) {
            return Err(MellivoraError::InvalidArgs(
                "not a JPEG (missing SOI)".into(),
            ));
        }

        let mut segments = Vec::new();
        let mut metadata_bytes = 0usize;
        let mut pos = 2usize;

        while pos + 1 < bytes.len() {
            if bytes[pos] != 0xFF {
                return Err(MellivoraError::InvalidArgs(format!(
                    "malformed JPEG: expected a marker at offset {pos}"
                )));
            }
            let marker = bytes[pos + 1];
            match marker {
                0xD8 => {
                    pos += 2;
                    continue;
                }
                0xD9 => break,
                0xDA => {
                    segments.push(Segment::new(
                        "SOS",
                        "Start of scan (pixel data)",
                        pos,
                        bytes.len() - pos,
                        false,
                    ));
                    break;
                }
                0x01 | 0xD0..=0xD7 => {
                    pos += 2;
                    continue;
                }
                _ => {}
            }

            if pos + 4 > bytes.len() {
                break;
            }
            let length = u16::from_be_bytes([bytes[pos + 2], bytes[pos + 3]]) as usize;
            if length < 2 || pos + 2 + length > bytes.len() {
                return Err(MellivoraError::InvalidArgs(format!(
                    "malformed JPEG: truncated segment at offset {pos}"
                )));
            }
            let payload = &bytes[pos + 4..pos + 2 + length];
            let (kind, label, removable) = classify(marker, payload);

            if removable {
                metadata_bytes += length + 2;
            }
            segments.push(Segment::new(kind, label, pos, length + 2, removable));
            pos += 2 + length;
        }

        if segments.is_empty() {
            return Err(MellivoraError::InvalidArgs(
                "malformed JPEG: no segments found".into(),
            ));
        }

        Ok(ScanResult {
            format: Format::Jpeg,
            segments,
            metadata_bytes,
        })
    }

    fn strip(&self, bytes: &[u8]) -> Result<Vec<u8>> {
        let scan = self.scan(bytes)?;
        Ok(strip_ranges(bytes, &scan))
    }
}

fn classify(marker: u8, payload: &[u8]) -> (String, String, bool) {
    match marker {
        0xE0 => {
            let label = if payload.starts_with(b"JFIF") {
                "JFIF"
            } else if payload.starts_with(b"JFXX") {
                "JFIF extension"
            } else {
                "APP0"
            };
            ("APP0".to_string(), label.to_string(), false)
        }
        0xE1 => {
            if payload.starts_with(b"Exif\0\0") {
                ("APP1".to_string(), "EXIF (including GPS)".to_string(), true)
            } else if payload.starts_with(b"http://ns.adobe.com/xap/1.0/") {
                ("APP1".to_string(), "XMP".to_string(), true)
            } else {
                ("APP1".to_string(), "APP1".to_string(), false)
            }
        }
        0xE2 => {
            let label = if payload.starts_with(b"ICC_PROFILE") {
                "ICC profile"
            } else {
                "APP2"
            };
            ("APP2".to_string(), label.to_string(), false)
        }
        0xEC => ("APP12".to_string(), "Ducky / APP12".to_string(), true),
        0xED => ("APP13".to_string(), "IPTC / Photoshop".to_string(), true),
        0xEE => (
            "APP14".to_string(),
            "Adobe colour transform".to_string(),
            false,
        ),
        0xFE => ("COM".to_string(), "Comment".to_string(), true),
        _ => {
            let name = marker_name(marker);
            (name.to_string(), name.to_string(), false)
        }
    }
}

fn marker_name(marker: u8) -> String {
    match marker {
        0xC0 => "SOF0".into(),
        0xC2 => "SOF2".into(),
        0xC4 => "DHT".into(),
        0xDB => "DQT".into(),
        0xDD => "DRI".into(),
        other => format!("0x{other:02X}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal JPEG: SOI, JFIF, EXIF, comment, DQT, SOS, entropy data, EOI.
    fn sample() -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xD8];

        // APP0 / JFIF
        bytes.extend_from_slice(&[0xFF, 0xE0, 0x00, 0x10]);
        bytes.extend_from_slice(b"JFIF\0\x01\x01\0\0\x01\0\x01\0\0");

        // APP1 / EXIF
        let exif_payload = b"Exif\0\0FAKE-EXIF-PAYLOAD";
        bytes.extend_from_slice(&[0xFF, 0xE1]);
        bytes.extend_from_slice(&((exif_payload.len() + 2) as u16).to_be_bytes());
        bytes.extend_from_slice(exif_payload);

        // COM
        let comment = b"shot on a phone";
        bytes.extend_from_slice(&[0xFF, 0xFE]);
        bytes.extend_from_slice(&((comment.len() + 2) as u16).to_be_bytes());
        bytes.extend_from_slice(comment);

        // DQT (kept)
        let dqt = [0u8; 65];
        bytes.extend_from_slice(&[0xFF, 0xDB]);
        bytes.extend_from_slice(&((dqt.len() + 2) as u16).to_be_bytes());
        bytes.extend_from_slice(&dqt);

        // SOS plus entropy-coded data and EOI
        bytes.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]);
        bytes.extend_from_slice(&[0x12, 0x34, 0x56, 0x78]);
        bytes.extend_from_slice(&[0xFF, 0xD9]);
        bytes
    }

    #[test]
    fn finds_exif_and_comment() {
        let scan = JpegHandler.scan(&sample()).expect("scan");
        let labels = scan.removable_labels();
        assert!(labels.iter().any(|label| label.starts_with("EXIF")));
        assert!(labels.iter().any(|label| label == "Comment"));
        assert!(scan.metadata_bytes > 0);
    }

    #[test]
    fn strip_removes_metadata_and_preserves_pixels() {
        let original = sample();
        let stripped = JpegHandler.strip(&original).expect("strip");

        assert!(!stripped.windows(4).any(|w| w == b"Exif"));
        assert!(!stripped.windows(6).any(|w| w == b"shot o"));
        // JFIF and image data survive.
        assert!(stripped.windows(4).any(|w| w == b"JFIF"));
        assert!(stripped.ends_with(&[0x12, 0x34, 0x56, 0x78, 0xFF, 0xD9]));
        assert!(stripped.starts_with(&[0xFF, 0xD8]));

        let rescan = JpegHandler.scan(&stripped).expect("rescan");
        assert_eq!(rescan.metadata_bytes, 0);
    }

    #[test]
    fn keeps_icc_profile() {
        let mut bytes = vec![0xFF, 0xD8];
        let icc = b"ICC_PROFILE\0\x01\x01payload";
        bytes.extend_from_slice(&[0xFF, 0xE2]);
        bytes.extend_from_slice(&((icc.len() + 2) as u16).to_be_bytes());
        bytes.extend_from_slice(icc);
        bytes.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]);
        bytes.extend_from_slice(&[0xFF, 0xD9]);

        let stripped = JpegHandler.strip(&bytes).expect("strip");
        assert_eq!(stripped, bytes);
    }

    #[test]
    fn rejects_non_jpeg() {
        let err = JpegHandler
            .scan(b"not a jpeg at all")
            .expect_err("must fail");
        assert_eq!(err.code(), "invalid_args");
    }
}
