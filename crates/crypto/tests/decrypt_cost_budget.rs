//! A file someone sends you must not decide how long your CPU is busy.
//!
//! The container format accepts up to 1 GiB of Argon2id memory and 16 iterations,
//! which is right for a format: a peer may have used strong parameters. The
//! built-in `crypto.decrypt` is what a user points at an untrusted file, so it
//! refuses a header above its own budget unless asked otherwise — otherwise a
//! 75-byte file buys minutes of CPU. A fuzz target found the shape: a header
//! asking for 595 MiB and nine iterations cost 42 seconds before the chunk check
//! rejected the file.

use std::io::Cursor;
use std::time::{Duration, Instant};

use mellivora_core::{AppPaths, Args, Tool, ToolContext};
use mellivora_crypto::{seal_stream, AeadAlgorithm, Decrypt, KdfParams, NativeBackend};

struct Sandbox {
    root: std::path::PathBuf,
    context: ToolContext,
}

impl Sandbox {
    fn new(name: &str) -> Self {
        let root =
            std::env::temp_dir().join(format!("mellivora-budget-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("sandbox");
        let paths = AppPaths::under(root.clone());
        let context = ToolContext::new(paths);
        Self { root, context }
    }

    /// A real container sealed with deliberately expensive parameters.
    fn expensive_container(&self, name: &str, params: KdfParams) -> std::path::PathBuf {
        let mut sealed = Vec::new();
        seal_stream(
            &NativeBackend,
            b"expensive",
            AeadAlgorithm::ChaCha20Poly1305,
            params,
            Cursor::new(b"sealed under an expensive header\n"),
            &mut sealed,
        )
        .expect("seal");
        let path = self.root.join(name);
        std::fs::write(&path, sealed).expect("write container");
        path
    }

    fn run(
        &self,
        input: &std::path::Path,
        extra: &[(&str, &str)],
    ) -> Result<(), (String, Duration)> {
        let mut args = Args::new();
        args.insert("input", input.display().to_string());
        args.insert("output", self.root.join("out.txt").display().to_string());
        args.insert("passphrase", "expensive");
        for (key, value) in extra {
            args.insert(*key, (*value).to_string());
        }
        let started = Instant::now();
        Decrypt::new(std::sync::Arc::new(NativeBackend))
            .run(&self.context, &args)
            .map(|_| ())
            .map_err(|error| (error.to_string(), started.elapsed()))
    }
}

fn over_budget() -> KdfParams {
    KdfParams {
        m_cost_kib: 300 * 1024,
        t_cost: 1,
        p_cost: 1,
    }
}

#[test]
fn an_over_budget_header_is_refused_before_the_key_is_derived() {
    let sandbox = Sandbox::new("refused");
    let container = sandbox.expensive_container("expensive.melv", over_budget());

    let (message, elapsed) = sandbox.run(&container, &[]).expect_err("refused");
    assert!(
        message.contains("300 MiB") && message.contains("iteration"),
        "the refusal should name the parameters: {message}"
    );
    assert!(
        message.contains("allow_expensive"),
        "the refusal should say how to proceed: {message}"
    );
    // Deriving 300 MiB takes seconds; refusing must not.
    assert!(
        elapsed < Duration::from_millis(500),
        "refusing took {elapsed:?}: the key was derived first"
    );
}

#[test]
fn allow_expensive_opens_the_file_the_operator_vouched_for() {
    let sandbox = Sandbox::new("allowed");
    let container = sandbox.expensive_container("allowed.melv", over_budget());

    sandbox
        .run(&container, &[("allow_expensive", "true")])
        .expect("an explicit opt-in derives the key and decrypts");

    let plaintext = std::fs::read(sandbox.root.join("out.txt")).expect("output");
    assert_eq!(plaintext, b"sealed under an expensive header\n");
}

#[test]
fn a_default_container_is_under_the_budget() {
    // The defaults must stay openable without the flag, or the fix would break
    // every file the tool writes.
    let sandbox = Sandbox::new("default");
    let container = sandbox.expensive_container("default.melv", KdfParams::default());
    sandbox.run(&container, &[]).expect("defaults open");
}
