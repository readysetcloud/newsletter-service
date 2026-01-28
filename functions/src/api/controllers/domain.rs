use aws_sdk_dynamodb::types::AttributeValue;
use lambda_http::{Body, Error, Request, Response};
use newsletter::senders::{auth, aws_clients, error::AppError, response, types::*, validation};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Deserialize)]
struct VerifyDomainRequest {
    domain: String,
}

#[derive(Serialize)]
struct VerifyDomainResponse {
    domain: String,
    #[serde(rename = "verificationStatus")]
    verification_status: String,
    #[serde(rename = "dnsRecords")]
    dns_records: Vec<DnsRecord>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    message: String,
}

#[derive(Debug, Serialize)]
struct GetDomainVerificationResponse {
    domain: String,
    #[serde(rename = "verificationStatus")]
    verification_status: String,
    #[serde(rename = "dnsRecords")]
    dns_records: Vec<EnhancedDnsRecord>,
    instructions: Vec<String>,
    #[serde(rename = "estimatedVerificationTime")]
    estimated_verification_time: String,
    troubleshooting: Vec<String>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "verifiedAt")]
    verified_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct EnhancedDnsRecord {
    name: String,
    #[serde(rename = "type")]
    record_type: String,
    value: String,
    description: String,
}

pub async fn verify_domain(event: Request) -> Result<Response<Body>, Error> {
    match handle_verify_domain(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_verify_domain(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context.tenant_id.ok_or_else(|| {
        AppError::Unauthorized("A brand is required before verifying a domain".to_string())
    })?;

    let body: VerifyDomainRequest = serde_json::from_slice(event.body())
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    validation::validate_domain(&body.domain)?;

    let tier = user_context.tier.as_deref().unwrap_or("free-tier");
    let tier_limits = get_tier_limits(tier, 0);

    if !tier_limits.can_use_dns {
        return Err(AppError::BadRequest(format!(
            "DNS verification not available for your tier. Current tier: {}. Please upgrade to use domain verification.",
            tier
        )));
    }

    if domain_exists(&tenant_id, &body.domain).await? {
        return Err(AppError::Conflict(
            "Domain already configured for this tenant".to_string(),
        ));
    }

    let dns_records = create_ses_domain_identity(&body.domain, &tenant_id).await?;

    let now = chrono::Utc::now().to_rfc3339();
    let domain_record = DomainVerificationRecord {
        pk: tenant_id.clone(),
        sk: KeyPatterns::domain(&body.domain),
        domain: body.domain.clone(),
        tenant_id: tenant_id.clone(),
        verification_status: VerificationStatus::Pending,
        dns_records: dns_records.clone(),
        ses_identity_arn: None,
        created_at: now.clone(),
        updated_at: now.clone(),
        verified_at: None,
    };

    save_domain_record(&domain_record).await?;

    response::format_response(
        201,
        VerifyDomainResponse {
            domain: body.domain,
            verification_status: "pending".to_string(),
            dns_records,
            created_at: now.clone(),
            updated_at: now,
            message: "Domain verification initiated. Please add the DNS records to your domain."
                .to_string(),
        },
    )
}

async fn domain_exists(tenant_id: &str, domain: &str) -> Result<bool, AppError> {
    let ddb = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let result = ddb
        .get_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S(KeyPatterns::domain(domain)))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB get failed: {}", e)))?;

    Ok(result.item().is_some())
}

async fn create_ses_domain_identity(
    domain: &str,
    tenant_id: &str,
) -> Result<Vec<DnsRecord>, AppError> {
    let ses = aws_clients::get_ses_client().await;
    let config_set = std::env::var("SES_CONFIGURATION_SET").ok();

    let mut create_command = ses.create_email_identity().email_identity(domain);
    if let Some(config) = config_set {
        create_command = create_command.configuration_set_name(config);
    }

    let _create_response = create_command
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("SES create domain identity failed: {}", e)))?;

    let resource_arn_prefix = std::env::var("RESOURCE_ARN_PREFIX")
        .unwrap_or_else(|_| "arn:aws:ses:us-east-1:123456789012:identity/".to_string());
    let resource_arn = format!("{}{}", resource_arn_prefix, domain);

    ses.create_tenant_resource_association()
        .tenant_name(tenant_id)
        .resource_arn(&resource_arn)
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("SES tenant association failed: {}", e)))?;

    let identity_info = ses
        .get_email_identity()
        .email_identity(domain)
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("SES get email identity failed: {}", e)))?;

    let mut dns_records = Vec::new();

    if let Some(dkim_attributes) = identity_info.dkim_attributes() {
        let tokens = dkim_attributes.tokens();
        for (i, token) in tokens.iter().enumerate() {
            dns_records.push(DnsRecord {
                name: format!("{}._domainkey.{}", token, domain),
                record_type: "CNAME".to_string(),
                value: format!("{}.dkim.amazonses.com", token),
                description: format!("DKIM token {} for email authentication", i + 1),
            });
        }
    }

    tracing::info!(
        "SES domain identity created: domain={}, tenant_id={}, dns_records_count={}",
        domain,
        tenant_id,
        dns_records.len()
    );

    Ok(dns_records)
}

