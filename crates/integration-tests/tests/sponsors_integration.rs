use aws_sdk_dynamodb::types::AttributeValue;
use std::collections::HashMap;

// ── Helper functions ───────────────────────────────────────────────────

async fn get_test_dynamodb_client() -> aws_sdk_dynamodb::Client {
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .load()
        .await;
    aws_sdk_dynamodb::Client::new(&config)
}

fn get_table_name() -> String {
    std::env::var("TABLE_NAME").unwrap_or_else(|_| "NewsletterTable".to_string())
}

fn sponsor_sk(name_lower: &str, sponsor_id: &str) -> String {
    format!("sponsor#{}#{}", name_lower, sponsor_id)
}

fn sponsorship_sk(sponsor_id: &str, date: &str, sponsorship_id: &str) -> String {
    format!("sponsorship#{}#{}#{}", sponsor_id, date, sponsorship_id)
}

fn outreach_sk(sponsor_id: &str, generated_at: &str) -> String {
    format!("outreach#{}#{}", sponsor_id, generated_at)
}

fn outreach_job_sk(job_id: &str) -> String {
    format!("outreach-job#{}", job_id)
}

struct InsertSponsorParams<'a> {
    client: &'a aws_sdk_dynamodb::Client,
    table: &'a str,
    tenant_id: &'a str,
    sponsor_id: &'a str,
    name: &'a str,
    email: &'a str,
    status: &'a str,
    version: u64,
}

async fn insert_sponsor(p: &InsertSponsorParams<'_>) -> String {
    let name_lower = p.name.to_lowercase();
    let sk = sponsor_sk(&name_lower, p.sponsor_id);
    let now = chrono::Utc::now().to_rfc3339();
    let mut put = p.client
        .put_item()
        .table_name(p.table)
        .item("pk", AttributeValue::S(p.tenant_id.to_string()))
        .item("sk", AttributeValue::S(sk.clone()))
        .item("sponsorId", AttributeValue::S(p.sponsor_id.to_string()))
        .item("sponsorName", AttributeValue::S(p.name.to_string()))
        .item("contactEmail", AttributeValue::S(p.email.to_string()))
        .item("status", AttributeValue::S(p.status.to_string()))
        .item("version", AttributeValue::N(p.version.to_string()))
        .item(
            "totalFulfilledSponsorships",
            AttributeValue::N("0".to_string()),
        )
        .item("totalRevenue", AttributeValue::N("0".to_string()))
        .item("createdAt", AttributeValue::S(now.clone()))
        .item("updatedAt", AttributeValue::S(now))
        .item("GSI2PK", AttributeValue::S(p.tenant_id.to_string()))
        .item("GSI2SK", AttributeValue::S(p.sponsor_id.to_string()));
    if p.status == "archived" {
        put = put.item(
            "archivedAt",
            AttributeValue::S(chrono::Utc::now().to_rfc3339()),
        );
    }
    put.send().await.expect("Failed to insert sponsor");
    sk
}

struct InsertSponsorshipParams<'a> {
    client: &'a aws_sdk_dynamodb::Client,
    table: &'a str,
    tenant_id: &'a str,
    sponsor_id: &'a str,
    sponsorship_id: &'a str,
    date: &'a str,
    amount: f64,
    status: &'a str,
    issue_id: &'a str,
}

async fn insert_sponsorship(p: &InsertSponsorshipParams<'_>) -> String {
    let sk = sponsorship_sk(p.sponsor_id, p.date, p.sponsorship_id);
    let now = chrono::Utc::now().to_rfc3339();
    let mut put = p.client
        .put_item()
        .table_name(p.table)
        .item("pk", AttributeValue::S(p.tenant_id.to_string()))
        .item("sk", AttributeValue::S(sk.clone()))
        .item(
            "sponsorshipId",
            AttributeValue::S(p.sponsorship_id.to_string()),
        )
        .item("sponsorId", AttributeValue::S(p.sponsor_id.to_string()))
        .item("issueId", AttributeValue::S(p.issue_id.to_string()))
        .item("issueTitle", AttributeValue::S("Test Issue".to_string()))
        .item("sponsorshipDate", AttributeValue::S(p.date.to_string()))
        .item("amountCharged", AttributeValue::N(p.amount.to_string()))
        .item("status", AttributeValue::S(p.status.to_string()))
        .item("placementType", AttributeValue::S("primary".to_string()))
        .item("sponsorLinkIds", AttributeValue::L(vec![]))
        .item("createdAt", AttributeValue::S(now.clone()))
        .item("updatedAt", AttributeValue::S(now));
    if p.status == "fulfilled" {
        put = put.item(
            "fulfilledAt",
            AttributeValue::S(chrono::Utc::now().to_rfc3339()),
        );
    }
    put.send().await.expect("Failed to insert sponsorship");
    sk
}

async fn insert_link_record(
    client: &aws_sdk_dynamodb::Client,
    table: &str,
    issue_id: &str,
    link_hash: &str,
    total_clicks: u64,
) {
    client
        .put_item()
        .table_name(table)
        .item("pk", AttributeValue::S(issue_id.to_string()))
        .item("sk", AttributeValue::S(format!("link#{}", link_hash)))
        .item("linkHash", AttributeValue::S(link_hash.to_string()))
        .item("clicks_total", AttributeValue::N(total_clicks.to_string()))
        .item("url", AttributeValue::S("https://example.com".to_string()))
        .send()
        .await
        .expect("Failed to insert link record");
}

