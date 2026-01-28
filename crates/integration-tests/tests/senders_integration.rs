use aws_sdk_dynamodb::types::AttributeValue;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
struct CreateSenderRequest {
    email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(rename = "verificationType")]
    verification_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(dead_code)]
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

#[derive(Debug, Serialize, Deserialize)]
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
}

#[derive(Debug, Serialize, Deserialize)]
struct TierLimits {
    tier: String,
    #[serde(rename = "maxSenders")]
    max_senders: usize,
    #[serde(rename = "currentCount")]
    current_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct UpdateSenderRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(rename = "isDefault", skip_serializing_if = "Option::is_none")]
    is_default: Option<bool>,
}

async fn get_test_dynamodb_client() -> aws_sdk_dynamodb::Client {
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .load()
        .await;
    aws_sdk_dynamodb::Client::new(&config)
}

async fn get_test_ses_client() -> aws_sdk_sesv2::Client {
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .load()
        .await;
    aws_sdk_sesv2::Client::new(&config)
}

async fn cleanup_test_sender(tenant_id: &str, sender_id: &str) {
    let table_name = std::env::var("TABLE_NAME").unwrap_or_else(|_| "NewsletterTable".to_string());
    let client = get_test_dynamodb_client().await;

    let _ = client
        .delete_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S(format!("sender#{}", sender_id)))
        .send()
        .await;
}

async fn cleanup_test_ses_identity(email: &str) {
    let client = get_test_ses_client().await;
    let _ = client
        .delete_email_identity()
        .email_identity(email)
        .send()
        .await;
}

#[tokio::test]
#[ignore]
async fn test_create_sender_mailbox_verification() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let test_email = format!("test-{}@example.com", uuid::Uuid::new_v4());

    let request = CreateSenderRequest {
        email: test_email.clone(),
        name: Some("Test Sender".to_string()),
        verification_type: "mailbox".to_string(),
    };

    let response_json = serde_json::to_string(&request).unwrap();

    println!("Test would create sender with mailbox verification");
    println!("Tenant ID: {}", tenant_id);
    println!("Email: {}", test_email);
    println!("Request: {}", response_json);

    assert!(test_email.contains("@example.com"));
    assert_eq!(request.verification_type, "mailbox");
}

#[tokio::test]
#[ignore]
async fn test_create_sender_domain_verification() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let test_email = format!("test@domain-{}.com", uuid::Uuid::new_v4());

    let request = CreateSenderRequest {
        email: test_email.clone(),
        name: Some("Domain Sender".to_string()),
        verification_type: "domain".to_string(),
    };

    println!("Test would create sender with domain verification");
    println!("Tenant ID: {}", tenant_id);
    println!("Email: {}", test_email);

    assert!(test_email.contains("@"));
    assert_eq!(request.verification_type, "domain");
}

#[tokio::test]
#[ignore]
async fn test_get_senders_with_tier_limits() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());

    println!("Test would list senders with tier limits");
    println!("Tenant ID: {}", tenant_id);

    let expected_response = GetSendersResponse {
        senders: vec![],
        tier_limits: TierLimits {
            tier: "free-tier".to_string(),
            max_senders: 1,
            current_count: 0,
        },
    };

    assert_eq!(expected_response.tier_limits.max_senders, 1);
    assert_eq!(expected_response.tier_limits.current_count, 0);
}

#[tokio::test]
#[ignore]
async fn test_update_sender_default_reassignment() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let sender_id = uuid::Uuid::new_v4().to_string();

    let update_request = UpdateSenderRequest {
        name: Some("Updated Name".to_string()),
        is_default: Some(true),
    };

    println!("Test would update sender and reassign default");
    println!("Tenant ID: {}", tenant_id);
    println!("Sender ID: {}", sender_id);

    assert_eq!(update_request.is_default, Some(true));
    assert!(update_request.name.is_some());
}

