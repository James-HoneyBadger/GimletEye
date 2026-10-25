//! Pack trust: a pinned pack that changed is refused, and the refusal is loud.
//!
//! Trust is opt-in per pack, so the interesting cases are the three ways it can
//! go wrong: the digest drifted, the pin names a pack that is not installed, and
//! the pin uses an algorithm the host cannot check. Each has to end with the pack
//! *not* loaded and a failure a user can act on.

use std::fs;
use std::path::{Path, PathBuf};

use mellivora_core::AppPaths;
use mellivora_toolkit::{plugin_trust, Runtime};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mellivora-trust-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("mkdir");
    dir
}

/// A pack that loads, reports one tool, and shuts down when asked.
fn write_pack(dir: &Path, tool_id: &str) {
    fs::create_dir_all(dir).expect("pack dir");
    fs::write(
        dir.join("mellivora-pack.toml"),
        "name = \"pinned\"\n\
         version = \"0.1.0\"\n\
         protocol_version = 1\n\
         description = \"a pack to pin\"\n\
         command = [\"python3\", \"pack.py\"]\n\
         enabled = true\n\
         capabilities = []\n",
    )
    .expect("manifest");
    fs::write(
        dir.join("pack.py"),
        format!(
            r#"#!/usr/bin/env python3
import json, sys

TOOLS = [{{
    "id": "{tool_id}", "title": "Echo", "summary": "echo",
    "category": "developer", "capabilities": [], "args": [],
    "origin": "plugin:pinned",
}}]

for line in sys.stdin:
    if not line.strip():
        continue
    request = json.loads(line)
    method = request.get("method")
    if method == "initialize":
        print(json.dumps({{"jsonrpc": "2.0", "id": request["id"],
                           "result": {{"protocol_version": 1, "name": "pinned",
                                      "version": "0.1.0"}}}}), flush=True)
    elif method == "list_tools":
        print(json.dumps({{"jsonrpc": "2.0", "id": request["id"],
                           "result": {{"tools": TOOLS}}}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({{"jsonrpc": "2.0", "id": request["id"], "result": {{}}}}), flush=True)
        break
"#
        ),
    )
    .expect("script");
}

fn write_config(home: &Path, pack_dir: &Path, trust: &str) {
    fs::create_dir_all(home).expect("home");
    fs::write(
        home.join("config.toml"),
        format!(
            "schema_version = 1\n\n[plugins]\ndirs = [\"{}\"]\n\n{trust}",
            pack_dir.display()
        ),
    )
    .expect("config");
}

fn has_tool(runtime: &Runtime, id: &str) -> bool {
    runtime.registry.get(id).is_some()
}

#[test]
fn a_matching_pin_loads_the_pack() {
    let home = scratch("match");
    let pack = home.join("pack");
    write_pack(&pack, "pinned.echo");

    let digest = plugin_trust::digest(&pack).expect("digest");
    assert!(digest.starts_with("sha256:"), "{digest}");

    write_config(&home, &pack, &format!("[trust]\npinned = \"{digest}\"\n"));
    let runtime = Runtime::load(Some(home.clone()), true).expect("runtime");

    assert!(
        has_tool(&runtime, "pinned.echo"),
        "a pinned pack should load"
    );
    assert!(
        runtime.pack_failures().is_empty(),
        "unexpected failures: {:?}",
        runtime.pack_failures()
    );

    let _ = fs::remove_dir_all(&home);
}

#[test]
fn a_changed_pack_is_refused_and_says_what_changed() {
    let home = scratch("drift");
    let pack = home.join("pack");
    write_pack(&pack, "pinned.echo");
    let digest = plugin_trust::digest(&pack).expect("digest");
    write_config(&home, &pack, &format!("[trust]\npinned = \"{digest}\"\n"));

    // The edit a user would make - and the edit an attacker would make.
    let script = pack.join("pack.py");
    let mut text = fs::read_to_string(&script).expect("read");
    text.push_str("\n# a line that was not there when the pin was taken\n");
    fs::write(&script, text).expect("write");

    let runtime = Runtime::load(Some(home.clone()), true).expect("runtime");

    assert!(
        !has_tool(&runtime, "pinned.echo"),
        "a pack that does not match its pin must not be loaded"
    );
    let failures = runtime.pack_failures();
    assert_eq!(failures.len(), 1, "{failures:?}");
    let message = &failures[0].error;
    assert!(
        message.contains("does not match its pinned digest"),
        "{message}"
    );
    assert!(message.contains("pinned:"), "{message}");
    assert!(message.contains("actual:"), "{message}");

    let _ = fs::remove_dir_all(&home);
}

#[test]
fn unpinned_packs_are_left_alone() {
    let home = scratch("unpinned");
    let pack = home.join("pack");
    write_pack(&pack, "pinned.echo");

    // A pin for some other pack must not disable this one.
    write_config(
        &home,
        &pack,
        &format!("[trust]\nsomewhere-else = \"sha256:{}\"\n", "0".repeat(64)),
    );
    let runtime = Runtime::load(Some(home.clone()), true).expect("runtime");

    assert!(has_tool(&runtime, "pinned.echo"));
    let failures = runtime.pack_failures();
    assert_eq!(failures.len(), 1, "{failures:?}");
    assert!(
        failures[0].error.contains("was not found"),
        "a pin for a missing pack is worth knowing about: {}",
        failures[0].error
    );

    let _ = fs::remove_dir_all(&home);
}

#[test]
fn a_pin_with_an_unknown_algorithm_is_refused() {
    let home = scratch("algorithm");
    let pack = home.join("pack");
    write_pack(&pack, "pinned.echo");
    write_config(&home, &pack, "[trust]\npinned = \"sha512:abc\"\n");

    let runtime = Runtime::load(Some(home.clone()), true).expect("runtime");
    assert!(!has_tool(&runtime, "pinned.echo"));
    let failures = runtime.pack_failures();
    assert!(
        failures[0].error.contains("unknown algorithm"),
        "{:?}",
        failures[0].error
    );

    let _ = fs::remove_dir_all(&home);
}

#[test]
fn the_digest_covers_every_file_in_the_pack() {
    let dir = scratch("digest");
    write_pack(&dir, "pinned.echo");
    let first = plugin_trust::digest(&dir).expect("digest");

    // Same content, different name: the digest must follow.
    fs::rename(dir.join("pack.py"), dir.join("main.py")).expect("rename");
    let renamed = plugin_trust::digest(&dir).expect("digest");
    assert_ne!(first, renamed, "renaming a file must change the digest");

    // An added file changes it too, even an empty one.
    fs::write(dir.join("extra.txt"), b"").expect("write");
    let added = plugin_trust::digest(&dir).expect("digest");
    assert_ne!(renamed, added, "adding a file must change the digest");

    // And it is stable when nothing changes.
    assert_eq!(added, plugin_trust::digest(&dir).expect("digest"));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn the_pin_survives_a_round_trip_through_config_toml() {
    let home = scratch("config-roundtrip");
    let pack = home.join("pack");
    write_pack(&pack, "pinned.echo");
    let digest = plugin_trust::digest(&pack).expect("digest");
    write_config(&home, &pack, &format!("[trust]\npinned = \"{digest}\"\n"));

    let paths = AppPaths::under(home.clone());
    let config = mellivora_core::Config::load(&paths).expect("config parses");
    assert_eq!(config.trust.get("pinned"), Some(&digest));

    // And a config with no [trust] table is not an error: the field is additive.
    let bare = scratch("config-bare");
    fs::create_dir_all(&bare).expect("home");
    fs::write(bare.join("config.toml"), "schema_version = 1\n").expect("write");
    let parsed = mellivora_core::Config::load(&AppPaths::under(bare.clone())).expect("parses");
    assert!(parsed.trust.is_empty());

    let _ = fs::remove_dir_all(&home);
    let _ = fs::remove_dir_all(&bare);
}
