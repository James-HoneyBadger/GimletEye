use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use mellivora_core::MellivoraError;
use serde_json::json;

/// Maps toolkit errors onto HTTP status codes while keeping the machine-readable
/// error code in the body.
#[derive(Debug)]
pub struct ApiError(pub MellivoraError);

impl From<MellivoraError> for ApiError {
    fn from(err: MellivoraError) -> Self {
        Self(err)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            MellivoraError::NotFound(_) => StatusCode::NOT_FOUND,
            MellivoraError::InvalidArgs(_) => StatusCode::BAD_REQUEST,
            MellivoraError::CapabilityDenied(_) => StatusCode::FORBIDDEN,
            MellivoraError::Unsupported(_) => StatusCode::NOT_IMPLEMENTED,
            MellivoraError::Timeout(_) => StatusCode::GATEWAY_TIMEOUT,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = json!({ "error": self.0 });
        (status, Json(body)).into_response()
    }
}