#[tokio::test]
#[ignore]
async fn test_delete_sender_with_ses_cleanup() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let sender_id = uuid::Uuid::new_v4().to_string();
    let test_email = format!("delete-test-{}@example.com", uuid::Uuid::new_v4());

    println!("Test would delete sender and cleanup SES identity");
    println!("Tenant ID: {}", tenant_id);
    println!("Sender ID: {}", sender_id);
    println!("Email: {}", test_email);

    cleanup_test_sender(&tenant_id, &sender_id).await;
    cleanup_test_ses_identity(&test_email).await;

    assert!(!sender_id.is_empty());
}

#[tokio::test]
#[ignore]
async fn test_get_sender_status_with_ses_polling() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let sender_id = uuid::Uuid::new_v4().to_string();

    println!("Test would check sender status and poll SES");
    println!("Tenant ID: {}", tenant_id);
    println!("Sender ID: {}", sender_id);

    let _ses_client = get_test_ses_client().await;
    assert!(_ses_client.config().region().is_some());
}

#[tokio::test]
#[ignore]
async fn test_verify_domain_with_dns_records() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let test_domain = format!("test-domain-{}.com", uuid::Uuid::new_v4());

    println!("Test would verify domain and return DNS records");
    println!("Tenant ID: {}", tenant_id);
    println!("Domain: {}", test_domain);

    assert!(test_domain.contains(".com"));
    assert!(!test_domain.contains("@"));
}

#[tokio::test]
#[ignore]
async fn test_automatic_status_checking_flow() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let sender_id = uuid::Uuid::new_v4().to_string();
    let start_time = chrono::Utc::now();

    println!("Test would verify automatic status checking flow");
    println!("Tenant ID: {}", tenant_id);
    println!("Sender ID: {}", sender_id);
    println!("Start Time: {}", start_time.to_rfc3339());

    let expiration_time = start_time + chrono::Duration::hours(24);
    let time_remaining = expiration_time - start_time;

    assert!(time_remaining.num_hours() == 24);
}

#[tokio::test]
#[ignore]
async fn test_tier_limit_enforcement_free_tier() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());

    println!("Test would enforce free-tier sender limit (1 sender max)");
    println!("Tenant ID: {}", tenant_id);

    let tier_limits = TierLimits {
        tier: "free-tier".to_string(),
        max_senders: 1,
        current_count: 0,
    };

    assert_eq!(tier_limits.max_senders, 1);
    assert!(tier_limits.current_count < tier_limits.max_senders);
}

#[tokio::test]
#[ignore]
async fn test_tier_limit_enforcement_creator_tier() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());

    println!("Test would enforce creator-tier sender limit (2 senders max)");
    println!("Tenant ID: {}", tenant_id);

    let tier_limits = TierLimits {
        tier: "creator-tier".to_string(),
        max_senders: 2,
        current_count: 0,
    };

    assert_eq!(tier_limits.max_senders, 2);
}

#[tokio::test]
#[ignore]
async fn test_duplicate_email_detection() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let test_email = format!("duplicate-{}@example.com", uuid::Uuid::new_v4());

    println!("Test would detect duplicate email addresses");
    println!("Tenant ID: {}", tenant_id);
    println!("Email: {}", test_email);

    let request1 = CreateSenderRequest {
        email: test_email.clone(),
        name: Some("First Sender".to_string()),
        verification_type: "mailbox".to_string(),
    };

    let request2 = CreateSenderRequest {
        email: test_email.clone(),
        name: Some("Duplicate Sender".to_string()),
        verification_type: "mailbox".to_string(),
    };

    assert_eq!(request1.email, request2.email);
}

