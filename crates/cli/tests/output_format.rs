//! `[defaults] output` decides the format when the caller does not, and an
//! explicit `--format`/`--json` still wins: a per-run choice must not be
//! overridden by a configuration file someone else wrote.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn home(name: &str, config: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("gimlet-eye-cli-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("home");
    fs::write(dir.join("config.toml"), config).expect("config");
    dir
}

fn run(home: &Path, args: &[&str]) -> String {
    let output = Command::new(env!("CARGO_BIN_EXE_gimlet"))
        .env("GIMLET_HOME", home)
        .env_remove("GIMLET_PLUGIN_PATH")
        .arg("--no-plugins")
        .args(args)
        .output()
        .expect("spawn gimlet");
    assert!(
        output.status.success(),
        "exit {}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("utf-8 stdout")
}

#[test]
fn the_configured_output_is_used_when_no_flag_is_given() {
    let dir = home("configured-json", "[defaults]\noutput = \"json\"\n");
    let stdout = run(&dir, &["sha256", "text=abc"]);

    assert!(stdout.trim_start().starts_with('{'), "{stdout}");
    assert!(stdout.contains("\"tool\": \"crypto.sha256\""), "{stdout}");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn the_format_flag_beats_the_configured_output() {
    let dir = home("flag-wins", "[defaults]\noutput = \"json\"\n");
    let stdout = run(&dir, &["--format", "text", "sha256", "text=abc"]);

    assert!(!stdout.trim_start().starts_with('{'), "{stdout}");
    assert!(stdout.contains("sha256:"), "{stdout}");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn json_flag_beats_a_text_default() {
    let dir = home("json-flag", "[defaults]\noutput = \"text\"\n");
    let stdout = run(&dir, &["--json", "sha256", "text=abc"]);

    assert!(stdout.trim_start().starts_with('{'), "{stdout}");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn without_a_config_the_default_is_text() {
    let dir = home("no-config", "");
    let _ = fs::remove_file(dir.join("config.toml"));
    let stdout = run(&dir, &["sha256", "text=abc"]);

    assert!(stdout.contains("sha256:"), "{stdout}");
    assert!(!stdout.trim_start().starts_with('{'), "{stdout}");

    let _ = fs::remove_dir_all(&dir);
}
