//! EXIF GPS redaction.
//!
//! Deleting EXIF outright is the safe default, but it also throws away camera,
//! lens, and date information that people often want to keep. Redaction is the
//! narrower tool: rewrite the GPS coordinates to a coarser precision **in
//! place**. Because a `GPSLatitude` is three 8-byte RATIONALs, the replacement
//! is the same size, so no offset in the file moves and the rest of the EXIF
//! block is untouched.

use std::ops::Range;

use mellivora_core::{MellivoraError, Result};
use serde::Serialize;

use crate::format::Format;

/// How much location precision to keep.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpsPrecision {
    Off,
    /// ~111 km: degrees only.
    Country,
    /// ~11 km: one decimal place.
    Region,
    /// ~1.1 km: two decimal places.
    City,
}

impl GpsPrecision {
    pub fn parse(value: &str) -> Result<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "off" | "none" | "" => Ok(Self::Off),
            "country" => Ok(Self::Country),
            "region" => Ok(Self::Region),
            "city" => Ok(Self::City),
            other => Err(MellivoraError::InvalidArgs(format!(
                "unknown GPS precision '{other}' (use off, country, region, or city)"
            ))),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Country => "country",
            Self::Region => "region",
            Self::City => "city",
        }
    }

    fn coordinate_grid_seconds(self) -> Option<i64> {
        match self {
            Self::Off => None,
            Self::Country => Some(3_600),
            Self::Region => Some(360),
            Self::City => Some(36),
        }
    }

    fn altitude_grid_metres(self) -> f64 {
        match self {
            Self::Off => 0.0,
            Self::Country => 1_000.0,
            Self::Region => 100.0,
            Self::City => 10.0,
        }
    }
}

/// What the redaction did, for the report. Only post-redaction values are
/// reported: echoing the original coordinates would defeat the purpose.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GpsRedaction {
    pub precision: String,
    pub latitude: f64,
    pub longitude: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub altitude_metres: Option<f64>,
}

/// Byte ranges of every EXIF payload in the container.
pub fn exif_ranges(bytes: &[u8]) -> Result<Vec<Range<usize>>> {
    let format = Format::detect(bytes).ok_or_else(|| {
        MellivoraError::Unsupported("unrecognised container; cannot locate EXIF".to_string())
    })?;
    let scan = format.handler().scan(bytes)?;
    let mut ranges = Vec::new();

    for segment in &scan.segments {
        let (start, end) = match format {
            Format::Jpeg if segment.kind == "APP1" && segment.label.starts_with("EXIF") => {
                (segment.offset + 4, segment.offset + segment.size)
            }
            Format::Png if segment.kind == "eXIf" => {
                let length = u32::from_be_bytes(chunk_length(bytes, segment.offset)) as usize;
                (segment.offset + 8, segment.offset + 8 + length)
            }
            Format::Webp if segment.kind == "EXIF" => {
                let length = u32::from_le_bytes(chunk_length(bytes, segment.offset + 4)) as usize;
                (segment.offset + 8, segment.offset + 8 + length)
            }
            _ => continue,
        };

        if end > bytes.len() || start > end {
            return Err(malformed("EXIF segment extends past the end of the file"));
        }
        ranges.push(start..end);
    }

    Ok(ranges)
}

fn chunk_length(bytes: &[u8], offset: usize) -> [u8; 4] {
    let mut length = [0u8; 4];
    if let Some(slice) = bytes.get(offset..offset + 4) {
        length.copy_from_slice(slice);
    }
    length
}

