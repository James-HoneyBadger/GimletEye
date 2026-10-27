//! The shape of `Report.data`, checked rather than remembered.
//!
//! COMPATIBILITY.md states the rules: `data` is an object or an array of
//! objects, keys are `snake_case`, nesting stops at two levels, and a string
//! carries a value rather than a document. This test runs every native tool and
//! holds it to them — and fails when a tool is added without a sample, so the
//! rules cannot rot into folklore.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use gimlet_eye_core::{AppPaths, Args, Report, ToolContext};
use gimlet_eye_toolkit::Runtime;
use serde_json::Value;

/// Deepest allowed path: `data.a.b` and `data.a[].b`.
const MAX_DEPTH: usize = 2;

struct Workspace {
    paths: AppPaths,
}

impl Workspace {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("gimlet-data-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("workspace");
        Self {
            paths: AppPaths::under(root),
        }
    }

    fn dir(&self) -> &Path {
        &self.paths.root
    }

    fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.paths.root.join(name);
        fs::write(&path, bytes).expect("write fixture");
        path
    }
}

struct Samples {
    runtime: Runtime,
    context: ToolContext,
    seen: BTreeSet<String>,
}

impl Samples {
    fn new(paths: &AppPaths) -> Self {
        let runtime = Runtime::load(Some(paths.root.clone()), false).expect("runtime");
        let context = runtime.context(false);
        Self {
            runtime,
            context,
            seen: BTreeSet::new(),
        }
    }

    /// Run one tool and hold its report to the documented shape.
    fn run(&mut self, id: &str, args: Args) -> Report {
        let tool = self
            .runtime
            .registry
            .get(id)
            .unwrap_or_else(|| panic!("{id} is not registered"));
        let report = tool
            .run(&self.context, &args)
            .unwrap_or_else(|error| panic!("{id} failed: {error}"));
        check_data(&report.data, id);
        self.seen.insert(report.tool.clone());
        report
    }

    fn native_ids(&self) -> BTreeSet<String> {
        self.runtime
            .registry
            .manifests()
            .into_iter()
            .filter(|manifest| manifest.origin == "builtin")
            .map(|manifest| manifest.id)
            .collect()
    }
}

fn args(pairs: &[(&str, String)]) -> Args {
    let mut args = Args::new();
    for (key, value) in pairs {
        args.insert(*key, value.clone());
    }
    args
}

/// A throwaway GnuPG home with one key, or `None` when gpg is not installed.
///
/// The OpenPGP tools have no data worth shape-checking without a keyring, so the
/// sample is a real signature and a real encryption.
fn gpg_keyring(name: &str) -> Option<PathBuf> {
    if !Command::new("gpg")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
    {
        return None;
    }
    let home = std::env::temp_dir().join(format!("gimlet-shape-gpg-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&home);
    fs::create_dir_all(&home).expect("gpg home");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&home, fs::Permissions::from_mode(0o700)).expect("chmod");
    }
    let generated = Command::new("gpg")
        .arg("--homedir")
        .arg(&home)
        .args([
            "--batch",
            "--passphrase",
            "",
            "--quick-generate-key",
            "Shape Test <shape@example.invalid>",
            "default",
            "default",
            "never",
        ])
        .output()
        .expect("generate key");
    assert!(
        generated.status.success(),
        "gpg key generation failed: {}",
        String::from_utf8_lossy(&generated.stderr)
    );
    Some(home)
}

fn gpg(home: &Path, args: &[&str]) {
    let output = Command::new("gpg")
        .arg("--homedir")
        .arg(home)
        .args(args)
        .output()
        .expect("run gpg");
    assert!(
        output.status.success(),
        "gpg {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// SOI, an APP1 EXIF segment, a comment, a scan, and EOI — enough for scrub.
fn jpeg_with_exif() -> Vec<u8> {
    let exif = b"Exif\0\0FAKE-EXIF-PAYLOAD";
    let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xE1];
    bytes.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
    bytes.extend_from_slice(exif);
    bytes.extend_from_slice(&[0xFF, 0xFE]);
    bytes.extend_from_slice(&(2u16 + 5).to_be_bytes());
    bytes.extend_from_slice(b"hello");
    bytes.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]);
    bytes.extend_from_slice(&[9, 9, 9, 9]);
    bytes.extend_from_slice(&[0xFF, 0xD9]);
    bytes
}

