//! Running `metadata-strip` twice must equal running it once.
//!
//! The unit-level property is checked in `gimlet-eye-scrub` (redaction twice) and
//! in the fuzz targets (strip twice on arbitrary bytes). This is the version a
//! user actually exercises: the *tool*, with `redact_gps` and a profile, which
//! redacts into a working copy, strips, and verifies. A regression anywhere along
//! that path shows up here as a second output that differs from the first.

use std::fs;
use std::path::{Path, PathBuf};

use gimlet_eye_core::{Args, ToolContext};
use gimlet_eye_toolkit::Runtime;

struct Sandbox {
    root: PathBuf,
    context: ToolContext,
    runtime: Runtime,
}

impl Sandbox {
    fn new(name: &str) -> Self {
        let root =
            std::env::temp_dir().join(format!("gimlet-strip-idem-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("sandbox");
        let runtime = Runtime::load(Some(root.clone()), false).expect("runtime");
        let context = runtime.context(false);
        Self {
            root,
            context,
            runtime,
        }
    }

    fn run(&mut self, args: Args) -> serde_json::Value {
        let tool = self
            .runtime
            .registry
            .get("privacy.metadata-strip")
            .expect("metadata-strip is registered");
        let report = tool
            .run(&self.context, &args)
            .unwrap_or_else(|error| panic!("metadata-strip failed: {error}"));
        serde_json::to_value(&report.data).expect("data is serialisable")
    }
}

fn args(pairs: &[(&str, &str)]) -> Args {
    let mut args = Args::new();
    for (key, value) in pairs {
        args.insert(*key, (*value).to_string());
    }
    args
}

/// A JPEG whose EXIF really carries coordinates.
///
/// `golden/fixtures/photo-gps.jpg` has a GPS *segment*, but its tags do not
/// include a coordinate pair, so `redact_gps` correctly reports that there is
/// nothing to redact in it. This seed exists for exactly this case.
fn gps_fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../scrub/fuzz/seeds/exif/gps.jpg")
        .canonicalize()
        .expect("the GPS seed")
}

#[test]
fn redacting_and_stripping_twice_leaves_the_second_output_alone() {
    let mut sandbox = Sandbox::new("gps");
    let first = sandbox.root.join("first.jpg");
    let second = sandbox.root.join("second.jpg");

    let first_report = sandbox.run(args(&[
        ("input", gps_fixture().to_str().expect("utf-8 path")),
        ("output", first.to_str().expect("utf-8 path")),
        // `archive` keeps EXIF, so the redacted coordinates survive the strip and
        // a second pass has something left to look at.
        ("profile", "archive"),
        ("redact_gps", "city"),
    ]));
    assert!(
        first.exists(),
        "the first run should have written its output"
    );

    let second_report = sandbox.run(args(&[
        ("input", first.to_str().expect("utf-8 path")),
        ("output", second.to_str().expect("utf-8 path")),
        ("profile", "archive"),
        ("redact_gps", "city"),
    ]));

    // The coordinate must not drift: this is the property the fuzz target found
    // broken, where each pass moved the point a little further.
    assert_eq!(
        first_report["gps"], second_report["gps"],
        "the second run reported a different coordinate than the first"
    );

    // Idempotent means the second run finds nothing left to do — not that it
    // rewrites the file with a different arrangement of the same bytes.
    if second.exists() {
        assert_eq!(
            fs::read(&first).expect("first output"),
            fs::read(&second).expect("second output"),
            "a second strip rewrote the file instead of leaving it alone"
        );
    }
    assert_eq!(
        second_report["removed_bytes"], 0,
        "the second run removed bytes that the first run should have removed"
    );
}