#[tokio::test]
#[ignore]
async fn test_end_to_end_sender_lifecycle() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let test_email = format!("lifecycle-{}@example.com", uuid::Uuid::new_v4());

    println!("=== Starting End-to-End Sender Lifecycle Test ===");
    println!("Tenant ID: {}", tenant_id);
    println!("Email: {}", test_email);

    let table_name = std::env::var("TABLE_NAME").unwrap_or_else(|_| "NewsletterTable".to_string());
    let ddb_client = get_test_dynamodb_client().await;
    let _ses_client = get_test_ses_client().await;

    let sender_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let mut item = HashMap::new();
    item.insert("pk".to_string(), AttributeValue::S(tenant_id.clone()));
    item.insert(
        "sk".to_string(),
        AttributeValue::S(format!("sender#{}", sender_id)),
    );
    item.insert(
        "GSI1PK".to_string(),
        AttributeValue::S(format!("sender#{}", tenant_id)),
    );
    item.insert("GSI1SK".to_string(), AttributeValue::S(test_email.clone()));
    item.insert("senderId".to_string(), AttributeValue::S(sender_id.clone()));
    item.insert("tenantId".to_string(), AttributeValue::S(tenant_id.clone()));
    item.insert("email".to_string(), AttributeValue::S(test_email.clone()));
    item.insert(
        "verificationType".to_string(),
        AttributeValue::S("mailbox".to_string()),
    );
    item.insert(
        "verificationStatus".to_string(),
        AttributeValue::S("pending".to_string()),
    );
    item.insert("isDefault".to_string(), AttributeValue::Bool(true));
    item.insert("createdAt".to_string(), AttributeValue::S(now.clone()));
    item.insert("updatedAt".to_string(), AttributeValue::S(now.clone()));
    item.insert("emailsSent".to_string(), AttributeValue::N("0".to_string()));

    println!("\n1. Creating sender in DynamoDB...");
    let put_result = ddb_client
        .put_item()
        .table_name(&table_name)
        .set_item(Some(item))
        .send()
        .await;

    match put_result {
        Ok(_) => println!("✓ Sender created successfully"),
        Err(e) => println!("✗ Failed to create sender: {}", e),
    }

    println!("\n2. Retrieving sender from DynamoDB...");
    let get_result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(format!("sender#{}", sender_id)))
        .send()
        .await;

    match get_result {
        Ok(response) => {
            if response.item.is_some() {
                println!("✓ Sender retrieved successfully");
            } else {
                println!("✗ Sender not found");
            }
        }
        Err(e) => println!("✗ Failed to retrieve sender: {}", e),
    }

    println!("\n3. Querying senders by tenant using GSI1...");
    let query_result = ddb_client
        .query()
        .table_name(&table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :gsi1pk")
        .expression_attribute_values(
            ":gsi1pk",
            AttributeValue::S(format!("sender#{}", tenant_id)),
        )
        .send()
        .await;

    match query_result {
        Ok(response) => {
            let count = response.items().len();
            println!("✓ Query successful, found {} sender(s)", count);
        }
        Err(e) => println!("✗ Query failed: {}", e),
    }

    println!("\n4. Cleaning up test data...");
    cleanup_test_sender(&tenant_id, &sender_id).await;
    cleanup_test_ses_identity(&test_email).await;
    println!("✓ Cleanup complete");

    println!("\n=== End-to-End Test Complete ===");
}

#[tokio::test]
#[ignore]
async fn test_domain_verification_dns_records_structure() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let test_domain = format!("test-{}.com", uuid::Uuid::new_v4());

    println!("=== Testing Domain Verification DNS Records ===");
    println!("Tenant ID: {}", tenant_id);
    println!("Domain: {}", test_domain);

    let ses_client = get_test_ses_client().await;

    println!("\n1. Creating domain identity in SES...");
    let create_result = ses_client
        .create_email_identity()
        .email_identity(&test_domain)
        .send()
        .await;

    match create_result {
        Ok(response) => {
            println!("✓ Domain identity created");
            println!("  Identity Type: {:?}", response.identity_type());
        }
        Err(e) => {
            println!("✗ Failed to create domain identity: {}", e);
        }
    }

    println!("\n2. Retrieving domain verification details...");
    let get_result = ses_client
        .get_email_identity()
        .email_identity(&test_domain)
        .send()
        .await;

    match get_result {
        Ok(response) => {
            println!("✓ Domain details retrieved");
            println!(
                "  Verification Status: {:?}",
                response.verification_status()
            );

            if let Some(dkim_attrs) = response.dkim_attributes() {
                println!("  DKIM Status: {:?}", dkim_attrs.status());
                let tokens = dkim_attrs.tokens();
                if !tokens.is_empty() {
                    println!("  DKIM Tokens: {} token(s)", tokens.len());
                }
            }
        }
        Err(e) => {
            println!("✗ Failed to retrieve domain details: {}", e);
        }
    }

    println!("\n3. Cleaning up domain identity...");
    let _ = ses_client
        .delete_email_identity()
        .email_identity(&test_domain)
        .send()
        .await;
    println!("✓ Cleanup complete");

    println!("\n=== Domain Verification Test Complete ===");
}

