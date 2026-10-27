//! Stdout that survives a closed pipe.
//!
//! `gimlet tools list | head` must finish quietly. `println!` panics when
//! the reader goes away (`EPIPE`), which turns an ordinary shell pipeline into
//! a backtrace, so every line goes through these macros instead.

use std::io::{self, Write};

pub fn write(args: std::fmt::Arguments<'_>) {
    let mut stdout = io::stdout().lock();
    match stdout.write_fmt(args) {
        Ok(()) => {}
        // The reader stopped listening; that is how `| head` ends.
        Err(err) if err.kind() == io::ErrorKind::BrokenPipe => {}
        Err(err) => {
            let _ = writeln!(io::stderr(), "gimlet: cannot write output: {err}");
        }
    }
}

/// `print!`, without the panic on a closed pipe.
#[macro_export]
macro_rules! out {
    ($($arg:tt)*) => {
        $crate::output::write(format_args!($($arg)*))
    };
}

/// `println!`, without the panic on a closed pipe.
#[macro_export]
macro_rules! outln {
    () => {
        $crate::out!("\n")
    };
    ($($arg:tt)*) => {
        $crate::out!("{}\n", format_args!($($arg)*))
    };
}