/// Redact GPS coordinates inside one EXIF payload.
///
/// Accepts both the JPEG form (`Exif\0\0` + TIFF) and the raw TIFF form used by
/// PNG `eXIf` and WebP `EXIF` chunks.
pub fn redact_gps_payload(
    payload: &mut [u8],
    precision: GpsPrecision,
) -> Result<Option<GpsRedaction>> {
    let Some(grid_seconds) = precision.coordinate_grid_seconds() else {
        return Ok(None);
    };

    let base = if payload.starts_with(b"Exif\0\0") {
        6
    } else if payload.starts_with(b"II") || payload.starts_with(b"MM") {
        0
    } else {
        return Ok(None);
    };

    let plan = {
        let tiff = Tiff::new(&payload[base..])?;
        build_plan(&tiff)?
    };
    let Some(plan) = plan else {
        return Ok(None);
    };

    if let (Some(offset), Some(value)) = (plan.latitude_offset, plan.latitude) {
        write_dms(payload, base + offset, value, grid_seconds, plan.little)?;
    }
    if let (Some(offset), Some(value)) = (plan.longitude_offset, plan.longitude) {
        write_dms(payload, base + offset, value, grid_seconds, plan.little)?;
    }

    let mut altitude_out = None;
    if let (Some(offset), Some(altitude)) = (plan.altitude_offset, plan.altitude) {
        let grid = precision.altitude_grid_metres();
        let rounded = if grid > 0.0 {
            (altitude.abs() / grid).trunc() * grid
        } else {
            altitude
        };
        write_rational(payload, base + offset, rounded as u32, 1, plan.little)?;
        altitude_out = Some(rounded);
    }

    let (lat_deg, lat_min, lat_sec) = plan
        .latitude
        .map(|v| truncate_dms(v, grid_seconds))
        .unwrap_or_default();
    let (lon_deg, lon_min, lon_sec) = plan
        .longitude
        .map(|v| truncate_dms(v, grid_seconds))
        .unwrap_or_default();

    let latitude = dms_to_decimal(lat_deg, lat_min, lat_sec) * sign(plan.latitude_ref, 'S');
    let longitude = dms_to_decimal(lon_deg, lon_min, lon_sec) * sign(plan.longitude_ref, 'W');

    Ok(Some(GpsRedaction {
        precision: precision.as_str().to_string(),
        latitude: round6(latitude),
        longitude: round6(longitude),
        altitude_metres: altitude_out,
    }))
}

fn sign(reference: Option<char>, negative: char) -> f64 {
    match reference {
        Some(value) if value.eq_ignore_ascii_case(&negative) => -1.0,
        _ => 1.0,
    }
}

fn dms_to_decimal(degrees: u32, minutes: u32, seconds: u32) -> f64 {
    f64::from(degrees) + f64::from(minutes) / 60.0 + f64::from(seconds) / 3_600.0
}

