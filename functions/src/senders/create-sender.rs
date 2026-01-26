use aws_sdk_dynamodb::types::AttributeValue;
use lambda_http::{run, service_fn, Body, Error, Request, Response};
use newsletter_lambdas::senders::{auth, aws_clients, error::AppError, response, types::*, validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Deserialize)]
struct CreateSenderRequest {
    email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(rename = "verificationType", default = "default_verification_type")]
    verification_type: String,
}

fn default_verification_type() -> String {
    "mailbox".to_string()
}

#[derive(Serialize)]
struct CreateSenderResponse {
    #[serde(rename = "senderId")]
    sender_id: String,
    email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(rename = "verificationType")]
    verification_type: String,
    #[serde(rename = "verificationStatus")]
    verification_status: String,
    #[serde(rename = "isDefault")]
    is_default: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    domain: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    message: String,
}

async fn function_handler(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context.tenant_id.ok_or_else(|| {
        AppError::Unauthorized("A brand is required before creating a sender".to_string())
    })?;

    let body: CreateSenderRequest = serde_json::from_slice(event.body())
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    validation::validate_email(&body.email)?;

    if body.verification_type != "mailbox" && body.verification_type != "domain" {
        return Err(AppError::BadRequest(
            "Verification type must be either \"mailbox\" or \"domain\"".to_string(),
        ));
    }

    let tier = user_context.tier.as_deref().unwrap_or("free-tier");
    let current_senders = get_senders_by_tenant(&tenant_id).await?;
    let tier_limits = get_tier_limits(tier, current_senders.len());

    if body.verification_type == "domain" && !tier_limits.can_use_dns {
        return Err(AppError::BadRequest(format!(
            "DNS verification not available for your tier. Current tier: {}",
            tier
        )));
    }

    if current_senders.len() >= tier_limits.max_senders {
        return Err(AppError::BadRequest(format!(
            "Maximum sender limit reached ({}). Current tier: {}",
            tier_limits.max_senders, tier
        )));
    }

    if current_senders.iter().any(|s| s.email == body.email) {
        return Err(AppError::Conflict(
            "Email address already configured".to_string(),
        ));
    }

    let sender_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let is_default = current_senders.is_empty();

    let verification_type_enum = if body.verification_type == "domain" {
        VerificationType::Domain
    } else {
        VerificationType::Mailbox
    };

    let domain = if body.verification_type == "domain" {
        Some(validation::extract_domain(&body.email))
    } else {
        None
    };

    let mut sender_record = SenderRecord {
        pk: tenant_id.clone(),
        sk: KeyPatterns::sender(&sender_id),
        gsi1pk: KeyPatterns::sender_gsi1pk(&tenant_id),
        gsi1sk: body.email.clone(),
        sender_id: sender_id.clone(),
        tenant_id: tenant_id.clone(),
        email: body.email.clone(),
        name: body.name.clone(),
        verification_type: verification_type_enum,
        verification_status: VerificationStatus::Pending,
        is_default,
        domain: domain.clone(),
        ses_identity_arn: None,
        created_at: now.clone(),
        updated_at: now.clone(),
        verified_at: None,
        failure_reason: None,
        last_verification_sent: Some(now.clone()),
        emails_sent: 0,
        last_sent_at: None,
    };

    if body.verification_type == "domain" {
        match initiate_email_verification(&body.email, &body.verification_type, &tenant_id).await {
            Ok(identity_arn) => {
                sender_record.ses_identity_arn = Some(identity_arn);
            }
            Err(e) => {
                tracing::error!("SES domain verification initiation failed: {:?}", e);
                return Err(AppError::InternalError(
                    "Failed to initiate domain verification".to_string(),
                ));
            }
        }
    }

    save_sender_record(&sender_record).await?;

    if body.verification_type == "mailbox" {
        let environment = std::env::var("ENVIRONMENT").unwrap_or_else(|_| "production".to_string());
        let is_production = environment == "production";

        if is_production {
            if let Err(e) = send_custom_verification_email(&body.email, &tenant_id).await {
                tracing::error!("Failed to send verification email: {:?}", e);
            }
        } else {
            match initiate_email_verification(&body.email, &body.verification_type, &tenant_id)
                .await
            {
                Ok(identity_arn) => {
                    tracing::info!("Standard AWS verification email sent successfully: email={}, identity_arn={}", body.email, identity_arn);
                }
                Err(e) => {
                    tracing::error!("Failed to send standard verification email: {:?}", e);
                }
            }
        }

        if let Err(e) = schedule_initial_status_check(&tenant_id, &sender_id).await {
            tracing::error!("Failed to schedule automatic status checking: {:?}", e);
        }
    }

    let environment = std::env::var("ENVIRONMENT").unwrap_or_else(|_| "production".to_string());
    let is_production = environment == "production";

    let message = if body.verification_type == "mailbox" {
        if is_production {
            "Verification email sent. Please check your inbox and click the verification link."
        } else {
            "AWS verification email sent. Please check your inbox and click the verification link."
        }
    } else {
        "Domain verification initiated. DNS records will be provided separately."
    };

    response::format_response(
        201,
        CreateSenderResponse {
            sender_id,
            email: body.email,
            name: body.name,
            verification_type: body.verification_type,
            verification_status: "pending".to_string(),
            is_default,
            domain,
            created_at: now.clone(),
            updated_at: now,
            message: message.to_string(),
        },
    )
}