async fn save_domain_record(domain_record: &DomainVerificationRecord) -> Result<(), AppError> {
    let ddb = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let item: std::collections::HashMap<String, aws_sdk_dynamodb::types::AttributeValue> =
        serde_dynamo::to_item(domain_record).map_err(|e| {
            AppError::InternalError(format!("Failed to serialize domain record: {}", e))
        })?;

    ddb.put_item()
        .table_name(table_name)
        .set_item(Some(item))
        .condition_expression("attribute_not_exists(pk) AND attribute_not_exists(sk)")
        .send()
        .await
        .map_err(|e| {
            if e.to_string().contains("ConditionalCheckFailed") {
                AppError::Conflict("Domain verification record already exists".to_string())
            } else {
                AppError::AwsError(format!("DynamoDB put failed: {}", e))
            }
        })?;

    Ok(())
}

pub async fn get_domain_verification(
    event: Request,
    domain: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_get_domain_verification(event, domain).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_get_domain_verification(
    event: Request,
    domain: Option<String>,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let domain =
        domain.ok_or_else(|| AppError::BadRequest("Domain parameter is required".to_string()))?;

    validation::validate_domain(&domain)?;

    let domain_record = get_domain_by_tenant(&tenant_id, &domain).await?;
    let mut current_status = domain_record.verification_status.clone();
    let ses_client = aws_clients::get_ses_client().await;

    match ses_client
        .get_email_identity()
        .email_identity(&domain)
        .send()
        .await
    {
        Ok(ses_response) => {
            current_status = if ses_response.verified_for_sending_status() {
                VerificationStatus::Verified
            } else if ses_response.verification_status().is_some()
                && ses_response.verification_status().unwrap().as_str() == "FAILED"
            {
                VerificationStatus::Failed
            } else {
                VerificationStatus::Pending
            };
        }
        Err(e) => {
            tracing::error!("SES verification status check failed: {:?}", e);
        }
    }

    let instructions = generate_dns_instructions(&domain, &domain_record.dns_records);

    let enhanced_dns_records: Vec<EnhancedDnsRecord> = domain_record
        .dns_records
        .iter()
        .map(|record| EnhancedDnsRecord {
            name: record.name.clone(),
            record_type: record.record_type.clone(),
            value: record.value.clone(),
            description: if record.description.is_empty() {
                get_record_description(&record.record_type)
            } else {
                record.description.clone()
            },
        })
        .collect();

    let current_status_str = match current_status {
        VerificationStatus::Pending => "pending",
        VerificationStatus::Verified => "verified",
        VerificationStatus::Failed => "failed",
        VerificationStatus::VerificationTimedOut => "verification_timed_out",
    };

    let mut updated_at = domain_record.updated_at.clone();
    let mut verified_at = domain_record.verified_at.clone();

    if current_status != domain_record.verification_status {
        let now = chrono::Utc::now().to_rfc3339();
        update_domain_verification_status(&tenant_id, &domain, &current_status).await?;
        updated_at = now.clone();
        if current_status == VerificationStatus::Verified && domain_record.verified_at.is_none() {
            verified_at = Some(now);
        }
    }

    let response_data = GetDomainVerificationResponse {
        domain: domain.to_string(),
        verification_status: current_status_str.to_string(),
        dns_records: enhanced_dns_records,
        instructions,
        estimated_verification_time: get_estimated_verification_time(&current_status),
        troubleshooting: get_troubleshooting_tips(&current_status),
        created_at: domain_record.created_at,
        updated_at,
        verified_at,
    };

    response::format_response(200, response_data)
}

async fn get_domain_by_tenant(
    tenant_id: &str,
    domain: &str,
) -> Result<DomainVerificationRecord, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let result = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("pk = :pk AND sk = :sk")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.to_string()))
        .expression_attribute_values(":sk", AttributeValue::S(KeyPatterns::domain(domain)))
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Error querying domain: {:?}", e);
            AppError::InternalError("Failed to query domain verification".to_string())
        })?;

    if let Some(items) = result.items {
        if let Some(item) = items.first() {
            let record: DomainVerificationRecord =
                serde_dynamo::from_item(item.clone()).map_err(|e| {
                    tracing::error!("Error deserializing domain record: {:?}", e);
                    AppError::InternalError("Failed to parse domain record".to_string())
                })?;
            return Ok(record);
        }
    }

    Err(AppError::NotFound(
        "Domain verification not found. Please initiate domain verification first.".to_string(),
    ))
}

