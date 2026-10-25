use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::ExitCode;

use mellivora_core::{
    Args, AuditEntry, Category, MellivoraError, OutputFormat, Report, Result, Status, Tool,
};

use crate::batch;
use crate::cli::{Cli, Command, ConfigCommand, PluginsCommand, ToolsCommand};
use mellivora_toolkit::Runtime;

struct Globals {
    home: Option<PathBuf>,
    /// `None` means the caller did not choose, so the configuration decides.
    format: Option<OutputFormat>,
    dry_run: bool,
    strict: bool,
    with_plugins: bool,
}

pub fn dispatch(cli: Cli) -> Result<ExitCode> {
    let globals = Globals {
        home: cli.home.clone(),
        format: if cli.json {
            Some(OutputFormat::Json)
        } else {
            cli.format.map(OutputFormat::from)
        },
        dry_run: cli.dry_run,
        strict: cli.strict,
        with_plugins: !cli.no_plugins,
    };

    match cli.command {
        Command::Run { tool, args } => run(&globals, &tool, &args),
        Command::Batch {
            tool,
            paths,
            args,
            input_arg,
            concurrency,
            fail_fast,
            extensions,
            no_recursive,
        } => run_batch(
            &globals,
            batch::BatchOptions {
                tool,
                paths,
                args: parse_pairs(&args)?,
                input_arg,
                concurrency: usize::from(concurrency),
                fail_fast,
                extensions,
                recursive: !no_recursive,
            },
        ),
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
                crate::outln!("{}", runtime.paths.config_file.display());
                Ok(ExitCode::SUCCESS)
            }
        },
        Command::Audit { limit } => show_audit(&globals, limit),
        Command::Doctor => doctor(&globals),
        Command::Serve {
            host,
            port,
            ui_dir,
            allow_remote,
        } => serve(&globals, host, port, ui_dir, allow_remote),
    }
}

fn run(globals: &Globals, tool_name: &str, raw_args: &[String]) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), globals.with_plugins)?;
    let tool = resolve(&runtime, tool_name)?;

    let args = parse_pairs(raw_args)?;
    let arg_keys: Vec<String> = args.as_map().keys().cloned().collect();

    let context = runtime.context(globals.dry_run);
    let report = tool.run(&context, &args)?;
    crate::out!("{}", report.render(format_for(globals, &runtime)));
    record_audit(&runtime, &report, arg_keys);

    Ok(exit_code(report.status, globals.strict))
}

/// The format a report is rendered in: an explicit `--json`/`--format` wins,
/// otherwise `[defaults] output` from the configuration decides.
fn format_for(globals: &Globals, runtime: &Runtime) -> OutputFormat {
    globals.format.unwrap_or(runtime.config.defaults.output)
}

/// Parse `key=value` arguments from the CLI into a typed bag.
fn parse_pairs(raw_args: &[String]) -> Result<Args> {
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
    Args::from_pairs(pairs)
}

fn run_batch(globals: &Globals, options: batch::BatchOptions) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), globals.with_plugins)?;
    let tool = resolve(&runtime, &options.tool)?;

    let mut arg_keys: Vec<String> = options.args.as_map().keys().cloned().collect();
    arg_keys.push(options.input_arg.clone());

    let context = runtime.context(globals.dry_run);
    let summary = batch::execute(tool, &context, &options, format_for(globals, &runtime))?;

    if let Some(log) = runtime.audit_log() {
        let entry = AuditEntry::new(options.tool.clone(), summary.status, summary.duration_ms)
            .with_arg_keys(arg_keys);
        if let Err(err) = log.record(&entry) {
            tracing::warn!(%err, "failed to write audit record");
        }
    }

    Ok(exit_code(summary.status, globals.strict))
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

    if format_for(globals, &runtime) == OutputFormat::Json {
        crate::outln!("{}", serde_json::to_string_pretty(&manifests)?);
        return Ok(ExitCode::SUCCESS);
    }

    crate::outln!(
        "{:<30} {:<11} {:<22} {:<7} {:<9} SUMMARY",
        "ID",
        "CATEGORY",
        "ORIGIN",
        "WRITES",
        "PLATFORM"
    );
    for manifest in &manifests {
        crate::outln!(
            "{:<30} {:<11} {:<22} {:<7} {:<9} {}",
            manifest.id,
            manifest.category,
            manifest.origin,
            if manifest.mutates { "yes" } else { "-" },
            platform_label(&manifest.platforms),
            manifest.summary
        );
    }
    crate::outln!("\n{} tool(s)", manifests.len());
    Ok(ExitCode::SUCCESS)
}

