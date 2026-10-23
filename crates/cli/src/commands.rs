use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::ExitCode;

use mellivora_core::{
    Args, AuditEntry, Category, MellivoraError, OutputFormat, Report, Result, Status, Tool,
};

use crate::cli::{Cli, Command, ConfigCommand, PluginsCommand, ToolsCommand};
use mellivora_toolkit::Runtime;

struct Globals {
    home: Option<PathBuf>,
    format: OutputFormat,
    dry_run: bool,
    strict: bool,
    with_plugins: bool,
}

pub fn dispatch(cli: Cli) -> Result<ExitCode> {
    let globals = Globals {
        home: cli.home.clone(),
        format: if cli.json {
            OutputFormat::Json
        } else {
            cli.format.into()
        },
        dry_run: cli.dry_run,
        strict: cli.strict,
        with_plugins: !cli.no_plugins,
    };

    match cli.command {
        Command::Run { tool, args } => run(&globals, &tool, &args),
        Command::Tools { command } => match command {
            ToolsCommand::List { category } => list_tools(&globals, category.as_deref()),
            ToolsCommand::Show { id } => show_tool(&globals, &id),
        },
        Command::Plugins { command } => match command {
            PluginsCommand::List => list_plugins(&globals),
            PluginsCommand::Doctor => doctor_plugins(&globals),
        },
        Command::Config { command } => match command {
            ConfigCommand::Show => show_config(&globals),
            ConfigCommand::Init { force } => init_config(&globals, force),
            ConfigCommand::Path => {
                let runtime = Runtime::load(globals.home.clone(), false)?;
                println!("{}", runtime.paths.config_file.display());
                Ok(ExitCode::SUCCESS)
            }
        },
        Command::Audit { limit } => show_audit(&globals, limit),
        Command::Doctor => doctor(&globals),
        Command::Serve { host, port, ui_dir } => serve(&globals, host, port, ui_dir),
    }
}

fn run(globals: &Globals, tool_name: &str, raw_args: &[String]) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), globals.with_plugins)?;
    let tool = resolve(&runtime, tool_name)?;

    let mut pairs: Vec<(String, String)> = Vec::with_capacity(raw_args.len());
    for raw in raw_args {
        match raw.split_once('=') {
            Some((key, value)) => pairs.push((key.to_string(), value.to_string())),
            None => {
                return Err(MellivoraError::InvalidArgs(format!(
                    "argument '{raw}' must be key=value (for example length=32)"
                )))
            }
        }
    }
    let args = Args::from_pairs(pairs)?;
    let arg_keys: Vec<String> = args.as_map().keys().cloned().collect();

    let context = runtime.context(globals.dry_run);
    let report = tool.run(&context, &args)?;
    print!("{}", report.render(globals.format));
    record_audit(&runtime, &report, arg_keys);

    Ok(exit_code(report.status, globals.strict))
}

/// `--strict` turns a warning verdict into a failure so CI gates on findings,
/// not just on errors.
fn exit_code(status: Status, strict: bool) -> ExitCode {
    match status {
        Status::Error => ExitCode::from(1),
        Status::Warning if strict => ExitCode::from(1),
        Status::Ok | Status::Warning => ExitCode::SUCCESS,
    }
}

fn resolve(runtime: &Runtime, query: &str) -> Result<std::sync::Arc<dyn Tool>> {
    if let Some(tool) = runtime.registry.resolve(query) {
        return Ok(tool);
    }
    let suggestions = runtime.registry.suggest(query, 3);
    let hint = match suggestions.len() {
        0 => String::new(),
        1 => format!(" Did you mean '{}'?", suggestions[0]),
        _ => format!(" Did you mean one of: {}?", suggestions.join(", ")),
    };
    Err(MellivoraError::NotFound(format!(
        "tool '{query}'.{hint} Run `mellivora tools list` to see everything available."
    )))
}

fn record_audit(runtime: &Runtime, report: &Report, arg_keys: Vec<String>) {
    let Some(log) = runtime.audit_log() else {
        return;
    };
    let entry = AuditEntry::new(report.tool.clone(), report.status, report.duration_ms)
        .with_arg_keys(arg_keys);
    if let Err(err) = log.record(&entry) {
        tracing::warn!(%err, "failed to write audit record");
    }
}

