use super::error::AppError;
use lambda_http::{Body, Response};
use serde::Serialize;
use serde_json::json;
use std::env;

fn get_cors_origin() -> String {
    env::var("ORIGIN").unwrap_or_else(|_| "*".to_string())
}

fn add_cors_headers(
    builder: lambda_http::http::response::Builder,
) -> lambda_http::http::response::Builder {
    builder
        .header("Access-Control-Allow-Origin", get_cors_origin())
        .header("Access-Control-Allow-Headers", "Content-Type,Authorization")
        .header(
            "Access-Control-Allow-Methods",
            "GET,POST,PUT,DELETE,OPTIONS",
        )
}

pub fn format_response<T: Serialize>(
    status_code: u16,
    body: T,
) -> Result<Response<Body>, AppError> {
    let body_json = serde_json::to_string(&body)
        .map_err(|e| AppError::InternalError(format!("JSON serialization failed: {}", e)))?;

    add_cors_headers(Response::builder())
        .status(status_code)
        .header("Content-Type", "application/json")
        .body(Body::Text(body_json))
        .map_err(|e| AppError::InternalError(format!("Response building failed: {}", e)))
}

pub fn format_error_response(error: &AppError) -> Response<Body> {
    let status_code = error.status_code();
    let body = json!({
        "message": error.to_string()
    });

    add_cors_headers(Response::builder())
        .status(status_code)
        .header("Content-Type", "application/json")
        .body(Body::Text(body.to_string()))
        .unwrap_or_else(|_| Response::builder().status(500).body(Body::Empty).unwrap())
}

pub fn format_options_response() -> Result<Response<Body>, AppError> {
    add_cors_headers(Response::builder())
        .status(200)
        .body(Body::Empty)
        .map_err(|e| AppError::InternalError(format!("Response building failed: {}", e)))
}