/// `any`, or the platforms a tool declares, for the catalogue column.
fn platform_label(platforms: &[String]) -> String {
    if platforms.is_empty() {
        "any".to_string()
    } else {
        platforms.join(",")
    }
}

fn show_tool(globals: &Globals, id: &str) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), globals.with_plugins)?;
    let tool = resolve(&runtime, id)?;
    crate::outln!("{}", serde_json::to_string_pretty(tool.manifest())?);
    Ok(ExitCode::SUCCESS)
}

fn list_plugins(globals: &Globals) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), true)?;
    let summaries = runtime.pack_summaries();
    let failures = runtime.pack_failures();

    if summaries.is_empty() && failures.is_empty() {
        crate::outln!("no plugin packs discovered");
        crate::outln!("searched:");
        for dir in runtime.config.effective_plugin_dirs(&runtime.paths) {
            crate::outln!("  {}", dir.display());
        }
        return Ok(ExitCode::SUCCESS);
    }

    crate::outln!("{:<16} {:<10} {:<7} DIR", "PACK", "VERSION", "TOOLS");
    for pack in &summaries {
        crate::outln!(
            "{:<16} {:<10} {:<7} {}",
            pack.name,
            pack.version,
            pack.tool_count,
            pack.dir.display()
        );
    }

    report_pack_failures(&failures);
    Ok(ExitCode::SUCCESS)
}

fn doctor_plugins(globals: &Globals) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), true)?;
    let summaries = runtime.pack_summaries();
    let failures = runtime.pack_failures();

    for pack in &summaries {
        crate::outln!("{} {} ({})", pack.name, pack.version, pack.dir.display());
        let capabilities: Vec<String> = pack.capabilities.iter().map(ToString::to_string).collect();
        if !capabilities.is_empty() {
            crate::outln!("  capabilities: {}", capabilities.join(", "));
        }
        for manifest in runtime
            .registry
            .manifests()
            .into_iter()
            .filter(|manifest| manifest.origin == format!("plugin:{}", pack.name))
        {
            crate::outln!("  tool: {}", manifest.id);
        }
    }

    report_pack_failures(&failures);

    if summaries.is_empty() && failures.is_empty() {
        crate::outln!("no plugin packs found");
    }

    Ok(if failures.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    })
}

/// A pack that failed to load is reported the same way everywhere: once, on
/// stderr, with the manifest that could not be read.
fn report_pack_failures(failures: &[mellivora_core::PackFailure]) {
    for failure in failures {
        eprintln!(
            "failed: {} — {}",
            failure.manifest_path.display(),
            failure.error
        );
    }
}

fn show_config(globals: &Globals) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), false)?;
    crate::outln!("# {}", runtime.paths.config_file.display());
    crate::out!("{}", runtime.config.to_toml()?);
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
    crate::outln!("wrote {}", path.display());
    Ok(ExitCode::SUCCESS)
}

fn show_audit(globals: &Globals, limit: usize) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), false)?;
    let Some(log) = runtime.audit_log() else {
        crate::outln!("audit trail is disabled in the configuration");
        return Ok(ExitCode::SUCCESS);
    };

    let entries = log.tail(limit)?;
    if entries.is_empty() {
        crate::outln!("no audit records at {}", log.path().display());
        return Ok(ExitCode::SUCCESS);
    }

    if format_for(globals, &runtime) == OutputFormat::Json {
        crate::outln!("{}", serde_json::to_string_pretty(&entries)?);
        return Ok(ExitCode::SUCCESS);
    }

    for entry in entries {
        crate::outln!(
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

    crate::outln!("mellivora {}", mellivora_core::VERSION);
    crate::outln!("home        {}", runtime.paths.root.display());
    crate::outln!(
        "config      {}{}",
        runtime.paths.config_file.display(),
        if runtime.paths.config_file.exists() {
            ""
        } else {
            " (defaults)"
        }
    );

    match runtime.paths.ensure() {
        Ok(()) => crate::outln!("state dirs  ok"),
        Err(err) => {
            problems += 1;
            crate::outln!("state dirs  FAILED: {err}");
        }
    }

    let mut by_category: BTreeMap<String, usize> = BTreeMap::new();
    for manifest in runtime.registry.manifests() {
        *by_category
            .entry(manifest.category.to_string())
            .or_default() += 1;
    }
    crate::outln!("tools       {} total", runtime.registry.len());
    for (category, count) in by_category {
        crate::outln!("  {category:<12} {count}");
    }

    let packs = runtime.pack_summaries();
    crate::outln!("packs       {} loaded", packs.len());
    for pack in &packs {
        crate::outln!("  {:<16} {} tool(s)", pack.name, pack.tool_count);
    }

    let failures = runtime.pack_failures();
    for failure in &failures {
        problems += 1;
        crate::outln!(
            "pack failed {} — {}",
            failure.manifest_path.display(),
            failure.error
        );
    }

    if globals.with_plugins && packs.is_empty() && failures.is_empty() {
        crate::outln!(
            "hint        no packs found; run scripts/link-sources.sh to wire up Perl Den"
        );
    }

    match runtime.audit_log() {
        Some(log) => crate::outln!("audit       {}", log.path().display()),
        None => crate::outln!("audit       disabled"),
    }

    Ok(if problems == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    })
}