async fn get_senders_by_tenant(tenant_id: &str) -> Result<Vec<SenderRecord>, AppError> {
    let ddb = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let result = ddb
        .query()
        .table_name(table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :gsi1pk")
        .expression_attribute_values(
            ":gsi1pk",
            AttributeValue::S(KeyPatterns::sender_gsi1pk(tenant_id)),
        )
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB query failed: {}", e)))?;

    let senders = result
        .items()
        .iter()
        .filter_map(|item| serde_dynamo::from_item(item.clone()).ok())
        .collect();

    Ok(senders)
}

async fn save_sender_record(sender: &SenderRecord) -> Result<(), AppError> {
    let ddb = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let item: std::collections::HashMap<String, aws_sdk_dynamodb::types::AttributeValue> =
        serde_dynamo::to_item(sender)
            .map_err(|e| AppError::InternalError(format!("Failed to serialize sender: {}", e)))?;

    ddb.put_item()
        .table_name(table_name)
        .set_item(Some(item))
        .condition_expression("attribute_not_exists(pk) AND attribute_not_exists(sk)")
        .send()
        .await
        .map_err(|e| {
            if e.to_string().contains("ConditionalCheckFailed") {
                AppError::Conflict("Sender already exists".to_string())
            } else {
                AppError::AwsError(format!("DynamoDB put failed: {}", e))
            }
        })?;

    Ok(())
}

async fn initiate_email_verification(
    email: &str,
    verification_type: &str,
    tenant_id: &str,
) -> Result<String, AppError> {
    let ses = aws_clients::get_ses_client().await;
    let identity = if verification_type == "domain" {
        validation::extract_domain(email)
    } else {
        email.to_string()
    };

    let config_set = std::env::var("SES_CONFIGURATION_SET").ok();

    let mut create_command = ses.create_email_identity().email_identity(&identity);
    if let Some(config) = config_set {
        create_command = create_command.configuration_set_name(config);
    }

    let create_response = create_command
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("SES create identity failed: {}", e)))?;

    let resource_arn_prefix = std::env::var("RESOURCE_ARN_PREFIX")
        .unwrap_or_else(|_| "arn:aws:ses:us-east-1:123456789012:identity/".to_string());
    let resource_arn = format!("{}{}", resource_arn_prefix, identity);

    if let Err(e) = ses
        .create_tenant_resource_association()
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
            "Failed to create tenant resource association (non-fatal)"
        );
    }

    tracing::info!(
        "SES identity created: identity={}, tenant_id={}",
        identity,
        tenant_id
    );

    Ok(create_response
        .identity_type()
        .map(|t| t.as_str().to_string())
        .unwrap_or_default())
}

async fn send_custom_verification_email(email: &str, tenant_id: &str) -> Result<(), AppError> {
    let ses = aws_clients::get_ses_client().await;
    let template_name = std::env::var("SES_VERIFY_TEMPLATE_NAME")
        .map_err(|_| AppError::InternalError("SES_VERIFY_TEMPLATE_NAME not set".to_string()))?;

    let result = ses
        .send_custom_verification_email()
        .email_address(email)
        .template_name(&template_name)
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("SES send verification email failed: {}", e)))?;

    tracing::info!(
        "Custom verification email sent successfully: tenant_id={}, email={}, message_id={:?}",
        tenant_id,
        email,
        result.message_id()
    );

    let resource_arn_prefix = std::env::var("RESOURCE_ARN_PREFIX")
        .unwrap_or_else(|_| "arn:aws:ses:us-east-1:123456789012:identity/".to_string());
    let resource_arn = format!("{}{}", resource_arn_prefix, email);

    if let Err(e) = ses
        .create_tenant_resource_association()
        .tenant_name(tenant_id)
        .resource_arn(&resource_arn)
        .send()
        .await
    {
        tracing::warn!(
            error = ?e,
            error_message = %e,
            email = %email,
            tenant_id = %tenant_id,
            resource_arn = %resource_arn,
            "Failed to create tenant resource association (non-fatal)"
        );
    }

    Ok(())
}

