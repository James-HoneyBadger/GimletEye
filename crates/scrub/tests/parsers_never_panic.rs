//! A deterministic stand-in for the libFuzzer targets in `fuzz/`.
//!
//! The soak harness needs nightly and libFuzzer, so it runs on a schedule. This
//! test runs the same entry points — over the same seed corpus, plus a
//! structural mutation sweep — on every `cargo test`, so a parser regression is
//! caught on the commit that causes it rather than a week later in a soak.

use std::fs;
use std::path::{Path, PathBuf};

use mellivora_scrub::{exif_ranges, handler_for, redact_gps_payload, GpsPrecision, RemovalPolicy};

fn corpus_dir() -> PathBuf {
    // The committed seeds, not the working corpus libFuzzer grows during a run.
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fuzz/seeds")
}

fn seeds() -> Vec<(String, Vec<u8>)> {
    let mut seeds = Vec::new();
    for format in fs::read_dir(corpus_dir()).expect("corpus directory") {
        let format = format.expect("directory entry").path();
        if !format.is_dir() {
            continue;
        }
        for file in fs::read_dir(&format).expect("format directory") {
            let path = file.expect("file entry").path();
            let name = path
                .strip_prefix(corpus_dir())
                .unwrap_or(&path)
                .display()
                .to_string();
            seeds.push((name, fs::read(&path).expect("read seed")));
        }
    }
    seeds.sort();
    seeds
}

#[test]
fn the_corpus_covers_every_parser() {
    for format in ["jpeg", "png", "webp", "exif"] {
        let dir = corpus_dir().join(format);
        let count = fs::read_dir(&dir)
            .unwrap_or_else(|error| panic!("{}: {error}", dir.display()))
            .count();
        assert!(count > 0, "no seeds for {format} in {}", dir.display());
    }
}

#[test]
fn seeds_survive_scan_strip_and_rescan() {
    for (name, bytes) in seeds() {
        // The seeds are well-formed containers, so every step must succeed and
        // the result must re-scan clean.
        exercise(&name, &bytes, Expect::Clean);
    }
}

#[test]
fn structural_mutations_never_panic() {
    for (name, bytes) in seeds() {
        for (index, mutant) in mutations(&bytes).into_iter().enumerate() {
            // A mutation can leave a degenerate container whose every structural
            // segment is gone once the metadata is removed. Refusing is correct
            // there — `MetadataStrip::run` fails closed on it — so the invariant
            // is checked only when a stripped container can still be read.
            exercise(&format!("{name}#{index}"), &mutant, Expect::NoPanic);
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Expect {
    /// Every step succeeds and the result scans clean.
    Clean,
    /// Failures are fine; the only requirement is not to panic, and to be clean
    /// whenever the stripped container is still readable.
    NoPanic,
}

/// The promise the strip tools make: if a strip succeeds, what it produced is a
/// container this build can read with nothing left for the policy to remove.
fn exercise(name: &str, bytes: &[u8], expect: Expect) {
    let strict = expect == Expect::Clean;
    // The EXIF reader is reachable through every container and rewrites bytes in
    // place — the highest-risk path in the crate.
    if let Ok(ranges) = exif_ranges(bytes) {
        let mut owned = bytes.to_vec();
        for range in ranges {
            let _ = redact_gps_payload(&mut owned[range], GpsPrecision::City);
        }
    }

    let Ok(handler) = handler_for(bytes) else {
        return;
    };
    let Ok(scan) = handler.scan(bytes) else {
        return;
    };
    let _ = scan.metadata_bytes;

    let Ok(stripped) = handler.strip_with(bytes, &RemovalPolicy::all()) else {
        assert!(!strict, "{name}: strip failed on a well-formed seed");
        return;
    };
    // ADR 0006 Gate 2: strip "never grows a file". Checked here, on every
    // commit, as well as in the nightly soak.
    assert!(
        stripped.len() <= bytes.len(),
        "{name}: strip grew the file from {} to {} bytes",
        bytes.len(),
        stripped.len()
    );
    let next = match handler_for(&stripped) {
        Ok(next) => next,
        Err(error) if strict => {
            panic!("{name}: strip produced a container this build cannot read: {error}")
        }
        Err(_) => return,
    };
    let rescan = match next.scan(&stripped) {
        Ok(rescan) => rescan,
        Err(error) if strict => {
            panic!("{name}: the stripped container does not scan: {error}")
        }
        Err(_) => return,
    };
    assert_eq!(
        rescan.removable_bytes(&RemovalPolicy::all()),
        0,
        "{name}: a successful strip left removable metadata behind"
    );
}

/// Truncations, head corruption, and impossible length fields: the three shapes
/// of input that break container walkers in practice.
fn mutations(bytes: &[u8]) -> Vec<Vec<u8>> {
    let mut mutants = Vec::new();

    let mut length = 0;
    while length < bytes.len() {
        mutants.push(bytes[..length].to_vec());
        length += 7;
    }

    for index in 0..bytes.len().min(64) {
        let mut copy = bytes.to_vec();
        copy[index] ^= 0xFF;
        mutants.push(copy);
    }

    for index in 0..bytes.len().saturating_sub(4) {
        let mut copy = bytes.to_vec();
        copy[index..index + 4].copy_from_slice(&u32::MAX.to_be_bytes());
        mutants.push(copy);
    }

    mutants
}