fn serve(
    globals: &Globals,
    host: String,
    port: u16,
    ui_dir: Option<PathBuf>,
    allow_remote: bool,
) -> Result<ExitCode> {
    let runtime = Runtime::load(globals.home.clone(), true)?;
    runtime.paths.ensure()?;

    let address = format!("{host}:{port}");
    let addr: std::net::SocketAddr = address.parse().map_err(|err| {
        MellivoraError::InvalidArgs(format!("invalid host/port '{address}': {err}"))
    })?;
    guard_bind_address(addr, allow_remote)?;

    if let Some(dir) = &ui_dir {
        if !dir.is_dir() {
            return Err(MellivoraError::NotFound(format!(
                "UI directory {} does not exist",
                dir.display()
            )));
        }
    }

    // Created on first run, so the caller can be told the credential before the
    // listener exists.
    let api_token = runtime.api_token()?;

    crate::outln!(
        "Mellivora ToolKit {} → http://{address}",
        mellivora_core::VERSION
    );
    crate::outln!("  API   http://{address}/api/v1/health");
    match &api_token {
        Some(token) => {
            crate::outln!("  token {token}");
            crate::outln!("        curl -H \"Authorization: Bearer <token>\" …");
            crate::outln!(
                "        stored in {} (mode 0600)",
                runtime.paths.api_token_file.display()
            );
            if ui_dir.is_some() {
                // The fragment is never sent to the server, so the token stays
                // out of request logs while still signing the workbench in.
                crate::outln!("  UI    http://{address}/#token={token}");
            }
        }
        None => {
            if ui_dir.is_some() {
                crate::outln!("  UI    http://{address}/");
            }
            eprintln!(
                "mellivora: warning: [api] require_token = false — any local page can drive this API"
            );
        }
    }

    mellivora_toolkit::serve_blocking(runtime, addr, ui_dir, globals.dry_run, api_token)?;
    Ok(ExitCode::SUCCESS)
}

/// The API has no authentication, so anything beyond loopback is an explicit
/// decision rather than a typo: `--allow-remote` says so out loud.
fn guard_bind_address(addr: std::net::SocketAddr, allow_remote: bool) -> Result<()> {
    if addr.ip().is_loopback() {
        return Ok(());
    }
    if !allow_remote {
        return Err(MellivoraError::InvalidArgs(format!(
            "refusing to bind {addr}: this API has no authentication \
             (pass --allow-remote to serve the network anyway)"
        )));
    }
    eprintln!("mellivora: warning: serving on {addr} without authentication");
    Ok(())
}

/// `mellivora system-info` is rewritten to `mellivora run system-info` before
/// clap sees it, preserving Perl Den's shorthand ergonomics.
pub fn normalize_args(mut argv: Vec<String>) -> Vec<String> {
    const KNOWN: [&str; 9] = [
        "run", "batch", "tools", "plugins", "config", "audit", "doctor", "serve", "help",
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
    fn leaves_batch_alone() {
        let argv = normalize_args(vec![
            "mellivora".into(),
            "batch".into(),
            "crypto.sha256".into(),
            "/tmp".into(),
        ]);
        assert_eq!(argv[1], "batch");
        assert_eq!(argv.len(), 4);
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
    fn a_non_loopback_bind_needs_an_explicit_opt_in() {
        let loopback: std::net::SocketAddr = "127.0.0.1:7878".parse().expect("addr");
        assert!(guard_bind_address(loopback, false).is_ok());

        let any: std::net::SocketAddr = "0.0.0.0:7878".parse().expect("addr");
        let err = guard_bind_address(any, false).expect_err("must refuse");
        assert_eq!(err.code(), "invalid_args");
        assert!(err.to_string().contains("--allow-remote"), "{err}");
        assert!(guard_bind_address(any, true).is_ok());
    }

    #[test]
    fn format_flag_maps_to_output_format() {
        assert_eq!(
            OutputFormat::from(FormatArg::Markdown),
            OutputFormat::Markdown
        );
    }
}
