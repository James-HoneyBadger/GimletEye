//! The credential layer for `/api/v1`.

use std::fmt;

use axum::http::{header, HeaderMap};
use mellivora_core::token;

/// Whether the API needs a credential, and which one it accepts.
///
/// A disabled policy is not the default anywhere except in tests: the CLI and
/// the desktop shell both build a required policy from
/// `[api] require_token` and the token file.
#[derive(Clone, Default)]
pub struct AuthPolicy {
    token: Option<String>,
}

impl AuthPolicy {
    /// No credential required. Any local page can drive the API.
    pub fn disabled() -> Self {
        Self { token: None }
    }

    pub fn required(token: impl Into<String>) -> Self {
        Self {
            token: Some(token.into()),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.token.is_some()
    }

    /// True when the request may proceed: either nothing is required, or the
    /// presented credential is the expected one.
    pub fn allows(&self, presented: Option<&str>) -> bool {
        let Some(expected) = self.token.as_deref() else {
            return true;
        };
        presented
            .map(|value| token::matches(value, expected))
            .unwrap_or(false)
    }
}

impl fmt::Debug for AuthPolicy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // The token itself must never reach a log line or a panic message.
        f.debug_struct("AuthPolicy")
            .field("enabled", &self.token.is_some())
            .finish()
    }
}

/// `Authorization: Bearer <token>`, with the scheme matched case-insensitively
/// as the HTTP specification requires.
pub fn bearer(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, credential) = value.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    let credential = credential.trim();
    if credential.is_empty() {
        None
    } else {
        Some(credential)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(value: &str) -> HeaderMap {
        let mut map = HeaderMap::new();
        map.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(value).expect("value"),
        );
        map
    }

    #[test]
    fn a_disabled_policy_allows_everything() {
        let policy = AuthPolicy::disabled();
        assert!(policy.allows(None));
        assert!(policy.allows(Some("anything")));
        assert!(!policy.is_enabled());
    }

    #[test]
    fn a_required_policy_needs_the_exact_token() {
        let policy = AuthPolicy::required("s3cret");
        assert!(policy.is_enabled());
        assert!(policy.allows(Some("s3cret")));
        assert!(!policy.allows(Some("s3cre")));
        assert!(!policy.allows(Some("")));
        assert!(!policy.allows(None));
    }

    #[test]
    fn reads_the_bearer_scheme_case_insensitively() {
        assert_eq!(bearer(&headers("Bearer abc123")), Some("abc123"));
        assert_eq!(bearer(&headers("bearer abc123")), Some("abc123"));
        assert_eq!(bearer(&headers("BEARER   abc123  ")), Some("abc123"));
    }

    #[test]
    fn rejects_other_schemes_and_empty_credentials() {
        assert_eq!(bearer(&headers("Basic abc123")), None);
        assert_eq!(bearer(&headers("Bearer")), None);
        assert_eq!(bearer(&headers("Bearer   ")), None);
        assert_eq!(bearer(&HeaderMap::new()), None);
    }

    #[test]
    fn debug_never_prints_the_token() {
        let rendered = format!("{:?}", AuthPolicy::required("s3cret"));
        assert!(!rendered.contains("s3cret"), "{rendered}");
        assert!(rendered.contains("enabled: true"), "{rendered}");
    }
}
