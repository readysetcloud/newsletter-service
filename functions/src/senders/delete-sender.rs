use lambda_http::{run, service_fn, Body, Error, Request, RequestExt, Response};
use newsletter_lambdas::senders::{
    auth::get_user_context,
    aws_clients::{get_dynamodb_client, get_ses_client},
    error::AppError,
    response::{format_empty_response, format_error_response},
    types::{KeyPatterns, SenderRecord, VerificationStatus},
};
use serde_dynamo::from_item;

async fn function_handler(event: Request) -> Result<Response<Body>, Error> {
    match handle_request(event).await {
        Ok(response) => Ok(response),
        Err(e) => {
            tracing::error!(error = %e, "Request failed");
            Ok(format_error_response(&e))
        }
    }
}

async fn handle_request(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = get_user_context(&event)?;

    let tenant_id = user_context.tenant_id.as_ref().ok_or_else(|| {
        AppError::Unauthorized(String::from("A brand is required before deleting a sender"))
    })?;

    let sender_id = event
        .path_parameters_ref()
        .and_then(|params| params.first("senderId"))
        .ok_or_else(|| AppError::BadRequest(String::from("Sender Id is required")))?;

    let existing_sender = get_sender_by_id(tenant_id, sender_id).await?;

    if let Err(e) = cleanup_ses_identity(&existing_sender, tenant_id).await {
        tracing::error!(error = %e, "SES cleanup failed (continuing with deletion)");
    }

    if existing_sender.is_default {
        if let Err(e) = reassign_default_sender(tenant_id, sender_id).await {
            tracing::error!(error = %e, "Failed to reassign default sender");
        }
    }

    delete_sender_from_db(tenant_id, sender_id).await?;

    format_empty_response(204)
}

async fn get_sender_by_id(tenant_id: &str, sender_id: &str) -> Result<SenderRecord, AppError> {
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError(String::from("TABLE_NAME not configured")))?;

    let client = get_dynamodb_client().await;

    let result = client
        .get_item()
        .table_name(table_name)
        .key(
            "pk",
            aws_sdk_dynamodb::types::AttributeValue::S(tenant_id.to_string()),
        )
        .key(
            "sk",
            aws_sdk_dynamodb::types::AttributeValue::S(KeyPatterns::sender(sender_id)),
        )
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB GetItem failed: {}", e)))?;

    let item = result
        .item
        .ok_or_else(|| AppError::NotFound(String::from("Sender not found")))?;

    from_item(item)
        .map_err(|e| AppError::InternalError(format!("Failed to deserialize sender: {}", e)))
}

async fn cleanup_ses_identity(sender: &SenderRecord, tenant_id: &str) -> Result<(), AppError> {
    let identity = match sender.verification_type {
        newsletter_lambdas::senders::types::VerificationType::Domain => {
            sender.domain.as_ref().ok_or_else(|| {
                AppError::InternalError(String::from("Domain sender missing domain field"))
            })?
        }
        newsletter_lambdas::senders::types::VerificationType::Mailbox => &sender.email,
    };

    let resource_arn_prefix = std::env::var("RESOURCE_ARN_PREFIX")
        .map_err(|_| AppError::InternalError(String::from("RESOURCE_ARN_PREFIX not configured")))?;

    let client = get_ses_client().await;

    let resource_arn = format!("{}{}", resource_arn_prefix, identity);

    if let Err(e) = client
        .delete_tenant_resource_association()
        .tenant_name(tenant_id)
        .resource_arn(&resource_arn)
        .send()
        .await
    {
        tracing::warn!(
            error = ?e,
            error_message = %e,
            identity = %identity,
            tenant_id = %tenant_id,
            resource_arn = %resource_arn,
            "Failed to delete tenant resource association (continuing)"
        );
    }

    if let Err(e) = client
        .delete_email_identity()
        .email_identity(identity)
        .send()
        .await
    {
        tracing::warn!(
            error = ?e,
            error_message = %e,
            identity = %identity,
            "Failed to delete SES identity (continuing)"
        );
    } else {
        tracing::info!(identity = %identity, "Cleaned up SES identity");
    }

    Ok(())
}

async fn reassign_default_sender(tenant_id: &str, deleted_sender_id: &str) -> Result<(), AppError> {
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError(String::from("TABLE_NAME not configured")))?;

    let client = get_dynamodb_client().await;

    let result = client
        .query()
        .table_name(&table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :pk")
        .expression_attribute_values(
            ":pk",
            aws_sdk_dynamodb::types::AttributeValue::S(KeyPatterns::sender_gsi1pk(tenant_id)),
        )
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB Query failed: {}", e)))?;

    let items = result.items.unwrap_or_default();
    if items.is_empty() {
        return Ok(());
    }

    let remaining_senders: Vec<SenderRecord> = items
        .into_iter()
        .filter_map(|item| from_item(item).ok())
        .filter(|sender: &SenderRecord| sender.sender_id != deleted_sender_id)
        .collect();

    if remaining_senders.is_empty() {
        return Ok(());
    }

    let new_default_sender = remaining_senders
        .iter()
        .find(|sender| sender.verification_status == VerificationStatus::Verified)
        .or_else(|| remaining_senders.first())
        .ok_or_else(|| AppError::InternalError(String::from("No remaining senders found")))?;

    let updated_at = chrono::Utc::now().to_rfc3339();

    client
        .update_item()
        .table_name(table_name)
        .key(
            "pk",
            aws_sdk_dynamodb::types::AttributeValue::S(tenant_id.to_string()),
        )
        .key(
            "sk",
            aws_sdk_dynamodb::types::AttributeValue::S(KeyPatterns::sender(
                &new_default_sender.sender_id,
            )),
        )
        .update_expression("SET isDefault = :def, updatedAt = :upd")
        .expression_attribute_values(":def", aws_sdk_dynamodb::types::AttributeValue::Bool(true))
        .expression_attribute_values(
            ":upd",
            aws_sdk_dynamodb::types::AttributeValue::S(updated_at),
        )
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to update default sender: {}", e)))?;

    tracing::info!(email = %new_default_sender.email, "Reassigned default sender");

    Ok(())
}

