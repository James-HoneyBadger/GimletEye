//! Platform declarations.
//!
//! Several tools are only meaningful on one operating system: `sysadmin.*`
//! reads `/proc` and parses `df`, which is Linux-shaped. Without a declaration
//! the failure mode on macOS or Windows is an empty or half-filled report, so a
//! tool states where it runs and the registry refuses it everywhere else.

use crate::error::{GimletEyeError, Result};
use crate::tool::ToolManifest;

/// The identifier a manifest uses for this host, matching `std::env::consts::OS`
/// (`linux`, `macos`, `windows`, `freebsd`, …).
pub fn current() -> &'static str {
    std::env::consts::OS
}

/// Does this declaration cover `os`? An empty declaration covers everything.
pub fn matches(platforms: &[String], os: &str) -> bool {
    platforms.is_empty()
        || platforms
            .iter()
            .any(|platform| platform.eq_ignore_ascii_case(os))
}

/// `Ok(())` when the tool runs here, otherwise an error that names both sides.
pub fn check(manifest: &ToolManifest) -> Result<()> {
    if matches(&manifest.platforms, current()) {
        return Ok(());
    }
    Err(GimletEyeError::Unsupported(format!(
        "{} runs on {}; this host is {}",
        manifest.id,
        manifest.platforms.join(", "),
        current()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool::Category;

    fn manifest(platforms: &[&str]) -> ToolManifest {
        ToolManifest::new("demo.tool", "Demo", "demo", Category::Sysadmin)
            .with_platforms(platforms.iter().copied())
    }

    #[test]
    fn an_empty_declaration_runs_everywhere() {
        assert!(matches(&[], "linux"));
        assert!(matches(&[], "windows"));
        assert!(check(&manifest(&[])).is_ok());
    }

    #[test]
    fn a_declaration_matches_case_insensitively() {
        let declared = vec!["Linux".to_string()];
        assert!(matches(&declared, "linux"));
        assert!(!matches(&declared, "macos"));
    }

    #[test]
    fn check_names_the_tool_and_both_platforms() {
        let error = check(&manifest(&["plan9"])).expect_err("must refuse");
        assert_eq!(error.code(), "unsupported");
        let message = error.to_string();
        assert!(message.contains("demo.tool"), "{message}");
        assert!(message.contains("plan9"), "{message}");
        assert!(message.contains(current()), "{message}");
    }

    #[test]
    fn check_accepts_a_declaration_that_includes_this_host() {
        assert!(check(&manifest(&[current(), "plan9"])).is_ok());
    }
}
