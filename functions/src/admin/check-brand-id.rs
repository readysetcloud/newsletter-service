use aws_sdk_dynamodb::types::AttributeValue;
use lambda_http::{run, service_fn, Body, Error, Request, RequestExt, Response};
use newsletter_lambdas::admin::{
    aws_clients, format_error_response, format_response, get_user_context, AppError,
};
use serde::Serialize;
use serde_json::json;
use std::env;

#[derive(Serialize)]
struct ValidationResult {
    is_valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

async fn function_handler(event: Request) -> Result<Response<Body>, Error> {
    let _user_context = get_user_context(&event)?;

    let query_params = event.query_string_parameters();
    let brand_id = match query_params.first("brandId") {
        Some(value) => value,
        None => {
            return Ok(format_response(
                400,
                json!({ "message": "brandId parameter is required" }),
            )?);
        }
    };

    let validation_result = validate_brand_id(brand_id);
    if !validation_result.is_valid {
        return Ok(format_response(
            200,
            json!({
                "available": false,
                "brandId": brand_id,
                "error": validation_result.error,
                "suggestions": generate_suggestions(brand_id),
            }),
        )?);
    }

    let is_available = check_brand_id_availability(brand_id).await;
    let mut response = json!({
        "available": is_available,
        "brandId": brand_id,
    });

    if !is_available {
        response["suggestions"] = json!(generate_suggestions(brand_id));
    }

    Ok(format_response(200, response)?)
}

fn validate_brand_id(brand_id: &str) -> ValidationResult {
    if brand_id.len() < 3 || brand_id.len() > 50 {
        return ValidationResult {
            is_valid: false,
            error: Some("Brand ID must be between 3 and 50 characters".to_string()),
        };
    }

    if !brand_id.chars().all(|c| c.is_ascii_lowercase()) {
        return ValidationResult {
            is_valid: false,
            error: Some("Brand ID can only contain lowercase letters".to_string()),
        };
    }

    let reserved_words = [
        "admin",
        "api",
        "www",
        "mail",
        "email",
        "support",
        "help",
        "blog",
        "news",
        "app",
        "mobile",
        "web",
        "ftp",
        "cdn",
        "assets",
        "static",
        "dev",
        "test",
        "staging",
        "prod",
        "production",
        "beta",
        "alpha",
        "dashboard",
        "console",
        "panel",
        "login",
        "signup",
        "register",
        "auth",
        "oauth",
        "sso",
        "security",
        "privacy",
        "terms",
        "legal",
    ];

    let normalized = brand_id.to_lowercase();
    if reserved_words.contains(&normalized.as_str()) {
        return ValidationResult {
            is_valid: false,
            error: Some("This brand ID is reserved and cannot be used".to_string()),
        };
    }

    ValidationResult {
        is_valid: true,
        error: None,
    }
}

async fn check_brand_id_availability(brand_id: &str) -> bool {
    let table_name = match env::var("TABLE_NAME") {
        Ok(value) => value,
        Err(err) => {
            tracing::error!(error = %err, "TABLE_NAME not set");
            return false;
        }
    };

    let ddb_client = aws_clients::get_dynamodb_client().await;
    let result = ddb_client
        .get_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(brand_id.to_string()))
        .key("sk", AttributeValue::S("tenant".to_string()))
        .send()
        .await;

    match result {
        Ok(output) => output.item().is_none(),
        Err(err) => {
            tracing::error!(error = %err, "Error checking brand ID in DynamoDB");
            false
        }
    }
}

fn generate_suggestions(base_brand_id: &str) -> Vec<String> {
    let mut suggestions = Vec::new();
    let clean_base: String = base_brand_id
        .chars()
        .filter(|c| c.is_ascii_lowercase())
        .take(45)
        .collect();

    let suffixes = ["co", "inc", "corp", "ltd", "llc"];
    for suffix in suffixes {
        let suggestion = format!("{}{}", clean_base, suffix);
        if suggestion.len() <= 50 {
            suggestions.push(suggestion);
        }
    }

    for i in 0..5 {
        let letter = (b'a' + i) as char;
        let suggestion = format!("{}{}", clean_base, letter);
        if suggestion.len() <= 50 {
            suggestions.push(suggestion);
        }
    }

    suggestions.truncate(5);
    suggestions
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    run(service_fn(|event: Request| async move {
        match function_handler(event).await {
            Ok(response) => Ok::<Response<Body>, std::convert::Infallible>(response),
            Err(e) => {
                tracing::error!(error = %e, "Function execution failed");

                if let Some(app_err) = e.downcast_ref::<AppError>() {
                    Ok(format_error_response(app_err))
                } else {
                    Ok(format_error_response(&AppError::InternalError(
                        e.to_string(),
                    )))
                }
            }
        }
    }))
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_brand_id_rejects_length() {
        let too_short = validate_brand_id("ab");
        assert!(!too_short.is_valid);
        assert_eq!(
            too_short.error.as_deref(),
            Some("Brand ID must be between 3 and 50 characters")
        );

        let too_long = "a".repeat(51);
        let result = validate_brand_id(&too_long);
        assert!(!result.is_valid);
        assert_eq!(
            result.error.as_deref(),
            Some("Brand ID must be between 3 and 50 characters")
        );
    }

    #[test]
    fn validate_brand_id_rejects_non_lowercase() {
        let result = validate_brand_id("Brand");
        assert!(!result.is_valid);
        assert_eq!(
            result.error.as_deref(),
            Some("Brand ID can only contain lowercase letters")
        );

        let result = validate_brand_id("brand123");
        assert!(!result.is_valid);
        assert_eq!(
            result.error.as_deref(),
            Some("Brand ID can only contain lowercase letters")
        );
    }

    #[test]
    fn validate_brand_id_rejects_reserved_words() {
        let result = validate_brand_id("admin");
        assert!(!result.is_valid);
        assert_eq!(
            result.error.as_deref(),
            Some("This brand ID is reserved and cannot be used")
        );
    }

    #[test]
    fn validate_brand_id_accepts_valid() {
        let result = validate_brand_id("newsletter");
        assert!(result.is_valid);
        assert!(result.error.is_none());
    }

    #[test]
    fn generate_suggestions_sanitizes_and_limits() {
        let suggestions = generate_suggestions("brand-123");
        assert!(!suggestions.is_empty());
        assert!(suggestions.len() <= 5);
        assert!(suggestions
            .iter()
            .all(|s| s.chars().all(|c| c.is_ascii_lowercase())));
    }

    #[test]
    fn generate_suggestions_truncates_base() {
        let base = "a".repeat(60);
        let suggestions = generate_suggestions(&base);
        assert!(suggestions.len() <= 5);
        assert!(suggestions.iter().all(|s| s.len() <= 50));
    }
}