fn round6(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

/// Truncate toward zero onto a grid so the result never moves *outside* the
/// cell the original coordinate occupied.
fn truncate_dms(degrees: f64, grid_seconds: i64) -> (u32, u32, u32) {
    let total = (degrees.abs() * 3_600.0) as i64;
    let total = (total / grid_seconds) * grid_seconds;
    (
        (total / 3_600) as u32,
        ((total % 3_600) / 60) as u32,
        (total % 60) as u32,
    )
}

fn write_dms(
    payload: &mut [u8],
    offset: usize,
    degrees: f64,
    grid_seconds: i64,
    little: bool,
) -> Result<()> {
    let (d, m, s) = truncate_dms(degrees, grid_seconds);
    write_rational(payload, offset, d, 1, little)?;
    write_rational(payload, offset + 8, m, 1, little)?;
    write_rational(payload, offset + 16, s, 1, little)?;
    Ok(())
}

fn write_rational(
    payload: &mut [u8],
    offset: usize,
    numerator: u32,
    denominator: u32,
    little: bool,
) -> Result<()> {
    let slice = payload
        .get_mut(offset..offset + 8)
        .ok_or_else(|| malformed("GPS rational lies outside the EXIF payload"))?;
    let (numerator, denominator) = if little {
        (numerator.to_le_bytes(), denominator.to_le_bytes())
    } else {
        (numerator.to_be_bytes(), denominator.to_be_bytes())
    };
    slice[0..4].copy_from_slice(&numerator);
    slice[4..8].copy_from_slice(&denominator);
    Ok(())
}

fn malformed(detail: impl Into<String>) -> MellivoraError {
    MellivoraError::Tool(format!("cannot redact GPS: {}", detail.into()))
}

#[derive(Debug)]
struct Plan {
    little: bool,
    latitude_offset: Option<usize>,
    longitude_offset: Option<usize>,
    altitude_offset: Option<usize>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    altitude: Option<f64>,
    latitude_ref: Option<char>,
    longitude_ref: Option<char>,
}

const TAG_GPS_IFD: u16 = 0x8825;
const TAG_GPS_LATITUDE_REF: u16 = 1;
const TAG_GPS_LATITUDE: u16 = 2;
const TAG_GPS_LONGITUDE_REF: u16 = 3;
const TAG_GPS_LONGITUDE: u16 = 4;
const TAG_GPS_ALTITUDE: u16 = 6;

const TYPE_LONG: u16 = 4;
const TYPE_RATIONAL: u16 = 5;

fn build_plan(tiff: &Tiff<'_>) -> Result<Option<Plan>> {
    let ifd0 = tiff.u32(4)? as usize;
    let count = tiff.ifd_count(ifd0)?;

    let mut gps_ifd = None;
    for index in 0..count {
        let entry = tiff.entry(ifd0, index)?;
        if entry.tag == TAG_GPS_IFD && entry.field_type == TYPE_LONG && entry.count >= 1 {
            gps_ifd = Some(tiff.u32(entry.value_field)? as usize);
            break;
        }
    }
    let Some(gps_ifd) = gps_ifd else {
        return Ok(None);
    };

    let mut plan = Plan {
        little: tiff.little,
        latitude_offset: None,
        longitude_offset: None,
        altitude_offset: None,
        latitude: None,
        longitude: None,
        altitude: None,
        latitude_ref: None,
        longitude_ref: None,
    };

    let count = tiff.ifd_count(gps_ifd)?;
    for index in 0..count {
        let entry = tiff.entry(gps_ifd, index)?;
        match entry.tag {
            TAG_GPS_LATITUDE_REF | TAG_GPS_LONGITUDE_REF => {
                let reference = tiff.ascii(&entry)?.chars().next();
                if entry.tag == TAG_GPS_LATITUDE_REF {
                    plan.latitude_ref = reference;
                } else {
                    plan.longitude_ref = reference;
                }
            }
            TAG_GPS_LATITUDE | TAG_GPS_LONGITUDE
                if entry.field_type == TYPE_RATIONAL && entry.count == 3 =>
            {
                let offset = tiff.value_offset(&entry)?;
                let parts = tiff.rationals(offset, 3)?;
                let decimal = parts[0] + parts[1] / 60.0 + parts[2] / 3_600.0;
                if entry.tag == TAG_GPS_LATITUDE {
                    plan.latitude = Some(decimal);
                    plan.latitude_offset = Some(offset);
                } else {
                    plan.longitude = Some(decimal);
                    plan.longitude_offset = Some(offset);
                }
            }
            TAG_GPS_ALTITUDE if entry.field_type == TYPE_RATIONAL && entry.count == 1 => {
                let offset = tiff.value_offset(&entry)?;
                plan.altitude = tiff.rationals(offset, 1)?.first().copied();
                plan.altitude_offset = Some(offset);
            }
            _ => {}
        }
    }

    if plan.latitude.is_none() && plan.longitude.is_none() && plan.altitude.is_none() {
        return Ok(None);
    }
    Ok(Some(plan))
}

struct Tiff<'a> {
    bytes: &'a [u8],
    little: bool,
}

struct Entry {
    tag: u16,
    field_type: u16,
    count: u32,
    value_field: usize,
}

impl<'a> Tiff<'a> {
    fn new(bytes: &'a [u8]) -> Result<Self> {
        if bytes.len() < 8 {
            return Err(malformed("TIFF header is truncated"));
        }
        let little = match &bytes[0..2] {
            b"II" => true,
            b"MM" => false,
            _ => return Err(malformed("unknown TIFF byte order")),
        };
        let tiff = Self { bytes, little };
        if tiff.u16(2)? != 42 {
            return Err(malformed("missing TIFF magic 42"));
        }
        Ok(tiff)
    }

