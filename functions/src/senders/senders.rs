use aws_sdk_dynamodb::types::AttributeValue;
use lambda_http::{Body, Error, Request, Response};
use newsletter_lambdas::senders::{
    auth, aws_clients, error::AppError, response, types::*, validation,
};
use serde::{Deserialize, Serialize};
use serde_dynamo::from_item;
use std::collections::HashMap;
use std::env;
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

pub async fn list_senders(event: Request) -> Result<Response<Body>, Error> {
    match handle_list_senders(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_list_senders(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let tier = user_context.tier.unwrap_or_else(|| "free-tier".to_string());

    let table_name = env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not configured".to_string()))?;

    let config = aws_config::load_from_env().await;
    let client = aws_sdk_dynamodb::Client::new(&config);

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

async fn get_senders_by_tenant(
    client: &aws_sdk_dynamodb::Client,
    table_name: &str,
    tenant_id: &str,
) -> Result<Vec<SenderRecord>, AppError> {
    let gsi1pk = KeyPatterns::sender_gsi1pk(tenant_id);

    let result = client
        .query()
        .table_name(table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :gsi1pk")
        .expression_attribute_values(":gsi1pk", AttributeValue::S(gsi1pk))
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

pub async fn create_sender(event: Request) -> Result<Response<Body>, Error> {
    match handle_create_sender(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_create_sender(event: Request) -> Result<Response<Body>, AppError> {
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
    let current_senders = get_senders_by_tenant_for_create(&tenant_id).await?;
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

async fn get_senders_by_tenant_for_create(tenant_id: &str) -> Result<Vec<SenderRecord>, AppError> {
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

pub async fn update_sender(
    event: Request,
    sender_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_update_sender(event, sender_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_update_sender(
    event: Request,
    sender_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let sender_id =
        sender_id.ok_or_else(|| AppError::BadRequest("Sender ID is required".to_string()))?;

    let body: UpdateSenderRequest = serde_json::from_slice(event.body())
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    validate_update_request(&body)?;

    let _existing_sender = get_sender_by_id(&tenant_id, &sender_id).await?;

    if body.is_default == Some(true) {
        unset_other_defaults(&tenant_id, &sender_id).await?;
    }

    let updated_sender = update_sender_in_db(&tenant_id, &sender_id, &body).await?;

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

async fn update_sender_in_db(
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

pub async fn delete_sender(
    event: Request,
    sender_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_delete_sender(event, sender_id).await {
        Ok(response) => Ok(response),
        Err(e) => {
            tracing::error!(error = %e, "Request failed");
            Ok(response::format_error_response(&e))
        }
    }
}

async fn handle_delete_sender(
    event: Request,
    sender_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;

    let tenant_id = user_context.tenant_id.as_ref().ok_or_else(|| {
        AppError::Unauthorized(String::from("A brand is required before deleting a sender"))
    })?;

    let sender_id =
        sender_id.ok_or_else(|| AppError::BadRequest(String::from("Sender Id is required")))?;

    let existing_sender = get_sender_by_id(tenant_id, &sender_id).await?;

    if let Err(e) = cleanup_ses_identity(&existing_sender, tenant_id).await {
        tracing::error!(error = %e, "SES cleanup failed (continuing with deletion)");
    }

    if existing_sender.is_default {
        if let Err(e) = reassign_default_sender(tenant_id, &sender_id).await {
            tracing::error!(error = %e, "Failed to reassign default sender");
        }
    }

    delete_sender_from_db(tenant_id, &sender_id).await?;

    response::format_empty_response(204)
}

async fn cleanup_ses_identity(sender: &SenderRecord, tenant_id: &str) -> Result<(), AppError> {
    let identity = match sender.verification_type {
        VerificationType::Domain => sender.domain.as_ref().ok_or_else(|| {
            AppError::InternalError(String::from("Domain sender missing domain field"))
        })?,
        VerificationType::Mailbox => &sender.email,
    };

    let resource_arn_prefix = std::env::var("RESOURCE_ARN_PREFIX")
        .map_err(|_| AppError::InternalError(String::from("RESOURCE_ARN_PREFIX not configured")))?;

    let client = aws_clients::get_ses_client().await;

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

    let client = aws_clients::get_dynamodb_client().await;

    let result = client
        .query()
        .table_name(&table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :pk")
        .expression_attribute_values(
            ":pk",
            AttributeValue::S(KeyPatterns::sender_gsi1pk(tenant_id)),
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
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key(
            "sk",
            AttributeValue::S(KeyPatterns::sender(&new_default_sender.sender_id)),
        )
        .update_expression("SET isDefault = :def, updatedAt = :upd")
        .expression_attribute_values(":def", AttributeValue::Bool(true))
        .expression_attribute_values(":upd", AttributeValue::S(updated_at))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to update default sender: {}", e)))?;

    tracing::info!(email = %new_default_sender.email, "Reassigned default sender");

    Ok(())
}

async fn delete_sender_from_db(tenant_id: &str, sender_id: &str) -> Result<(), AppError> {
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError(String::from("TABLE_NAME not configured")))?;

    let client = aws_clients::get_dynamodb_client().await;

    client
        .delete_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S(KeyPatterns::sender(sender_id)))
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

pub async fn get_sender_status(
    event: Request,
    sender_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_get_sender_status(event, sender_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_get_sender_status(
    event: Request,
    sender_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let sender_id =
        sender_id.ok_or_else(|| AppError::BadRequest("Missing senderId parameter".to_string()))?;

    let table_name = env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not configured".to_string()))?;

    let config = aws_config::load_from_env().await;
    let ddb_client = aws_sdk_dynamodb::Client::new(&config);
    let ses_client = aws_sdk_sesv2::Client::new(&config);

    let sender = get_sender_by_id_for_status(&ddb_client, &table_name, &tenant_id, &sender_id)
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
                    &sender_id,
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

async fn get_sender_by_id_for_status(
    client: &aws_sdk_dynamodb::Client,
    table_name: &str,
    tenant_id: &str,
    sender_id: &str,
) -> Result<Option<SenderRecord>, AppError> {
    let pk = tenant_id.to_string();
    let sk = KeyPatterns::sender(sender_id);

    let result = client
        .get_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(pk))
        .key("sk", AttributeValue::S(sk))
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
    ses_client: &aws_sdk_sesv2::Client,
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
    client: &aws_sdk_dynamodb::Client,
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
            AttributeValue::S(status_str.to_string()),
        ),
        (":updatedAt".to_string(), AttributeValue::S(now.clone())),
    ];

    if *new_status == VerificationStatus::Verified {
        update_expression.push_str(", verifiedAt = :verifiedAt");
        expression_attribute_values
            .push((":verifiedAt".to_string(), AttributeValue::S(now.clone())));
    }

    client
        .update_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(pk))
        .key("sk", AttributeValue::S(sk))
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