struct InsertOutreachRecordParams<'a> {
    client: &'a aws_sdk_dynamodb::Client,
    table: &'a str,
    tenant_id: &'a str,
    sponsor_id: &'a str,
    generated_at: &'a str,
    subject: &'a str,
    body: &'a str,
    is_fallback: bool,
}

async fn insert_outreach_record(p: &InsertOutreachRecordParams<'_>) -> String {
    let sk = outreach_sk(p.sponsor_id, p.generated_at);
    p.client
        .put_item()
        .table_name(p.table)
        .item("pk", AttributeValue::S(p.tenant_id.to_string()))
        .item("sk", AttributeValue::S(sk.clone()))
        .item("sponsorId", AttributeValue::S(p.sponsor_id.to_string()))
        .item("generatedAt", AttributeValue::S(p.generated_at.to_string()))
        .item("subject", AttributeValue::S(p.subject.to_string()))
        .item("body", AttributeValue::S(p.body.to_string()))
        .item("isFallback", AttributeValue::Bool(p.is_fallback))
        .item("metricsSource", AttributeValue::S("general".to_string()))
        .send()
        .await
        .expect("Failed to insert outreach record");
    sk
}

async fn insert_outreach_job(
    client: &aws_sdk_dynamodb::Client,
    table: &str,
    tenant_id: &str,
    sponsor_id: &str,
    job_id: &str,
    status: &str,
    outreach_record_sk: Option<&str>,
) -> String {
    let sk = outreach_job_sk(job_id);
    let now = chrono::Utc::now();
    let ttl = now.timestamp() + 86400;
    let mut put = client
        .put_item()
        .table_name(table)
        .item("pk", AttributeValue::S(tenant_id.to_string()))
        .item("sk", AttributeValue::S(sk.clone()))
        .item("jobId", AttributeValue::S(job_id.to_string()))
        .item("sponsorId", AttributeValue::S(sponsor_id.to_string()))
        .item("status", AttributeValue::S(status.to_string()))
        .item("createdAt", AttributeValue::S(now.to_rfc3339()))
        .item("updatedAt", AttributeValue::S(now.to_rfc3339()))
        .item("ttl", AttributeValue::N(ttl.to_string()));
    if let Some(record_sk) = outreach_record_sk {
        put = put.item("outreachRecordSk", AttributeValue::S(record_sk.to_string()));
    }
    put.send().await.expect("Failed to insert outreach job");
    sk
}

async fn insert_pricing_record(
    client: &aws_sdk_dynamodb::Client,
    table: &str,
    tenant_id: &str,
    subscriber_count: f64,
    recommended_rate: f64,
    open_rate: f64,
    click_through_rate: f64,
) {
    let now = chrono::Utc::now().to_rfc3339();
    client
        .put_item()
        .table_name(table)
        .item("pk", AttributeValue::S(tenant_id.to_string()))
        .item("sk", AttributeValue::S(format!("pricing#{}", now)))
        .item(
            "subscriberCount",
            AttributeValue::N(subscriber_count.to_string()),
        )
        .item(
            "recommendedRate",
            AttributeValue::N(recommended_rate.to_string()),
        )
        .item("openRate", AttributeValue::N(open_rate.to_string()))
        .item(
            "clickThroughRate",
            AttributeValue::N(click_through_rate.to_string()),
        )
        .item("createdAt", AttributeValue::S(now))
        .send()
        .await
        .expect("Failed to insert pricing record");
}

async fn cleanup_item(client: &aws_sdk_dynamodb::Client, table: &str, pk: &str, sk: &str) {
    let _ = client
        .delete_item()
        .table_name(table)
        .key("pk", AttributeValue::S(pk.to_string()))
        .key("sk", AttributeValue::S(sk.to_string()))
        .send()
        .await;
}

async fn cleanup_items_with_prefix(
    client: &aws_sdk_dynamodb::Client,
    table: &str,
    pk: &str,
    sk_prefix: &str,
) {
    if let Ok(output) = client
        .query()
        .table_name(table)
        .key_condition_expression("pk = :pk AND begins_with(sk, :prefix)")
        .expression_attribute_values(":pk", AttributeValue::S(pk.to_string()))
        .expression_attribute_values(":prefix", AttributeValue::S(sk_prefix.to_string()))
        .send()
        .await
    {
        for item in output.items() {
            if let (Some(pk_val), Some(sk_val)) = (
                item.get("pk").and_then(|v| v.as_s().ok()),
                item.get("sk").and_then(|v| v.as_s().ok()),
            ) {
                let _ = client
                    .delete_item()
                    .table_name(table)
                    .key("pk", AttributeValue::S(pk_val.to_string()))
                    .key("sk", AttributeValue::S(sk_val.to_string()))
                    .send()
                    .await;
            }
        }
    }
}

async fn get_sponsor_by_gsi2(
    client: &aws_sdk_dynamodb::Client,
    table: &str,
    tenant_id: &str,
    sponsor_id: &str,
) -> Option<HashMap<String, AttributeValue>> {
    let result = client
        .query()
        .table_name(table)
        .index_name("GSI2")
        .key_condition_expression("GSI2PK = :pk AND GSI2SK = :sk")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.to_string()))
        .expression_attribute_values(":sk", AttributeValue::S(sponsor_id.to_string()))
        .limit(1)
        .send()
        .await
        .ok()?;
    result.items().first().cloned()
}