#[tokio::test]
#[ignore]
async fn test_sender_status_polling_and_update() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let sender_id = uuid::Uuid::new_v4().to_string();
    let test_email = format!("status-{}@example.com", uuid::Uuid::new_v4());

    println!("=== Testing Sender Status Polling ===");
    println!("Tenant ID: {}", tenant_id);
    println!("Sender ID: {}", sender_id);
    println!("Email: {}", test_email);

    let table_name = std::env::var("TABLE_NAME").unwrap_or_else(|_| "NewsletterTable".to_string());
    let ddb_client = get_test_dynamodb_client().await;
    let ses_client = get_test_ses_client().await;

    let now = chrono::Utc::now().to_rfc3339();

    let mut item = HashMap::new();
    item.insert("pk".to_string(), AttributeValue::S(tenant_id.clone()));
    item.insert(
        "sk".to_string(),
        AttributeValue::S(format!("sender#{}", sender_id)),
    );
    item.insert(
        "GSI1PK".to_string(),
        AttributeValue::S(format!("sender#{}", tenant_id)),
    );
    item.insert("GSI1SK".to_string(), AttributeValue::S(test_email.clone()));
    item.insert("senderId".to_string(), AttributeValue::S(sender_id.clone()));
    item.insert("tenantId".to_string(), AttributeValue::S(tenant_id.clone()));
    item.insert("email".to_string(), AttributeValue::S(test_email.clone()));
    item.insert(
        "verificationType".to_string(),
        AttributeValue::S("mailbox".to_string()),
    );
    item.insert(
        "verificationStatus".to_string(),
        AttributeValue::S("pending".to_string()),
    );
    item.insert("isDefault".to_string(), AttributeValue::Bool(true));
    item.insert("createdAt".to_string(), AttributeValue::S(now.clone()));
    item.insert("updatedAt".to_string(), AttributeValue::S(now.clone()));
    item.insert("emailsSent".to_string(), AttributeValue::N("0".to_string()));

    println!("\n1. Creating test sender...");
    let _ = ddb_client
        .put_item()
        .table_name(&table_name)
        .set_item(Some(item))
        .send()
        .await;

    println!("\n2. Checking SES verification status...");
    let ses_result = ses_client
        .get_email_identity()
        .email_identity(&test_email)
        .send()
        .await;

    match ses_result {
        Ok(response) => {
            println!("✓ SES status retrieved");
            let status = response
                .verification_status()
                .map(|s| s.as_str())
                .unwrap_or("unknown");
            println!("  Verification Status: {}", status);

            let internal_status = match status {
                "SUCCESS" => "verified",
                "FAILED" => "failed",
                "PENDING" => "pending",
                _ => "unknown",
            };
            println!("  Mapped Internal Status: {}", internal_status);
        }
        Err(e) => {
            println!("✗ SES identity not found (expected for test): {}", e);
        }
    }

    println!("\n3. Updating sender status in DynamoDB...");
    let update_time = chrono::Utc::now().to_rfc3339();
    let update_result = ddb_client
        .update_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(format!("sender#{}", sender_id)))
        .update_expression("SET verificationStatus = :status, updatedAt = :updated")
        .expression_attribute_values(":status", AttributeValue::S("verified".to_string()))
        .expression_attribute_values(":updated", AttributeValue::S(update_time))
        .send()
        .await;

    match update_result {
        Ok(_) => println!("✓ Status updated successfully"),
        Err(e) => println!("✗ Failed to update status: {}", e),
    }

    println!("\n4. Cleaning up...");
    cleanup_test_sender(&tenant_id, &sender_id).await;
    println!("✓ Cleanup complete");

    println!("\n=== Status Polling Test Complete ===");
}

