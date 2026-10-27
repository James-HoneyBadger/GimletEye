use std::sync::Arc;
use std::time::Instant;

use gimlet_eye_core::{
    ArgKind, ArgSpec, Args, Capability, Category, GimletEyeError, Report, Result, Severity, Tool,
    ToolContext, ToolManifest,
};
use serde_json::{json, Value};

use crate::backend::CryptoBackend;

const LOWER: &str = "abcdefghijklmnopqrstuvwxyz";
const UPPER: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &str = "0123456789";
const SYMBOLS: &str = "!@#$%^&*()-_=+[]{};:,.?/";
const AMBIGUOUS: &str = "Il1O0o";

/// Password generation with an entropy budget and guaranteed character
/// classes.
pub struct PassGen {
    manifest: ToolManifest,
    backend: Arc<dyn CryptoBackend>,
}

impl PassGen {
    pub fn new(backend: Arc<dyn CryptoBackend>) -> Self {
        Self {
            manifest: ToolManifest::new(
                "crypto.passgen",
                "Generate passwords",
                "Cryptographically secure passwords with an estimated entropy budget",
                Category::Crypto,
            )
            .with_capabilities([Capability::Secrets])
            .with_args([
                ArgSpec::new("length", ArgKind::Integer)
                    .default_value(Value::from(24))
                    .help("Characters per password (8-256)"),
                ArgSpec::new("count", ArgKind::Integer)
                    .default_value(Value::from(1))
                    .help("How many passwords to produce (1-256)"),
                ArgSpec::new("symbols", ArgKind::Boolean).default_value(Value::Bool(true)),
                ArgSpec::new("no_ambiguous", ArgKind::Boolean)
                    .default_value(Value::Bool(false))
                    .help("Exclude characters that look alike (Il1O0o)"),
            ])
            .with_tags(["secrets", "entropy", "generator"]),
            backend,
        }
    }

    fn alphabet(&self, symbols: bool, no_ambiguous: bool) -> String {
        let mut alphabet = String::from(LOWER);
        alphabet.push_str(UPPER);
        alphabet.push_str(DIGITS);
        if symbols {
            alphabet.push_str(SYMBOLS);
        }
        if no_ambiguous {
            alphabet.retain(|c| !AMBIGUOUS.contains(c));
        }
        alphabet
    }

    /// Unbiased index in `0..bound`: reject the incomplete tail of the u64 range.
    fn index(&self, bound: usize) -> usize {
        if bound <= 1 {
            return 0;
        }
        let bound = bound as u64;
        let ceiling = u64::MAX - (u64::MAX % bound);
        loop {
            let bytes = self.backend.random_bytes(8);
            let mut raw = [0u8; 8];
            raw.copy_from_slice(&bytes[..8]);
            let value = u64::from_le_bytes(raw);
            if value < ceiling {
                return (value % bound) as usize;
            }
        }
    }

    fn pick(&self, pool: &[char]) -> char {
        if pool.is_empty() {
            return '?';
        }
        pool[self.index(pool.len())]
    }

    fn generate(&self, length: usize, symbols: bool, no_ambiguous: bool) -> String {
        let mut required: Vec<char> = Vec::new();
        for class in [LOWER, UPPER, DIGITS] {
            let pool: Vec<char> = class
                .chars()
                .filter(|c| !no_ambiguous || !AMBIGUOUS.contains(*c))
                .collect();
            if !pool.is_empty() {
                required.push(self.pick(&pool));
            }
        }
        if symbols && length > required.len() {
            let pool: Vec<char> = SYMBOLS.chars().collect();
            required.push(self.pick(&pool));
        }

        let alphabet: Vec<char> = self.alphabet(symbols, no_ambiguous).chars().collect();
        let mut password = required;
        while password.len() < length {
            password.push(self.pick(&alphabet));
        }

        // Fisher–Yates so the guaranteed classes are not in fixed positions.
        for position in (1..password.len()).rev() {
            let swap = self.index(position + 1);
            password.swap(position, swap);
        }

        password.into_iter().collect()
    }
}