#[test]
fn every_native_tool_answers_with_data_of_the_documented_shape() {
    let workspace = Workspace::new("shape");
    let dir = workspace.dir().to_path_buf();
    let mut samples = Samples::new(&workspace.paths);

    // ── crypto ────────────────────────────────────────────────────────────
    samples.run(
        "crypto.passgen",
        args(&[("length", "16".into()), ("count", "2".into())]),
    );
    samples.run("crypto.sha256", args(&[("text", "abc".into())]));

    let plaintext = workspace.file("note.txt", b"the launch code is 0000\n");
    samples.run(
        "crypto.encrypt",
        args(&[
            ("input", plaintext.display().to_string()),
            ("passphrase", "test-only".into()),
        ]),
    );
    let container = plaintext.with_file_name("note.txt.gimlet");
    samples.run(
        "crypto.inspect",
        args(&[("input", container.display().to_string())]),
    );
    samples.run(
        "crypto.decrypt",
        args(&[
            ("input", container.display().to_string()),
            ("output", dir.join("round-trip.txt").display().to_string()),
            ("passphrase", "test-only".into()),
        ]),
    );

    let keys = dir.join("keys");
    samples.run(
        "crypto.keygen",
        args(&[
            ("label", "shape".into()),
            ("dir", keys.display().to_string()),
        ]),
    );
    samples.run(
        "crypto.sign",
        args(&[
            ("input", plaintext.display().to_string()),
            ("key", keys.join("shape.key").display().to_string()),
        ]),
    );
    samples.run(
        "crypto.verify",
        args(&[
            ("input", plaintext.display().to_string()),
            (
                "signature",
                plaintext
                    .with_file_name("note.txt.sig")
                    .display()
                    .to_string(),
            ),
            ("key", keys.join("shape.pub").display().to_string()),
        ]),
    );

    // ── crypto: the sealed keystore ───────────────────────────────────────
    samples.run(
        "crypto.keygen",
        args(&[
            ("label", "recipient".into()),
            ("kind", "x25519".into()),
            ("keystore", "true".into()),
            ("passphrase", "test-only".into()),
        ]),
    );
    samples.run(
        "crypto.key-list",
        args(&[("passphrase", "test-only".into())]),
    );
    let recipient_public = dir.join("recipient.pub");
    samples.run(
        "crypto.key-export",
        args(&[
            ("selector", "recipient".into()),
            ("output", recipient_public.display().to_string()),
            ("passphrase", "test-only".into()),
        ]),
    );
    samples.run(
        "crypto.key-import",
        args(&[
            ("key", recipient_public.display().to_string()),
            ("label", "friend".into()),
            ("public_only", "true".into()),
            ("passphrase", "test-only".into()),
        ]),
    );
    let recipient_secret = dir.join("recipient.key");
    samples.run(
        "crypto.key-export",
        args(&[
            ("selector", "recipient".into()),
            ("output", recipient_secret.display().to_string()),
            ("secret", "true".into()),
            ("passphrase", "test-only".into()),
        ]),
    );
    samples.run(
        "crypto.encrypt",
        args(&[
            ("input", plaintext.display().to_string()),
            (
                "output",
                dir.join("for-recipient.gimlet").display().to_string(),
            ),
            ("to", recipient_public.display().to_string()),
        ]),
    );
    samples.run(
        "crypto.decrypt",
        args(&[
            (
                "input",
                dir.join("for-recipient.gimlet").display().to_string(),
            ),
            (
                "output",
                dir.join("for-recipient.txt").display().to_string(),
            ),
            ("key", recipient_secret.display().to_string()),
        ]),
    );
    samples.run(
        "crypto.key-rotate",
        args(&[
            ("passphrase", "test-only".into()),
            ("new_passphrase", "test-only-2".into()),
        ]),
    );

    // ── crypto: OpenPGP interop (needs gpg on PATH) ────────────────────────
    match gpg_keyring("shape") {
        Some(home) => {
            let signature = dir.join("note.txt.gpg.sig");
            gpg(
                &home,
                &[
                    "--batch",
                    "--detach-sign",
                    "--output",
                    signature.to_str().expect("utf8"),
                    plaintext.to_str().expect("utf8"),
                ],
            );
            samples.run(
                "crypto.gpg-verify",
                args(&[
                    ("input", plaintext.display().to_string()),
                    ("signature", signature.display().to_string()),
                    ("homedir", home.display().to_string()),
                ]),
            );
            samples.run(
                "crypto.gpg-encrypt",
                args(&[
                    ("input", plaintext.display().to_string()),
                    ("output", dir.join("for-gpg.txt.gpg").display().to_string()),
                    ("recipient", "Shape Test".into()),
                    ("homedir", home.display().to_string()),
                ]),
            );
            let _ = fs::remove_dir_all(&home);
        }
        None => {
            // No gpg here: the tools still exist and still owe a shape. The
            // crypto crate's own interop test checks it where gpg is installed.
            samples.seen.insert("crypto.gpg-verify".to_string());
            samples.seen.insert("crypto.gpg-encrypt".to_string());
        }
    }

    // ── privacy ───────────────────────────────────────────────────────────
    let photo = workspace.file("photo.jpg", &jpeg_with_exif());
    samples.run(
        "privacy.metadata-scan",
        args(&[("input", photo.display().to_string())]),
    );
    samples.run(
        "privacy.metadata-strip",
        args(&[("input", photo.display().to_string())]),
    );
    samples.run(
        "privacy.metadata-verify",
        args(&[(
            "input",
            photo
                .with_file_name("photo.clean.jpg")
                .display()
                .to_string(),
        )]),
    );

    // ── sysadmin (Linux-only by declaration) ──────────────────────────────
    #[cfg(target_os = "linux")]
    {
        samples.run("sysadmin.system-info", Args::new());
        samples.run(
            "sysadmin.disk-usage",
            args(&[("path", dir.display().to_string())]),
        );
    }
    #[cfg(not(target_os = "linux"))]
    {
        // The gate refuses these here; the shape is checked where they run.
        samples.seen.insert("sysadmin.system-info".to_string());
        samples.seen.insert("sysadmin.disk-usage".to_string());
    }

    // ── coverage ──────────────────────────────────────────────────────────
    let native = samples.native_ids();
    let missing: Vec<&String> = native.difference(&samples.seen).collect();
    assert!(
        missing.is_empty(),
        "no sample invocation for {missing:?}; add one to this test so its data shape is checked"
    );

    let _ = fs::remove_dir_all(&dir);
}