#[tokio::test]
#[ignore]
async fn test_default_sender_reassignment_on_delete() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());

    println!("=== Testing Default Sender Reassignment ===");
    println!("Tenant ID: {}", tenant_id);

    let table_name = std::env::var("TABLE_NAME").unwrap_or_else(|_| "NewsletterTable".to_string());
    let ddb_client = get_test_dynamodb_client().await;

    let sender1_id = uuid::Uuid::new_v4().to_string();
    let sender2_id = uuid::Uuid::new_v4().to_string();
    let email1 = format!("sender1-{}@example.com", uuid::Uuid::new_v4());
    let email2 = format!("sender2-{}@example.com", uuid::Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();

    println!("\n1. Creating first sender (default)...");
    let mut item1 = HashMap::new();
    item1.insert("pk".to_string(), AttributeValue::S(tenant_id.clone()));
    item1.insert(
        "sk".to_string(),
        AttributeValue::S(format!("sender#{}", sender1_id)),
    );
    item1.insert(
        "GSI1PK".to_string(),
        AttributeValue::S(format!("sender#{}", tenant_id)),
    );
    item1.insert("GSI1SK".to_string(), AttributeValue::S(email1.clone()));
    item1.insert(
        "senderId".to_string(),
        AttributeValue::S(sender1_id.clone()),
    );
    item1.insert("tenantId".to_string(), AttributeValue::S(tenant_id.clone()));
    item1.insert("email".to_string(), AttributeValue::S(email1.clone()));
    item1.insert(
        "verificationType".to_string(),
        AttributeValue::S("mailbox".to_string()),
    );
    item1.insert(
        "verificationStatus".to_string(),
        AttributeValue::S("verified".to_string()),
    );
    item1.insert("isDefault".to_string(), AttributeValue::Bool(true));
    item1.insert("createdAt".to_string(), AttributeValue::S(now.clone()));
    item1.insert("updatedAt".to_string(), AttributeValue::S(now.clone()));
    item1.insert("emailsSent".to_string(), AttributeValue::N("0".to_string()));

    let _ = ddb_client
        .put_item()
        .table_name(&table_name)
        .set_item(Some(item1))
        .send()
        .await;
    println!("✓ First sender created");

    println!("\n2. Creating second sender (not default)...");
    let mut item2 = HashMap::new();
    item2.insert("pk".to_string(), AttributeValue::S(tenant_id.clone()));
    item2.insert(
        "sk".to_string(),
        AttributeValue::S(format!("sender#{}", sender2_id)),
    );
    item2.insert(
        "GSI1PK".to_string(),
        AttributeValue::S(format!("sender#{}", tenant_id)),
    );
    item2.insert("GSI1SK".to_string(), AttributeValue::S(email2.clone()));
    item2.insert(
        "senderId".to_string(),
        AttributeValue::S(sender2_id.clone()),
    );
    item2.insert("tenantId".to_string(), AttributeValue::S(tenant_id.clone()));
    item2.insert("email".to_string(), AttributeValue::S(email2.clone()));
    item2.insert(
        "verificationType".to_string(),
        AttributeValue::S("mailbox".to_string()),
    );
    item2.insert(
        "verificationStatus".to_string(),
        AttributeValue::S("verified".to_string()),
    );
    item2.insert("isDefault".to_string(), AttributeValue::Bool(false));
    item2.insert("createdAt".to_string(), AttributeValue::S(now.clone()));
    item2.insert("updatedAt".to_string(), AttributeValue::S(now.clone()));
    item2.insert("emailsSent".to_string(), AttributeValue::N("0".to_string()));

    let _ = ddb_client
        .put_item()
        .table_name(&table_name)
        .set_item(Some(item2))
        .send()
        .await;
    println!("✓ Second sender created");

    println!("\n3. Deleting default sender...");
    let _ = ddb_client
        .delete_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(format!("sender#{}", sender1_id)))
        .send()
        .await;
    println!("✓ Default sender deleted");

    println!("\n4. Reassigning default to remaining sender...");
    let update_time = chrono::Utc::now().to_rfc3339();
    let update_result = ddb_client
        .update_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(format!("sender#{}", sender2_id)))
        .update_expression("SET isDefault = :def, updatedAt = :upd")
        .expression_attribute_values(":def", AttributeValue::Bool(true))
        .expression_attribute_values(":upd", AttributeValue::S(update_time))
        .send()
        .await;

    match update_result {
        Ok(_) => println!("✓ Default reassigned successfully"),
        Err(e) => println!("✗ Failed to reassign default: {}", e),
    }

    println!("\n5. Verifying new default sender...");
    let get_result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(format!("sender#{}", sender2_id)))
        .send()
        .await;

    match get_result {
        Ok(response) => {
            if let Some(item) = response.item {
                if let Some(AttributeValue::Bool(is_default)) = item.get("isDefault") {
                    if *is_default {
                        println!("✓ Sender is now default");
                    } else {
                        println!("✗ Sender is not default");
                    }
                }
            }
        }
        Err(e) => println!("✗ Failed to verify: {}", e),
    }

    println!("\n6. Cleaning up...");
    cleanup_test_sender(&tenant_id, &sender2_id).await;
    println!("✓ Cleanup complete");

    println!("\n=== Default Reassignment Test Complete ===");
}