    fn slice(&self, offset: usize, length: usize) -> Result<&'a [u8]> {
        self.bytes
            .get(offset..offset + length)
            .ok_or_else(|| malformed("EXIF structure is truncated"))
    }

    fn u16(&self, offset: usize) -> Result<u16> {
        let slice = self.slice(offset, 2)?;
        Ok(if self.little {
            u16::from_le_bytes([slice[0], slice[1]])
        } else {
            u16::from_be_bytes([slice[0], slice[1]])
        })
    }

    fn u32(&self, offset: usize) -> Result<u32> {
        let slice = self.slice(offset, 4)?;
        let bytes = [slice[0], slice[1], slice[2], slice[3]];
        Ok(if self.little {
            u32::from_le_bytes(bytes)
        } else {
            u32::from_be_bytes(bytes)
        })
    }

    fn ifd_count(&self, ifd: usize) -> Result<usize> {
        let count = self.u16(ifd)? as usize;
        // A corrupt count would make the entry loop read far past the block.
        if count > 512 {
            return Err(malformed("implausible IFD entry count"));
        }
        Ok(count)
    }

    fn entry(&self, ifd: usize, index: usize) -> Result<Entry> {
        let base = ifd + 2 + index * 12;
        self.slice(base, 12)?;
        Ok(Entry {
            tag: self.u16(base)?,
            field_type: self.u16(base + 2)?,
            count: self.u32(base + 4)?,
            value_field: base + 8,
        })
    }

    fn value_offset(&self, entry: &Entry) -> Result<usize> {
        let size =
            type_size(entry.field_type).ok_or_else(|| malformed("unknown TIFF field type"))?;
        if entry.count > 4096 {
            return Err(malformed("implausible TIFF value count"));
        }
        let total = size * entry.count as usize;
        if total <= 4 {
            Ok(entry.value_field)
        } else {
            Ok(self.u32(entry.value_field)? as usize)
        }
    }

    fn rationals(&self, offset: usize, count: usize) -> Result<Vec<f64>> {
        let mut values = Vec::with_capacity(count);
        for index in 0..count {
            let base = offset + index * 8;
            let numerator = self.u32(base)?;
            let denominator = self.u32(base + 4)?;
            if denominator == 0 {
                return Err(malformed("zero denominator in a GPS rational"));
            }
            values.push(f64::from(numerator) / f64::from(denominator));
        }
        Ok(values)
    }

    fn ascii(&self, entry: &Entry) -> Result<String> {
        if entry.field_type != 2 {
            return Ok(String::new());
        }
        let offset = self.value_offset(entry)?;
        let length = (entry.count as usize).min(8);
        let slice = self.slice(offset, length)?;
        Ok(slice
            .iter()
            .take_while(|byte| **byte != 0)
            .map(|byte| *byte as char)
            .collect())
    }
}

