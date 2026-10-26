//! OpenPGP interop, exercised against a real `gpg`.
//!
//! ADR 0006 accepts no unverified claim, so the acceptance criterion for this
//! feature - "verifies a `gpg`-signed file" - is a test that runs `gpg`, not a
//! mock. Each run gets its own GnuPG home so nothing touches the user's keyring,
//! and the whole file is skipped where `gpg` is not installed.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use mellivora_core::{AppPaths, Args, Tool, ToolContext};
use mellivora_crypto::{GpgEncrypt, GpgVerify};

/// `a_missing_gpg...` changes PATH, which is process-wide, so these tests take
/// turns instead of racing each other's environment.
static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn serial() -> std::sync::MutexGuard<'static, ()> {
    SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Whether `gpg` runs here.
///
/// A missing `gpg` makes this file skip, which on a developer machine is the
/// right call and in CI is not: a skipped interop test is an unverified claim
/// dressed as a green one. `MELLIVORA_REQUIRE_GPG` turns the skip into a failure,
/// and the workflow sets it.
fn gpg_available() -> bool {
    let works = Command::new("gpg")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !works && std::env::var_os("MELLIVORA_REQUIRE_GPG").is_some() {
        panic!("MELLIVORA_REQUIRE_GPG is set but gpg did not run: the interop claim is unverified");
    }
    works
}

struct Keyring {
    dir: PathBuf,
}

impl Keyring {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("mellivora-gpg-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("gpg home");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).expect("chmod");
        }
        let keyring = Self { dir };
        keyring.gpg(&[
            "--batch",
            "--passphrase",
            "",
            "--quick-generate-key",
            "Mellivora Test <test@example.invalid>",
            "default",
            "default",
            "never",
        ]);
        keyring
    }

    fn gpg(&self, args: &[&str]) {
        let output = Command::new("gpg")
            .arg("--homedir")
            .arg(&self.dir)
            .args(args)
            .output()
            .expect("run gpg");
        assert!(
            output.status.success(),
            "gpg {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn dir(&self) -> &Path {
        &self.dir
    }
}

impl Drop for Keyring {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn context() -> ToolContext {
    let root = std::env::temp_dir().join(format!("mellivora-gpg-work-{}", std::process::id()));
    let _ = fs::create_dir_all(&root);
    ToolContext::new(AppPaths::under(root))
}

fn args(pairs: &[(&str, String)]) -> Args {
    let mut args = Args::new();
    for (key, value) in pairs {
        args.insert(*key, value.clone());
    }
    args
}

#[test]
fn verifies_a_signature_made_by_gpg_and_refuses_a_broken_one() {
    let _guard = serial();
    if !gpg_available() {
        eprintln!("skipping: gpg is not installed");
        return;
    }
    let keyring = Keyring::new("verify");
    let ctx = context();
    let work = ctx.paths.root.clone();
    let note = work.join("signed.txt");
    fs::write(&note, b"the launch code is 0000\n").expect("write");
    let signature = work.join("signed.txt.sig");
    keyring.gpg(&[
        "--batch",
        "--detach-sign",
        "--output",
        signature.to_str().expect("utf8"),
        note.to_str().expect("utf8"),
    ]);

    let report = GpgVerify::new()
        .run(
            &ctx,
            &args(&[
                ("input", note.display().to_string()),
                ("signature", signature.display().to_string()),
                ("homedir", keyring.dir().display().to_string()),
            ]),
        )
        .expect("verifies");

    assert_eq!(report.data["valid"], true);
    assert_eq!(report.data["backend"], "gpg");
    let fingerprint = report.data["fingerprint"].as_str().expect("fingerprint");
    assert_eq!(
        fingerprint.len(),
        40,
        "a v4 fingerprint is 40 hex characters"
    );
    assert!(report.summary.contains("valid"));

    // A signature over different bytes must fail closed, not warn.
    fs::write(&note, b"the launch code is 1234\n").expect("rewrite");
    let error = GpgVerify::new()
        .run(
            &ctx,
            &args(&[
                ("input", note.display().to_string()),
                ("signature", signature.display().to_string()),
                ("homedir", keyring.dir().display().to_string()),
            ]),
        )
        .expect_err("tampered file");
    assert!(
        error.to_string().contains("does not match"),
        "unhelpful error: {error}"
    );
}

#[test]
fn encrypts_something_gpg_itself_can_read() {
    let _guard = serial();
    if !gpg_available() {
        eprintln!("skipping: gpg is not installed");
        return;
    }
    let keyring = Keyring::new("encrypt");
    let ctx = context();
    let work = ctx.paths.root.clone();
    let plain = work.join("secret.txt");
    fs::write(&plain, b"for your eyes only\n").expect("write");

    let report = GpgEncrypt::new()
        .run(
            &ctx,
            &args(&[
                ("input", plain.display().to_string()),
                ("recipient", "Mellivora Test".to_string()),
                ("homedir", keyring.dir().display().to_string()),
            ]),
        )
        .expect("encrypts");
    let output = PathBuf::from(report.data["output"].as_str().expect("output"));
    assert!(output.is_file());
    assert!(report.data["output_bytes"].as_u64().expect("bytes") > 0);

    // The real check: gpg decrypts what the tool produced.
    let decrypted = work.join("secret.txt.clear");
    keyring.gpg(&[
        "--batch",
        "--yes",
        "--output",
        decrypted.to_str().expect("utf8"),
        "--decrypt",
        output.to_str().expect("utf8"),
    ]);
    assert_eq!(fs::read(&decrypted).expect("read"), b"for your eyes only\n");
}

#[test]
fn a_dry_run_writes_nothing() {
    let _guard = serial();
    if !gpg_available() {
        eprintln!("skipping: gpg is not installed");
        return;
    }
    let keyring = Keyring::new("dryrun");
    let ctx = context().with_dry_run(true);
    let plain = ctx.paths.root.join("dry.txt");
    fs::write(&plain, b"nothing happens\n").expect("write");

    let report = GpgEncrypt::new()
        .run(
            &ctx,
            &args(&[
                ("input", plain.display().to_string()),
                ("recipient", "Mellivora Test".to_string()),
                ("homedir", keyring.dir().display().to_string()),
            ]),
        )
        .expect("dry run");
    assert_eq!(report.data["dry_run"], true);
    assert_eq!(report.data["output"], serde_json::Value::Null);
    assert!(!plain.with_file_name("dry.txt.gpg").exists());
}

#[test]
fn a_missing_gpg_is_reported_as_missing_not_as_a_bad_signature() {
    // Point PATH at an empty directory so the lookup fails the same way it would
    // on a machine without gpg.
    let previous = std::env::var_os("PATH");
    let empty = std::env::temp_dir().join(format!("mellivora-empty-path-{}", std::process::id()));
    fs::create_dir_all(&empty).expect("mkdir");
    std::env::set_var("PATH", &empty);

    let ctx = context();
    let input = ctx.paths.root.join("anything.txt");
    fs::write(&input, b"x").expect("write");
    let error = GpgVerify::new()
        .run(
            &ctx,
            &args(&[
                ("input", input.display().to_string()),
                ("signature", input.display().to_string()),
            ]),
        )
        .expect_err("no gpg");

    match previous {
        Some(value) => std::env::set_var("PATH", value),
        None => std::env::remove_var("PATH"),
    }
    let _ = fs::remove_dir_all(&empty);

    assert_eq!(error.code(), "not_found");
    assert!(error.to_string().contains("gpg"), "{error}");
}