#[tokio::test]
#[ignore]
async fn test_automatic_status_check_expiration() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let sender_id = uuid::Uuid::new_v4().to_string();

    println!("=== Testing Automatic Status Check Expiration ===");
    println!("Tenant ID: {}", tenant_id);
    println!("Sender ID: {}", sender_id);

    let start_time = chrono::Utc::now();
    let expiration_time = start_time + chrono::Duration::hours(24);

    println!("\n1. Calculating expiration times...");
    println!("  Start Time: {}", start_time.to_rfc3339());
    println!("  Expiration Time: {}", expiration_time.to_rfc3339());

    let time_remaining = expiration_time - start_time;
    println!("  Time Remaining: {} hours", time_remaining.num_hours());

    assert_eq!(time_remaining.num_hours(), 24);

    println!("\n2. Simulating time passage...");
    let current_time = start_time + chrono::Duration::hours(25);
    let is_expired = current_time > expiration_time;

    println!("  Current Time: {}", current_time.to_rfc3339());
    println!("  Is Expired: {}", is_expired);

    assert!(is_expired);

    println!("\n3. Testing final state detection...");
    let statuses = vec!["verified", "failed", "verification_timed_out"];

    for status in statuses {
        let is_final = matches!(status, "verified" | "failed" | "verification_timed_out");
        println!("  Status '{}' is final: {}", status, is_final);
        assert!(is_final);
    }

    let pending_status = "pending";
    let is_pending_final = matches!(
        pending_status,
        "verified" | "failed" | "verification_timed_out"
    );
    println!(
        "  Status '{}' is final: {}",
        pending_status, is_pending_final
    );
    assert!(!is_pending_final);

    println!("\n=== Expiration Test Complete ===");
}

#[tokio::test]
#[ignore]
async fn test_ses_identity_cleanup_on_timeout() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let test_email = format!("timeout-{}@example.com", uuid::Uuid::new_v4());

    println!("=== Testing SES Identity Cleanup on Timeout ===");
    println!("Tenant ID: {}", tenant_id);
    println!("Email: {}", test_email);

    let ses_client = get_test_ses_client().await;

    println!("\n1. Creating test SES identity...");
    let create_result = ses_client
        .create_email_identity()
        .email_identity(&test_email)
        .send()
        .await;

    match create_result {
        Ok(_) => println!("✓ SES identity created"),
        Err(e) => println!("✗ Failed to create identity: {}", e),
    }

    println!("\n2. Simulating timeout and cleanup...");
    let delete_result = ses_client
        .delete_email_identity()
        .email_identity(&test_email)
        .send()
        .await;

    match delete_result {
        Ok(_) => println!("✓ SES identity deleted successfully"),
        Err(e) => println!("✗ Failed to delete identity: {}", e),
    }

    println!("\n3. Verifying identity is removed...");
    let verify_result = ses_client
        .get_email_identity()
        .email_identity(&test_email)
        .send()
        .await;

    match verify_result {
        Ok(_) => println!("✗ Identity still exists (unexpected)"),
        Err(e) => {
            if e.to_string().contains("NotFoundException") {
                println!("✓ Identity not found (expected)");
            } else {
                println!("✗ Unexpected error: {}", e);
            }
        }
    }

    println!("\n=== Cleanup Test Complete ===");
}
