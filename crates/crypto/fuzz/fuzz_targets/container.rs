#![no_main]

//! The `.melv` reader: header parsing, and opening with a fixed passphrase.
//!
//! The scrub targets fuzz the parsers that touch irreplaceable files; this one
//! fuzzes the file format the tool writes. It must never panic, whatever bytes
//! arrive.
//!
//! It also found the one thing worth saying loudly: a legal header may ask for
//! 595 MiB of memory and nine iterations, and honouring it costs ~42 seconds
//! before the chunk stream is even checked. That is a *tool* policy question
//! rather than a format one, and `crates/crypto/tests/decrypt_cost_budget.rs`
//! pins the answer: `crypto.decrypt` refuses above its budget unless told
//! `allow_expensive=true`.

use libfuzzer_sys::fuzz_target;
use mellivora_crypto::{inspect, open_for_recipient, open_stream, Kdf, NativeBackend};

/// Parameters this target is willing to pay for.
///
/// The *format* accepts up to 1 GiB and 16 iterations, and honouring that is
/// allowed to cost minutes — bounding it is a policy of the built-in decrypt tool
/// (`refuse_expensive_header` in `operations.rs`), tested there rather than here.
/// This target stays inside the cheap range so that thousands of inputs get
/// parsed per second instead of one.
const BUDGET_KIB: u32 = 64 * 1024;
const BUDGET_ITERATIONS: u32 = 2;

fuzz_target!(|data: &[u8]| {
    // Parsing a header is cheap and takes any length, so every input reaches it.
    let Ok(header) = inspect(data) else {
        return;
    };

    let within_budget = match &header.kdf {
        Kdf::Argon2id(params) => {
            params.m_cost_kib <= BUDGET_KIB
                && params.t_cost <= BUDGET_ITERATIONS
                && params.p_cost <= 4
        }
        // v3 derives through X25519, not Argon2id: always cheap.
        Kdf::X25519HkdfSha256 => true,
    };

    if !within_budget {
        // Expensive but legal — version 1 uses Argon2id too. Parsing is all this
        // target claims for such a header; see the note on BUDGET_KIB.
        return;
    }

    let mut out = Vec::new();
    let _ = open_stream(&NativeBackend, b"fuzz-passphrase", data, &mut out);

    // The recipient path shares the chunk stream and has its own header layout.
    let mut recipient_out = Vec::new();
    let _ = open_for_recipient(&NativeBackend, &[3u8; 32], data, &mut recipient_out);
});
