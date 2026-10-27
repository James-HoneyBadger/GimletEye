#![no_main]

//! EXIF/TIFF: the container ranges and the in-place GPS redaction.

use libfuzzer_sys::fuzz_target;
use gimlet_eye_scrub::{exif_ranges, redact_gps_payload, GpsPrecision};

fuzz_target!(|data: &[u8]| {
    // Through a container: JPEG stores `Exif\0\0` + TIFF, PNG eXIf and WebP
    // EXIF store the TIFF block directly.
    if let Ok(ranges) = exif_ranges(data) {
        let mut owned = data.to_vec();
        for range in ranges {
            let _ = redact_gps_payload(&mut owned[range], GpsPrecision::City);
        }

        // Redaction is documented as idempotent: a second pass must leave the
        // bytes exactly as the first left them, not merely avoid panicking.
        let once = owned.clone();
        let again = exif_ranges(&owned).unwrap_or_default();
        for range in again {
            let _ = redact_gps_payload(&mut owned[range], GpsPrecision::City);
        }
        assert_eq!(owned, once, "GPS redaction is not idempotent");
    }

    // And the payload on its own, however a container reaches it.
    let mut payload = data.to_vec();
    let _ = redact_gps_payload(&mut payload, GpsPrecision::City);
});