fn type_size(field_type: u16) -> Option<usize> {
    match field_type {
        1 | 2 | 6 | 7 => Some(1),
        3 | 8 => Some(2),
        4 | 9 | 11 => Some(4),
        5 | 10 | 12 => Some(8),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exif::fixtures::build_exif;

    fn read_dms(payload: &[u8], base: usize, offset: usize) -> (f64, f64, f64) {
        let mut parts = Vec::new();
        for index in 0..3 {
            let at = base + offset + index * 8;
            let numerator = u32::from_be_bytes([
                payload[at],
                payload[at + 1],
                payload[at + 2],
                payload[at + 3],
            ]);
            let denominator = u32::from_be_bytes([
                payload[at + 4],
                payload[at + 5],
                payload[at + 6],
                payload[at + 7],
            ]);
            parts.push(f64::from(numerator) / f64::from(denominator));
        }
        (parts[0], parts[1], parts[2])
    }

    #[test]
    fn city_precision_truncates_to_two_decimals() {
        let mut payload = build_exif(
            (51.0, 30.0, 26.46), // 51.50735
            (0.0, 7.0, 39.93),   // 0.12776
            Some(35.0),
            "N",
            "W",
        );
        let redaction = redact_gps_payload(&mut payload, GpsPrecision::City)
            .expect("redact")
            .expect("gps present");

        assert_eq!(redaction.precision, "city");
        assert_eq!(redaction.latitude, 51.5);
        // The fixture stores 0.12776 with a West reference.
        assert_eq!(redaction.longitude, -0.12);
        assert_eq!(redaction.altitude_metres, Some(30.0));

        let (d, m, s) = read_dms(&payload, 6, 92);
        assert_eq!((d, m, s), (51.0, 30.0, 0.0));
    }

    #[test]
    fn region_and_country_are_coarser() {
        let mut region = build_exif((51.0, 30.0, 26.46), (0.0, 7.0, 39.93), None, "N", "W");
        let redaction = redact_gps_payload(&mut region, GpsPrecision::Region)
            .expect("redact")
            .expect("gps");
        assert_eq!(redaction.latitude, 51.5);
        assert_eq!(redaction.longitude, -0.1);

        let mut country = build_exif((51.0, 30.0, 26.46), (0.0, 7.0, 39.93), None, "N", "W");
        let redaction = redact_gps_payload(&mut country, GpsPrecision::Country)
            .expect("redact")
            .expect("gps");
        assert_eq!(redaction.latitude, 51.0);
        assert_eq!(redaction.longitude, 0.0);
    }

    #[test]
    fn southern_and_western_references_are_reported_as_negative() {
        let mut payload = build_exif((33.0, 51.0, 0.0), (151.0, 12.0, 0.0), None, "S", "E");
        let redaction = redact_gps_payload(&mut payload, GpsPrecision::Country)
            .expect("redact")
            .expect("gps");
        assert_eq!(redaction.latitude, -33.0);
        assert_eq!(redaction.longitude, 151.0);
    }

    #[test]
    fn redaction_is_idempotent() {
        let mut payload = build_exif((51.0, 30.0, 26.46), (0.0, 7.0, 39.93), None, "N", "W");
        let first = redact_gps_payload(&mut payload, GpsPrecision::City)
            .expect("redact")
            .expect("gps");
        let second = redact_gps_payload(&mut payload, GpsPrecision::City)
            .expect("redact")
            .expect("gps");
        assert_eq!(first, second);
    }

    #[test]
    fn raw_tiff_payload_is_supported() {
        // PNG eXIf and WebP EXIF chunks store the TIFF block directly.
        let mut payload = build_exif((51.0, 30.0, 26.46), (0.0, 7.0, 39.93), None, "N", "W");
        payload.drain(..6);
        let redaction = redact_gps_payload(&mut payload, GpsPrecision::Country)
            .expect("redact")
            .expect("gps");
        assert_eq!(redaction.latitude, 51.0);
    }

    #[test]
    fn off_precision_is_a_no_op() {
        let mut payload = build_exif((51.0, 30.0, 0.0), (0.0, 7.0, 0.0), None, "N", "W");
        let original = payload.clone();
        assert_eq!(
            redact_gps_payload(&mut payload, GpsPrecision::Off).expect("no-op"),
            None
        );
        assert_eq!(payload, original);
    }

    #[test]
    fn missing_gps_returns_none() {
        let mut payload = b"Exif\0\0MM".to_vec();
        assert!(redact_gps_payload(&mut payload, GpsPrecision::City).is_err());

        let mut tiff_only = vec![0u8; 8];
        tiff_only[0..2].copy_from_slice(b"MM");
        tiff_only[2..4].copy_from_slice(&42u16.to_be_bytes());
        tiff_only[4..8].copy_from_slice(&8u32.to_be_bytes());
        // IFD0 with zero entries and no next IFD.
        tiff_only.extend_from_slice(&0u16.to_be_bytes());
        tiff_only.extend_from_slice(&0u32.to_be_bytes());
        assert_eq!(
            redact_gps_payload(&mut tiff_only, GpsPrecision::City).expect("no gps"),
            None
        );
    }

    #[test]
    fn rejects_malformed_structure() {
        let mut payload = b"Exif\0\0MM\x00\x2a\x00\x00\x00\x08".to_vec();
        // Claims one IFD0 entry but provides none.
        payload.extend_from_slice(&1u16.to_be_bytes());
        let err = redact_gps_payload(&mut payload, GpsPrecision::City).expect_err("must fail");
        assert_eq!(err.code(), "tool");
    }

    #[test]
    fn parses_precision_names() {
        assert_eq!(
            GpsPrecision::parse("City").expect("city"),
            GpsPrecision::City
        );
        assert_eq!(GpsPrecision::parse("off").expect("off"), GpsPrecision::Off);
        assert_eq!(
            GpsPrecision::parse("none").expect("none"),
            GpsPrecision::Off
        );
        assert_eq!(
            GpsPrecision::parse("block").expect_err("bad").code(),
            "invalid_args"
        );
    }
}

/// Shared test fixtures. Public within the crate so sibling modules can build a
/// realistic EXIF block without duplicating the structure.
#[cfg(test)]
pub(crate) mod fixtures {
    use super::*;

    /// Minimal big-endian EXIF block: IFD0 with a GPS pointer, GPS IFD with
    /// refs, latitude, longitude, and altitude.
    /// Valid TIFF/EXIF with an empty IFD0: no GPS pointer at all.
    pub(crate) fn build_exif_without_gps() -> Vec<u8> {
        let mut payload = b"Exif\0\0".to_vec();
        payload.extend_from_slice(b"MM");
        payload.extend_from_slice(&42u16.to_be_bytes());
        payload.extend_from_slice(&8u32.to_be_bytes());
        payload.extend_from_slice(&0u16.to_be_bytes()); // zero entries
        payload.extend_from_slice(&0u32.to_be_bytes()); // no next IFD
        payload
    }

    pub(crate) fn build_exif(
        lat: (f64, f64, f64),
        lon: (f64, f64, f64),
        altitude: Option<f64>,
        lat_ref: &str,
        lon_ref: &str,
    ) -> Vec<u8> {
        let mut tiff: Vec<u8> = Vec::new();
        tiff.extend_from_slice(b"MM");
        tiff.extend_from_slice(&42u16.to_be_bytes());
        tiff.extend_from_slice(&8u32.to_be_bytes()); // IFD0 offset

        // IFD0: one entry (GPS IFD pointer), then next-IFD offset.
        let gps_offset: u32 = 26;
        let data_start: u32 = 26 + 2 + 5 * 12 + 4; // 92
        tiff.extend_from_slice(&1u16.to_be_bytes());
        tiff.extend_from_slice(&TAG_GPS_IFD.to_be_bytes());
        tiff.extend_from_slice(&TYPE_LONG.to_be_bytes());
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&gps_offset.to_be_bytes());
        tiff.extend_from_slice(&0u32.to_be_bytes());

        // GPS IFD: 5 entries, sorted by tag.
        tiff.extend_from_slice(&5u16.to_be_bytes());
        // 1: latitude ref (ASCII, inline)
        tiff.extend_from_slice(&TAG_GPS_LATITUDE_REF.to_be_bytes());
        tiff.extend_from_slice(&2u16.to_be_bytes());
        tiff.extend_from_slice(&2u32.to_be_bytes());
        let mut ref_bytes = [0u8; 4];
        ref_bytes[0] = lat_ref.as_bytes()[0];
        tiff.extend_from_slice(&ref_bytes);
        // 2: latitude (3 RATIONAL, offset)
        tiff.extend_from_slice(&TAG_GPS_LATITUDE.to_be_bytes());
        tiff.extend_from_slice(&TYPE_RATIONAL.to_be_bytes());
        tiff.extend_from_slice(&3u32.to_be_bytes());
        tiff.extend_from_slice(&data_start.to_be_bytes());
        // 3: longitude ref
        tiff.extend_from_slice(&TAG_GPS_LONGITUDE_REF.to_be_bytes());
        tiff.extend_from_slice(&2u16.to_be_bytes());
        tiff.extend_from_slice(&2u32.to_be_bytes());
        let mut ref_bytes = [0u8; 4];
        ref_bytes[0] = lon_ref.as_bytes()[0];
        tiff.extend_from_slice(&ref_bytes);
        // 4: longitude (3 RATIONAL)
        tiff.extend_from_slice(&TAG_GPS_LONGITUDE.to_be_bytes());
        tiff.extend_from_slice(&TYPE_RATIONAL.to_be_bytes());
        tiff.extend_from_slice(&3u32.to_be_bytes());
        tiff.extend_from_slice(&(data_start + 24).to_be_bytes());
        // 6: altitude (1 RATIONAL)
        tiff.extend_from_slice(&TAG_GPS_ALTITUDE.to_be_bytes());
        tiff.extend_from_slice(&TYPE_RATIONAL.to_be_bytes());
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&(data_start + 48).to_be_bytes());
        tiff.extend_from_slice(&0u32.to_be_bytes()); // next IFD

        debug_assert_eq!(tiff.len(), data_start as usize);

        for (index, part) in [lat.0, lat.1, lat.2].iter().enumerate() {
            tiff.extend_from_slice(&((part * 1_000_000.0) as u32).to_be_bytes());
            tiff.extend_from_slice(&1_000_000u32.to_be_bytes());
            debug_assert!(index < 3);
        }
        for part in [lon.0, lon.1, lon.2] {
            tiff.extend_from_slice(&((part * 1_000_000.0) as u32).to_be_bytes());
            tiff.extend_from_slice(&1_000_000u32.to_be_bytes());
        }
        let altitude = altitude.unwrap_or(0.0);
        tiff.extend_from_slice(&(altitude as u32).to_be_bytes());
        tiff.extend_from_slice(&1u32.to_be_bytes());

        let mut payload = b"Exif\0\0".to_vec();
        payload.extend_from_slice(&tiff);
        payload
    }
}