// ── Test 15.1: End-to-end sponsor CRUD lifecycle ───────────────────────
// Requirements: 1.1–1.11

#[tokio::test]
#[ignore]
async fn test_sponsor_crud_lifecycle() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let sponsor_id = uuid::Uuid::new_v4().to_string();
    let table = get_table_name();
    let client = get_test_dynamodb_client().await;

    println!("=== 15.1: End-to-End Sponsor CRUD Lifecycle ===");

    // 1. Create
    let sk = insert_sponsor(&InsertSponsorParams {
        client: &client, table: &table, tenant_id: &tenant_id, sponsor_id: &sponsor_id,
        name: "Acme Corp", email: "jane@acme.com", status: "active", version: 1,
    })
    .await;

    // 2. Read via GSI2
    let sponsor = get_sponsor_by_gsi2(&client, &table, &tenant_id, &sponsor_id)
        .await
        .expect("Sponsor not found via GSI2");
    assert_eq!(
        sponsor
            .get("sponsorName")
            .and_then(|v| v.as_s().ok())
            .unwrap(),
        "Acme Corp"
    );
    assert_eq!(
        sponsor.get("status").and_then(|v| v.as_s().ok()).unwrap(),
        "active"
    );
    let v = sponsor
        .get("version")
        .and_then(|v| v.as_n().ok())
        .and_then(|n| n.parse::<u64>().ok())
        .unwrap();
    assert_eq!(v, 1);
    println!("✓ Created and read sponsor: version={}", v);

    // 3. Update with optimistic locking
    let update_result = client
        .update_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(sk.clone()))
        .update_expression("SET sponsorName = :name, version = :new_ver, updatedAt = :now")
        .condition_expression("version = :cur")
        .expression_attribute_values(":name", AttributeValue::S("Acme Corp Updated".to_string()))
        .expression_attribute_values(":new_ver", AttributeValue::N("2".to_string()))
        .expression_attribute_values(":cur", AttributeValue::N("1".to_string()))
        .expression_attribute_values(":now", AttributeValue::S(chrono::Utc::now().to_rfc3339()))
        .return_values(aws_sdk_dynamodb::types::ReturnValue::AllNew)
        .send()
        .await
        .expect("Update failed");
    let updated_v = update_result
        .attributes()
        .unwrap()
        .get("version")
        .and_then(|v| v.as_n().ok())
        .and_then(|n| n.parse::<u64>().ok())
        .unwrap();
    assert_eq!(updated_v, 2);
    println!("✓ Updated sponsor: version={}", updated_v);

    // 4. Archive
    client
        .update_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(sk.clone()))
        .update_expression("SET #st = :archived, archivedAt = :now, updatedAt = :now")
        .expression_attribute_names("#st", "status")
        .expression_attribute_values(":archived", AttributeValue::S("archived".to_string()))
        .expression_attribute_values(":now", AttributeValue::S(chrono::Utc::now().to_rfc3339()))
        .send()
        .await
        .expect("Archive failed");

    let archived = client
        .get_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(sk.clone()))
        .send()
        .await
        .expect("Get failed")
        .item()
        .cloned()
        .expect("Not found");
    assert_eq!(
        archived.get("status").and_then(|v| v.as_s().ok()).unwrap(),
        "archived"
    );
    assert!(
        archived.contains_key("archivedAt"),
        "archivedAt should be set"
    );
    println!("✓ Archived sponsor, archivedAt present");

    // 5. Restore
    client
        .update_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(sk.clone()))
        .update_expression("SET #st = :active, updatedAt = :now REMOVE archivedAt")
        .expression_attribute_names("#st", "status")
        .expression_attribute_values(":active", AttributeValue::S("active".to_string()))
        .expression_attribute_values(":now", AttributeValue::S(chrono::Utc::now().to_rfc3339()))
        .send()
        .await
        .expect("Restore failed");

    let restored = client
        .get_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(sk.clone()))
        .send()
        .await
        .expect("Get failed")
        .item()
        .cloned()
        .expect("Not found");
    assert_eq!(
        restored.get("status").and_then(|v| v.as_s().ok()).unwrap(),
        "active"
    );
    assert!(
        !restored.contains_key("archivedAt"),
        "archivedAt should be cleared"
    );
    println!("✓ Restored sponsor to active");

    cleanup_item(&client, &table, &tenant_id, &sk).await;
    println!("=== 15.1 Complete ===");
}

// ── Test 15.2: Sponsorship lifecycle with pricing snapshot ─────────────
// Requirements: 2.5, 3.1–3.5, 8.1, 8.2

