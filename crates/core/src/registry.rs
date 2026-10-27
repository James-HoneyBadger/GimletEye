use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::sync::Arc;

use crate::error::{GimletEyeError, Result};
use crate::platform;
use crate::report::Report;
use crate::tool::{Args, Category, Tool, ToolContext, ToolManifest};

/// In-process catalogue of built-in tools plus adapters contributed by plugin
/// packs. Surfaces only ever talk to this type.
#[derive(Default)]
pub struct Registry {
    tools: BTreeMap<String, Arc<dyn Tool>>,
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, tool: Arc<dyn Tool>) -> Result<()> {
        let id = tool.manifest().id.clone();
        if id.is_empty() {
            return Err(GimletEyeError::Internal(
                "tool registered with an empty id".into(),
            ));
        }
        if self.tools.contains_key(&id) {
            return Err(GimletEyeError::Config(format!("duplicate tool id '{id}'")));
        }
        // One gate for every surface: a tool that declares a platform is refused
        // here rather than in each dispatch path.
        self.tools.insert(id, Arc::new(PlatformGate::new(tool)));
        Ok(())
    }

    pub fn register_all<I: IntoIterator<Item = Arc<dyn Tool>>>(&mut self, tools: I) -> Result<()> {
        for tool in tools {
            self.register(tool)?;
        }
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn Tool>> {
        self.tools.get(id).cloned()
    }

    /// Resolve user input: exact id, then `category.tool`, then a unique suffix.
    pub fn resolve(&self, query: &str) -> Option<Arc<dyn Tool>> {
        let query = query.trim();
        if query.is_empty() {
            return None;
        }
        if let Some(tool) = self.tools.get(query) {
            return Some(tool.clone());
        }
        let normalized = query.replace('_', "-").to_ascii_lowercase();
        if let Some((_, tool)) = self
            .tools
            .iter()
            .find(|(id, _)| id.to_ascii_lowercase() == normalized)
        {
            return Some(tool.clone());
        }
        // `system-info` resolves to `sysadmin.system-info` when it is unambiguous.
        let suffix = format!(".{normalized}");
        let matches: Vec<&Arc<dyn Tool>> = self
            .tools
            .iter()
            .filter(|(id, _)| id.to_ascii_lowercase().ends_with(&suffix))
            .map(|(_, tool)| tool)
            .collect();
        if matches.len() == 1 {
            return Some(matches[0].clone());
        }
        // A pack must never steal a shorthand from a built-in: `system-info`
        // keeps meaning the native implementation, and the pack stays reachable
        // by its full id.
        let native: Vec<&Arc<dyn Tool>> = matches
            .iter()
            .copied()
            .filter(|tool| tool.manifest().origin == "builtin")
            .collect();
        if native.len() == 1 {
            return Some(native[0].clone());
        }
        None
    }

    pub fn list(&self) -> Vec<Arc<dyn Tool>> {
        self.tools.values().cloned().collect()
    }

    pub fn manifests(&self) -> Vec<ToolManifest> {
        self.tools
            .values()
            .map(|tool| tool.manifest().clone())
            .collect()
    }

    pub fn manifests_in(&self, category: Category) -> Vec<ToolManifest> {
        self.manifests()
            .into_iter()
            .filter(|manifest| manifest.category == category)
            .collect()
    }

    pub fn categories(&self) -> Vec<Category> {
        let set: BTreeSet<Category> = self
            .tools
            .values()
            .map(|tool| tool.manifest().category)
            .collect();
        set.into_iter().collect()
    }

    pub fn len(&self) -> usize {
        self.tools.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    /// Closest ids for "did you mean" hints.
    pub fn suggest(&self, query: &str, limit: usize) -> Vec<String> {
        let mut scored: Vec<(f64, String)> = self
            .tools
            .keys()
            .map(|id| {
                let by_full = similarity(query, id);
                let by_tail = id
                    .rsplit('.')
                    .next()
                    .map_or(0.0, |tail| similarity(query, tail));
                (by_full.max(by_tail), id.clone())
            })
            .filter(|(score, _)| *score >= 0.34)
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.into_iter().take(limit).map(|(_, id)| id).collect()
    }
}

impl fmt::Debug for Registry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Registry")
            .field("tools", &self.tools.keys().collect::<Vec<_>>())
            .finish()
    }
}

/// Refuses a tool that does not run on this host, so no surface has to remember
/// to ask.
struct PlatformGate {
    inner: Arc<dyn Tool>,
}

impl fmt::Debug for PlatformGate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PlatformGate")
            .field("tool", &self.inner.manifest().id)
            .finish()
    }
}

impl PlatformGate {
    fn new(inner: Arc<dyn Tool>) -> Self {
        Self { inner }
    }
}

impl Tool for PlatformGate {
    fn manifest(&self) -> &ToolManifest {
        self.inner.manifest()
    }

    fn run(&self, context: &ToolContext, args: &Args) -> Result<Report> {
        platform::check(self.manifest())?;
        self.inner.run(context, args)
    }
}

/// Trigram Jaccard similarity, matching the fuzzy matching behaviour Perl Den
/// users already rely on for script lookup.
pub fn similarity(left: &str, right: &str) -> f64 {
    let a = trigrams(left);
    let b = trigrams(right);
    if a.is_empty() || b.is_empty() {
        return if left.eq_ignore_ascii_case(right) {
            1.0
        } else {
            0.0
        };
    }
    let intersection = a.intersection(&b).count() as f64;
    let union = a.union(&b).count() as f64;
    intersection / union
}

