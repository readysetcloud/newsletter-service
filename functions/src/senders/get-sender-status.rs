use aws_sdk_dynamodb::Client as DynamoDbClient;
use aws_sdk_sesv2::Client as SesClient;
use lambda_http::{run, service_fn, Body, Error, Request, RequestExt, Response};
use newsletter_lambdas::senders::{auth, error::AppError, response, types::*};
use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Serialize)]
struct GetSenderStatusResponse {
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
    #[serde(rename = "emailsSent")]
    emails_sent: i64,
    #[serde(skip_serializing_if = "Option::is_none", rename = "lastSentAt")]
    last_sent_at: Option<String>,
    #[serde(rename = "statusChanged")]
    status_changed: bool,
    #[serde(skip_serializing_if = "Option::is_none", rename = "sesStatus")]
    ses_status: Option<SesStatusInfo>,
    #[serde(rename = "lastChecked")]
    last_checked: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SesStatusInfo {
    #[serde(rename = "verificationStatus")]
    verification_status: String,
    #[serde(rename = "dkimStatus")]
    dkim_status: String,
    #[serde(rename = "identityType")]
    identity_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

async fn get_sender_by_id(
    client: &DynamoDbClient,
    table_name: &str,
    tenant_id: &str,
    sender_id: &str,
) -> Result<Option<SenderRecord>, AppError> {
    let pk = tenant_id.to_string();
    let sk = KeyPatterns::sender(sender_id);

    let result = client
        .get_item()
        .table_name(table_name)
        .key("pk", aws_sdk_dynamodb::types::AttributeValue::S(pk))
        .key("sk", aws_sdk_dynamodb::types::AttributeValue::S(sk))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to get sender: {}", e)))?;

    match result.item {
        Some(item) => {
            let sender: SenderRecord = serde_dynamo::from_item(item.clone()).map_err(|e| {
                AppError::InternalError(format!("Failed to deserialize sender: {}", e))
            })?;
            Ok(Some(sender))
        }
        None => Ok(None),
    }
}

async fn check_ses_verification_status(
    ses_client: &SesClient,
    email: &str,
) -> Result<SesStatusInfo, AppError> {
    match ses_client
        .get_email_identity()
        .email_identity(email)
        .send()
        .await
    {
        Ok(response) => {
            let verification_status = response
                .verification_status()
                .map(|s| s.as_str().to_lowercase())
                .unwrap_or_else(|| "unknown".to_string());

            let dkim_status = response
                .dkim_attributes()
                .and_then(|d| d.status())
                .map(|s| s.as_str().to_lowercase())
                .unwrap_or_else(|| "unknown".to_string());

            let identity_type = response
                .identity_type()
                .map(|t| t.as_str().to_lowercase())
                .unwrap_or_else(|| "unknown".to_string());

            Ok(SesStatusInfo {
                verification_status,
                dkim_status,
                identity_type,
                error: None,
            })
        }
        Err(e) => {
            let error_message = e.to_string();
            if error_message.contains("NotFoundException") {
                Ok(SesStatusInfo {
                    verification_status: "not_found".to_string(),
                    dkim_status: "unknown".to_string(),
                    identity_type: "unknown".to_string(),
                    error: Some("Identity not found in SES".to_string()),
                })
            } else {
                tracing::error!("Error checking SES verification status: {}", e);
                Ok(SesStatusInfo {
                    verification_status: "unknown".to_string(),
                    dkim_status: "unknown".to_string(),
                    identity_type: "unknown".to_string(),
                    error: Some("Failed to check SES status".to_string()),
                })
            }
        }
    }
}

fn map_ses_status_to_internal(ses_status: &str) -> Option<VerificationStatus> {
    match ses_status {
        "success" => Some(VerificationStatus::Verified),
        "failed" => Some(VerificationStatus::Failed),
        "pending" => Some(VerificationStatus::Pending),
        "not_found" => None,
        _ => None,
    }
}

async fn update_sender_verification_status(
    client: &DynamoDbClient,
    table_name: &str,
    tenant_id: &str,
    sender_id: &str,
    new_status: &VerificationStatus,
) -> Result<String, AppError> {
    let pk = tenant_id.to_string();
    let sk = KeyPatterns::sender(sender_id);
    let now = chrono::Utc::now().to_rfc3339();

    let status_str = match new_status {
        VerificationStatus::Verified => "verified",
        VerificationStatus::Failed => "failed",
        VerificationStatus::Pending => "pending",
        VerificationStatus::VerificationTimedOut => "verification_timed_out",
    };

    let mut update_expression =
        "SET verificationStatus = :status, updatedAt = :updatedAt".to_string();
    let mut expression_attribute_values = vec![
        (
            ":status".to_string(),
            aws_sdk_dynamodb::types::AttributeValue::S(status_str.to_string()),
        ),
        (
            ":updatedAt".to_string(),
            aws_sdk_dynamodb::types::AttributeValue::S(now.clone()),
        ),
    ];

    if *new_status == VerificationStatus::Verified {
        update_expression.push_str(", verifiedAt = :verifiedAt");
        expression_attribute_values.push((
            ":verifiedAt".to_string(),
            aws_sdk_dynamodb::types::AttributeValue::S(now.clone()),
        ));
    }

    client
        .update_item()
        .table_name(table_name)
        .key("pk", aws_sdk_dynamodb::types::AttributeValue::S(pk))
        .key("sk", aws_sdk_dynamodb::types::AttributeValue::S(sk))
        .update_expression(update_expression)
        .set_expression_attribute_values(Some(expression_attribute_values.into_iter().collect()))
        .condition_expression("attribute_exists(pk) AND attribute_exists(sk)")
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to update sender status: {}", e)))?;

    tracing::info!(
        "Updated sender verification status: tenantId={}, senderId={}, newStatus={:?}",
        tenant_id,
        sender_id,
        new_status
    );

    Ok(now)
}

async fn function_handler(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let path_params = event.path_parameters();
    let sender_id = path_params
        .first("senderId")
        .ok_or_else(|| AppError::BadRequest("Missing senderId parameter".to_string()))?;

    let table_name = env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not configured".to_string()))?;

    let config = aws_config::load_from_env().await;
    let ddb_client = DynamoDbClient::new(&config);
    let ses_client = SesClient::new(&config);

    let sender = get_sender_by_id(&ddb_client, &table_name, &tenant_id, sender_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Sender not found".to_string()))?;

    let mut updated_sender = sender.clone();
    let mut status_changed = false;
    let mut ses_status_info = None;
    let last_checked = chrono::Utc::now().to_rfc3339();

    if sender.verification_status != VerificationStatus::Verified {
        let ses_status = check_ses_verification_status(&ses_client, &sender.email).await?;

        if let Some(new_status) = map_ses_status_to_internal(&ses_status.verification_status) {
            if new_status != sender.verification_status {
                let updated_at = update_sender_verification_status(
                    &ddb_client,
                    &table_name,
                    &tenant_id,
                    sender_id,
                    &new_status,
                )
                .await?;

                updated_sender.verification_status = new_status.clone();
                updated_sender.updated_at = updated_at.clone();

                if new_status == VerificationStatus::Verified {
                    updated_sender.verified_at = Some(updated_at);
                }

                status_changed = true;
            }
        }

        ses_status_info = Some(ses_status);
    }

    response::format_response(
        200,
        GetSenderStatusResponse {
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
            emails_sent: updated_sender.emails_sent,
            last_sent_at: updated_sender.last_sent_at,
            status_changed,
            ses_status: ses_status_info,
            last_checked,
        },
    )
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
    fn test_map_ses_status_success_to_verified() {
        let result = map_ses_status_to_internal("success");
        assert_eq!(result, Some(VerificationStatus::Verified));
    }

    #[test]
    fn test_map_ses_status_failed_to_failed() {
        let result = map_ses_status_to_internal("failed");
        assert_eq!(result, Some(VerificationStatus::Failed));
    }

    #[test]
    fn test_map_ses_status_pending_to_pending() {
        let result = map_ses_status_to_internal("pending");
        assert_eq!(result, Some(VerificationStatus::Pending));
    }

    #[test]
    fn test_map_ses_status_not_found_to_none() {
        let result = map_ses_status_to_internal("not_found");
        assert_eq!(result, None);
    }

    #[test]
    fn test_map_ses_status_unknown_to_none() {
        let result = map_ses_status_to_internal("unknown");
        assert_eq!(result, None);
    }

    #[test]
    fn test_map_ses_status_empty_to_none() {
        let result = map_ses_status_to_internal("");
        assert_eq!(result, None);
    }

    #[test]
    fn test_already_verified_sender_skips_ses_check() {
        let response = GetSenderStatusResponse {
            sender_id: "abc-456".to_string(),
            email: "test@example.com".to_string(),
            name: Some("Test Sender".to_string()),
            verification_type: VerificationType::Mailbox,
            verification_status: VerificationStatus::Verified,
            is_default: true,
            domain: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            verified_at: Some("2024-01-01T00:05:00Z".to_string()),
            failure_reason: None,
            emails_sent: 42,
            last_sent_at: Some("2024-01-02T00:00:00Z".to_string()),
            status_changed: false,
            ses_status: None,
            last_checked: "2024-01-03T00:00:00Z".to_string(),
        };

        assert_eq!(response.verification_status, VerificationStatus::Verified);
        assert!(!response.status_changed);
        assert!(response.ses_status.is_none());
    }

    #[test]
    fn test_response_json_field_names() {
        let response = GetSenderStatusResponse {
            sender_id: "abc-456".to_string(),
            email: "test@example.com".to_string(),
            name: Some("Test".to_string()),
            verification_type: VerificationType::Mailbox,
            verification_status: VerificationStatus::Verified,
            is_default: true,
            domain: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            verified_at: Some("2024-01-01T00:05:00Z".to_string()),
            failure_reason: None,
            emails_sent: 5,
            last_sent_at: Some("2024-01-02T00:00:00Z".to_string()),
            status_changed: false,
            ses_status: None,
            last_checked: "2024-01-03T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert!(parsed.get("senderId").is_some());
        assert!(parsed.get("email").is_some());
        assert!(parsed.get("verificationType").is_some());
        assert!(parsed.get("verificationStatus").is_some());
        assert!(parsed.get("isDefault").is_some());
        assert!(parsed.get("createdAt").is_some());
        assert!(parsed.get("updatedAt").is_some());
        assert!(parsed.get("verifiedAt").is_some());
        assert!(parsed.get("emailsSent").is_some());
        assert!(parsed.get("lastSentAt").is_some());
        assert!(parsed.get("statusChanged").is_some());
        assert!(parsed.get("lastChecked").is_some());
    }

    #[test]
    fn test_ses_status_info_serialization() {
        let ses_status = SesStatusInfo {
            verification_status: "success".to_string(),
            dkim_status: "success".to_string(),
            identity_type: "email_address".to_string(),
            error: None,
        };

        let json = serde_json::to_string(&ses_status).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["verificationStatus"], "success");
        assert_eq!(parsed["dkimStatus"], "success");
        assert_eq!(parsed["identityType"], "email_address");
        assert!(parsed.get("error").is_none());
    }

    #[test]
    fn test_ses_status_info_with_error() {
        let ses_status = SesStatusInfo {
            verification_status: "not_found".to_string(),
            dkim_status: "unknown".to_string(),
            identity_type: "unknown".to_string(),
            error: Some("Identity not found in SES".to_string()),
        };

        let json = serde_json::to_string(&ses_status).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["verificationStatus"], "not_found");
        assert_eq!(parsed["error"], "Identity not found in SES");
    }
}