#[tokio::test]
#[ignore]
async fn test_sponsorship_lifecycle_with_pricing_snapshot() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let sponsor_id = uuid::Uuid::new_v4().to_string();
    let sponsorship_id = uuid::Uuid::new_v4().to_string();
    let table = get_table_name();
    let client = get_test_dynamodb_client().await;

    println!("=== 15.2: Sponsorship Lifecycle with Pricing Snapshot ===");

    let sponsor_sk = insert_sponsor(&InsertSponsorParams {
        client: &client, table: &table, tenant_id: &tenant_id, sponsor_id: &sponsor_id,
        name: "Lifecycle Sponsor", email: "lifecycle@test.com", status: "active", version: 1,
    })
    .await;
    insert_pricing_record(&client, &table, &tenant_id, 5000.0, 150.0, 0.48, 0.12).await;

    // 1. Create sponsorship (draft)
    let ship_sk = insert_sponsorship(&InsertSponsorshipParams {
        client: &client, table: &table, tenant_id: &tenant_id, sponsor_id: &sponsor_id,
        sponsorship_id: &sponsorship_id, date: "2025-01-15", amount: 150.0,
        status: "draft", issue_id: &format!("{}#42", tenant_id),
    })
    .await;
    println!("✓ Sponsorship created (draft)");

    // 2. Transition to booked
    client
        .update_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(ship_sk.clone()))
        .update_expression("SET #st = :booked, updatedAt = :now")
        .expression_attribute_names("#st", "status")
        .expression_attribute_values(":booked", AttributeValue::S("booked".to_string()))
        .expression_attribute_values(":now", AttributeValue::S(chrono::Utc::now().to_rfc3339()))
        .send()
        .await
        .expect("Booking failed");

    let booked = client
        .get_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(ship_sk.clone()))
        .send()
        .await
        .unwrap()
        .item()
        .cloned()
        .unwrap();
    assert_eq!(
        booked.get("status").and_then(|v| v.as_s().ok()).unwrap(),
        "booked"
    );
    println!("✓ Transitioned to booked");

    // 3. Fulfill with pricing snapshot
    let snapshot_map = AttributeValue::M(HashMap::from([
        (
            "subscriberCount".to_string(),
            AttributeValue::N("5000".to_string()),
        ),
        (
            "recommendedRate".to_string(),
            AttributeValue::N("150".to_string()),
        ),
        (
            "openRate".to_string(),
            AttributeValue::N("0.48".to_string()),
        ),
        (
            "clickThroughRate".to_string(),
            AttributeValue::N("0.12".to_string()),
        ),
    ]));
    client
        .update_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(ship_sk.clone()))
        .update_expression(
            "SET #st = :f, fulfilledAt = :now, pricingSnapshot = :snap, updatedAt = :now",
        )
        .expression_attribute_names("#st", "status")
        .expression_attribute_values(":f", AttributeValue::S("fulfilled".to_string()))
        .expression_attribute_values(":now", AttributeValue::S(chrono::Utc::now().to_rfc3339()))
        .expression_attribute_values(":snap", snapshot_map)
        .send()
        .await
        .expect("Fulfillment failed");

    let fulfilled = client
        .get_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(ship_sk.clone()))
        .send()
        .await
        .unwrap()
        .item()
        .cloned()
        .unwrap();

    let snap = fulfilled
        .get("pricingSnapshot")
        .and_then(|v| v.as_m().ok())
        .expect("pricingSnapshot missing");
    assert_eq!(
        snap.get("subscriberCount")
            .and_then(|v| v.as_n().ok())
            .and_then(|n| n.parse::<f64>().ok())
            .unwrap(),
        5000.0
    );
    assert_eq!(
        snap.get("recommendedRate")
            .and_then(|v| v.as_n().ok())
            .and_then(|n| n.parse::<f64>().ok())
            .unwrap(),
        150.0
    );
    assert!(fulfilled.contains_key("fulfilledAt"));
    assert_eq!(
        fulfilled
            .get("amountCharged")
            .and_then(|v| v.as_n().ok())
            .and_then(|n| n.parse::<f64>().ok())
            .unwrap(),
        150.0
    );
    println!("✓ Fulfilled with pricingSnapshot captured");

    // 4. Attempt amountCharged update on fulfilled entry (should fail)
    let update_result = client
        .update_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(ship_sk.clone()))
        .update_expression("SET amountCharged = :amt")
        .condition_expression("#st <> :f")
        .expression_attribute_names("#st", "status")
        .expression_attribute_values(":amt", AttributeValue::N("200".to_string()))
        .expression_attribute_values(":f", AttributeValue::S("fulfilled".to_string()))
        .send()
        .await;
    assert!(
        update_result.is_err(),
        "amountCharged update on fulfilled entry should fail"
    );

    let unchanged = client
        .get_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(ship_sk.clone()))
        .send()
        .await
        .unwrap()
        .item()
        .cloned()
        .unwrap();
    assert_eq!(
        unchanged
            .get("amountCharged")
            .and_then(|v| v.as_n().ok())
            .and_then(|n| n.parse::<f64>().ok())
            .unwrap(),
        150.0
    );
    println!("✓ amountCharged immutable on fulfilled entry");

    cleanup_item(&client, &table, &tenant_id, &sponsor_sk).await;
    cleanup_item(&client, &table, &tenant_id, &ship_sk).await;
    cleanup_items_with_prefix(&client, &table, &tenant_id, "pricing#").await;
    println!("=== 15.2 Complete ===");
}

// ── Test 15.3: Link attribution and click totals ───────────────────────
// Requirements: 4.1–4.5, 4.8

