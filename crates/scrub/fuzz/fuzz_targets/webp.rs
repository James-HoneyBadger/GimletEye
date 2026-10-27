#![no_main]

//! WebP: scan, strip, and re-scan, with the `VP8X` flag-clearing path included.

use libfuzzer_sys::fuzz_target;
use gimlet_eye_scrub::{handler_for, Format, RemovalPolicy};

fuzz_target!(|data: &[u8]| {
    if Format::detect(data) != Some(Format::Webp) {
        return;
    }
    let Ok(handler) = handler_for(data) else {
        return;
    };
    let Ok(scan) = handler.scan(data) else {
        return;
    };
    let _ = scan.metadata_bytes;

    // The archive profile removes nothing; stripping under it must be a no-op
    // apart from a recomputed RIFF size.
    let kept = handler
        .strip_with(data, &RemovalPolicy::none())
        .expect("no-op strip");
    assert!(handler_for(&kept).map(|next| next.scan(&kept)).is_ok());

    let Ok(stripped) = handler.strip_with(data, &RemovalPolicy::all()) else {
        return;
    };
    assert!(
        stripped.len() <= data.len(),
        "strip grew the file from {} to {} bytes",
        data.len(),
        stripped.len()
    );
    let Ok(next) = handler_for(&stripped) else {
        return;
    };
    let Ok(rescan) = next.scan(&stripped) else {
        return;
    };
    assert_eq!(
        rescan.removable_bytes(&RemovalPolicy::all()),
        0,
        "a successful strip left removable metadata behind"
    );

    if let Ok(twice) = next.strip_with(&stripped, &RemovalPolicy::all()) {
        assert_eq!(twice, stripped, "stripping twice is not idempotent");
    }
});
