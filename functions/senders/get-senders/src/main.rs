use aws_sdk_dynamodb::Client as DynamoDbClient;
use lambda_http::{run, service_fn, Body, Error, Request, Response};
use senders_shared::{auth, error::AppError, response, types::*};
use serde::{Deserialize, Serialize};
use serde_dynamo::from_item;
use std::env;

#[derive(Debug, Serialize)]
struct GetSendersResponse {
    senders: Vec<SenderResponse>,
    #[serde(rename = "tierLimits")]
    tier_limits: TierLimits,
}

#[derive(Debug, Serialize, Deserialize)]
struct SenderResponse {
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
}

impl From<SenderRecord> for SenderResponse {
    fn from(sender: SenderRecord) -> Self {
        SenderResponse {
            sender_id: sender.sender_id,
            email: sender.email,
            name: sender.name,
            verification_type: sender.verification_type,
            verification_status: sender.verification_status,
            is_default: sender.is_default,
            domain: sender.domain,
            created_at: sender.created_at,
            updated_at: sender.updated_at,
            verified_at: sender.verified_at,
            failure_reason: sender.failure_reason,
            emails_sent: sender.emails_sent,
            last_sent_at: sender.last_sent_at,
        }
    }
}

async fn get_senders_by_tenant(
    client: &DynamoDbClient,
    table_name: &str,
    tenant_id: &str,
) -> Result<Vec<SenderRecord>, AppError> {
    let gsi1pk = KeyPatterns::sender_gsi1pk(tenant_id);

    let result = client
        .query()
        .table_name(table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :gsi1pk")
        .expression_attribute_values(
            ":gsi1pk",
            aws_sdk_dynamodb::types::AttributeValue::S(gsi1pk),
        )
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to query senders: {}", e)))?;

    let senders = result
        .items()
        .iter()
        .filter_map(|item| {
            from_item::<_, SenderRecord>(item.clone())
                .map_err(|e| {
                    tracing::error!("Failed to deserialize sender record: {}", e);
                    e
                })
                .ok()
        })
        .collect();

    Ok(senders)
}

async fn function_handler(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let tier = user_context.tier.unwrap_or_else(|| "free-tier".to_string());

    let table_name = env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not configured".to_string()))?;

    let config = aws_config::load_from_env().await;
    let client = DynamoDbClient::new(&config);

    let senders = get_senders_by_tenant(&client, &table_name, &tenant_id).await?;

    let tier_limits = get_tier_limits(&tier, senders.len());

    let sender_responses: Vec<SenderResponse> =
        senders.into_iter().map(SenderResponse::from).collect();

    response::format_response(
        200,
        GetSendersResponse {
            senders: sender_responses,
            tier_limits,
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
    fn test_sender_response_from_sender_record() {
        let sender_record = SenderRecord {
            pk: "tenant-123".to_string(),
            sk: "sender#abc-456".to_string(),
            gsi1pk: "sender#tenant-123".to_string(),
            gsi1sk: "test@example.com".to_string(),
            sender_id: "abc-456".to_string(),
            tenant_id: "tenant-123".to_string(),
            email: "test@example.com".to_string(),
            name: Some("Test Sender".to_string()),
            verification_type: VerificationType::Mailbox,
            verification_status: VerificationStatus::Verified,
            is_default: true,
            domain: None,
            ses_identity_arn: Some(
                "arn:aws:ses:us-east-1:123456789012:identity/test@example.com".to_string(),
            ),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            verified_at: Some("2024-01-01T00:05:00Z".to_string()),
            failure_reason: None,
            last_verification_sent: Some("2024-01-01T00:00:00Z".to_string()),
            emails_sent: 42,
            last_sent_at: Some("2024-01-02T00:00:00Z".to_string()),
        };

        let response = SenderResponse::from(sender_record);

        assert_eq!(response.sender_id, "abc-456");
        assert_eq!(response.email, "test@example.com");
        assert_eq!(response.name, Some("Test Sender".to_string()));
        assert!(response.is_default);
        assert_eq!(response.emails_sent, 42);
        assert_eq!(
            response.verified_at,
            Some("2024-01-01T00:05:00Z".to_string())
        );
    }

    #[test]
    fn test_empty_sender_list_response_structure() {
        let senders: Vec<SenderRecord> = vec![];
        let tier_limits = get_tier_limits("free-tier", senders.len());

        let sender_responses: Vec<SenderResponse> =
            senders.into_iter().map(SenderResponse::from).collect();

        let response = GetSendersResponse {
            senders: sender_responses,
            tier_limits,
        };

        assert_eq!(response.senders.len(), 0);
        assert_eq!(response.tier_limits.tier, "free-tier");
        assert_eq!(response.tier_limits.current_count, 0);
        assert_eq!(response.tier_limits.max_senders, 1);
    }

    #[test]
    fn test_empty_sender_list_serialization() {
        let response = GetSendersResponse {
            senders: vec![],
            tier_limits: get_tier_limits("free-tier", 0),
        };

        let json = serde_json::to_string(&response).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert!(parsed["senders"].is_array());
        assert_eq!(parsed["senders"].as_array().unwrap().len(), 0);
        assert_eq!(parsed["tierLimits"]["tier"], "free-tier");
        assert_eq!(parsed["tierLimits"]["currentCount"], 0);
        assert_eq!(parsed["tierLimits"]["maxSenders"], 1);
    }

    #[test]
    fn test_response_structure_with_multiple_senders() {
        let sender1 = SenderRecord {
            pk: "tenant-123".to_string(),
            sk: "sender#abc-456".to_string(),
            gsi1pk: "sender#tenant-123".to_string(),
            gsi1sk: "test1@example.com".to_string(),
            sender_id: "abc-456".to_string(),
            tenant_id: "tenant-123".to_string(),
            email: "test1@example.com".to_string(),
            name: Some("Test Sender 1".to_string()),
            verification_type: VerificationType::Mailbox,
            verification_status: VerificationStatus::Verified,
            is_default: true,
            domain: None,
            ses_identity_arn: Some(
                "arn:aws:ses:us-east-1:123456789012:identity/test1@example.com".to_string(),
            ),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            verified_at: Some("2024-01-01T00:05:00Z".to_string()),
            failure_reason: None,
            last_verification_sent: Some("2024-01-01T00:00:00Z".to_string()),
            emails_sent: 10,
            last_sent_at: Some("2024-01-02T00:00:00Z".to_string()),
        };

        let sender2 = SenderRecord {
            pk: "tenant-123".to_string(),
            sk: "sender#def-789".to_string(),
            gsi1pk: "sender#tenant-123".to_string(),
            gsi1sk: "test2@example.com".to_string(),
            sender_id: "def-789".to_string(),
            tenant_id: "tenant-123".to_string(),
            email: "test2@example.com".to_string(),
            name: None,
            verification_type: VerificationType::Domain,
            verification_status: VerificationStatus::Pending,
            is_default: false,
            domain: Some("example.com".to_string()),
            ses_identity_arn: None,
            created_at: "2024-01-02T00:00:00Z".to_string(),
            updated_at: "2024-01-02T00:00:00Z".to_string(),
            verified_at: None,
            failure_reason: None,
            last_verification_sent: None,
            emails_sent: 0,
            last_sent_at: None,
        };

        let senders = vec![sender1, sender2];
        let tier_limits = get_tier_limits("creator-tier", senders.len());

        let sender_responses: Vec<SenderResponse> =
            senders.into_iter().map(SenderResponse::from).collect();

        let response = GetSendersResponse {
            senders: sender_responses,
            tier_limits,
        };

        assert_eq!(response.senders.len(), 2);
        assert_eq!(response.tier_limits.tier, "creator-tier");
        assert_eq!(response.tier_limits.current_count, 2);
        assert_eq!(response.tier_limits.max_senders, 2);
        assert!(response.tier_limits.can_use_dns);
    }

    #[test]
    fn test_response_json_field_names() {
        let sender = SenderRecord {
            pk: "tenant-123".to_string(),
            sk: "sender#abc-456".to_string(),
            gsi1pk: "sender#tenant-123".to_string(),
            gsi1sk: "test@example.com".to_string(),
            sender_id: "abc-456".to_string(),
            tenant_id: "tenant-123".to_string(),
            email: "test@example.com".to_string(),
            name: Some("Test".to_string()),
            verification_type: VerificationType::Mailbox,
            verification_status: VerificationStatus::Verified,
            is_default: true,
            domain: None,
            ses_identity_arn: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            verified_at: Some("2024-01-01T00:05:00Z".to_string()),
            failure_reason: None,
            last_verification_sent: None,
            emails_sent: 5,
            last_sent_at: Some("2024-01-02T00:00:00Z".to_string()),
        };

        let response = GetSendersResponse {
            senders: vec![SenderResponse::from(sender)],
            tier_limits: get_tier_limits("free-tier", 1),
        };

        let json = serde_json::to_string(&response).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert!(parsed["senders"].is_array());
        let sender_json = &parsed["senders"][0];

        assert!(sender_json.get("senderId").is_some());
        assert!(sender_json.get("email").is_some());
        assert!(sender_json.get("verificationType").is_some());
        assert!(sender_json.get("verificationStatus").is_some());
        assert!(sender_json.get("isDefault").is_some());
        assert!(sender_json.get("createdAt").is_some());
        assert!(sender_json.get("updatedAt").is_some());
        assert!(sender_json.get("verifiedAt").is_some());
        assert!(sender_json.get("emailsSent").is_some());
        assert!(sender_json.get("lastSentAt").is_some());

        assert!(parsed["tierLimits"].get("tier").is_some());
        assert!(parsed["tierLimits"].get("maxSenders").is_some());
        assert!(parsed["tierLimits"].get("currentCount").is_some());
        assert!(parsed["tierLimits"].get("canUseDNS").is_some());
        assert!(parsed["tierLimits"].get("canUseMailbox").is_some());
    }

    #[test]
    fn test_response_optional_fields_omitted() {
        let sender = SenderRecord {
            pk: "tenant-123".to_string(),
            sk: "sender#abc-456".to_string(),
            gsi1pk: "sender#tenant-123".to_string(),
            gsi1sk: "test@example.com".to_string(),
            sender_id: "abc-456".to_string(),
            tenant_id: "tenant-123".to_string(),
            email: "test@example.com".to_string(),
            name: None,
            verification_type: VerificationType::Mailbox,
            verification_status: VerificationStatus::Pending,
            is_default: false,
            domain: None,
            ses_identity_arn: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            verified_at: None,
            failure_reason: None,
            last_verification_sent: None,
            emails_sent: 0,
            last_sent_at: None,
        };

        let response = SenderResponse::from(sender);
        let json = serde_json::to_string(&response).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert!(parsed.get("name").is_none());
        assert!(parsed.get("domain").is_none());
        assert!(parsed.get("verifiedAt").is_none());
        assert!(parsed.get("failureReason").is_none());
        assert!(parsed.get("lastSentAt").is_none());
    }
}
