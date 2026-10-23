//! Wire protocol between the host and a plugin pack.
//!
//! JSON-RPC 2.0, one JSON object per line, over the pack's stdin/stdout.
//! Stderr is reserved for pack diagnostics and never parsed, so a pack can log
//! freely without corrupting the stream.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::tool::ToolManifest;

pub const PROTOCOL_VERSION: u32 = 1;
pub const JSONRPC_VERSION: &str = "2.0";

pub const METHOD_INITIALIZE: &str = "initialize";
pub const METHOD_LIST_TOOLS: &str = "list_tools";
pub const METHOD_RUN_TOOL: &str = "run_tool";
pub const METHOD_SHUTDOWN: &str = "shutdown";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

impl Request {
    pub fn new(id: u64, method: impl Into<String>, params: Value) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id,
            method: method.into(),
            params,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub jsonrpc: String,
    #[serde(default)]
    pub id: Option<u64>,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<RpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<Value>,
}

/// `initialize` request payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitializeParams {
    pub protocol_version: u32,
    pub client: ClientInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

/// `initialize` response payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitializeResult {
    pub protocol_version: u32,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

/// `list_tools` response payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListToolsResult {
    pub tools: Vec<ToolManifest>,
}

/// `run_tool` request payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunToolParams {
    pub tool: String,
    #[serde(default)]
    pub args: Value,
}

/// Pack-side error codes. Kept in the JSON-RPC application range so they do not
/// collide with the protocol's reserved codes.
pub mod codes {
    pub const TOOL_NOT_FOUND: i64 = -32_001;
    pub const INVALID_ARGS: i64 = -32_002;
    pub const EXECUTION_FAILED: i64 = -32_003;
    pub const UNSUPPORTED: i64 = -32_004;
}
