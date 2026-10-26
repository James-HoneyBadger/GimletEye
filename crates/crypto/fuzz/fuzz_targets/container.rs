#![no_main]

//! The `.melv` reader: header parsing, and opening with a fixed passphrase.
//!
//! The scrub targets fuzz the parsers that touch irreplaceable files; this one
//! fuzzes the file format the tool writes, which until now had no fuzzing at all.
//! Two things it must never do: panic, or let a crafted header buy work — a
//! header can name 1 GiB of memory and sixteen iterations, and refusing that
//! *before* deriving the key is the only reason a hostile file cannot pin a core.

use std::time::{Duration, Instant};

use libfuzzer_sys::fuzz_target;
use mellivora_crypto::{inspect, open_for_recipient, open_stream, Kdf, NativeBackend};

/// Parameters this target is willing to pay for. Anything larger has to be
/// refused by the reader, and refused without deriving.
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
        // An expensive header must be refused, and refused before any derivation.
        let started = Instant::now();
        let mut out = Vec::new();
        let result = open_stream(&NativeBackend, b"fuzz-passphrase", data, &mut out);
        assert!(
            result.is_err(),
            "a header demanding more than the budget was accepted"
        );
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "refusing an expensive header took {:?}: the key was derived first",
            started.elapsed()
        );
        return;
    }

    let mut out = Vec::new();
    let _ = open_stream(&NativeBackend, b"fuzz-passphrase", data, &mut out);

    // The recipient path shares the chunk stream and has its own header layout.
    let mut recipient_out = Vec::new();
    let _ = open_for_recipient(&NativeBackend, &[3u8; 32], data, &mut recipient_out);
});
