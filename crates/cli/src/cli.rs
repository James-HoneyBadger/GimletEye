use std::path::PathBuf;

use clap::{Parser, Subcommand, ValueEnum};
use mellivora_core::OutputFormat;

#[derive(Debug, Parser)]
#[command(
    name = "mellivora",
    version,
    about = "Mellivora ToolKit — one workbench for system, crypto, and privacy operations",
    long_about = "Mellivora ToolKit is one workbench for system administration, \
                  cryptography, and metadata privacy — one registry, one report format, \
                  one configuration, one audit trail.\n\n\
                  Any tool can be invoked directly: `mellivora system-info` is shorthand for \
                  `mellivora run system-info`.",
    disable_help_subcommand = true
)]
pub struct Cli {
    /// Override the toolkit home directory (config, audit, plugins)
    #[arg(long, global = true, env = "MELLIVORA_HOME", value_name = "DIR")]
    pub home: Option<PathBuf>,

    /// Output format for tool reports
    #[arg(long, global = true, value_enum, default_value_t = FormatArg::Text)]
    pub format: FormatArg,

    /// Shorthand for --format json
    #[arg(long, global = true)]
    pub json: bool,

    /// Report intended changes without writing them
    #[arg(long, global = true)]
    pub dry_run: bool,

    /// Skip plugin pack discovery
    #[arg(long, global = true)]
    pub no_plugins: bool,

    /// Treat warnings as failures (useful in CI)
    #[arg(long, global = true)]
    pub strict: bool,

    /// Increase log verbosity (repeatable)
    #[arg(short, long, global = true, action = clap::ArgAction::Count)]
    pub verbose: u8,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Run a tool
    Run {
        /// Tool id, or a unique suffix such as `system-info`
        tool: String,
        /// Tool arguments as key=value pairs
        #[arg(value_name = "KEY=VALUE")]
        args: Vec<String>,
    },
    /// Run a tool over many files, one report per file plus an aggregate
    Batch {
        /// Tool id, or a unique suffix such as `metadata-strip`
        tool: String,
        /// Files or directories to process
        #[arg(value_name = "PATH", required = true)]
        paths: Vec<PathBuf>,
        /// Tool argument as key=value (repeatable)
        #[arg(long = "arg", value_name = "KEY=VALUE")]
        args: Vec<String>,
        /// Argument that receives each file path
        #[arg(long, default_value = "input", value_name = "NAME")]
        input_arg: String,
        /// Files processed at once
        #[arg(short, long, default_value_t = 4, value_parser = clap::value_parser!(u8).range(1..=32))]
        concurrency: u8,
        /// Stop after the first failing file
        #[arg(long)]
        fail_fast: bool,
        /// Only process this extension (repeatable)
        #[arg(long = "ext", value_name = "EXT")]
        extensions: Vec<String>,
        /// Do not descend into subdirectories
        #[arg(long)]
        no_recursive: bool,
    },
    /// Browse the tool catalogue
    Tools {
        #[command(subcommand)]
        command: ToolsCommand,
    },
    /// Inspect plugin packs
    Plugins {
        #[command(subcommand)]
        command: PluginsCommand,
    },
    /// Configuration management
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    /// Show recent audit records
    Audit {
        #[arg(short, long, default_value_t = 20)]
        limit: usize,
    },
    /// Check the local installation and report problems
    Doctor,
    /// Serve the HTTP API and the UI on loopback
    Serve {
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
        #[arg(short, long, default_value_t = 7878)]
        port: u16,
        /// Directory containing the built UI
        #[arg(long, value_name = "DIR")]
        ui_dir: Option<PathBuf>,
    },
}

#[derive(Debug, Subcommand)]
pub enum ToolsCommand {
    /// List every registered tool
    List {
        #[arg(long)]
        category: Option<String>,
    },
    /// Show a tool's manifest
    Show { id: String },
}

#[derive(Debug, Subcommand)]
pub enum PluginsCommand {
    /// List loaded packs
    List,
    /// Start every pack and report its tools
    Doctor,
}

#[derive(Debug, Subcommand)]
pub enum ConfigCommand {
    /// Print the effective configuration
    Show,
    /// Write a default configuration file
    Init {
        #[arg(long)]
        force: bool,
    },
    /// Print the configuration file path
    Path,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, ValueEnum)]
pub enum FormatArg {
    #[default]
    Text,
    Json,
    Markdown,
    Csv,
}

impl From<FormatArg> for OutputFormat {
    fn from(value: FormatArg) -> Self {
        match value {
            FormatArg::Text => Self::Text,
            FormatArg::Json => Self::Json,
            FormatArg::Markdown => Self::Markdown,
            FormatArg::Csv => Self::Csv,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn cli_definition_is_valid() {
        Cli::command().debug_assert();
    }
}
