use lambda_http::{run, service_fn, Body, Error, Request, Response};
use senders_shared::{auth, aws_clients, error::AppError, response, types::*, validation};
use serde::{Deserialize, Serialize};

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

async fn function_handler(event: Request) -> Result<Response<Body>, AppError> {
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
        .key(
            "pk",
            aws_sdk_dynamodb::types::AttributeValue::S(tenant_id.to_string()),
        )
        .key(
            "sk",
            aws_sdk_dynamodb::types::AttributeValue::S(KeyPatterns::domain(domain)),
        )
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
    fn test_validate_domain_valid() {
        assert!(validation::validate_domain("example.com").is_ok());
        assert!(validation::validate_domain("sub.example.com").is_ok());
        assert!(validation::validate_domain("example.co.uk").is_ok());
        assert!(validation::validate_domain("my-domain.com").is_ok());
    }

    #[test]
    fn test_validate_domain_with_protocol() {
        let result = validation::validate_domain("https://example.com");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_domain_with_http_protocol() {
        let result = validation::validate_domain("http://example.com");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_domain_with_path() {
        let result = validation::validate_domain("example.com/path");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_domain_with_path_and_protocol() {
        let result = validation::validate_domain("https://example.com/path");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_domain_invalid_format() {
        let result = validation::validate_domain("example..com");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_domain_empty() {
        let result = validation::validate_domain("");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_domain_only_tld() {
        let result = validation::validate_domain("com");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_domain_with_port() {
        let result = validation::validate_domain("example.com:8080");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_domain_with_query_string() {
        let result = validation::validate_domain("example.com?query=value");
        assert!(result.is_err());
    }

    #[test]
    fn test_tier_limits_free_tier_no_dns() {
        let limits = get_tier_limits("free-tier", 0);
        assert!(!limits.can_use_dns);
        assert!(limits.can_use_mailbox);
    }

    #[test]
    fn test_tier_limits_creator_tier_has_dns() {
        let limits = get_tier_limits("creator-tier", 0);
        assert!(limits.can_use_dns);
        assert!(limits.can_use_mailbox);
    }

    #[test]
    fn test_tier_limits_pro_tier_has_dns() {
        let limits = get_tier_limits("pro-tier", 0);
        assert!(limits.can_use_dns);
        assert!(limits.can_use_mailbox);
    }

    #[test]
    fn test_tier_limits_unknown_defaults_to_free() {
        let limits = get_tier_limits("unknown-tier", 0);
        assert!(!limits.can_use_dns);
    }

    #[test]
    fn test_verify_domain_request_deserialization() {
        let json = r#"{"domain":"example.com"}"#;
        let request: VerifyDomainRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.domain, "example.com");
    }

    #[test]
    fn test_verify_domain_response_serialization() {
        let response = VerifyDomainResponse {
            domain: "example.com".to_string(),
            verification_status: "pending".to_string(),
            dns_records: vec![DnsRecord {
                name: "_amazonses.example.com".to_string(),
                record_type: "TXT".to_string(),
                value: "verification-token".to_string(),
                description: "Domain ownership verification record".to_string(),
            }],
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            message: "Domain verification initiated".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"domain\":\"example.com\""));
        assert!(json.contains("\"verificationStatus\":\"pending\""));
        assert!(json.contains("\"dnsRecords\""));
    }

    #[test]
    fn test_domain_verification_record_serialization() {
        let record = DomainVerificationRecord {
            pk: "tenant-123".to_string(),
            sk: "domain#example.com".to_string(),
            domain: "example.com".to_string(),
            tenant_id: "tenant-123".to_string(),
            verification_status: VerificationStatus::Pending,
            dns_records: vec![],
            ses_identity_arn: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            verified_at: None,
        };

        let json = serde_json::to_string(&record).unwrap();
        assert!(json.contains("\"domain\":\"example.com\""));
        assert!(json.contains("\"verificationStatus\":\"pending\""));
    }

    #[test]
    fn test_dns_record_serialization() {
        let record = DnsRecord {
            name: "token._domainkey.example.com".to_string(),
            record_type: "CNAME".to_string(),
            value: "token.dkim.amazonses.com".to_string(),
            description: "DKIM token 1 for email authentication".to_string(),
        };

        let json = serde_json::to_string(&record).unwrap();
        assert!(json.contains("\"name\":\"token._domainkey.example.com\""));
        assert!(json.contains("\"type\":\"CNAME\""));
        assert!(json.contains("\"value\":\"token.dkim.amazonses.com\""));
        assert!(json.contains("\"description\":\"DKIM token 1 for email authentication\""));
    }

    #[test]
    fn test_key_pattern_domain() {
        let pattern = KeyPatterns::domain("example.com");
        assert_eq!(pattern, "domain#example.com");
    }

    #[test]
    fn test_key_pattern_domain_with_subdomain() {
        let pattern = KeyPatterns::domain("sub.example.com");
        assert_eq!(pattern, "domain#sub.example.com");
    }
}
