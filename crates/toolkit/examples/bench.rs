//! Throughput for the three operations that touch a whole file.
//!
//! Numbers that only live in a pull-request comment rot. This runs the same
//! measurements every time, prints JSON, and can fail when throughput falls
//! under a floor — so "it feels slower" becomes a number in a job log instead of
//! an argument.
//!
//! ```bash
//! cargo run --release -p mellivora-toolkit --example bench
//! cargo run --release -p mellivora-toolkit --example bench -- --assert-floor-mib 20
//! ```
//!
//! Sizes default to 10 MiB and 1 GiB, the two the roadmap names. Inputs are
//! synthesized: a JPEG with one EXIF segment and a large opaque scan is a valid
//! container for the walker, and needs no fixture on disk.

use std::io::Cursor;
use std::time::{Duration, Instant};

use mellivora_crypto::{seal_stream, AeadAlgorithm, KdfParams, NativeBackend};
use mellivora_scrub::{handler_for, RemovalPolicy};

const MIB: usize = 1024 * 1024;

struct Measurement {
    operation: &'static str,
    input_bytes: usize,
    elapsed: Duration,
}

impl Measurement {
    fn mib_per_second(&self) -> f64 {
        let seconds = self.elapsed.as_secs_f64();
        if seconds <= 0.0 {
            return f64::INFINITY;
        }
        (self.input_bytes as f64 / MIB as f64) / seconds
    }

    /// True for operations whose cost does not scale with the input, where a
    /// throughput figure would be misleading rather than useful.
    fn header_bound(&self) -> bool {
        self.operation.starts_with("scan")
    }

    fn json(&self) -> String {
        let throughput = if self.header_bound() {
            "null".to_string()
        } else {
            format!("{:.1}", self.mib_per_second())
        };
        format!(
            "{{\"operation\":\"{}\",\"input_bytes\":{},\"elapsed_ms\":{:.1},\"mib_per_second\":{throughput},\"header_bound\":{}}}",
            self.operation,
            self.input_bytes,
            self.elapsed.as_secs_f64() * 1000.0,
            self.header_bound()
        )
    }

    fn print(&self) {
        let throughput = if self.header_bound() {
            "header only".to_string()
        } else {
            format!("{:.1} MiB/s", self.mib_per_second())
        };
        println!(
            "{:<14} {:>9} MiB {:>9.1} ms {:>14}",
            self.operation,
            self.input_bytes / MIB,
            self.elapsed.as_secs_f64() * 1000.0,
            throughput
        );
    }
}

/// A JPEG that is `total` bytes long: SOI, one EXIF segment, an SOF0 and SOS
/// header, then a scan whose payload is opaque filler, then EOI. The scrubber
/// walks the header and copies the rest, which is exactly the work measured.
fn jpeg_of_size(total: usize) -> Vec<u8> {
    let exif = b"Exif\0\0II*\x00\x08\x00\x00\x00\x00\x00";
    let mut bytes = Vec::with_capacity(total);
    bytes.extend_from_slice(&[0xFF, 0xD8]);
    bytes.extend_from_slice(&[0xFF, 0xE1]);
    bytes.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
    bytes.extend_from_slice(exif);
    bytes.extend_from_slice(&[
        0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    ]);
    bytes.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]);

    let trailing = 2; // EOI
    let filler = total.saturating_sub(bytes.len() + trailing);
    // 0xFF introduces a marker, so fill with 0x00 to keep the scan opaque and
    // not accidentally marker-shaped.
    bytes.resize(bytes.len() + filler, 0x00);
    bytes.extend_from_slice(&[0xFF, 0xD9]);
    bytes
}

fn measure(operation: &'static str, input_bytes: usize, run: impl FnOnce()) -> Measurement {
    let started = Instant::now();
    run();
    Measurement {
        operation,
        input_bytes,
        elapsed: started.elapsed(),
    }
}

fn bench_scrub(bytes: &[u8]) -> Vec<Measurement> {
    let handler = handler_for(bytes).expect("the synthesized input is a JPEG");
    let policy = RemovalPolicy::all();

    // Scanning walks the container's structure, not its pixel data — a 1 GiB
    // JPEG with one big scan costs the same to scan as a 1 KiB one. The label
    // says so, and the floor check skips it, because a "throughput" number for
    // this operation would be a lie told in MiB.
    let scan = measure("scan (header)", bytes.len(), || {
        let result = handler.scan(bytes).expect("scan");
        assert!(result.metadata_bytes > 0, "the fixture must have metadata");
    });
    let strip = measure("strip", bytes.len(), || {
        let stripped = handler.strip_with(bytes, &policy).expect("strip");
        assert!(stripped.len() < bytes.len(), "strip must remove something");
    });
    vec![scan, strip]
}

fn bench_encrypt(bytes: &[u8]) -> Measurement {
    // A deliberately cheap KDF: the interesting number is bytes per second, and
    // Argon2id would add a constant that has nothing to do with file size.
    let params = KdfParams {
        m_cost_kib: 8,
        t_cost: 1,
        p_cost: 1,
    };
    measure("encrypt", bytes.len(), || {
        let mut out = Vec::with_capacity(bytes.len() + 4096);
        seal_stream(
            &NativeBackend,
            b"bench",
            AeadAlgorithm::ChaCha20Poly1305,
            params,
            Cursor::new(bytes),
            &mut out,
        )
        .expect("seal");
    })
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let floor = args
        .iter()
        .position(|arg| arg == "--assert-floor-mib")
        .and_then(|index| args.get(index + 1))
        .and_then(|value| value.parse::<f64>().ok());

    let sizes: Vec<usize> = match args.iter().any(|arg| arg == "--quick") {
        true => vec![MIB],
        false => vec![10 * MIB, 1024 * MIB],
    };

    println!(
        "{:<14} {:>12} {:>12} {:>14}",
        "operation", "input", "elapsed", "throughput"
    );

    let mut measurements = Vec::new();
    for size in sizes {
        let bytes = jpeg_of_size(size);
        for measurement in bench_scrub(&bytes) {
            measurement.print();
            measurements.push(measurement);
        }

        let encrypted = bench_encrypt(&bytes);
        encrypted.print();
        measurements.push(encrypted);
    }

    println!();
    for measurement in &measurements {
        println!("{}", measurement.json());
    }

    if let Some(floor) = floor {
        let slow: Vec<&Measurement> = measurements
            .iter()
            .filter(|measurement| !measurement.operation.starts_with("scan"))
            .filter(|measurement| measurement.mib_per_second() < floor)
            .collect();
        if !slow.is_empty() {
            eprintln!("\n{floor} MiB/s floor missed:");
            for measurement in slow {
                eprintln!(
                    "  {} on {} MiB: {:.1} MiB/s",
                    measurement.operation,
                    measurement.input_bytes / MIB,
                    measurement.mib_per_second()
                );
            }
            std::process::exit(1);
        }
        println!("\nstrip and encrypt cleared {floor} MiB/s (scan is header-bound)");
    }
}
