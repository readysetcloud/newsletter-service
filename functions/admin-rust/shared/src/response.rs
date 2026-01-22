use lambda_http::{Response, Body};
use serde::Serialize;
use serde_json::json;
use crate::error::AppError;

pub fn format_response<T: Serialize>(status_code: u16, body: T) -> Result<Response<Body>, AppError> {
    let body_json = serde_json::to_string(&body)
        .map_err(|e| AppError::InternalError(format!("JSON serialization failed: {}", e)))?;

    let mut builder = Response::builder()
        .status(status_code)
        .header("Content-Type", "application/json");

    if let Ok(origin) = std::env::var("ORIGIN") {
        if !origin.is_empty() {
            builder = builder.header("Access-Control-Allow-Origin", origin);
        }
    }

    builder
        .body(Body::Text(body_json))
        .map_err(|e| AppError::InternalError(format!("Response building failed: {}", e)))
}

pub fn format_error_response(error: &AppError) -> Response<Body> {
    let status_code = error.status_code();
    let body = json!({
        "message": error.to_string()
    });

    let mut builder = Response::builder()
        .status(status_code)
        .header("Content-Type", "application/json");

    if let Ok(origin) = std::env::var("ORIGIN") {
        if !origin.is_empty() {
            builder = builder.header("Access-Control-Allow-Origin", origin);
        }
    }

    builder
        .body(Body::Text(body.to_string()))
        .unwrap_or_else(|_| Response::builder().status(500).body(Body::Empty).unwrap())
}