fn list_tools(globals: &Globals, category: Option<&str>) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), globals.with_plugins)?;
    let filter = category
        .map(|value| value.parse::<Category>())
        .transpose()?;

    let mut manifests = runtime.registry.manifests();
    if let Some(category) = filter {
        manifests.retain(|manifest| manifest.category == category);
    }

    if globals.format == OutputFormat::Json {
        println!("{}", serde_json::to_string_pretty(&manifests)?);
        return Ok(ExitCode::SUCCESS);
    }

    println!("{:<30} {:<11} {:<22} SUMMARY", "ID", "CATEGORY", "ORIGIN");
    for manifest in &manifests {
        println!(
            "{:<30} {:<11} {:<22} {}",
            manifest.id, manifest.category, manifest.origin, manifest.summary
        );
    }
    println!("\n{} tool(s)", manifests.len());
    Ok(ExitCode::SUCCESS)
}

fn show_tool(globals: &Globals, id: &str) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), globals.with_plugins)?;
    let tool = resolve(&runtime, id)?;
    println!("{}", serde_json::to_string_pretty(tool.manifest())?);
    Ok(ExitCode::SUCCESS)
}

fn list_plugins(globals: &Globals) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), true)?;
    let summaries = runtime.pack_summaries();
    let failures = runtime.pack_failures();

    if summaries.is_empty() && failures.is_empty() {
        println!("no plugin packs discovered");
        println!("searched:");
        for dir in runtime.config.effective_plugin_dirs(&runtime.paths) {
            println!("  {}", dir.display());
        }
        return Ok(ExitCode::SUCCESS);
    }

    println!("{:<16} {:<10} {:<7} DIR", "PACK", "VERSION", "TOOLS");
    for pack in &summaries {
        println!(
            "{:<16} {:<10} {:<7} {}",
            pack.name,
            pack.version,
            pack.tool_count,
            pack.dir.display()
        );
    }

    for failure in &failures {
        eprintln!(
            "failed: {} — {}",
            failure.manifest_path.display(),
            failure.error
        );
    }
    Ok(ExitCode::SUCCESS)
}

fn doctor_plugins(globals: &Globals) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), true)?;
    let summaries = runtime.pack_summaries();
    let failures = runtime.pack_failures();

    for pack in &summaries {
        println!("{} {} ({})", pack.name, pack.version, pack.dir.display());
        let capabilities: Vec<String> = pack.capabilities.iter().map(ToString::to_string).collect();
        if !capabilities.is_empty() {
            println!("  capabilities: {}", capabilities.join(", "));
        }
        for manifest in runtime
            .registry
            .manifests()
            .into_iter()
            .filter(|manifest| manifest.origin == format!("plugin:{}", pack.name))
        {
            println!("  tool: {}", manifest.id);
        }
    }

    for failure in &failures {
        eprintln!(
            "failed: {} — {}",
            failure.manifest_path.display(),
            failure.error
        );
    }

    if summaries.is_empty() && failures.is_empty() {
        println!("no plugin packs found");
    }

    Ok(if failures.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    })
}

fn show_config(globals: &Globals) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), false)?;
    println!("# {}", runtime.paths.config_file.display());
    print!("{}", runtime.config.to_toml()?);
    Ok(ExitCode::SUCCESS)
}

fn init_config(globals: &Globals, force: bool) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), false)?;
    let path = &runtime.paths.config_file;
    if path.exists() && !force {
        return Err(MellivoraError::Config(format!(
            "{} already exists (use --force to overwrite)",
            path.display()
        )));
    }
    runtime.paths.ensure()?;
    runtime.config.save(path)?;
    println!("wrote {}", path.display());
    Ok(ExitCode::SUCCESS)
}

fn show_audit(globals: &Globals, limit: usize) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), false)?;
    let Some(log) = runtime.audit_log() else {
        println!("audit trail is disabled in the configuration");
        return Ok(ExitCode::SUCCESS);
    };

    let entries = log.tail(limit)?;
    if entries.is_empty() {
        println!("no audit records at {}", log.path().display());
        return Ok(ExitCode::SUCCESS);
    }

    if globals.format == OutputFormat::Json {
        println!("{}", serde_json::to_string_pretty(&entries)?);
        return Ok(ExitCode::SUCCESS);
    }

    for entry in entries {
        println!(
            "{}  {:<8} {:<30} {:>6} ms  {}",
            entry.ts,
            entry.status,
            entry.tool,
            entry.duration_ms,
            entry.arg_keys.join(",")
        );
    }
    Ok(ExitCode::SUCCESS)
}