#[tokio::test]
#[ignore]
async fn test_link_attribution_and_click_totals() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let sponsor_id = uuid::Uuid::new_v4().to_string();
    let sponsorship_id = uuid::Uuid::new_v4().to_string();
    let issue_id = format!("{}#42", tenant_id);
    let table = get_table_name();
    let client = get_test_dynamodb_client().await;

    println!("=== 15.3: Link Attribution and Click Totals ===");

    let sponsor_sk = insert_sponsor(&InsertSponsorParams {
        client: &client, table: &table, tenant_id: &tenant_id, sponsor_id: &sponsor_id,
        name: "Link Sponsor", email: "links@test.com", status: "active", version: 1,
    })
    .await;
    let ship_sk = insert_sponsorship(&InsertSponsorshipParams {
        client: &client, table: &table, tenant_id: &tenant_id, sponsor_id: &sponsor_id,
        sponsorship_id: &sponsorship_id, date: "2025-01-15", amount: 100.0,
        status: "booked", issue_id: &issue_id,
    })
    .await;

    // Create link records
    let lh1 = format!("lnk-{}", &uuid::Uuid::new_v4().to_string()[..8]);
    let lh2 = format!("lnk-{}", &uuid::Uuid::new_v4().to_string()[..8]);
    insert_link_record(&client, &table, &issue_id, &lh1, 120).await;
    insert_link_record(&client, &table, &issue_id, &lh2, 80).await;
    println!("✓ Link records created: {} (120), {} (80)", lh1, lh2);

    // Associate links
    client
        .update_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(ship_sk.clone()))
        .update_expression("SET sponsorLinkIds = :links, updatedAt = :now")
        .expression_attribute_values(
            ":links",
            AttributeValue::L(vec![
                AttributeValue::S(lh1.clone()),
                AttributeValue::S(lh2.clone()),
            ]),
        )
        .expression_attribute_values(":now", AttributeValue::S(chrono::Utc::now().to_rfc3339()))
        .send()
        .await
        .expect("Link association failed");

    // Verify stored links
    let entry = client
        .get_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(ship_sk.clone()))
        .send()
        .await
        .unwrap()
        .item()
        .cloned()
        .unwrap();
    let stored = entry
        .get("sponsorLinkIds")
        .and_then(|v| v.as_l().ok())
        .unwrap();
    assert_eq!(stored.len(), 2);
    println!("✓ Links associated");

    // Compute click totals
    let mut total: u64 = 0;
    for lh in [&lh1, &lh2] {
        let rec = client
            .get_item()
            .table_name(&table)
            .key("pk", AttributeValue::S(issue_id.clone()))
            .key("sk", AttributeValue::S(format!("link#{}", lh)))
            .send()
            .await
            .unwrap()
            .item()
            .cloned()
            .unwrap();
        total += rec
            .get("clicks_total")
            .and_then(|v| v.as_n().ok())
            .and_then(|n| n.parse::<u64>().ok())
            .unwrap_or(0);
    }
    assert_eq!(total, 200);
    println!("✓ Click totals computed: {}", total);

    // Store click cache
    let cache = AttributeValue::M(HashMap::from([
        (
            "totalClicks".to_string(),
            AttributeValue::N("200".to_string()),
        ),
        (
            "uniqueClicks".to_string(),
            AttributeValue::N("160".to_string()),
        ),
        (
            "computedAt".to_string(),
            AttributeValue::S(chrono::Utc::now().to_rfc3339()),
        ),
    ]));
    client
        .update_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(ship_sk.clone()))
        .update_expression("SET clickCache = :c")
        .expression_attribute_values(":c", cache)
        .send()
        .await
        .expect("Cache update failed");

    let cached = client
        .get_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(ship_sk.clone()))
        .send()
        .await
        .unwrap()
        .item()
        .cloned()
        .unwrap();
    let cc = cached
        .get("clickCache")
        .and_then(|v| v.as_m().ok())
        .unwrap();
    assert_eq!(
        cc.get("totalClicks")
            .and_then(|v| v.as_n().ok())
            .and_then(|n| n.parse::<u64>().ok())
            .unwrap(),
        200
    );
    println!("✓ Click cache stored");

    cleanup_item(&client, &table, &tenant_id, &sponsor_sk).await;
    cleanup_item(&client, &table, &tenant_id, &ship_sk).await;
    cleanup_item(&client, &table, &issue_id, &format!("link#{}", lh1)).await;
    cleanup_item(&client, &table, &issue_id, &format!("link#{}", lh2)).await;
    println!("=== 15.3 Complete ===");
}

// ── Test 15.4: Outreach generation with mocked Bedrock ─────────────────
// Requirements: 6.3, 6.4, 7.1, 9.1, 9.2