fn check_data(data: &Value, tool: &str) {
    match data {
        Value::Null => {}
        Value::Object(map) => check_object(map, tool, ""),
        Value::Array(items) => {
            for item in items {
                let map = item.as_object().unwrap_or_else(|| {
                    panic!(
                        "{tool}: `data` array holds {}, expected objects",
                        kind(item)
                    )
                });
                check_object(map, tool, "[].");
            }
        }
        other => panic!(
            "{tool}: `data` must be an object or an array of objects, found {}",
            kind(other)
        ),
    }
}

fn check_object(map: &serde_json::Map<String, Value>, tool: &str, prefix: &str) {
    for (key, value) in map {
        let path = format!("{tool}: {prefix}{key}");
        assert!(is_snake_case(key), "{path}: keys are snake_case");
        check_value(value, &path, 1);
    }
}

fn check_value(value: &Value, path: &str, depth: usize) {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
        Value::String(text) => {
            assert!(
                !text.contains('\n'),
                "{path}: a value must not contain a newline; prose belongs in `body`"
            );
            assert!(
                !text.contains('\u{1b}'),
                "{path}: a value must not contain an ANSI escape"
            );
        }
        Value::Array(items) => {
            for item in items {
                check_value(item, &format!("{path}[]"), depth);
            }
        }
        Value::Object(map) => {
            assert!(
                depth <= MAX_DEPTH,
                "{path}: nesting stops at two levels (`data.a.b`); prose belongs in `body`"
            );
            for (key, inner) in map {
                let path = format!("{path}.{key}");
                assert!(is_snake_case(key), "{path}: keys are snake_case");
                check_value(inner, &path, depth + 1);
            }
        }
    }
}

fn is_snake_case(key: &str) -> bool {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_lowercase()
        && chars.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

fn kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}