fn doctor(globals: &Globals) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), true)?;
    let mut problems = 0usize;

    println!("mellivora {}", mellivora_core::VERSION);
    println!("home        {}", runtime.paths.root.display());
    println!(
        "config      {}{}",
        runtime.paths.config_file.display(),
        if runtime.paths.config_file.exists() {
            ""
        } else {
            " (defaults)"
        }
    );

    match runtime.paths.ensure() {
        Ok(()) => println!("state dirs  ok"),
        Err(err) => {
            problems += 1;
            println!("state dirs  FAILED: {err}");
        }
    }

    let mut by_category: BTreeMap<String, usize> = BTreeMap::new();
    for manifest in runtime.registry.manifests() {
        *by_category
            .entry(manifest.category.to_string())
            .or_default() += 1;
    }
    println!("tools       {} total", runtime.registry.len());
    for (category, count) in by_category {
        println!("  {category:<12} {count}");
    }

    let packs = runtime.pack_summaries();
    println!("packs       {} loaded", packs.len());
    for pack in &packs {
        println!("  {:<16} {} tool(s)", pack.name, pack.tool_count);
    }

    let failures = runtime.pack_failures();
    for failure in &failures {
        problems += 1;
        println!(
            "pack failed {} — {}",
            failure.manifest_path.display(),
            failure.error
        );
    }

    if globals.with_plugins && packs.is_empty() && failures.is_empty() {
        println!("hint        no packs found; run scripts/link-sources.sh to wire up Perl Den");
    }

    match runtime.audit_log() {
        Some(log) => println!("audit       {}", log.path().display()),
        None => println!("audit       disabled"),
    }

    Ok(if problems == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    })
}

fn serve(globals: &Globals, host: String, port: u16, ui_dir: Option<PathBuf>) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), true)?;
    runtime.paths.ensure()?;

    let address = format!("{host}:{port}");
    let addr: std::net::SocketAddr = address.parse().map_err(|err| {
        MellivoraError::InvalidArgs(format!("invalid host/port '{address}': {err}"))
    })?;

    if let Some(dir) = &ui_dir {
        if !dir.is_dir() {
            return Err(MellivoraError::NotFound(format!(
                "UI directory {} does not exist",
                dir.display()
            )));
        }
    }

    println!(
        "Mellivora ToolKit {} → http://{address}",
        mellivora_core::VERSION
    );
    println!("  API   http://{address}/api/v1/health");
    if ui_dir.is_some() {
        println!("  UI    http://{address}/");
    }

    mellivora_toolkit::serve_blocking(runtime, addr, ui_dir, globals.dry_run)?;
    Ok(ExitCode::SUCCESS)
}

/// `mellivora system-info` is rewritten to `mellivora run system-info` before
/// clap sees it, preserving Perl Den's shorthand ergonomics.
pub fn normalize_args(mut argv: Vec<String>) -> Vec<String> {
    const KNOWN: [&str; 8] = [
        "run", "tools", "plugins", "config", "audit", "doctor", "serve", "help",
    ];

    let mut index = 1;
    while index < argv.len() {
        let token = argv[index].clone();
        if token == "--format" || token == "--home" || token == "--ui-dir" || token == "-f" {
            index += 2;
            continue;
        }
        if token.starts_with('-') {
            index += 1;
            continue;
        }
        if !KNOWN.contains(&token.as_str()) {
            argv.insert(index, "run".to_string());
        }
        break;
    }
    argv
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::FormatArg;

    #[test]
    fn rewrites_shorthand_to_run() {
        let argv = normalize_args(vec!["mellivora".into(), "system-info".into()]);
        assert_eq!(argv, vec!["mellivora", "run", "system-info"]);
    }

    #[test]
    fn leaves_known_subcommands_alone() {
        let argv = normalize_args(vec!["mellivora".into(), "tools".into(), "list".into()]);
        assert_eq!(argv, vec!["mellivora", "tools", "list"]);
    }

    #[test]
    fn skips_global_flags_before_subcommand() {
        let argv = normalize_args(vec![
            "mellivora".into(),
            "--format".into(),
            "json".into(),
            "system-info".into(),
        ]);
        assert_eq!(
            argv,
            vec!["mellivora", "--format", "json", "run", "system-info"]
        );
    }

    #[test]
    fn does_not_rewrite_help_flags() {
        let argv = normalize_args(vec!["mellivora".into(), "--help".into()]);
        assert_eq!(argv, vec!["mellivora", "--help"]);
    }

    #[test]
    fn strict_promotes_warnings_to_failures() {
        assert_eq!(exit_code(Status::Ok, false), ExitCode::SUCCESS);
        assert_eq!(exit_code(Status::Warning, false), ExitCode::SUCCESS);
        assert_eq!(exit_code(Status::Warning, true), ExitCode::from(1));
        assert_eq!(exit_code(Status::Error, false), ExitCode::from(1));
        assert_eq!(exit_code(Status::Error, true), ExitCode::from(1));
    }

    #[test]
    fn format_flag_maps_to_output_format() {
        assert_eq!(
            OutputFormat::from(FormatArg::Markdown),
            OutputFormat::Markdown
        );
    }
}