async fn update_domain_verification_status(
    tenant_id: &str,
    domain: &str,
    status: &VerificationStatus,
) -> Result<(), AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let now = chrono::Utc::now().to_rfc3339();
    let status_str = match status {
        VerificationStatus::Pending => "pending",
        VerificationStatus::Verified => "verified",
        VerificationStatus::Failed => "failed",
        VerificationStatus::VerificationTimedOut => "verification_timed_out",
    };

    let mut update_expression =
        "SET verificationStatus = :status, updatedAt = :updatedAt".to_string();
    let mut expression_attribute_values = HashMap::new();
    expression_attribute_values.insert(
        ":status".to_string(),
        AttributeValue::S(status_str.to_string()),
    );
    expression_attribute_values.insert(":updatedAt".to_string(), AttributeValue::S(now.clone()));

    if *status == VerificationStatus::Verified {
        update_expression.push_str(", verifiedAt = :verifiedAt");
        expression_attribute_values.insert(":verifiedAt".to_string(), AttributeValue::S(now));
    }

    let mut key = HashMap::new();
    key.insert("pk".to_string(), AttributeValue::S(tenant_id.to_string()));
    key.insert(
        "sk".to_string(),
        AttributeValue::S(KeyPatterns::domain(domain)),
    );

    ddb_client
        .update_item()
        .table_name(&table_name)
        .set_key(Some(key))
        .update_expression(update_expression)
        .set_expression_attribute_values(Some(expression_attribute_values))
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Error updating domain verification status: {:?}", e);
            AppError::InternalError("Failed to update domain status".to_string())
        })?;

    Ok(())
}

fn generate_dns_instructions(_domain: &str, dns_records: &[DnsRecord]) -> Vec<String> {
    let mut instructions = vec![
        "To verify your domain ownership, you need to add DNS records to your domain's DNS settings.".to_string(),
        "Follow these steps:".to_string(),
        "".to_string(),
        "1. Log in to your domain registrar or DNS hosting provider (e.g., GoDaddy, Namecheap, Cloudflare, Route 53).".to_string(),
        "2. Navigate to the DNS management section for your domain.".to_string(),
        "3. Add the following DNS records exactly as shown:".to_string(),
        "".to_string(),
    ];

    for (index, record) in dns_records.iter().enumerate() {
        instructions.push(format!("   Record {}:", index + 1));
        instructions.push(format!("   • Type: {}", record.record_type));
        instructions.push(format!("   • Name: {}", record.name));
        instructions.push(format!("   • Value: {}", record.value));
        instructions.push(format!("   • Purpose: {}", record.description));
        instructions.push("".to_string());
    }

    instructions.extend(vec![
        "4. Save your DNS changes.".to_string(),
        "5. DNS propagation can take up to 72 hours, but typically completes within 15-30 minutes.".to_string(),
        "6. Return to this page to check your verification status.".to_string(),
        "".to_string(),
        "💡 Tip: You can use online DNS lookup tools to verify your records are properly configured before checking verification status.".to_string(),
    ]);

    instructions
}

fn get_record_description(record_type: &str) -> String {
    match record_type {
        "TXT" => "Domain ownership verification".to_string(),
        "CNAME" => "Email authentication (DKIM)".to_string(),
        "MX" => "Mail server routing".to_string(),
        _ => "Email service configuration".to_string(),
    }
}

fn get_estimated_verification_time(status: &VerificationStatus) -> String {
    match status {
        VerificationStatus::Pending => {
            "Verification typically completes within 15-30 minutes after DNS records are added, but can take up to 72 hours.".to_string()
        }
        VerificationStatus::Verified => {
            "Domain is verified and ready for sending emails.".to_string()
        }
        VerificationStatus::Failed => {
            "Verification failed. Please check your DNS records and try again.".to_string()
        }
        _ => "Status unknown. Please refresh to get the latest information.".to_string(),
    }
}

fn get_troubleshooting_tips(status: &VerificationStatus) -> Vec<String> {
    let common_tips = vec![
        "Ensure DNS records are added exactly as shown, including any trailing dots".to_string(),
        "Check that there are no extra spaces in the record values".to_string(),
        "DNS changes can take time to propagate - wait at least 15 minutes before checking again"
            .to_string(),
    ];

    match status {
        VerificationStatus::Pending => {
            let mut tips = common_tips;
            tips.extend(vec![
                "Use a DNS lookup tool to verify your records are visible".to_string(),
                "Contact your DNS provider if you're having trouble adding records".to_string(),
            ]);
            tips
        }
        VerificationStatus::Failed => vec![
            "Double-check that all DNS records are correctly configured".to_string(),
            "Remove any duplicate or conflicting DNS records".to_string(),
            "Ensure you have the correct permissions to modify DNS settings".to_string(),
            "Try removing and re-adding the DNS records".to_string(),
            "Contact support if the issue persists after verifying your DNS configuration"
                .to_string(),
        ],
        VerificationStatus::Verified => vec![
            "Your domain is successfully verified!".to_string(),
            "You can now add email addresses under this domain".to_string(),
            "Keep your DNS records in place to maintain verification status".to_string(),
        ],
        _ => common_tips,
    }
}