impl Tool for PassGen {
    fn manifest(&self) -> &ToolManifest {
        &self.manifest
    }

    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report> {
        ctx.require(Capability::Secrets)?;
        let started = Instant::now();

        let length = args.u64_or("length", 24)? as usize;
        let count = args.u64_or("count", 1)? as usize;
        let symbols = args.bool_or("symbols", true)?;
        let no_ambiguous = args.bool_or("no_ambiguous", false)?;

        if !(8..=256).contains(&length) {
            return Err(GimletEyeError::InvalidArgs(
                "length must be between 8 and 256".into(),
            ));
        }
        if !(1..=256).contains(&count) {
            return Err(GimletEyeError::InvalidArgs(
                "count must be between 1 and 256".into(),
            ));
        }

        let alphabet_size = self.alphabet(symbols, no_ambiguous).chars().count();
        let entropy_bits = (length as f64 * (alphabet_size as f64).log2() * 10.0).round() / 10.0;

        let passwords: Vec<String> = (0..count)
            .map(|_| self.generate(length, symbols, no_ambiguous))
            .collect();

        let mut report = Report::new(&self.manifest.id)
            .with_summary(format!(
                "{count} password(s) · {length} chars · ~{entropy_bits} bits each"
            ))
            .with_data(json!({
                "passwords": passwords,
                "length": length,
                "alphabet_size": alphabet_size,
                "entropy_bits": entropy_bits,
                "backend": self.backend.name(),
            }))
            .with_duration(started.elapsed());

        if entropy_bits < 60.0 {
            report.add_finding(
                Severity::Medium,
                "passgen.low_entropy",
                format!("~{entropy_bits} bits is below the 60-bit guidance for stored secrets"),
            );
        }

        Ok(report.sealed())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gimlet_eye_core::AppPaths;

    fn context() -> ToolContext {
        ToolContext::new(AppPaths::under(std::env::temp_dir().join("gimlet-passgen")))
    }

    fn run(args: Args) -> Report {
        PassGen::new(Arc::new(crate::NativeBackend))
            .run(&context(), &args)
            .expect("run")
    }

    #[test]
    fn honours_length_and_count() {
        let mut args = Args::new();
        args.insert("length", 32);
        args.insert("count", 3);
        let report = run(args);
        let passwords = report.data["passwords"].as_array().expect("array");
        assert_eq!(passwords.len(), 3);
        for password in passwords {
            assert_eq!(password.as_str().expect("string").chars().count(), 32);
        }
    }

    #[test]
    fn includes_every_character_class() {
        let report = run(Args::new());
        let password = report.data["passwords"][0].as_str().expect("password");
        assert!(password.chars().any(|c| c.is_ascii_lowercase()));
        assert!(password.chars().any(|c| c.is_ascii_uppercase()));
        assert!(password.chars().any(|c| c.is_ascii_digit()));
        assert!(password.chars().any(|c| SYMBOLS.contains(c)));
    }

    #[test]
    fn excludes_ambiguous_characters_on_request() {
        let mut args = Args::new();
        args.insert("no_ambiguous", true);
        args.insert("count", 8);
        let report = run(args);
        for password in report.data["passwords"].as_array().expect("array") {
            let password = password.as_str().expect("string");
            assert!(
                !password.chars().any(|c| AMBIGUOUS.contains(c)),
                "{password}"
            );
        }
    }

    #[test]
    fn rejects_out_of_range_length() {
        let mut args = Args::new();
        args.insert("length", 4);
        let err = PassGen::new(Arc::new(crate::NativeBackend))
            .run(&context(), &args)
            .expect_err("must reject");
        assert_eq!(err.code(), "invalid_args");
    }

    #[test]
    fn generation_is_not_deterministic() {
        let first = run(Args::new()).data["passwords"][0]
            .as_str()
            .unwrap()
            .to_string();
        let second = run(Args::new()).data["passwords"][0]
            .as_str()
            .unwrap()
            .to_string();
        assert_ne!(first, second);
    }
}
