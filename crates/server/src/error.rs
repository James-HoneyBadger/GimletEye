use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use gimlet_eye_core::GimletEyeError;
use serde_json::json;

/// Maps toolkit errors onto HTTP status codes while keeping the machine-readable
/// error code in the body.
#[derive(Debug)]
pub struct ApiError(pub GimletEyeError);

impl From<GimletEyeError> for ApiError {
    fn from(err: GimletEyeError) -> Self {
        Self(err)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            GimletEyeError::NotFound(_) => StatusCode::NOT_FOUND,
            GimletEyeError::InvalidArgs(_) => StatusCode::BAD_REQUEST,
            GimletEyeError::CapabilityDenied(_) => StatusCode::FORBIDDEN,
            GimletEyeError::Unsupported(_) => StatusCode::NOT_IMPLEMENTED,
            GimletEyeError::Timeout(_) => StatusCode::GATEWAY_TIMEOUT,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = json!({ "error": self.0 });
        (status, Json(body)).into_response()
    }
}
