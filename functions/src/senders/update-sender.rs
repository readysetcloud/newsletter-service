use aws_sdk_dynamodb::types::AttributeValue;
use lambda_http::{run, service_fn, Body, Error, Request, RequestExt, Response};
use newsletter_lambdas::senders::{auth, aws_clients, error::AppError, response, types::*};
use serde::{Deserialize, Serialize};
use serde_dynamo::from_item;
use std::collections::HashMap;

#[derive(Deserialize)]
struct UpdateSenderRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(rename = "isDefault", skip_serializing_if = "Option::is_none")]
    is_default: Option<bool>,
}

#[derive(Serialize)]
struct UpdateSenderResponse {
    #[serde(rename = "senderId")]
    sender_id: String,
    email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(rename = "verificationType")]
    verification_type: VerificationType,
    #[serde(rename = "verificationStatus")]
    verification_status: VerificationStatus,
    #[serde(rename = "isDefault")]
    is_default: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    domain: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "verifiedAt")]
    verified_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "failureReason")]
    failure_reason: Option<String>,
}

async fn function_handler(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let path_params = event.path_parameters();
    let sender_id = path_params
        .first("senderId")
        .ok_or_else(|| AppError::BadRequest("Sender ID is required".to_string()))?;

    let body: UpdateSenderRequest = serde_json::from_slice(event.body())
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    validate_update_request(&body)?;

    let _existing_sender = get_sender_by_id(&tenant_id, sender_id).await?;

    if body.is_default == Some(true) {
        unset_other_defaults(&tenant_id, sender_id).await?;
    }

    let updated_sender = update_sender(&tenant_id, sender_id, &body).await?;

    response::format_response(
        200,
        UpdateSenderResponse {
            sender_id: updated_sender.sender_id,
            email: updated_sender.email,
            name: updated_sender.name,
            verification_type: updated_sender.verification_type,
            verification_status: updated_sender.verification_status,
            is_default: updated_sender.is_default,
            domain: updated_sender.domain,
            created_at: updated_sender.created_at,
            updated_at: updated_sender.updated_at,
            verified_at: updated_sender.verified_at,
            failure_reason: updated_sender.failure_reason,
        },
    )
}

fn validate_update_request(body: &UpdateSenderRequest) -> Result<(), AppError> {
    if body.name.is_none() && body.is_default.is_none() {
        return Err(AppError::BadRequest(
            "At least one field must be provided for update".to_string(),
        ));
    }

    if let Some(ref name) = body.name {
        if name.is_empty() {
            return Err(AppError::BadRequest("Name cannot be empty".to_string()));
        }
    }

    Ok(())
}

async fn get_sender_by_id(tenant_id: &str, sender_id: &str) -> Result<SenderRecord, AppError> {
    let client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let result = client
        .get_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S(KeyPatterns::sender(sender_id)))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB error: {}", e)))?;

    let item = result
        .item
        .ok_or_else(|| AppError::NotFound("Sender not found".to_string()))?;

    let sender: SenderRecord = from_item(item.clone())
        .map_err(|e| AppError::InternalError(format!("Failed to deserialize sender: {}", e)))?;

    Ok(sender)
}

