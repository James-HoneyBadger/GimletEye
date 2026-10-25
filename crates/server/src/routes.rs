use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderValue, Method, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use mellivora_core::{
    AppPaths, Args, AuditEntry, AuditLog, Config, MellivoraError, PackSummary, Registry, Report,
    ToolContext, ToolManifest, VERSION,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::{bearer, AuthPolicy};
use crate::error::ApiError;

/// Everything a request needs. Built once by the CLI and cloned per request.
#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<Registry>,
    pub context: ToolContext,
    pub packs: Arc<Vec<PackSummary>>,
    pub config: Arc<Config>,
    pub audit: Option<Arc<AuditLog>>,
    pub ui_dir: Option<Arc<PathBuf>>,
    pub auth: AuthPolicy,
}

impl AppState {
    pub fn new(registry: Arc<Registry>, context: ToolContext, config: Config) -> Self {
        Self {
            registry,
            context,
            packs: Arc::new(Vec::new()),
            config: Arc::new(config),
            audit: None,
            ui_dir: None,
            auth: AuthPolicy::disabled(),
        }
    }

    /// Require `Authorization: Bearer <token>` on `/api/` routes.
    pub fn with_token(mut self, token: impl Into<String>) -> Self {
        self.auth = AuthPolicy::required(token);
        self
    }

    pub fn with_packs(mut self, packs: Vec<PackSummary>) -> Self {
        self.packs = Arc::new(packs);
        self
    }

    pub fn with_audit(mut self, audit: AuditLog) -> Self {
        self.audit = Some(Arc::new(audit));
        self
    }

    pub fn with_ui_dir(mut self, dir: PathBuf) -> Self {
        self.ui_dir = Some(Arc::new(dir));
        self
    }

    pub fn paths(&self) -> &AppPaths {
        &self.context.paths
    }
}

#[derive(Debug, Deserialize)]
struct RunRequest {
    tool: String,
    #[serde(default)]
    args: BTreeMap<String, Value>,
    #[serde(default)]
    dry_run: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct AuditQuery {
    limit: Option<usize>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/tools", get(list_tools))
        .route("/api/v1/tools/{id}", get(show_tool))
        .route("/api/v1/run", post(run_tool))
        .route("/api/v1/packs", get(list_packs))
        .route("/api/v1/audit", get(list_audit))
        .route("/api/v1/config", get(show_config))
        .fallback(get(static_file))
        .layer(middleware::from_fn_with_state(state.clone(), authorize))
        // Outermost, so a preflight is answered before authentication: browsers
        // do not send credentials on an OPTIONS request.
        .layer(middleware::from_fn(cors))
        .with_state(state)
}

pub async fn serve(state: AppState, addr: SocketAddr) -> Result<(), MellivoraError> {
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|err| MellivoraError::Io(format!("cannot bind {addr}: {err}")))?;
    serve_listener(state, listener).await
}

/// Serve on a listener the caller already bound, so the port is known first.
pub async fn serve_listener(
    state: AppState,
    listener: tokio::net::TcpListener,
) -> Result<(), MellivoraError> {
    if let Ok(addr) = listener.local_addr() {
        tracing::info!(%addr, "listening");
    }
    axum::serve(listener, router(state))
        .await
        .map_err(|err| MellivoraError::Internal(err.to_string()))
}

/// Every `/api/` request needs the token when one is configured.
///
/// The UI bundle and the static fallback stay open: they carry no data, and the
/// shell is what asks the user for the credential.
async fn authorize(
    State(state): State<AppState>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    if state.auth.is_enabled() && request.uri().path().starts_with("/api/") {
        let presented = bearer(request.headers()).map(str::to_owned);
        if !state.auth.allows(presented.as_deref()) {
            return (
                StatusCode::UNAUTHORIZED,
                [(header::WWW_AUTHENTICATE, "Bearer realm=\"mellivora\"")],
                "missing or invalid API token\n",
            )
                .into_response();
        }
    }
    next.run(request).await
}

async fn health(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "status": "ok",
        "version": VERSION,
        "tools": state.registry.len(),
        "packs": state.packs.len(),
    }))
}

async fn list_tools(State(state): State<AppState>) -> Json<Vec<ToolManifest>> {
    Json(state.registry.manifests())
}