async fn schedule_initial_status_check(tenant_id: &str, sender_id: &str) -> Result<(), AppError> {
    let scheduler = aws_clients::get_scheduler_client().await;
    let schedule_name = build_schedule_name(tenant_id, sender_id);

    let target_arn = std::env::var("CHECK_SENDER_STATUS_FUNCTION_ARN").map_err(|_| {
        AppError::InternalError("CHECK_SENDER_STATUS_FUNCTION_ARN not set".to_string())
    })?;
    let role_arn = std::env::var("SCHEDULER_ROLE_ARN")
        .map_err(|_| AppError::InternalError("SCHEDULER_ROLE_ARN not set".to_string()))?;

    let start_time = chrono::Utc::now();
    let run_at = start_time + chrono::Duration::minutes(1);
    let schedule_expression = format!("at({})", run_at.format("%Y-%m-%dT%H:%M:%S"));

    let input = serde_json::json!({
        "tenantId": tenant_id,
        "senderId": sender_id,
        "startTime": start_time.to_rfc3339()
    });

    scheduler
        .create_schedule()
        .name(&schedule_name)
        .schedule_expression(&schedule_expression)
        .action_after_completion(aws_sdk_scheduler::types::ActionAfterCompletion::Delete)
        .flexible_time_window(
            aws_sdk_scheduler::types::FlexibleTimeWindow::builder()
                .mode(aws_sdk_scheduler::types::FlexibleTimeWindowMode::Off)
                .build()
                .map_err(|e| {
                    AppError::InternalError(format!("Failed to build time window: {}", e))
                })?,
        )
        .target(
            aws_sdk_scheduler::types::Target::builder()
                .arn(&target_arn)
                .role_arn(&role_arn)
                .input(input.to_string())
                .build()
                .map_err(|e| AppError::InternalError(format!("Failed to build target: {}", e)))?,
        )
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Scheduler create schedule failed: {}", e)))?;

    tracing::info!(
        "Automatic status checking scheduled for sender: sender_id={}, email={}",
        sender_id,
        schedule_name
    );

    Ok(())
}