fn trigrams(value: &str) -> BTreeSet<String> {
    let normalized: String = value
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' })
        .collect();
    let normalized = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars: Vec<char> = normalized.chars().collect();
    if chars.len() < 3 {
        return BTreeSet::from([normalized]);
    }
    chars.windows(3).map(|w| w.iter().collect()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::Report;
    use crate::tool::{Args, ToolContext};

    struct Stub {
        manifest: ToolManifest,
    }

    impl Stub {
        fn new(id: &str) -> Self {
            Self::with_category(id, Category::Sysadmin)
        }

        fn with_category(id: &str, category: Category) -> Self {
            Self {
                manifest: ToolManifest::new(id, "Stub", "stub tool", category),
            }
        }
    }

    impl Tool for Stub {
        fn manifest(&self) -> &ToolManifest {
            &self.manifest
        }

        fn run(&self, _ctx: &ToolContext, _args: &Args) -> Result<Report> {
            Ok(Report::new(self.manifest.id.clone()))
        }
    }

    fn registry() -> Registry {
        let mut registry = Registry::new();
        registry
            .register(Arc::new(Stub::new("sysadmin.system-info")))
            .expect("register");
        registry
            .register(Arc::new(Stub::with_category(
                "privacy.metadata-scan",
                Category::Privacy,
            )))
            .expect("register");
        registry
    }

    #[test]
    fn resolves_exact_and_suffix_ids() {
        let registry = registry();
        assert!(registry.get("sysadmin.system-info").is_some());
        assert!(registry.resolve("sysadmin.system-info").is_some());
        assert!(registry.resolve("system_info").is_some());
        assert!(registry.resolve("system-info").is_some());
        assert!(registry.resolve("nope").is_none());
    }

    #[test]
    fn a_tool_for_another_platform_is_refused_at_dispatch() {
        struct Elsewhere;

        impl Tool for Elsewhere {
            fn manifest(&self) -> &ToolManifest {
                static MANIFEST: std::sync::OnceLock<ToolManifest> = std::sync::OnceLock::new();
                MANIFEST.get_or_init(|| {
                    ToolManifest::new(
                        "demo.elsewhere",
                        "Elsewhere",
                        "runs elsewhere",
                        Category::Sysadmin,
                    )
                    .with_platforms(["plan9"])
                })
            }

            fn run(&self, _ctx: &ToolContext, _args: &Args) -> Result<Report> {
                Ok(Report::new("demo.elsewhere"))
            }
        }

        let mut registry = Registry::new();
        registry.register(Arc::new(Elsewhere)).expect("register");
        let tool = registry.get("demo.elsewhere").expect("registered");
        assert_eq!(tool.manifest().platforms, vec!["plan9".to_string()]);

        let context = ToolContext::new(crate::paths::AppPaths::under(std::env::temp_dir()));
        let error = tool
            .run(&context, &Args::new())
            .expect_err("a tool for another platform must not run");
        assert_eq!(error.code(), "unsupported");
    }

    #[test]
    fn rejects_duplicate_ids() {
        let mut registry = Registry::new();
        registry
            .register(Arc::new(Stub::new("a.b")))
            .expect("first");
        let err = registry
            .register(Arc::new(Stub::new("a.b")))
            .expect_err("duplicate");
        assert_eq!(err.code(), "config");
    }

    #[test]
    fn builtin_wins_over_pack_for_ambiguous_shorthand() {
        struct PackStub {
            manifest: ToolManifest,
        }

        impl Tool for PackStub {
            fn manifest(&self) -> &ToolManifest {
                &self.manifest
            }

            fn run(&self, _ctx: &ToolContext, _args: &Args) -> Result<Report> {
                Ok(Report::new(self.manifest.id.clone()))
            }
        }

        let mut registry = Registry::new();
        registry
            .register(Arc::new(Stub::new("sysadmin.system-info")))
            .expect("builtin");
        registry
            .register(Arc::new(PackStub {
                manifest: ToolManifest::new(
                    "example.system-info",
                    "System information",
                    "pack copy",
                    Category::Sysadmin,
                )
                .with_origin("plugin:example"),
            }))
            .expect("pack");

        let resolved = registry.resolve("system-info").expect("resolves");
        assert_eq!(resolved.manifest().id, "sysadmin.system-info");
        assert!(registry.resolve("example.system-info").is_some());
    }

    #[test]
    fn suggests_close_identifiers() {
        let registry = registry();
        let suggestions = registry.suggest("systeminfo", 3);
        assert_eq!(
            suggestions.first().map(String::as_str),
            Some("sysadmin.system-info")
        );
    }

    #[test]
    fn similarity_is_symmetric_and_bounded() {
        assert!((similarity("system-info", "system-info") - 1.0).abs() < f64::EPSILON);
        assert!(similarity("system-info", "disk-usage") < 0.34);
        assert!((similarity("a-b", "a-b") - similarity("a-b", "a-b")).abs() < f64::EPSILON);
    }

    #[test]
    fn filters_by_category() {
        let registry = registry();
        assert_eq!(registry.manifests_in(Category::Sysadmin).len(), 1);
        assert_eq!(
            registry.categories(),
            vec![Category::Sysadmin, Category::Privacy]
        );
    }
}