async fn show_tool(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ToolManifest>, ApiError> {
    let tool = state
        .registry
        .resolve(&id)
        .ok_or_else(|| MellivoraError::NotFound(format!("tool '{id}'")))?;
    Ok(Json(tool.manifest().clone()))
}

async fn list_packs(State(state): State<AppState>) -> Json<Vec<PackSummary>> {
    Json(state.packs.as_ref().clone())
}

/// Recent runs, straight from the JSONL audit trail. Argument *values* are
/// never recorded, so this is safe to render without redaction.
async fn list_audit(
    State(state): State<AppState>,
    Query(query): Query<AuditQuery>,
) -> Result<Json<Value>, ApiError> {
    let Some(log) = state.audit.as_ref() else {
        return Ok(Json(
            json!({ "enabled": false, "path": Value::Null, "entries": [] }),
        ));
    };
    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    let entries = log.tail(limit)?;
    Ok(Json(json!({
        "enabled": true,
        "path": log.path().display().to_string(),
        "entries": entries,
    })))
}

async fn show_config(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "config": state.config.as_ref(),
        "paths": {
            "root": state.paths().root.display().to_string(),
            "config_file": state.paths().config_file.display().to_string(),
            "audit_file": state.paths().audit_file.display().to_string(),
        }
    }))
}

async fn run_tool(
    State(state): State<AppState>,
    Json(request): Json<RunRequest>,
) -> Result<Json<Report>, ApiError> {
    let tool = state
        .registry
        .resolve(&request.tool)
        .ok_or_else(|| MellivoraError::NotFound(format!("tool '{}'", request.tool)))?;

    let arg_keys: Vec<String> = request.args.keys().cloned().collect();
    let args = Args::from_map(request.args);
    let mut context = state.context.clone();
    if let Some(dry_run) = request.dry_run {
        context.dry_run = dry_run;
    }

    let report = tokio::task::spawn_blocking(move || tool.run(&context, &args))
        .await
        .map_err(|err| MellivoraError::Internal(format!("tool task failed: {err}")))??;

    if let Some(audit) = &state.audit {
        let entry = AuditEntry::new(report.tool.clone(), report.status, report.duration_ms)
            .with_arg_keys(arg_keys);
        if let Err(err) = audit.record(&entry) {
            tracing::warn!(%err, "failed to write audit record");
        }
    }

    Ok(Json(report))
}

async fn static_file(State(state): State<AppState>, uri: Uri) -> Response {
    let Some(dir) = state.ui_dir.clone() else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };

    let requested = uri.path().trim_start_matches('/');
    let requested = if requested.is_empty() {
        "index.html"
    } else {
        requested
    };
    if requested.contains("..") {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }

    let mut target = dir.join(requested);
    if !target.is_file() {
        // Single-page app: unknown routes fall back to the shell.
        target = dir.join("index.html");
    }

    match std::fs::read(&target) {
        Ok(bytes) => ([(header::CONTENT_TYPE, content_type(&target))], bytes).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

fn content_type(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

/// Origins the local API answers: the desktop webview, the browser dev server,
/// and anything served from this machine. Any other origin gets no grant, so a
/// page the user happens to visit cannot drive local tools through the browser.
fn origin_allowed(origin: &str) -> bool {
    let origin = origin.trim().to_ascii_lowercase();
    if matches!(
        origin.as_str(),
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    ) {
        return true;
    }
    let Some(rest) = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
    else {
        return false;
    };
    let authority = rest.split('/').next().unwrap_or_default();
    let host = match authority.strip_prefix('[') {
        Some(bracketed) => bracketed.split(']').next().unwrap_or_default(),
        None => authority.split(':').next().unwrap_or_default(),
    };
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

/// The desktop shell and the browser dev server run on different origins, so the
/// local API answers a small allowlist rather than every origin. Requests with
/// no `Origin` at all (curl, the CLI, a same-origin navigation) are unaffected.
async fn cors(request: axum::extract::Request, next: Next) -> Response {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let preflight = request.method() == Method::OPTIONS;
    let granted = origin
        .as_deref()
        .filter(|value| origin_allowed(value))
        .map(str::to_owned);

    if preflight && granted.is_none() && origin.is_some() {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }

    let mut response = if preflight {
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(request).await
    };

    if let Some(origin) = granted {
        if let Ok(value) = HeaderValue::from_str(&origin) {
            let headers = response.headers_mut();
            headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
            headers.insert(header::VARY, HeaderValue::from_static("origin"));
            headers.insert(
                header::ACCESS_CONTROL_ALLOW_METHODS,
                HeaderValue::from_static("GET, POST, OPTIONS"),
            );
            headers.insert(
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                HeaderValue::from_static("content-type"),
            );
        }
    }
    response
}

#[cfg(test)]
mod tests {
    use super::origin_allowed;

    #[test]
    fn allows_the_local_ui_the_dev_server_and_the_desktop_shell() {
        for origin in [
            "http://127.0.0.1:7878",
            "http://localhost:5173",
            "https://localhost",
            "http://[::1]:7878",
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
        ] {
            assert!(origin_allowed(origin), "{origin} should be allowed");
        }
    }

    #[test]
    fn refuses_remote_and_opaque_origins() {
        for origin in [
            "https://evil.example",
            "http://127.0.0.1.evil.example",
            "http://localhost.evil.example",
            "http://192.168.1.5:7878",
            "null",
            "file://",
            "ftp://localhost",
        ] {
            assert!(!origin_allowed(origin), "{origin} should be refused");
        }
    }
}
