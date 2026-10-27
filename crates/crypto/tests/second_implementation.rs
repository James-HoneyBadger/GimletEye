//! The container opened by a second implementation.
//!
//! ADR 0006 Gate 1 will not accept "readable by a second implementation" on the
//! strength of a specification alone, and it should not: a format that only its
//! own code can read is documented by its source, not by its document. So
//! `interop/read_container.py` is a reader written from `docs/CONTAINER.md` — no Rust
//! involved — and this file runs it against the two committed fixtures and
//! against what this build writes.
//!
//! A missing interpreter skips, because not every machine has Python. In CI the
//! interpreter is installed for the job and `GIMLET_REQUIRE_SECOND_IMPL`
//! turns a skip into a failure, so the claim cannot quietly stop being tested.

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;

use gimlet_eye_crypto::{
    seal_stream, AeadAlgorithm, KdfParams, NativeBackend, VERSION, VERSION_RECIPIENT,
    VERSION_STREAMING,
};

const V1_FIXTURE: &str = "fixtures/container-v1.melv";
const V3_FIXTURE: &str = "fixtures/container-v3.melv";
const V1_PASSPHRASE: &str = "correct horse battery staple";
const V1_PLAINTEXT: &[u8] = b"a container written by 0.2.0: whole-file AEAD, version 1\n";
const V3_SECRET_HEX: &str = "0303030303030303030303030303030303030303030303030303030303030303";
const V3_PLAINTEXT: &[u8] = b"a container written by 0.5.0: x25519 recipient, version 3\n";

fn here() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf()
}

fn reader_script() -> PathBuf {
    here().join("tests/interop/read_container.py")
}

/// Whether the second implementation can run here.
fn python_available() -> bool {
    let works = Command::new("python3")
        .args(["-c", "import cryptography"])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !works && std::env::var_os("GIMLET_REQUIRE_SECOND_IMPL").is_some() {
        panic!(
            "GIMLET_REQUIRE_SECOND_IMPL is set but `python3` with `cryptography` did not run: \
             the second-implementation claim is unverified"
        );
    }
    works
}

struct Run {
    status: i32,
    stdout: Vec<u8>,
    stderr: String,
}

fn read_with_second_implementation(file: &Path, selector: &[&str]) -> Run {
    let output = Command::new("python3")
        .arg(reader_script())
        .arg(file)
        .args(selector)
        .output()
        .expect("run the second implementation");
    Run {
        status: output.status.code().unwrap_or(-1),
        stdout: output.stdout,
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    }
}

fn temp_file(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("gimlet-interop-{name}-{}", std::process::id()));
    let _ = std::fs::remove_file(&path);
    path
}

#[test]
fn a_v1_container_opens_in_the_second_implementation() {
    if !python_available() {
        eprintln!("skipping: python3 with cryptography is not installed");
        return;
    }
    let fixture = here().join("tests").join(V1_FIXTURE);
    let run = read_with_second_implementation(&fixture, &["--passphrase", V1_PASSPHRASE]);
    assert_eq!(run.status, 0, "reader failed: {}", run.stderr);
    assert_eq!(run.stdout, V1_PLAINTEXT);
    assert!(
        run.stderr.contains(&format!("version={VERSION}")),
        "reader should report the version it read: {}",
        run.stderr
    );
}

#[test]
fn a_v3_container_opens_in_the_second_implementation() {
    if !python_available() {
        eprintln!("skipping: python3 with cryptography is not installed");
        return;
    }
    let fixture = here().join("tests").join(V3_FIXTURE);
    let run = read_with_second_implementation(&fixture, &["--key-hex", V3_SECRET_HEX]);
    assert_eq!(run.status, 0, "reader failed: {}", run.stderr);
    assert_eq!(run.stdout, V3_PLAINTEXT);
    assert!(
        run.stderr.contains(&format!("version={VERSION_RECIPIENT}")),
        "reader should report the version it read: {}",
        run.stderr
    );
}

#[test]
fn what_this_build_writes_opens_in_the_second_implementation() {
    if !python_available() {
        eprintln!("skipping: python3 with cryptography is not installed");
        return;
    }
    // Cross a chunk boundary on purpose: a single-chunk file would not exercise
    // the counter in the per-chunk nonce.
    let plaintext: Vec<u8> = (0..(gimlet_eye_crypto::CHUNK_SIZE * 2 + 1234))
        .map(|index| (index % 251) as u8)
        .collect();
    let path = temp_file("written");
    let mut container = Vec::new();
    seal_stream(
        &NativeBackend,
        b"a passphrase only this test knows",
        AeadAlgorithm::ChaCha20Poly1305,
        KdfParams::default(),
        Cursor::new(&plaintext),
        &mut container,
    )
    .expect("seal");
    assert_eq!(container[4], VERSION_STREAMING, "the writer emits v2");
    std::fs::write(&path, &container).expect("write container");

    let run = read_with_second_implementation(
        &path,
        &["--passphrase", "a passphrase only this test knows"],
    );
    let _ = std::fs::remove_file(&path);
    assert_eq!(run.status, 0, "reader failed: {}", run.stderr);
    assert_eq!(
        run.stdout, plaintext,
        "the bytes must survive the round trip"
    );
}

#[test]
fn the_second_implementation_rejects_a_tampered_chunk() {
    if !python_available() {
        eprintln!("skipping: python3 with cryptography is not installed");
        return;
    }
    // Without this, the reader could be "decrypting" by printing whatever it
    // was given; a flipped bit has to stop it.
    let plaintext = vec![7u8; 1000];
    let mut container = Vec::new();
    seal_stream(
        &NativeBackend,
        b"tamper test",
        AeadAlgorithm::Aes256Gcm,
        KdfParams::default(),
        Cursor::new(&plaintext),
        &mut container,
    )
    .expect("seal");
    let last = container.len() - 1;
    container[last] ^= 0x01;

    let path = temp_file("tampered");
    std::fs::write(&path, &container).expect("write container");
    let run = read_with_second_implementation(&path, &["--passphrase", "tamper test"]);
    let _ = std::fs::remove_file(&path);
    assert_ne!(run.status, 0, "a tampered chunk must not decrypt");
    assert_ne!(
        run.status, 101,
        "the reader should fail, not panic: {}",
        run.stderr
    );
}
