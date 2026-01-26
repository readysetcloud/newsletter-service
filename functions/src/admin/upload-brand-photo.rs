use aws_sdk_dynamodb::types::AttributeValue;
use aws_sdk_s3::operation::head_object::HeadObjectError;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::types::ObjectCannedAcl;
use chrono::Utc;
use lambda_http::http::Method;
use lambda_http::{run, service_fn, Body, Error, Request, Response};
use newsletter_lambdas::admin::{aws_clients, format_response, get_user_context};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

#[derive(Debug)]
enum UploadBrandPhotoError {
    Unauthorized,
    BadRequest(String),
    Forbidden(String),
    NotFound(String),
    MethodNotAllowed,
    Internal(String),
}

async fn function_handler(event: Request) -> Result<Response<Body>, Error> {
    match handle_request(event).await {
        Ok(response) => Ok(response),
        Err(err) => {
            tracing::error!(error = ?err, "Brand photo upload error");
            Ok(format_error_response(err))
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    run(service_fn(function_handler)).await
}

async fn handle_request(event: Request) -> Result<Response<Body>, UploadBrandPhotoError> {
    let user_context = get_user_context(&event).map_err(|_| UploadBrandPhotoError::Unauthorized)?;
    let tenant_id = user_context.tenant_id.ok_or_else(|| {
        UploadBrandPhotoError::BadRequest(
            "Tenant ID is required. Please complete brand setup first.".to_string(),
        )
    })?;

    let body = parse_body(&event)?;

    match *event.method() {
        Method::POST => generate_upload_url(&tenant_id, &body).await,
        Method::PUT => confirm_upload(&tenant_id, &body).await,
        _ => Err(UploadBrandPhotoError::MethodNotAllowed),
    }
}

fn parse_body(event: &Request) -> Result<Value, UploadBrandPhotoError> {
    match event.body() {
        Body::Text(text) => serde_json::from_str(text)
            .map_err(|err| UploadBrandPhotoError::Internal(format!("Invalid JSON body: {}", err))),
        Body::Binary(bytes) => serde_json::from_slice(bytes)
            .map_err(|err| UploadBrandPhotoError::Internal(format!("Invalid JSON body: {}", err))),
        Body::Empty => Ok(json!({})),
    }
}

async fn generate_upload_url(
    tenant_id: &str,
    body: &Value,
) -> Result<Response<Body>, UploadBrandPhotoError> {
    let file_name = body
        .get("fileName")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            UploadBrandPhotoError::BadRequest(
                "\"fileName\" is required and must be a non-empty string".to_string(),
            )
        })?;

    let content_type = body
        .get("contentType")
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            UploadBrandPhotoError::BadRequest(
                "\"contentType\" is required and must be a string".to_string(),
            )
        })?
        .to_lowercase();

    let allowed_types = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "image/webp",
    ];
    if !allowed_types.contains(&content_type.as_str()) {
        return Err(UploadBrandPhotoError::BadRequest(
            "Only image files are allowed (JPEG, PNG, GIF, WebP)".to_string(),
        ));
    }

    let file_name_lower = file_name.to_lowercase();
    let file_extension = file_name_lower.split('.').next_back().unwrap_or("");

    let valid_extensions: HashMap<&str, Vec<&str>> = HashMap::from([
        ("image/jpeg", vec!["jpg", "jpeg"]),
        ("image/jpg", vec!["jpg", "jpeg"]),
        ("image/png", vec!["png"]),
        ("image/gif", vec!["gif"]),
        ("image/webp", vec!["webp"]),
    ]);

    let valid_for_type = valid_extensions
        .get(content_type.as_str())
        .map(|values| values.contains(&file_extension))
        .unwrap_or(false);

    if !valid_for_type {
        return Err(UploadBrandPhotoError::BadRequest(
            "File extension does not match content type".to_string(),
        ));
    }

    let timestamp = Utc::now().timestamp_millis();
    let sanitized = sanitize_filename(file_name);
    let key = format!("brand-logos/{}/{}-{}", tenant_id, timestamp, sanitized);

    let bucket_name = std::env::var("HOSTING_BUCKET_NAME").map_err(|err| {
        UploadBrandPhotoError::Internal(format!("HOSTING_BUCKET_NAME not set: {}", err))
    })?;

    let s3_client = aws_clients::get_s3_client().await;
    let request = s3_client
        .put_object()
        .bucket(&bucket_name)
        .key(&key)
        .content_type(content_type)
        .acl(ObjectCannedAcl::PublicRead)
        .metadata("tenantId", tenant_id)
        .metadata("uploadedAt", Utc::now().to_rfc3339());

    let presigned = request
        .presigned(
            PresigningConfig::expires_in(Duration::from_secs(300)).map_err(|err| {
                UploadBrandPhotoError::Internal(format!("Presign config error: {}", err))
            })?,
        )
        .await
        .map_err(|err| UploadBrandPhotoError::Internal(format!("Presign failed: {}", err)))?;

    format_response(
        200,
        json!({
            "uploadUrl": presigned.uri().to_string(),
            "key": key,
            "expiresIn": 300,
            "maxSize": 2 * 1024 * 1024,
            "publicUrl": format!("https://{}.s3.amazonaws.com/{}", bucket_name, key)
        }),
    )
    .map_err(|err| UploadBrandPhotoError::Internal(err.to_string()))
}