#[tokio::test]
#[ignore]
async fn test_outreach_generation_with_mocked_bedrock() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let sponsor_id = uuid::Uuid::new_v4().to_string();
    let job_id = uuid::Uuid::new_v4().to_string();
    let table = get_table_name();
    let client = get_test_dynamodb_client().await;

    println!("=== 15.4: Outreach Generation with Mocked Bedrock ===");

    let sponsor_sk = insert_sponsor(&InsertSponsorParams {
        client: &client, table: &table, tenant_id: &tenant_id, sponsor_id: &sponsor_id,
        name: "Outreach Sponsor", email: "outreach@test.com", status: "active", version: 1,
    })
    .await;
    insert_pricing_record(&client, &table, &tenant_id, 5000.0, 150.0, 0.48, 0.12).await;

    // 1. Create job (processing)
    let job_sk = insert_outreach_job(
        &client,
        &table,
        &tenant_id,
        &sponsor_id,
        &job_id,
        "processing",
        None,
    )
    .await;

    let job = client
        .get_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(job_sk.clone()))
        .send()
        .await
        .unwrap()
        .item()
        .cloned()
        .unwrap();
    assert_eq!(
        job.get("status").and_then(|v| v.as_s().ok()).unwrap(),
        "processing"
    );
    println!("✓ Job created: processing");

    // 2. Simulate Bedrock completion
    let generated_at = chrono::Utc::now().to_rfc3339();
    let outreach_record_sk = insert_outreach_record(&InsertOutreachRecordParams {
        client: &client, table: &table, tenant_id: &tenant_id, sponsor_id: &sponsor_id,
        generated_at: &generated_at,
        subject: "Sponsorship Opportunity — Test Newsletter",
        body: "Hi there, I wanted to reach out about a sponsorship opportunity...",
        is_fallback: false,
    })
    .await;

    client
        .update_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(job_sk.clone()))
        .update_expression("SET #st = :c, outreachRecordSk = :rsk, updatedAt = :now")
        .expression_attribute_names("#st", "status")
        .expression_attribute_values(":c", AttributeValue::S("completed".to_string()))
        .expression_attribute_values(":rsk", AttributeValue::S(outreach_record_sk.clone()))
        .expression_attribute_values(":now", AttributeValue::S(chrono::Utc::now().to_rfc3339()))
        .send()
        .await
        .expect("Job update failed");

    // 3. Poll job — completed with outreachRecordSk
    let completed = client
        .get_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(job_sk.clone()))
        .send()
        .await
        .unwrap()
        .item()
        .cloned()
        .unwrap();
    assert_eq!(
        completed.get("status").and_then(|v| v.as_s().ok()).unwrap(),
        "completed"
    );
    assert_eq!(
        completed
            .get("outreachRecordSk")
            .and_then(|v| v.as_s().ok())
            .unwrap(),
        &outreach_record_sk
    );
    println!("✓ Job completed with outreachRecordSk");

    // 4. Fetch outreach list — verify record fields
    let prefix = format!("outreach#{}#", sponsor_id);
    let list = client
        .query()
        .table_name(&table)
        .key_condition_expression("pk = :pk AND begins_with(sk, :p)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
        .expression_attribute_values(":p", AttributeValue::S(prefix))
        .scan_index_forward(false)
        .send()
        .await
        .expect("Query failed");

    let items = list.items();
    assert!(!items.is_empty());
    let rec = &items[0];
    assert!(!rec
        .get("subject")
        .and_then(|v| v.as_s().ok())
        .unwrap()
        .is_empty());
    assert!(!rec
        .get("body")
        .and_then(|v| v.as_s().ok())
        .unwrap()
        .is_empty());
    assert!(!rec
        .get("isFallback")
        .and_then(|v| v.as_bool().ok())
        .unwrap());
    assert_eq!(
        rec.get("sponsorId").and_then(|v| v.as_s().ok()).unwrap(),
        &sponsor_id
    );
    println!("✓ Outreach record verified with all fields");

    cleanup_item(&client, &table, &tenant_id, &sponsor_sk).await;
    cleanup_item(&client, &table, &tenant_id, &job_sk).await;
    cleanup_item(&client, &table, &tenant_id, &outreach_record_sk).await;
    cleanup_items_with_prefix(&client, &table, &tenant_id, "pricing#").await;
    println!("=== 15.4 Complete ===");
}

// ── Test 15.5: Outreach template fallback ──────────────────────────────
// Requirements: 6.7, 7.6

