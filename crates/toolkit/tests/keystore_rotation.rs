//! Rotating the keystore passphrase must re-seal the keys, not lose them.
//!
//! Rotation is the one keystore operation that rewrites every key at once, so a
//! bug there does not degrade one entry — it can orphan the lot. Nothing tested it.
//!
//! The properties: the old passphrase stops opening the store, the new one opens
//! the same keys with the same public material, and a dry run changes nothing.

use std::path::PathBuf;

use mellivora_core::{Args, ToolContext};
use mellivora_toolkit::Runtime;

struct Store {
    root: PathBuf,
    runtime: Runtime,
    context: ToolContext,
}

impl Store {
    fn new(name: &str) -> Self {
        let root =
            std::env::temp_dir().join(format!("mellivora-rotate-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("sandbox");
        let runtime = Runtime::load(Some(root.clone()), false).expect("runtime");
        let context = runtime.context(false);
        Self {
            root,
            runtime,
            context,
        }
    }

    fn run(&self, id: &str, pairs: &[(&str, &str)]) -> Result<serde_json::Value, String> {
        let tool = self
            .runtime
            .registry
            .get(id)
            .unwrap_or_else(|| panic!("{id} is not registered"));
        let mut args = Args::new();
        for (key, value) in pairs {
            args.insert(*key, (*value).to_string());
        }
        let report = tool
            .run(&self.context, &args)
            .map_err(|error| error.to_string())?;
        Ok(serde_json::to_value(&report.data).expect("data serialises"))
    }

    fn public_key(&self, passphrase: &str) -> Result<String, String> {
        let data = self.run("crypto.key-list", &[("passphrase", passphrase)])?;
        Ok(data["keys"][0]["public_key"]
            .as_str()
            .expect("a public key")
            .to_string())
    }
}

#[test]
fn rotation_keeps_the_keys_and_retires_the_old_passphrase() {
    let store = Store::new("rotate");
    store
        .run(
            "crypto.keygen",
            &[
                ("label", "demo"),
                ("keystore", "true"),
                ("passphrase", "alpha"),
            ],
        )
        .expect("keygen into the keystore");
    let before = store.public_key("alpha").expect("the key is readable");

    store
        .run(
            "crypto.key-rotate",
            &[("passphrase", "alpha"), ("new_passphrase", "bravo")],
        )
        .expect("rotation succeeds");

    // The point of rotation: the old secret is useless afterwards.
    assert!(
        store.public_key("alpha").is_err(),
        "the old passphrase still opens the store"
    );
    assert_eq!(
        store
            .public_key("bravo")
            .expect("the key survives rotation"),
        before,
        "rotation changed the key material"
    );
    assert!(
        store.root.join("keystore.melv").is_file(),
        "the store should still be a sealed file"
    );
}

#[test]
fn a_dry_run_rotation_leaves_the_passphrase_alone() {
    let store = Store::new("dry-run");
    store
        .run(
            "crypto.keygen",
            &[
                ("label", "demo"),
                ("keystore", "true"),
                ("passphrase", "alpha"),
            ],
        )
        .expect("keygen into the keystore");

    // `key-rotate --dry-run` is the command a cautious admin runs first.
    let mut args = Args::new();
    for (key, value) in [("passphrase", "alpha"), ("new_passphrase", "charlie")] {
        args.insert(key, value.to_string());
    }
    let tool = store
        .runtime
        .registry
        .get("crypto.key-rotate")
        .expect("registered");
    let mut context = store.context.clone();
    context.dry_run = true;
    let report = tool.run(&context, &args).expect("dry run succeeds");
    assert!(
        report.summary.contains("would rotate"),
        "a dry run should say what it would do: {}",
        report.summary
    );

    assert!(
        store.public_key("alpha").is_ok(),
        "a dry run changed the passphrase"
    );
    assert!(
        store.public_key("charlie").is_err(),
        "a dry run applied the new passphrase"
    );
}

#[test]
fn rotation_refuses_the_same_or_an_empty_passphrase() {
    let store = Store::new("refusals");
    store
        .run(
            "crypto.keygen",
            &[
                ("label", "demo"),
                ("keystore", "true"),
                ("passphrase", "alpha"),
            ],
        )
        .expect("keygen into the keystore");

    let same = store.run(
        "crypto.key-rotate",
        &[("passphrase", "alpha"), ("new_passphrase", "alpha")],
    );
    assert!(same.is_err(), "rotating to the same passphrase should fail");

    let empty = store.run(
        "crypto.key-rotate",
        &[("passphrase", "alpha"), ("new_passphrase", "")],
    );
    assert!(empty.is_err(), "an empty new passphrase should fail");

    assert!(
        store.public_key("alpha").is_ok(),
        "a refused rotation must leave the store as it was"
    );
}
