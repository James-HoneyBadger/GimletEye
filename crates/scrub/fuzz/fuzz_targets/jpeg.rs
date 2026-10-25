#![no_main]

//! JPEG: scan, strip everything removable, and re-scan what came out.

use libfuzzer_sys::fuzz_target;
use mellivora_scrub::{handler_for, Format, RemovalPolicy};

fuzz_target!(|data: &[u8]| {
    if Format::detect(data) != Some(Format::Jpeg) {
        return;
    }
    let Ok(handler) = handler_for(data) else {
        return;
    };
    let Ok(scan) = handler.scan(data) else {
        return;
    };
    // Touch the parsed fields so the optimiser cannot drop the work.
    let _ = scan.metadata_bytes;
    let _ = scan.planned_labels(&RemovalPolicy::all());

    let Ok(stripped) = handler.strip_with(data, &RemovalPolicy::all()) else {
        return;
    };
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
});