#[tokio::test]
#[ignore]
async fn test_outreach_template_fallback() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let sponsor_id = uuid::Uuid::new_v4().to_string();
    let job_id = uuid::Uuid::new_v4().to_string();
    let table = get_table_name();
    let client = get_test_dynamodb_client().await;

    println!("=== 15.5: Outreach Template Fallback ===");

    let sponsor_sk = insert_sponsor(&InsertSponsorParams {
        client: &client, table: &table, tenant_id: &tenant_id, sponsor_id: &sponsor_id,
        name: "Fallback Sponsor", email: "fallback@test.com", status: "active", version: 1,
    })
    .await;

    // 1. Create job (processing)
    let job_sk = insert_outreach_job(
        &client,
        &table,
        &tenant_id,
        &sponsor_id,
        &job_id,
        "processing",
        None,
    )
    .await;

    // 2. Simulate Bedrock failure → fallback
    let generated_at = chrono::Utc::now().to_rfc3339();
    let outreach_record_sk = insert_outreach_record(&InsertOutreachRecordParams {
        client: &client, table: &table, tenant_id: &tenant_id, sponsor_id: &sponsor_id,
        generated_at: &generated_at,
        subject: "Sponsorship Opportunity — Test Newsletter",
        body: "Hi there,\n\nI wanted to reach out about a sponsorship opportunity with Test Newsletter.\n\nOur newsletter reaches 5,000 subscribers with a 48.0% open rate.\n\nWould you be interested in discussing a sponsorship for an upcoming issue?\n\nBest regards",
        is_fallback: true,
    }).await;

    client
        .update_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(job_sk.clone()))
        .update_expression("SET #st = :c, outreachRecordSk = :rsk, updatedAt = :now")
        .expression_attribute_names("#st", "status")
        .expression_attribute_values(":c", AttributeValue::S("completed".to_string()))
        .expression_attribute_values(":rsk", AttributeValue::S(outreach_record_sk.clone()))
        .expression_attribute_values(":now", AttributeValue::S(chrono::Utc::now().to_rfc3339()))
        .send()
        .await
        .expect("Job update failed");
    println!("✓ Fallback outreach record created");

    // 3. Verify isFallback=true
    let outreach = client
        .get_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(outreach_record_sk.clone()))
        .send()
        .await
        .unwrap()
        .item()
        .cloned()
        .unwrap();

    assert!(outreach
        .get("isFallback")
        .and_then(|v| v.as_bool().ok())
        .unwrap());
    let body = outreach.get("body").and_then(|v| v.as_s().ok()).unwrap();
    assert!(
        body.contains("sponsorship opportunity"),
        "Fallback body should contain template text"
    );
    assert!(!outreach
        .get("subject")
        .and_then(|v| v.as_s().ok())
        .unwrap()
        .is_empty());
    println!("✓ Fallback verified: isFallback=true");

    // 4. Verify job references fallback record
    let job = client
        .get_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(job_sk.clone()))
        .send()
        .await
        .unwrap()
        .item()
        .cloned()
        .unwrap();
    assert_eq!(
        job.get("outreachRecordSk")
            .and_then(|v| v.as_s().ok())
            .unwrap(),
        &outreach_record_sk
    );
    println!("✓ Job references fallback record");

    cleanup_item(&client, &table, &tenant_id, &sponsor_sk).await;
    cleanup_item(&client, &table, &tenant_id, &job_sk).await;
    cleanup_item(&client, &table, &tenant_id, &outreach_record_sk).await;
    println!("=== 15.5 Complete ===");
}

// ── Test 15.6: Tenant isolation ────────────────────────────────────────
// Requirements: 1.12, 1.13, 9.3

