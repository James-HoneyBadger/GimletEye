//! Redacting GPS twice must leave the bytes exactly as redacting once did.
//!
//! The fuzz target asserts this on arbitrary input; this runs it over the seed
//! corpus and the crafted fixtures on every `cargo test`, because learning about
//! it from a weekly soak is a worse way to find out. Three inputs in
//! `tests/fixtures/gps/` are here because fuzzing found them — they are
//! structurally hostile (an APP1 length that lies, tags pointing at each other),
//! so they live with the tests rather than with the seeds a fuzzer starts from:
//!
//! - `gps-grid-roundtrip.bin` — `1° 17' 24"` reads back from binary floating
//!   point as slightly under 1.29°, and truncating that hair dropped a whole grid
//!   step, so a second strip moved the coordinate. Fixed by rounding to whole
//!   seconds before snapping to the grid.
//! - `gps-overlapping-rationals.bin` — a TIFF whose latitude and longitude tags
//!   point into each other, so writing one rewrote the other and every pass moved
//!   the coordinate again. There is no correct value for shared bytes, so that
//!   payload is now refused instead of half-written.
//! - `gps-values-inside-ifd.bin` — a value pointer aimed at the IFD entry table
//!   itself, so the write edited the entries that describe the coordinates. Also
//!   refused: an IFD that edits itself as you write it has no stable answer.

use std::fs;
use std::path::{Path, PathBuf};

use mellivora_scrub::{exif_ranges, redact_gps_payload, GpsPrecision};

fn inputs() -> Vec<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut paths = Vec::new();
    for dir in [
        root.join("fuzz/seeds/exif"),
        root.join("tests/fixtures/gps"),
    ] {
        for entry in fs::read_dir(&dir).unwrap_or_else(|error| panic!("{}: {error}", dir.display()))
        {
            let path = entry.expect("entry").path();
            if path.is_file() {
                paths.push(path);
            }
        }
    }
    paths.sort();
    paths
}

/// Redact once, or report why the payload was refused.
fn redact(payload: &[u8]) -> Result<Option<Vec<u8>>, String> {
    let mut owned = payload.to_vec();
    let mut changed = false;
    // Not every seed is a payload this reader can locate EXIF in; that is a
    // corpus question, not a redaction failure.
    let Ok(ranges) = exif_ranges(&owned) else {
        return Ok(None);
    };
    for range in ranges {
        match redact_gps_payload(&mut owned[range], GpsPrecision::City) {
            Ok(Some(_)) => changed = true,
            Ok(None) => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(changed.then_some(owned))
}

#[test]
fn every_seed_is_stable_under_a_second_redaction() {
    let mut redacted = 0;
    let mut refused = 0;
    for path in inputs() {
        let payload = fs::read(&path).expect("read seed");
        let first = match redact(&payload) {
            Ok(Some(once)) => once,
            Ok(None) => continue,
            Err(reason) => {
                // Two refusals exist today: values sharing bytes, and a value
                // that would be written into the IFD table it was read from.
                assert!(
                    reason.contains("share bytes") || reason.contains("inside an IFD entry table"),
                    "{}: refused for an unexpected reason: {reason}",
                    path.display()
                );
                // A refusal has to be stable too: agreeing to redact the same
                // payload on a second attempt would be the bug again.
                assert!(
                    redact(&payload).is_err(),
                    "{}: refused once, then accepted",
                    path.display()
                );
                refused += 1;
                continue;
            }
        };
        let second = redact(&first)
            .unwrap_or_else(|reason| panic!("{}: second pass refused: {reason}", path.display()))
            .expect("a redacted payload is still redactable");
        assert_eq!(
            first,
            second,
            "{}: redacting twice changed the payload",
            path.display()
        );
        redacted += 1;
    }
    assert!(
        redacted >= 2,
        "expected at least two redactable GPS payloads"
    );
    assert!(refused >= 2, "expected both refused seeds to be exercised");
}