async fn unset_other_defaults(tenant_id: &str, exclude_sender_id: &str) -> Result<(), AppError> {
    let client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let result = client
        .query()
        .table_name(&table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :gsi1pk")
        .expression_attribute_values(
            ":gsi1pk",
            AttributeValue::S(KeyPatterns::sender_gsi1pk(tenant_id)),
        )
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB query error: {}", e)))?;

    if let Some(items) = result.items {
        let senders: Vec<SenderRecord> = items
            .into_iter()
            .filter_map(|item| from_item::<_, SenderRecord>(item.clone()).ok())
            .filter(|sender: &SenderRecord| {
                sender.sender_id != exclude_sender_id && sender.is_default
            })
            .collect();

        for sender in senders {
            let now = chrono::Utc::now().to_rfc3339();
            client
                .update_item()
                .table_name(&table_name)
                .key("pk", AttributeValue::S(tenant_id.to_string()))
                .key(
                    "sk",
                    AttributeValue::S(KeyPatterns::sender(&sender.sender_id)),
                )
                .update_expression("SET isDefault = :isDefault, updatedAt = :updatedAt")
                .expression_attribute_values(":isDefault", AttributeValue::Bool(false))
                .expression_attribute_values(":updatedAt", AttributeValue::S(now))
                .send()
                .await
                .map_err(|e| {
                    tracing::error!(
                        "Error unsetting default for sender {}: {}",
                        sender.sender_id,
                        e
                    );
                    AppError::AwsError(format!("Failed to unset default: {}", e))
                })?;
        }
    }

    Ok(())
}

async fn update_sender(
    tenant_id: &str,
    sender_id: &str,
    body: &UpdateSenderRequest,
) -> Result<SenderRecord, AppError> {
    let client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let mut update_parts = Vec::new();
    let mut expr_attr_names = HashMap::new();
    let mut expr_attr_values = HashMap::new();

    if let Some(ref name) = body.name {
        update_parts.push("#name = :name");
        expr_attr_names.insert("#name".to_string(), "name".to_string());
        expr_attr_values.insert(":name".to_string(), AttributeValue::S(name.clone()));
    }

    if let Some(is_default) = body.is_default {
        update_parts.push("isDefault = :isDefault");
        expr_attr_values.insert(":isDefault".to_string(), AttributeValue::Bool(is_default));
    }

    let now = chrono::Utc::now().to_rfc3339();
    update_parts.push("updatedAt = :updatedAt");
    expr_attr_values.insert(":updatedAt".to_string(), AttributeValue::S(now));

    if update_parts.len() == 1 {
        return Err(AppError::BadRequest(
            "No valid fields to update".to_string(),
        ));
    }

    let update_expression = format!("SET {}", update_parts.join(", "));

    let mut request = client
        .update_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S(KeyPatterns::sender(sender_id)))
        .update_expression(update_expression)
        .condition_expression("attribute_exists(pk) AND attribute_exists(sk)")
        .return_values(aws_sdk_dynamodb::types::ReturnValue::AllNew);

    for (key, value) in expr_attr_names {
        request = request.expression_attribute_names(key, value);
    }

    for (key, value) in expr_attr_values {
        request = request.expression_attribute_values(key, value);
    }

    let result = request.send().await.map_err(|e| {
        if e.to_string().contains("ConditionalCheckFailed") {
            AppError::NotFound("Sender not found".to_string())
        } else {
            AppError::AwsError(format!("DynamoDB update error: {}", e))
        }
    })?;

    let attributes = result
        .attributes
        .ok_or_else(|| AppError::InternalError("No attributes returned".to_string()))?;

    let updated_sender: SenderRecord = from_item(attributes.clone())
        .map_err(|e| AppError::InternalError(format!("Failed to deserialize sender: {}", e)))?;

    Ok(updated_sender)
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
                Ok::<Response<Body>, std::convert::Infallible>(response::format_error_response(&e))
            }
        }
    }))
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_update_request_valid_name() {
        let request = UpdateSenderRequest {
            name: Some("Test Sender".to_string()),
            is_default: None,
        };
        assert!(validate_update_request(&request).is_ok());
    }

    #[test]
    fn test_validate_update_request_valid_is_default() {
        let request = UpdateSenderRequest {
            name: None,
            is_default: Some(true),
        };
        assert!(validate_update_request(&request).is_ok());
    }

    #[test]
    fn test_validate_update_request_both_fields() {
        let request = UpdateSenderRequest {
            name: Some("Test Sender".to_string()),
            is_default: Some(false),
        };
        assert!(validate_update_request(&request).is_ok());
    }

    #[test]
    fn test_validate_update_request_no_fields() {
        let request = UpdateSenderRequest {
            name: None,
            is_default: None,
        };
        let result = validate_update_request(&request);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_update_request_empty_name() {
        let request = UpdateSenderRequest {
            name: Some("".to_string()),
            is_default: None,
        };
        let result = validate_update_request(&request);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }
}