#[tokio::test]
#[ignore]
async fn test_tenant_isolation() {
    let tenant_a = format!("test-tenant-a-{}", uuid::Uuid::new_v4());
    let tenant_b = format!("test-tenant-b-{}", uuid::Uuid::new_v4());
    let sponsor_a_id = uuid::Uuid::new_v4().to_string();
    let sponsor_b_id = uuid::Uuid::new_v4().to_string();
    let table = get_table_name();
    let client = get_test_dynamodb_client().await;

    println!("=== 15.6: Tenant Isolation ===");

    let sk_a = insert_sponsor(&InsertSponsorParams {
        client: &client, table: &table, tenant_id: &tenant_a, sponsor_id: &sponsor_a_id,
        name: "Tenant A Sponsor", email: "a@tenant-a.com", status: "active", version: 1,
    })
    .await;
    let sk_b = insert_sponsor(&InsertSponsorParams {
        client: &client, table: &table, tenant_id: &tenant_b, sponsor_id: &sponsor_b_id,
        name: "Tenant B Sponsor", email: "b@tenant-b.com", status: "active", version: 1,
    })
    .await;
    println!("✓ Sponsors created for both tenants");

    // Tenant A sees only their data
    let result_a = client
        .query()
        .table_name(&table)
        .key_condition_expression("pk = :pk AND begins_with(sk, :p)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_a.clone()))
        .expression_attribute_values(":p", AttributeValue::S("sponsor#".to_string()))
        .send()
        .await
        .expect("Query A failed");
    assert_eq!(result_a.items().len(), 1);
    assert_eq!(
        result_a.items()[0]
            .get("sponsorName")
            .and_then(|v| v.as_s().ok())
            .unwrap(),
        "Tenant A Sponsor"
    );
    println!("✓ Tenant A sees only their sponsor");

    // Tenant B sees only their data
    let result_b = client
        .query()
        .table_name(&table)
        .key_condition_expression("pk = :pk AND begins_with(sk, :p)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_b.clone()))
        .expression_attribute_values(":p", AttributeValue::S("sponsor#".to_string()))
        .send()
        .await
        .expect("Query B failed");
    assert_eq!(result_b.items().len(), 1);
    assert_eq!(
        result_b.items()[0]
            .get("sponsorName")
            .and_then(|v| v.as_s().ok())
            .unwrap(),
        "Tenant B Sponsor"
    );
    println!("✓ Tenant B sees only their sponsor");

    // Cross-tenant GSI2 isolation
    assert!(
        get_sponsor_by_gsi2(&client, &table, &tenant_a, &sponsor_b_id)
            .await
            .is_none()
    );
    assert!(
        get_sponsor_by_gsi2(&client, &table, &tenant_b, &sponsor_a_id)
            .await
            .is_none()
    );
    println!("✓ Cross-tenant GSI2 lookups return nothing");

    // Sponsorship isolation
    let ship_id = uuid::Uuid::new_v4().to_string();
    let ship_sk = insert_sponsorship(&InsertSponsorshipParams {
        client: &client, table: &table, tenant_id: &tenant_a, sponsor_id: &sponsor_a_id,
        sponsorship_id: &ship_id, date: "2025-01-15", amount: 100.0,
        status: "draft", issue_id: &format!("{}#1", tenant_a),
    })
    .await;

    let cross = client
        .query()
        .table_name(&table)
        .key_condition_expression("pk = :pk AND begins_with(sk, :p)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_b.clone()))
        .expression_attribute_values(
            ":p",
            AttributeValue::S(format!("sponsorship#{}#", sponsor_a_id)),
        )
        .send()
        .await
        .unwrap();
    assert!(
        cross.items().is_empty(),
        "Tenant B should not see tenant A's sponsorships"
    );
    println!("✓ Sponsorship data is tenant-isolated");

    cleanup_item(&client, &table, &tenant_a, &sk_a).await;
    cleanup_item(&client, &table, &tenant_b, &sk_b).await;
    cleanup_item(&client, &table, &tenant_a, &ship_sk).await;
    println!("=== 15.6 Complete ===");
}

// ── Test 15.7: Concurrent edit conflict ────────────────────────────────
// Requirements: 2.7, 5.9, 12.7

#[tokio::test]
#[ignore]
async fn test_concurrent_edit_conflict() {
    let tenant_id = format!("test-tenant-{}", uuid::Uuid::new_v4());
    let sponsor_id = uuid::Uuid::new_v4().to_string();
    let table = get_table_name();
    let client = get_test_dynamodb_client().await;

    println!("=== 15.7: Concurrent Edit Conflict ===");

    let sk = insert_sponsor(&InsertSponsorParams {
        client: &client, table: &table, tenant_id: &tenant_id, sponsor_id: &sponsor_id,
        name: "Conflict Sponsor", email: "conflict@test.com", status: "active", version: 1,
    })
    .await;
    println!("✓ Sponsor created with version 1");

    // Update A succeeds (version 1 → 2)
    let update_a = client
        .update_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(sk.clone()))
        .update_expression("SET sponsorName = :n, version = :nv, updatedAt = :now")
        .condition_expression("version = :cv")
        .expression_attribute_values(":n", AttributeValue::S("Updated by A".to_string()))
        .expression_attribute_values(":nv", AttributeValue::N("2".to_string()))
        .expression_attribute_values(":cv", AttributeValue::N("1".to_string()))
        .expression_attribute_values(":now", AttributeValue::S(chrono::Utc::now().to_rfc3339()))
        .send()
        .await;
    assert!(update_a.is_ok(), "First update should succeed");
    println!("✓ Update A succeeded");

    // Update B fails (also expects version 1, but it's now 2)
    let update_b = client
        .update_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(sk.clone()))
        .update_expression("SET sponsorName = :n, version = :nv, updatedAt = :now")
        .condition_expression("version = :cv")
        .expression_attribute_values(":n", AttributeValue::S("Updated by B".to_string()))
        .expression_attribute_values(":nv", AttributeValue::N("2".to_string()))
        .expression_attribute_values(":cv", AttributeValue::N("1".to_string()))
        .expression_attribute_values(":now", AttributeValue::S(chrono::Utc::now().to_rfc3339()))
        .send()
        .await;
    assert!(
        update_b.is_err(),
        "Second update should fail (version conflict)"
    );

    if let Err(err) = update_b {
        let svc = err.into_service_error();
        assert!(
            svc.is_conditional_check_failed_exception(),
            "Should be ConditionalCheckFailedException, got: {}",
            svc
        );
        println!("✓ Update B rejected with ConditionalCheckFailedException (409)");
    }

    // Verify final state
    let final_item = client
        .get_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(sk.clone()))
        .send()
        .await
        .unwrap()
        .item()
        .cloned()
        .unwrap();
    assert_eq!(
        final_item
            .get("sponsorName")
            .and_then(|v| v.as_s().ok())
            .unwrap(),
        "Updated by A"
    );
    assert_eq!(
        final_item
            .get("version")
            .and_then(|v| v.as_n().ok())
            .and_then(|n| n.parse::<u64>().ok())
            .unwrap(),
        2
    );
    println!("✓ Final state: name=Updated by A, version=2");

    // Retry B with correct version succeeds
    let retry = client
        .update_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(sk.clone()))
        .update_expression("SET sponsorName = :n, version = :nv, updatedAt = :now")
        .condition_expression("version = :cv")
        .expression_attribute_values(":n", AttributeValue::S("Updated by B (retry)".to_string()))
        .expression_attribute_values(":nv", AttributeValue::N("3".to_string()))
        .expression_attribute_values(":cv", AttributeValue::N("2".to_string()))
        .expression_attribute_values(":now", AttributeValue::S(chrono::Utc::now().to_rfc3339()))
        .send()
        .await;
    assert!(retry.is_ok(), "Retry with correct version should succeed");

    let retried = client
        .get_item()
        .table_name(&table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(sk.clone()))
        .send()
        .await
        .unwrap()
        .item()
        .cloned()
        .unwrap();
    assert_eq!(
        retried
            .get("version")
            .and_then(|v| v.as_n().ok())
            .and_then(|n| n.parse::<u64>().ok())
            .unwrap(),
        3
    );
    println!("✓ Retry succeeded, version=3");

    cleanup_item(&client, &table, &tenant_id, &sk).await;
    println!("=== 15.7 Complete ===");
}