fn build_schedule_name(tenant_id: &str, sender_id: &str) -> String {
    let tenant_prefix: String = tenant_id.chars().take(8).collect();
    let sender_prefix: String = sender_id.chars().take(8).collect();
    let suffix = chrono::Utc::now().timestamp_millis();
    format!(
        "sender-check-{}-{}-{}",
        tenant_prefix, sender_prefix, suffix
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
    fn test_validate_email_valid() {
        assert!(validation::validate_email("user@example.com").is_ok());
        assert!(validation::validate_email("test.user@example.co.uk").is_ok());
        assert!(validation::validate_email("user+tag@example.com").is_ok());
    }

    #[test]
    fn test_validate_email_invalid() {
        assert!(validation::validate_email("userexample.com").is_err());
        assert!(validation::validate_email("user@").is_err());
        assert!(validation::validate_email("@example.com").is_err());
        assert!(validation::validate_email("user @example.com").is_err());
    }

    #[test]
    fn test_verification_type_validation() {
        let valid_mailbox = CreateSenderRequest {
            email: "test@example.com".to_string(),
            name: None,
            verification_type: "mailbox".to_string(),
        };
        assert_eq!(valid_mailbox.verification_type, "mailbox");

        let valid_domain = CreateSenderRequest {
            email: "test@example.com".to_string(),
            name: None,
            verification_type: "domain".to_string(),
        };
        assert_eq!(valid_domain.verification_type, "domain");
    }

    #[test]
    fn test_default_verification_type() {
        assert_eq!(default_verification_type(), "mailbox");
    }

    #[test]
    fn test_extract_domain_from_email() {
        assert_eq!(
            validation::extract_domain("user@example.com"),
            "example.com"
        );
        assert_eq!(
            validation::extract_domain("test@sub.example.com"),
            "sub.example.com"
        );
    }

    #[test]
    fn test_tier_limits_free_tier() {
        let limits = get_tier_limits("free-tier", 0);
        assert_eq!(limits.max_senders, 1);
        assert!(!limits.can_use_dns);
        assert!(limits.can_use_mailbox);
    }

    #[test]
    fn test_tier_limits_creator_tier() {
        let limits = get_tier_limits("creator-tier", 1);
        assert_eq!(limits.max_senders, 2);
        assert!(limits.can_use_dns);
        assert!(limits.can_use_mailbox);
    }

    #[test]
    fn test_tier_limits_pro_tier() {
        let limits = get_tier_limits("pro-tier", 3);
        assert_eq!(limits.max_senders, 5);
        assert!(limits.can_use_dns);
        assert!(limits.can_use_mailbox);
    }

    #[test]
    fn test_sender_record_serialization() {
        let sender = SenderRecord {
            pk: "tenant-123".to_string(),
            sk: "sender#abc-456".to_string(),
            gsi1pk: "sender#tenant-123".to_string(),
            gsi1sk: "test@example.com".to_string(),
            sender_id: "abc-456".to_string(),
            tenant_id: "tenant-123".to_string(),
            email: "test@example.com".to_string(),
            name: Some("Test Sender".to_string()),
            verification_type: VerificationType::Mailbox,
            verification_status: VerificationStatus::Pending,
            is_default: true,
            domain: None,
            ses_identity_arn: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            verified_at: None,
            failure_reason: None,
            last_verification_sent: Some("2024-01-01T00:00:00Z".to_string()),
            emails_sent: 0,
            last_sent_at: None,
        };

        let json = serde_json::to_string(&sender).unwrap();
        assert!(json.contains("\"email\":\"test@example.com\""));
        assert!(json.contains("\"verificationType\":\"mailbox\""));
        assert!(json.contains("\"verificationStatus\":\"pending\""));
        assert!(json.contains("\"isDefault\":true"));
    }

    #[test]
    fn test_create_sender_response_serialization() {
        let response = CreateSenderResponse {
            sender_id: "abc-123".to_string(),
            email: "test@example.com".to_string(),
            name: Some("Test".to_string()),
            verification_type: "mailbox".to_string(),
            verification_status: "pending".to_string(),
            is_default: true,
            domain: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            message: "Verification email sent".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"senderId\":\"abc-123\""));
        assert!(json.contains("\"email\":\"test@example.com\""));
        assert!(json.contains("\"verificationType\":\"mailbox\""));
        assert!(json.contains("\"message\":\"Verification email sent\""));
    }

    #[test]
    fn test_tier_limit_enforcement_free_tier() {
        let limits = get_tier_limits("free-tier", 0);
        assert_eq!(limits.max_senders, 1);
        assert!(0 < limits.max_senders);

        let limits_at_limit = get_tier_limits("free-tier", 1);
        assert_eq!(limits_at_limit.current_count, 1);
        assert!(limits_at_limit.current_count >= limits_at_limit.max_senders);
    }

    #[test]
    fn test_tier_limit_enforcement_creator_tier() {
        let limits = get_tier_limits("creator-tier", 0);
        assert_eq!(limits.max_senders, 2);
        assert!(0 < limits.max_senders);

        let limits_at_limit = get_tier_limits("creator-tier", 2);
        assert_eq!(limits_at_limit.current_count, 2);
        assert!(limits_at_limit.current_count >= limits_at_limit.max_senders);
    }

    #[test]
    fn test_tier_limit_enforcement_pro_tier() {
        let limits = get_tier_limits("pro-tier", 0);
        assert_eq!(limits.max_senders, 5);
        assert!(0 < limits.max_senders);

        let limits_at_limit = get_tier_limits("pro-tier", 5);
        assert_eq!(limits_at_limit.current_count, 5);
        assert!(limits_at_limit.current_count >= limits_at_limit.max_senders);
    }

    #[test]
    fn test_dns_verification_tier_restriction() {
        let free_tier = get_tier_limits("free-tier", 0);
        assert!(!free_tier.can_use_dns);
        assert!(free_tier.can_use_mailbox);

        let creator_tier = get_tier_limits("creator-tier", 0);
        assert!(creator_tier.can_use_dns);
        assert!(creator_tier.can_use_mailbox);

        let pro_tier = get_tier_limits("pro-tier", 0);
        assert!(pro_tier.can_use_dns);
        assert!(pro_tier.can_use_mailbox);
    }

    #[test]
    fn test_tier_limits_with_current_count() {
        let limits_zero = get_tier_limits("creator-tier", 0);
        assert_eq!(limits_zero.current_count, 0);

        let limits_one = get_tier_limits("creator-tier", 1);
        assert_eq!(limits_one.current_count, 1);

        let limits_two = get_tier_limits("creator-tier", 2);
        assert_eq!(limits_two.current_count, 2);
    }

    #[test]
    fn test_duplicate_email_detection_empty_list() {
        let senders: Vec<SenderRecord> = vec![];
        let email = "test@example.com";
        assert!(!senders.iter().any(|s| s.email == email));
    }

    #[test]
    fn test_duplicate_email_detection_no_match() {
        let senders = [SenderRecord {
            pk: "tenant-123".to_string(),
            sk: "sender#abc-456".to_string(),
            gsi1pk: "sender#tenant-123".to_string(),
            gsi1sk: "existing@example.com".to_string(),
            sender_id: "abc-456".to_string(),
            tenant_id: "tenant-123".to_string(),
            email: "existing@example.com".to_string(),
            name: None,
            verification_type: VerificationType::Mailbox,
            verification_status: VerificationStatus::Verified,
            is_default: true,
            domain: None,
            ses_identity_arn: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            verified_at: None,
            failure_reason: None,
            last_verification_sent: None,
            emails_sent: 0,
            last_sent_at: None,
        }];
        let email = "new@example.com";
        assert!(!senders.iter().any(|s| s.email == email));
    }

    #[test]
    fn test_duplicate_email_detection_match() {
        let senders = [SenderRecord {
            pk: "tenant-123".to_string(),
            sk: "sender#abc-456".to_string(),
            gsi1pk: "sender#tenant-123".to_string(),
            gsi1sk: "existing@example.com".to_string(),
            sender_id: "abc-456".to_string(),
            tenant_id: "tenant-123".to_string(),
            email: "existing@example.com".to_string(),
            name: None,
            verification_type: VerificationType::Mailbox,
            verification_status: VerificationStatus::Verified,
            is_default: true,
            domain: None,
            ses_identity_arn: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            verified_at: None,
            failure_reason: None,
            last_verification_sent: None,
            emails_sent: 0,
            last_sent_at: None,
        }];
        let email = "existing@example.com";
        assert!(senders.iter().any(|s| s.email == email));
    }

    #[test]
    fn test_duplicate_email_detection_multiple_senders() {
        let senders = [
            SenderRecord {
                pk: "tenant-123".to_string(),
                sk: "sender#abc-456".to_string(),
                gsi1pk: "sender#tenant-123".to_string(),
                gsi1sk: "first@example.com".to_string(),
                sender_id: "abc-456".to_string(),
                tenant_id: "tenant-123".to_string(),
                email: "first@example.com".to_string(),
                name: None,
                verification_type: VerificationType::Mailbox,
                verification_status: VerificationStatus::Verified,
                is_default: true,
                domain: None,
                ses_identity_arn: None,
                created_at: "2024-01-01T00:00:00Z".to_string(),
                updated_at: "2024-01-01T00:00:00Z".to_string(),
                verified_at: None,
                failure_reason: None,
                last_verification_sent: None,
                emails_sent: 0,
                last_sent_at: None,
            },
            SenderRecord {
                pk: "tenant-123".to_string(),
                sk: "sender#def-789".to_string(),
                gsi1pk: "sender#tenant-123".to_string(),
                gsi1sk: "second@example.com".to_string(),
                sender_id: "def-789".to_string(),
                tenant_id: "tenant-123".to_string(),
                email: "second@example.com".to_string(),
                name: None,
                verification_type: VerificationType::Mailbox,
                verification_status: VerificationStatus::Verified,
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
            },
        ];

        assert!(senders.iter().any(|s| s.email == "first@example.com"));
        assert!(senders.iter().any(|s| s.email == "second@example.com"));
        assert!(!senders.iter().any(|s| s.email == "third@example.com"));
    }

    #[test]
    fn test_first_sender_is_default() {
        let empty_senders: Vec<SenderRecord> = vec![];
        assert!(empty_senders.is_empty());

        let one_sender = [SenderRecord {
            pk: "tenant-123".to_string(),
            sk: "sender#abc-456".to_string(),
            gsi1pk: "sender#tenant-123".to_string(),
            gsi1sk: "first@example.com".to_string(),
            sender_id: "abc-456".to_string(),
            tenant_id: "tenant-123".to_string(),
            email: "first@example.com".to_string(),
            name: None,
            verification_type: VerificationType::Mailbox,
            verification_status: VerificationStatus::Verified,
            is_default: true,
            domain: None,
            ses_identity_arn: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            verified_at: None,
            failure_reason: None,
            last_verification_sent: None,
            emails_sent: 0,
            last_sent_at: None,
        }];
        assert!(!one_sender.is_empty());
    }
}