async fn confirm_upload(
    tenant_id: &str,
    body: &Value,
) -> Result<Response<Body>, UploadBrandPhotoError> {
    let key = body
        .get("key")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            UploadBrandPhotoError::BadRequest(
                "\"key\" is required and must be a non-empty string".to_string(),
            )
        })?;

    if !key.starts_with(&format!("brand-logos/{}/", tenant_id)) {
        return Err(UploadBrandPhotoError::Forbidden(
            "Invalid logo key for this tenant".to_string(),
        ));
    }

    let bucket_name = std::env::var("HOSTING_BUCKET_NAME").map_err(|err| {
        UploadBrandPhotoError::Internal(format!("HOSTING_BUCKET_NAME not set: {}", err))
    })?;
    let s3_client = aws_clients::get_s3_client().await;

    let head_result = s3_client
        .head_object()
        .bucket(&bucket_name)
        .key(key)
        .send()
        .await;

    if let Err(err) = head_result {
        let is_not_found = err
            .as_service_error()
            .map(|service_error| matches!(service_error, HeadObjectError::NotFound(_)))
            .unwrap_or(false);

        if is_not_found {
            return Err(UploadBrandPhotoError::NotFound(
                "Photo not found in storage. Upload may have failed.".to_string(),
            ));
        }

        return Err(UploadBrandPhotoError::Internal(format!(
            "S3 head failed: {}",
            err
        )));
    }

    let public_url = format!("https://{}.s3.amazonaws.com/{}", bucket_name, key);
    let updated_at = Utc::now().to_rfc3339();

    let table_name = std::env::var("TABLE_NAME")
        .map_err(|err| UploadBrandPhotoError::Internal(format!("TABLE_NAME not set: {}", err)))?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    ddb_client
        .update_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S("tenant".to_string()))
        .update_expression("SET brandPhoto = :photo, brandPhotoKey = :key, updatedAt = :updatedAt")
        .expression_attribute_values(":photo", AttributeValue::S(public_url.clone()))
        .expression_attribute_values(":key", AttributeValue::S(key.to_string()))
        .expression_attribute_values(":updatedAt", AttributeValue::S(updated_at))
        .send()
        .await
        .map_err(|err| {
            UploadBrandPhotoError::Internal(format!("DynamoDB update failed: {}", err))
        })?;

    format_response(
        200,
        json!({
            "message": "Brand logo updated successfully",
            "photoUrl": public_url,
            "key": key
        }),
    )
    .map_err(|err| UploadBrandPhotoError::Internal(err.to_string()))
}

fn sanitize_filename(file_name: &str) -> String {
    file_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn format_error_response(err: UploadBrandPhotoError) -> Response<Body> {
    let (status, message) = match err {
        UploadBrandPhotoError::Unauthorized => (403, "Authentication required".to_string()),
        UploadBrandPhotoError::BadRequest(message) => (400, message),
        UploadBrandPhotoError::Forbidden(message) => (403, message),
        UploadBrandPhotoError::NotFound(message) => (404, message),
        UploadBrandPhotoError::MethodNotAllowed => (405, "Method not allowed".to_string()),
        UploadBrandPhotoError::Internal(message) => {
            tracing::error!(error = %message, "Internal brand photo error");
            (500, "Something went wrong".to_string())
        }
    };

    format_response(status, json!({ "message": message }))
        .unwrap_or_else(|_| Response::builder().status(500).body(Body::Empty).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_filename_replaces_invalid_chars() {
        let input = "my logo@2024#.png";
        let output = sanitize_filename(input);
        assert_eq!(output, "my_logo_2024_.png");
    }

    #[test]
    fn sanitize_filename_allows_alnum_dot_dash() {
        let input = "brand-Logo.01.png";
        let output = sanitize_filename(input);
        assert_eq!(output, "brand-Logo.01.png");
    }
}
