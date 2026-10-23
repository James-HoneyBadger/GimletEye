mod app;
mod cli;
mod commands;

use std::process::ExitCode;

use clap::Parser;
use mellivora_core::MellivoraError;

fn main() -> ExitCode {
    let argv = commands::normalize_args(std::env::args().collect());
    let cli = cli::Cli::parse_from(argv);
    init_tracing(cli.verbose);

    match commands::dispatch(cli) {
        Ok(code) => code,
        Err(err) => {
            eprintln!("mellivora: {err}");
            ExitCode::from(if matches!(err, MellivoraError::InvalidArgs(_)) {
                2
            } else {
                1
            })
        }
    }
}

fn init_tracing(verbose: u8) {
    let level = match verbose {
        0 => "warn",
        1 => "info",
        _ => "debug",
    };
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(level));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_writer(std::io::stderr)
        .try_init();
}