async fn delete_sender_from_db(tenant_id: &str, sender_id: &str) -> Result<(), AppError> {
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError(String::from("TABLE_NAME not configured")))?;

    let client = get_dynamodb_client().await;

    client
        .delete_item()
        .table_name(table_name)
        .key(
            "pk",
            aws_sdk_dynamodb::types::AttributeValue::S(tenant_id.to_string()),
        )
        .key(
            "sk",
            aws_sdk_dynamodb::types::AttributeValue::S(KeyPatterns::sender(sender_id)),
        )
        .condition_expression("attribute_exists(pk) AND attribute_exists(sk)")
        .send()
        .await
        .map_err(|e| {
            if e.to_string().contains("ConditionalCheckFailed") {
                AppError::NotFound(String::from("Sender not found"))
            } else {
                AppError::AwsError(format!("DynamoDB DeleteItem failed: {}", e))
            }
        })?;

    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    run(service_fn(function_handler)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use newsletter_lambdas::senders::types::{VerificationStatus, VerificationType};

    fn create_test_sender(
        sender_id: &str,
        is_default: bool,
        verification_type: VerificationType,
    ) -> SenderRecord {
        let now = chrono::Utc::now().to_rfc3339();
        let domain = if matches!(verification_type, VerificationType::Domain) {
            Some(String::from("example.com"))
        } else {
            None
        };

        SenderRecord {
            pk: String::from("test-tenant"),
            sk: KeyPatterns::sender(sender_id),
            gsi1pk: KeyPatterns::sender_gsi1pk("test-tenant"),
            gsi1sk: now.clone(),
            sender_id: sender_id.to_string(),
            tenant_id: String::from("test-tenant"),
            email: format!("{}@example.com", sender_id),
            name: Some(String::from("Test Sender")),
            verification_type,
            verification_status: VerificationStatus::Verified,
            is_default,
            domain,
            ses_identity_arn: Some(String::from(
                "arn:aws:ses:us-east-1:123456789012:identity/example.com",
            )),
            created_at: now.clone(),
            updated_at: now.clone(),
            verified_at: Some(now),
            failure_reason: None,
            last_verification_sent: None,
            emails_sent: 0,
            last_sent_at: None,
        }
    }

    #[test]
    fn test_key_patterns_sender() {
        let pattern = KeyPatterns::sender("abc-123");
        assert_eq!(pattern, "sender#abc-123");
    }

    #[test]
    fn test_create_mailbox_sender() {
        let sender = create_test_sender("test-1", true, VerificationType::Mailbox);
        assert_eq!(sender.sender_id, "test-1");
        assert_eq!(sender.email, "test-1@example.com");
        assert!(sender.is_default);
        assert!(matches!(
            sender.verification_type,
            VerificationType::Mailbox
        ));
        assert!(sender.domain.is_none());
    }

    #[test]
    fn test_create_domain_sender() {
        let sender = create_test_sender("test-2", false, VerificationType::Domain);
        assert_eq!(sender.sender_id, "test-2");
        assert!(!sender.is_default);
        assert!(matches!(sender.verification_type, VerificationType::Domain));
        assert_eq!(sender.domain, Some(String::from("example.com")));
    }

    #[test]
    fn test_sender_verification_status() {
        let sender = create_test_sender("test-3", false, VerificationType::Mailbox);
        assert_eq!(sender.verification_status, VerificationStatus::Verified);
        assert!(sender.verified_at.is_some());
    }

    #[test]
    fn test_sender_serialization() {
        let sender = create_test_sender("test-4", true, VerificationType::Mailbox);
        let json = serde_json::to_string(&sender).unwrap();
        assert!(json.contains("senderId"));
        assert!(json.contains("tenantId"));
        assert!(json.contains("isDefault"));
        assert!(json.contains("verificationType"));
    }

    #[test]
    fn test_sender_deserialization() {
        let sender = create_test_sender("test-5", false, VerificationType::Domain);
        let json = serde_json::to_string(&sender).unwrap();
        let deserialized: SenderRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.sender_id, sender.sender_id);
        assert_eq!(deserialized.email, sender.email);
        assert_eq!(deserialized.is_default, sender.is_default);
    }

    #[test]
    fn test_gsi1pk_format() {
        let sender = create_test_sender("test-6", true, VerificationType::Mailbox);
        assert_eq!(sender.gsi1pk, "sender#test-tenant");
    }

    #[test]
    fn test_sk_format() {
        let sender = create_test_sender("test-7", false, VerificationType::Mailbox);
        assert_eq!(sender.sk, "sender#test-7");
    }

    #[test]
    fn test_emails_sent_default() {
        let sender = create_test_sender("test-9", false, VerificationType::Mailbox);
        assert_eq!(sender.emails_sent, 0);
    }
}
