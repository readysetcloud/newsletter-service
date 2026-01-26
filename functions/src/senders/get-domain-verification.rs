use aws_sdk_dynamodb::types::AttributeValue;
use lambda_http::{run, service_fn, Body, Error, Request, RequestExt, Response};
use serde::Serialize;
use newsletter_lambdas::senders::{auth, aws_clients, error::AppError, response, types::*, validation};
use std::collections::HashMap;

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

async fn function_handler(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    // Extract domain from path parameters
    let path_params = event.path_parameters();
    let domain = path_params
        .first("domain")
        .ok_or_else(|| AppError::BadRequest("Domain parameter is required".to_string()))?;

    // Validate domain format
    validation::validate_domain(domain)?;

    // Get domain verification record from DynamoDB
    let domain_record = get_domain_by_tenant(&tenant_id, domain).await?;

    // Get current verification status from SES
    let mut current_status = domain_record.verification_status.clone();
    let ses_client = aws_clients::get_ses_client().await;

    match ses_client
        .get_email_identity()
        .email_identity(domain)
        .send()
        .await
    {
        Ok(ses_response) => {
            // Update status based on SES response
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
            // Continue with stored status if SES check fails
        }
    }

    // Generate user-friendly DNS setup instructions
    let instructions = generate_dns_instructions(domain, &domain_record.dns_records);

    // Prepare response with enhanced DNS records including descriptions
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

    // If status changed, update the record in DynamoDB
    if current_status != domain_record.verification_status {
        let now = chrono::Utc::now().to_rfc3339();
        update_domain_verification_status(&tenant_id, domain, &current_status).await?;
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

    // Add verifiedAt timestamp if status is verified
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
            // Don't throw - this is a background update
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

    // Add specific record instructions
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
    fn test_get_record_description_txt() {
        assert_eq!(
            get_record_description("TXT"),
            "Domain ownership verification"
        );
    }

    #[test]
    fn test_get_record_description_cname() {
        assert_eq!(
            get_record_description("CNAME"),
            "Email authentication (DKIM)"
        );
    }

    #[test]
    fn test_get_record_description_mx() {
        assert_eq!(get_record_description("MX"), "Mail server routing");
    }

    #[test]
    fn test_get_record_description_unknown() {
        assert_eq!(
            get_record_description("UNKNOWN"),
            "Email service configuration"
        );
    }

    #[test]
    fn test_get_estimated_verification_time_pending() {
        let time = get_estimated_verification_time(&VerificationStatus::Pending);
        assert!(time.contains("15-30 minutes"));
        assert!(time.contains("72 hours"));
    }

    #[test]
    fn test_get_estimated_verification_time_verified() {
        let time = get_estimated_verification_time(&VerificationStatus::Verified);
        assert!(time.contains("verified and ready"));
    }

    #[test]
    fn test_get_estimated_verification_time_failed() {
        let time = get_estimated_verification_time(&VerificationStatus::Failed);
        assert!(time.contains("failed"));
        assert!(time.contains("check your DNS records"));
    }

    #[test]
    fn test_get_troubleshooting_tips_pending() {
        let tips = get_troubleshooting_tips(&VerificationStatus::Pending);
        assert!(tips.len() >= 5);
        assert!(tips.iter().any(|t| t.contains("DNS lookup tool")));
        assert!(tips.iter().any(|t| t.contains("trailing dots")));
    }

    #[test]
    fn test_get_troubleshooting_tips_failed() {
        let tips = get_troubleshooting_tips(&VerificationStatus::Failed);
        assert!(tips.len() >= 5);
        assert!(tips.iter().any(|t| t.contains("Double-check")));
        assert!(tips.iter().any(|t| t.contains("duplicate")));
        assert!(tips.iter().any(|t| t.contains("Contact support")));
    }

    #[test]
    fn test_get_troubleshooting_tips_verified() {
        let tips = get_troubleshooting_tips(&VerificationStatus::Verified);
        assert_eq!(tips.len(), 3);
        assert!(tips.iter().any(|t| t.contains("successfully verified")));
        assert!(tips.iter().any(|t| t.contains("Keep your DNS records")));
    }

    #[test]
    fn test_generate_dns_instructions_format() {
        let dns_records = vec![
            DnsRecord {
                name: "_amazonses.example.com".to_string(),
                record_type: "TXT".to_string(),
                value: "verification-token".to_string(),
                description: "Domain ownership verification".to_string(),
            },
            DnsRecord {
                name: "dkim._domainkey.example.com".to_string(),
                record_type: "CNAME".to_string(),
                value: "dkim.amazonses.com".to_string(),
                description: "Email authentication".to_string(),
            },
        ];

        let instructions = generate_dns_instructions("example.com", &dns_records);

        assert!(instructions.len() > 10);
        assert!(instructions.iter().any(|i| i.contains("domain registrar")));
        assert!(instructions.iter().any(|i| i.contains("Record 1:")));
        assert!(instructions.iter().any(|i| i.contains("Record 2:")));
        assert!(instructions.iter().any(|i| i.contains("Type: TXT")));
        assert!(instructions.iter().any(|i| i.contains("Type: CNAME")));
        assert!(instructions.iter().any(|i| i.contains("72 hours")));
    }

    #[test]
    fn test_generate_dns_instructions_includes_all_records() {
        let dns_records = vec![
            DnsRecord {
                name: "record1".to_string(),
                record_type: "TXT".to_string(),
                value: "value1".to_string(),
                description: "desc1".to_string(),
            },
            DnsRecord {
                name: "record2".to_string(),
                record_type: "CNAME".to_string(),
                value: "value2".to_string(),
                description: "desc2".to_string(),
            },
            DnsRecord {
                name: "record3".to_string(),
                record_type: "TXT".to_string(),
                value: "value3".to_string(),
                description: "desc3".to_string(),
            },
        ];

        let instructions = generate_dns_instructions("example.com", &dns_records);

        assert!(instructions.iter().any(|i| i.contains("record1")));
        assert!(instructions.iter().any(|i| i.contains("record2")));
        assert!(instructions.iter().any(|i| i.contains("record3")));
        assert!(instructions.iter().any(|i| i.contains("value1")));
        assert!(instructions.iter().any(|i| i.contains("value2")));
        assert!(instructions.iter().any(|i| i.contains("value3")));
    }
}


