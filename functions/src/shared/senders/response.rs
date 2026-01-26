use super::error::AppError;
use lambda_http::{Body, Response};
use serde::Serialize;
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
    let json_body = serde_json::to_string(&body)
        .map_err(|e| AppError::InternalError(format!("Failed to serialize response: {}", e)))?;

    add_cors_headers(Response::builder())
        .status(status_code)
        .header("Content-Type", "application/json")
        .body(Body::Text(json_body))
        .map_err(|e| AppError::InternalError(format!("Failed to build response: {}", e)))
}

pub fn format_empty_response(status_code: u16) -> Result<Response<Body>, AppError> {
    add_cors_headers(Response::builder())
        .status(status_code)
        .body(Body::Empty)
        .map_err(|e| AppError::InternalError(format!("Failed to build response: {}", e)))
}

pub fn format_error_response(error: &AppError) -> Response<Body> {
    let status_code = error.status_code();
    let message = error.message();

    let error_body = serde_json::json!({
        "message": message
    });

    add_cors_headers(Response::builder())
        .status(status_code)
        .header("Content-Type", "application/json")
        .body(Body::Text(error_body.to_string()))
        .unwrap_or_else(|_| {
            Response::builder()
                .status(500)
                .body(Body::Text(
                    r#"{"message":"Internal server error"}"#.to_string(),
                ))
                .unwrap()
        })
}


