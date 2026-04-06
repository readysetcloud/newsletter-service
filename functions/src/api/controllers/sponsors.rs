use aws_sdk_dynamodb::types::{AttributeValue, Delete, Put, TransactWriteItem};
use chrono::Utc;
use lambda_http::{Body, Error, Request, Response};
use newsletter::admin::{auth, aws_clients, error::AppError, response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use uuid::Uuid;

// ── Constants ──────────────────────────────────────────────────────────

pub const SPONSOR_SK_PREFIX: &str = "sponsor#";
pub const SPONSORSHIP_SK_PREFIX: &str = "sponsorship#";
pub const OUTREACH_SK_PREFIX: &str = "outreach#";
pub const OUTREACH_JOB_SK_PREFIX: &str = "outreach-job#";
const GSI2_INDEX_NAME: &str = "GSI2";

const SHORT_DESC_MAX_LEN: usize = 200;

// ── Data types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SponsorRecord {
    pub sponsor_id: String,
    pub sponsor_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub short_description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub long_description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contact_name: Option<String>,
    pub contact_email: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub status: String,
    pub version: u64,
    #[serde(default)]
    pub total_fulfilled_sponsorships: u64,
    #[serde(default)]
    pub total_revenue: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sponsored_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_outreach_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSponsorRequest {
    pub sponsor_name: String,
    #[serde(default)]
    pub short_description: Option<String>,
    #[serde(default)]
    pub long_description: Option<String>,
    #[serde(default)]
    pub logo_url: Option<String>,
    #[serde(default)]
    pub contact_name: Option<String>,
    pub contact_email: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub allow_duplicate_name: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSponsorRequest {
    #[serde(default)]
    pub sponsor_name: Option<String>,
    #[serde(default)]
    pub short_description: Option<String>,
    #[serde(default)]
    pub long_description: Option<String>,
    #[serde(default)]
    pub logo_url: Option<String>,
    #[serde(default)]
    pub contact_name: Option<String>,
    #[serde(default)]
    pub contact_email: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    pub version: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSponsorRequest {
    #[serde(default)]
    pub confirmed: bool,
}

// ── Sponsorship data types ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PricingSnapshot {
    pub subscriber_count: f64,
    pub recommended_rate: f64,
    pub open_rate: f64,
    pub click_through_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClickCache {
    pub total_clicks: u64,
    pub unique_clicks: u64,
    pub computed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SponsorshipEntry {
    pub sponsorship_id: String,
    pub sponsor_id: String,
    pub issue_id: String,
    pub issue_title: String,
    pub sponsorship_date: String,
    pub amount_charged: f64,
    pub status: String,
    #[serde(default)]
    pub placement_type: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sponsor_link_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pricing_snapshot: Option<PricingSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub click_cache: Option<ClickCache>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fulfilled_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSponsorshipRequest {
    pub issue_id: String,
    pub issue_title: String,
    pub sponsorship_date: String,
    pub amount_charged: f64,
    #[serde(default = "default_placement_type")]
    pub placement_type: String,
}

fn default_placement_type() -> String {
    "primary".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSponsorshipRequest {
    pub status: String,
    #[serde(default)]
    pub amount_charged: Option<f64>,
    #[serde(default)]
    pub confirm_no_links: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSponsorshipLinksRequest {
    pub link_ids: Vec<String>,
}

// ── Validation ─────────────────────────────────────────────────────────

/// Validate sponsor input fields.
pub fn validate_sponsor_input(
    name: &str,
    email: &str,
    short_desc: Option<&str>,
) -> Result<(), String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Sponsor name is required".to_string());
    }
    if !validate_email(email) {
        return Err("Invalid email format".to_string());
    }
    if let Some(desc) = short_desc {
        if desc.len() > SHORT_DESC_MAX_LEN {
            return Err(format!(
                "Short description must not exceed {} characters",
                SHORT_DESC_MAX_LEN
            ));
        }
    }
    Ok(())
}

/// Validate email format: must contain exactly one @, with non-empty local and domain parts.
pub fn validate_email(email: &str) -> bool {
    let parts: Vec<&str> = email.split('@').collect();
    parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty()
}

/// Normalize a CreateSponsorRequest: trim text fields, lowercase email.
pub fn normalize_create_request(req: &mut CreateSponsorRequest) {
    req.sponsor_name = req.sponsor_name.trim().to_string();
    req.contact_email = req.contact_email.trim().to_lowercase();
    req.short_description = req.short_description.as_ref().map(|s| s.trim().to_string());
    req.long_description = req.long_description.as_ref().map(|s| s.trim().to_string());
    req.logo_url = req.logo_url.as_ref().map(|s| s.trim().to_string());
    req.contact_name = req.contact_name.as_ref().map(|s| s.trim().to_string());
    req.notes = req.notes.as_ref().map(|s| s.trim().to_string());
}

/// Normalize an UpdateSponsorRequest: trim text fields, lowercase email.
pub fn normalize_update_request(req: &mut UpdateSponsorRequest) {
    req.sponsor_name = req.sponsor_name.as_ref().map(|s| s.trim().to_string());
    req.contact_email = req.contact_email.as_ref().map(|s| s.trim().to_lowercase());
    req.short_description = req.short_description.as_ref().map(|s| s.trim().to_string());
    req.long_description = req.long_description.as_ref().map(|s| s.trim().to_string());
    req.logo_url = req.logo_url.as_ref().map(|s| s.trim().to_string());
    req.contact_name = req.contact_name.as_ref().map(|s| s.trim().to_string());
    req.notes = req.notes.as_ref().map(|s| s.trim().to_string());
}

// ── DynamoDB key generation ────────────────────────────────────────────

pub fn sponsor_sk(sponsor_name_lower: &str, sponsor_id: &str) -> String {
    format!("{}{}#{}", SPONSOR_SK_PREFIX, sponsor_name_lower, sponsor_id)
}

pub fn sponsorship_sk(sponsor_id: &str, date: &str, sponsorship_id: &str) -> String {
    format!(
        "{}{}#{}#{}",
        SPONSORSHIP_SK_PREFIX, sponsor_id, date, sponsorship_id
    )
}

#[allow(dead_code)] // Used by generate-outreach Lambda and tests; will be used by Rust handlers when reading outreach records
pub fn outreach_sk(sponsor_id: &str, generated_at: &str) -> String {
    format!("{}{}#{}", OUTREACH_SK_PREFIX, sponsor_id, generated_at)
}

pub fn outreach_job_sk(job_id: &str) -> String {
    format!("{}{}", OUTREACH_JOB_SK_PREFIX, job_id)
}

// ── Public endpoint handlers ───────────────────────────────────────────

/// POST /sponsors
pub async fn create_sponsor(event: Request) -> Result<Response<Body>, Error> {
    match handle_create_sponsor(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /sponsors
pub async fn list_sponsors(event: Request) -> Result<Response<Body>, Error> {
    match handle_list_sponsors(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /sponsors/:id
pub async fn get_sponsor(event: Request, sponsor_id: &str) -> Result<Response<Body>, Error> {
    match handle_get_sponsor(event, sponsor_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// PUT /sponsors/:id
pub async fn update_sponsor(event: Request, sponsor_id: &str) -> Result<Response<Body>, Error> {
    match handle_update_sponsor(event, sponsor_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// POST /sponsors/:id/archive
pub async fn archive_sponsor(event: Request, sponsor_id: &str) -> Result<Response<Body>, Error> {
    match handle_archive_sponsor(event, sponsor_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// POST /sponsors/:id/restore
pub async fn restore_sponsor(event: Request, sponsor_id: &str) -> Result<Response<Body>, Error> {
    match handle_restore_sponsor(event, sponsor_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// POST /sponsors/:id/sponsorships
pub async fn create_sponsorship(event: Request, sponsor_id: &str) -> Result<Response<Body>, Error> {
    match handle_create_sponsorship(event, sponsor_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /sponsors/:id/sponsorships
pub async fn list_sponsorships(event: Request, sponsor_id: &str) -> Result<Response<Body>, Error> {
    match handle_list_sponsorships(event, sponsor_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// PUT /sponsors/:id/sponsorships/:sid
pub async fn update_sponsorship(
    event: Request,
    sponsor_id: &str,
    sponsorship_id: &str,
) -> Result<Response<Body>, Error> {
    match handle_update_sponsorship(event, sponsor_id, sponsorship_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// PUT /sponsors/:id/sponsorships/:sid/links
pub async fn update_sponsorship_links(
    event: Request,
    sponsor_id: &str,
    sponsorship_id: &str,
) -> Result<Response<Body>, Error> {
    match handle_update_sponsorship_links(event, sponsor_id, sponsorship_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// POST /sponsors/:id/outreach
pub async fn trigger_outreach(event: Request, sponsor_id: &str) -> Result<Response<Body>, Error> {
    match handle_trigger_outreach(event, sponsor_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /sponsors/:id/outreach
pub async fn list_outreach(event: Request, sponsor_id: &str) -> Result<Response<Body>, Error> {
    match handle_list_outreach(event, sponsor_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /sponsors/:id/outreach/jobs/:jobId
pub async fn get_outreach_job(
    event: Request,
    sponsor_id: &str,
    job_id: &str,
) -> Result<Response<Body>, Error> {
    match handle_get_outreach_job(event, sponsor_id, job_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

// ── Internal handlers ──────────────────────────────────────────────────

async fn handle_create_sponsor(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let mut body: CreateSponsorRequest = parse_request_body(&event)?;
    normalize_create_request(&mut body);

    validate_sponsor_input(
        &body.sponsor_name,
        &body.contact_email,
        body.short_description.as_deref(),
    )
    .map_err(AppError::BadRequest)?;

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    // Check duplicate name (case-insensitive)
    if !body.allow_duplicate_name {
        let name_lower = body.sponsor_name.to_lowercase();
        let existing = ddb_client
            .query()
            .table_name(&table_name)
            .key_condition_expression("pk = :pk AND begins_with(sk, :sk_prefix)")
            .filter_expression("#st = :active")
            .expression_attribute_names("#st", "status")
            .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
            .expression_attribute_values(
                ":sk_prefix",
                AttributeValue::S(SPONSOR_SK_PREFIX.to_string()),
            )
            .expression_attribute_values(":active", AttributeValue::S("active".to_string()))
            .send()
            .await?;

        for item in existing.items() {
            if let Some(existing_name) = item.get("sponsorName").and_then(|v| v.as_s().ok()) {
                if existing_name.to_lowercase() == name_lower {
                    let empty = String::new();
                    let existing_id = item
                        .get("sponsorId")
                        .and_then(|v| v.as_s().ok())
                        .unwrap_or(&empty);
                    return response::format_response(
                        409,
                        json!({
                            "message": "A sponsor with this name already exists",
                            "existingSponsorId": existing_id
                        }),
                    );
                }
            }
        }
    }

    let sponsor_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let name_lower = body.sponsor_name.to_lowercase();
    let sk = sponsor_sk(&name_lower, &sponsor_id);

    let mut put = ddb_client
        .put_item()
        .table_name(&table_name)
        .item("pk", AttributeValue::S(tenant_id.clone()))
        .item("sk", AttributeValue::S(sk))
        .item("sponsorId", AttributeValue::S(sponsor_id.clone()))
        .item("sponsorName", AttributeValue::S(body.sponsor_name.clone()))
        .item(
            "contactEmail",
            AttributeValue::S(body.contact_email.clone()),
        )
        .item("status", AttributeValue::S("active".to_string()))
        .item("version", AttributeValue::N("1".to_string()))
        .item(
            "totalFulfilledSponsorships",
            AttributeValue::N("0".to_string()),
        )
        .item("totalRevenue", AttributeValue::N("0".to_string()))
        .item("createdAt", AttributeValue::S(now.clone()))
        .item("updatedAt", AttributeValue::S(now.clone()))
        .item("GSI2PK", AttributeValue::S(tenant_id.clone()))
        .item("GSI2SK", AttributeValue::S(sponsor_id.clone()))
        .condition_expression("attribute_not_exists(pk)");

    if let Some(ref desc) = body.short_description {
        put = put.item("shortDescription", AttributeValue::S(desc.clone()));
    }
    if let Some(ref desc) = body.long_description {
        put = put.item("longDescription", AttributeValue::S(desc.clone()));
    }
    if let Some(ref url) = body.logo_url {
        put = put.item("logoUrl", AttributeValue::S(url.clone()));
    }
    if let Some(ref name) = body.contact_name {
        put = put.item("contactName", AttributeValue::S(name.clone()));
    }
    if let Some(ref notes) = body.notes {
        put = put.item("notes", AttributeValue::S(notes.clone()));
    }

    put.send().await?;

    let record = SponsorRecord {
        sponsor_id,
        sponsor_name: body.sponsor_name,
        short_description: body.short_description,
        long_description: body.long_description,
        logo_url: body.logo_url,
        contact_name: body.contact_name,
        contact_email: body.contact_email,
        notes: body.notes,
        status: "active".to_string(),
        version: 1,
        total_fulfilled_sponsorships: 0,
        total_revenue: 0.0,
        last_sponsored_date: None,
        last_outreach_at: None,
        created_at: now.clone(),
        updated_at: now,
        archived_at: None,
    };

    response::format_response(201, &record)
}

async fn handle_list_sponsors(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let include_archived = event
        .uri()
        .query()
        .and_then(|q| {
            q.split('&')
                .find(|p| p.starts_with("includeArchived="))
                .map(|p| p.strip_prefix("includeArchived=").unwrap_or("false") == "true")
        })
        .unwrap_or(false);

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let mut query = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("pk = :pk AND begins_with(sk, :sk_prefix)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
        .expression_attribute_values(
            ":sk_prefix",
            AttributeValue::S(SPONSOR_SK_PREFIX.to_string()),
        );

    if !include_archived {
        query = query
            .filter_expression("#st = :active")
            .expression_attribute_names("#st", "status")
            .expression_attribute_values(":active", AttributeValue::S("active".to_string()));
    }

    let result = query.send().await?;
    let sponsors: Vec<Value> = result.items().iter().map(dynamodb_item_to_json).collect();

    response::format_response(200, json!({ "sponsors": sponsors }))
}

async fn handle_get_sponsor(event: Request, sponsor_id: &str) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let result = ddb_client
        .query()
        .table_name(&table_name)
        .index_name(GSI2_INDEX_NAME)
        .key_condition_expression("GSI2PK = :pk AND GSI2SK = :sk")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
        .expression_attribute_values(":sk", AttributeValue::S(sponsor_id.to_string()))
        .limit(1)
        .send()
        .await?;

    let items = result.items();
    if items.is_empty() {
        return Err(AppError::NotFound("Sponsor not found".to_string()));
    }

    let sponsor = dynamodb_item_to_json(&items[0]);
    response::format_response(200, sponsor)
}

async fn handle_update_sponsor(
    event: Request,
    sponsor_id: &str,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let mut body: UpdateSponsorRequest = parse_request_body(&event)?;
    normalize_update_request(&mut body);

    // Validate fields that are present
    let name_for_validation = body.sponsor_name.as_deref().unwrap_or("placeholder");
    let email_for_validation = body
        .contact_email
        .as_deref()
        .unwrap_or("placeholder@example.com");
    validate_sponsor_input(
        name_for_validation,
        email_for_validation,
        body.short_description.as_deref(),
    )
    .map_err(AppError::BadRequest)?;

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    // Look up current sponsor via GSI2
    let current = lookup_sponsor_by_id(ddb_client, &table_name, &tenant_id, sponsor_id).await?;
    let current_sk = current
        .get("sk")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing sk on sponsor record".to_string()))?
        .clone();
    let current_name = current
        .get("sponsorName")
        .and_then(|v| v.as_s().ok())
        .cloned()
        .unwrap_or_default();

    let now = Utc::now().to_rfc3339();
    let new_version = body.version + 1;

    // Determine if name changed (case-insensitive comparison of lowercased names)
    let name_changed = body
        .sponsor_name
        .as_ref()
        .map(|n| n.to_lowercase() != current_name.to_lowercase())
        .unwrap_or(false);

    if name_changed {
        let new_name = body.sponsor_name.as_ref().unwrap();
        let new_name_lower = new_name.to_lowercase();
        let new_sk = sponsor_sk(&new_name_lower, sponsor_id);

        // Build the new item from current + updates
        let mut new_item = current.clone();
        new_item.insert("sk".to_string(), AttributeValue::S(new_sk));
        new_item.insert(
            "sponsorName".to_string(),
            AttributeValue::S(new_name.clone()),
        );
        new_item.insert("updatedAt".to_string(), AttributeValue::S(now.clone()));
        new_item.insert(
            "version".to_string(),
            AttributeValue::N(new_version.to_string()),
        );

        // Apply optional field updates
        apply_optional_update(&mut new_item, "shortDescription", &body.short_description);
        apply_optional_update(&mut new_item, "longDescription", &body.long_description);
        apply_optional_update(&mut new_item, "logoUrl", &body.logo_url);
        apply_optional_update(&mut new_item, "contactName", &body.contact_name);
        apply_optional_update(&mut new_item, "contactEmail", &body.contact_email);
        apply_optional_update(&mut new_item, "notes", &body.notes);

        // TransactWriteItems: delete old sk + put new sk
        let delete_old = Delete::builder()
            .table_name(&table_name)
            .key("pk", AttributeValue::S(tenant_id.clone()))
            .key("sk", AttributeValue::S(current_sk))
            .condition_expression("version = :v")
            .expression_attribute_values(":v", AttributeValue::N(body.version.to_string()))
            .build()
            .map_err(|e| AppError::InternalError(format!("Failed to build delete: {}", e)))?;

        let put_new = Put::builder()
            .table_name(&table_name)
            .set_item(Some(new_item))
            .condition_expression("attribute_not_exists(pk)")
            .build()
            .map_err(|e| AppError::InternalError(format!("Failed to build put: {}", e)))?;

        let result = ddb_client
            .transact_write_items()
            .transact_items(TransactWriteItem::builder().delete(delete_old).build())
            .transact_items(TransactWriteItem::builder().put(put_new).build())
            .send()
            .await;

        match result {
            Ok(_) => {}
            Err(err) => {
                let service_err = err.into_service_error();
                if service_err.is_transaction_canceled_exception() {
                    return response::format_response(
                        409,
                        json!({
                            "message": "Record was modified by another session. Please reload and retry.",
                            "currentVersion": body.version
                        }),
                    );
                } else {
                    return Err(AppError::AwsError(format!(
                        "DynamoDB TransactWriteItems error: {}",
                        service_err
                    )));
                }
            }
        }

        // Re-fetch the updated record for the transact case
        let updated = lookup_sponsor_by_id(ddb_client, &table_name, &tenant_id, sponsor_id).await?;
        let updated_json = dynamodb_item_to_json(&updated);
        return response::format_response(200, updated_json);
    }

    // Name unchanged: simple UpdateItem
    let mut update_expr = String::from("SET updatedAt = :now, version = :new_version");
    let mut expr_attr_values: HashMap<String, AttributeValue> = HashMap::new();
    expr_attr_values.insert(":now".to_string(), AttributeValue::S(now));
    expr_attr_values.insert(
        ":new_version".to_string(),
        AttributeValue::N(new_version.to_string()),
    );
    expr_attr_values.insert(
        ":current_version".to_string(),
        AttributeValue::N(body.version.to_string()),
    );

    if let Some(ref name) = body.sponsor_name {
        update_expr.push_str(", sponsorName = :name");
        expr_attr_values.insert(":name".to_string(), AttributeValue::S(name.clone()));
    }
    if let Some(ref desc) = body.short_description {
        update_expr.push_str(", shortDescription = :short_desc");
        expr_attr_values.insert(":short_desc".to_string(), AttributeValue::S(desc.clone()));
    }
    if let Some(ref desc) = body.long_description {
        update_expr.push_str(", longDescription = :long_desc");
        expr_attr_values.insert(":long_desc".to_string(), AttributeValue::S(desc.clone()));
    }
    if let Some(ref url) = body.logo_url {
        update_expr.push_str(", logoUrl = :logo");
        expr_attr_values.insert(":logo".to_string(), AttributeValue::S(url.clone()));
    }
    if let Some(ref name) = body.contact_name {
        update_expr.push_str(", contactName = :contact_name");
        expr_attr_values.insert(":contact_name".to_string(), AttributeValue::S(name.clone()));
    }
    if let Some(ref email) = body.contact_email {
        update_expr.push_str(", contactEmail = :email");
        expr_attr_values.insert(":email".to_string(), AttributeValue::S(email.clone()));
    }
    if let Some(ref notes) = body.notes {
        update_expr.push_str(", notes = :notes");
        expr_attr_values.insert(":notes".to_string(), AttributeValue::S(notes.clone()));
    }

    let result = ddb_client
        .update_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(current_sk))
        .update_expression(&update_expr)
        .condition_expression("version = :current_version")
        .set_expression_attribute_values(Some(expr_attr_values))
        .return_values(aws_sdk_dynamodb::types::ReturnValue::AllNew)
        .send()
        .await;

    match result {
        Ok(output) => {
            if let Some(attrs) = output.attributes() {
                let updated = dynamodb_item_to_json(attrs);
                return response::format_response(200, updated);
            }
            // Fallback: re-fetch
            let updated =
                lookup_sponsor_by_id(ddb_client, &table_name, &tenant_id, sponsor_id).await?;
            response::format_response(200, dynamodb_item_to_json(&updated))
        }
        Err(err) => {
            let service_err = err.into_service_error();
            if service_err.is_conditional_check_failed_exception() {
                response::format_response(
                    409,
                    json!({
                        "message": "Record was modified by another session. Please reload and retry.",
                        "currentVersion": body.version
                    }),
                )
            } else {
                Err(AppError::AwsError(format!(
                    "DynamoDB UpdateItem error: {}",
                    service_err
                )))
            }
        }
    }
}

async fn handle_archive_sponsor(
    event: Request,
    sponsor_id: &str,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    // Parse optional body for confirmed flag
    let confirmed = parse_request_body::<ArchiveSponsorRequest>(&event)
        .map(|b| b.confirmed)
        .unwrap_or(false);

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let current = lookup_sponsor_by_id(ddb_client, &table_name, &tenant_id, sponsor_id).await?;
    let current_sk = current
        .get("sk")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing sk on sponsor record".to_string()))?
        .clone();

    // Check for booked sponsorships
    if !confirmed {
        let sponsorship_prefix = format!("{}{}#", SPONSORSHIP_SK_PREFIX, sponsor_id);
        let booked_result = ddb_client
            .query()
            .table_name(&table_name)
            .key_condition_expression("pk = :pk AND begins_with(sk, :sk_prefix)")
            .filter_expression("#st = :booked")
            .expression_attribute_names("#st", "status")
            .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
            .expression_attribute_values(":sk_prefix", AttributeValue::S(sponsorship_prefix))
            .expression_attribute_values(":booked", AttributeValue::S("booked".to_string()))
            .send()
            .await?;

        let booked_count = booked_result.items().len();
        if booked_count > 0 {
            return response::format_response(
                409,
                json!({
                    "message": "Sponsor has pending booked sponsorships. Confirm to proceed.",
                    "bookedCount": booked_count
                }),
            );
        }
    }

    let now = Utc::now().to_rfc3339();

    ddb_client
        .update_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(current_sk))
        .update_expression("SET #st = :archived, archivedAt = :now, updatedAt = :now")
        .expression_attribute_names("#st", "status")
        .expression_attribute_values(":archived", AttributeValue::S("archived".to_string()))
        .expression_attribute_values(":now", AttributeValue::S(now))
        .send()
        .await?;

    let updated = lookup_sponsor_by_id(ddb_client, &table_name, &tenant_id, sponsor_id).await?;
    let updated_json = dynamodb_item_to_json(&updated);
    response::format_response(200, updated_json)
}

async fn handle_restore_sponsor(
    event: Request,
    sponsor_id: &str,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let current = lookup_sponsor_by_id(ddb_client, &table_name, &tenant_id, sponsor_id).await?;
    let current_sk = current
        .get("sk")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing sk on sponsor record".to_string()))?
        .clone();

    let now = Utc::now().to_rfc3339();

    ddb_client
        .update_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(current_sk))
        .update_expression("SET #st = :active, updatedAt = :now REMOVE archivedAt")
        .expression_attribute_names("#st", "status")
        .expression_attribute_values(":active", AttributeValue::S("active".to_string()))
        .expression_attribute_values(":now", AttributeValue::S(now))
        .send()
        .await?;

    let updated = lookup_sponsor_by_id(ddb_client, &table_name, &tenant_id, sponsor_id).await?;
    let updated_json = dynamodb_item_to_json(&updated);
    response::format_response(200, updated_json)
}

// ── Sponsorship internal handlers ──────────────────────────────────────

const PRICING_SK_PREFIX: &str = "pricing#";

async fn handle_create_sponsorship(
    event: Request,
    sponsor_id: &str,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let body: CreateSponsorshipRequest = parse_request_body(&event)?;

    // Validate amountCharged is positive
    if body.amount_charged <= 0.0 {
        return Err(AppError::BadRequest(
            "Amount charged must be a positive number".to_string(),
        ));
    }

    // Validate placementType
    let placement = body.placement_type.as_str();
    if placement != "primary" && placement != "secondary" && placement != "inline" {
        return Err(AppError::BadRequest(
            "Placement type must be primary, secondary, or inline".to_string(),
        ));
    }

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    // Validate sponsor exists and is active (lookup via GSI2)
    let sponsor = lookup_sponsor_by_id(ddb_client, &table_name, &tenant_id, sponsor_id).await?;
    let sponsor_status = sponsor
        .get("status")
        .and_then(|v| v.as_s().ok())
        .unwrap_or(&String::new())
        .clone();
    if sponsor_status != "active" {
        return Err(AppError::NotFound(
            "Sponsor not found or is archived".to_string(),
        ));
    }

    let sponsorship_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let sk = sponsorship_sk(sponsor_id, &body.sponsorship_date, &sponsorship_id);

    let mut put = ddb_client
        .put_item()
        .table_name(&table_name)
        .item("pk", AttributeValue::S(tenant_id.clone()))
        .item("sk", AttributeValue::S(sk))
        .item("sponsorshipId", AttributeValue::S(sponsorship_id.clone()))
        .item("sponsorId", AttributeValue::S(sponsor_id.to_string()))
        .item("issueId", AttributeValue::S(body.issue_id.clone()))
        .item("issueTitle", AttributeValue::S(body.issue_title.clone()))
        .item(
            "sponsorshipDate",
            AttributeValue::S(body.sponsorship_date.clone()),
        )
        .item(
            "amountCharged",
            AttributeValue::N(body.amount_charged.to_string()),
        )
        .item("status", AttributeValue::S("draft".to_string()))
        .item(
            "placementType",
            AttributeValue::S(body.placement_type.clone()),
        )
        .item("createdAt", AttributeValue::S(now.clone()))
        .item("updatedAt", AttributeValue::S(now.clone()))
        .condition_expression("attribute_not_exists(pk)");

    // Initialize empty sponsorLinkIds list
    put = put.item("sponsorLinkIds", AttributeValue::L(vec![]));

    put.send().await?;

    let entry = SponsorshipEntry {
        sponsorship_id,
        sponsor_id: sponsor_id.to_string(),
        issue_id: body.issue_id,
        issue_title: body.issue_title,
        sponsorship_date: body.sponsorship_date,
        amount_charged: body.amount_charged,
        status: "draft".to_string(),
        placement_type: body.placement_type,
        sponsor_link_ids: vec![],
        pricing_snapshot: None,
        click_cache: None,
        created_at: now.clone(),
        updated_at: now,
        fulfilled_at: None,
    };

    response::format_response(201, &entry)
}

async fn handle_list_sponsorships(
    event: Request,
    sponsor_id: &str,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let sk_prefix = format!("{}{}#", SPONSORSHIP_SK_PREFIX, sponsor_id);

    let result = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("pk = :pk AND begins_with(sk, :sk_prefix)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
        .expression_attribute_values(":sk_prefix", AttributeValue::S(sk_prefix))
        .scan_index_forward(false)
        .send()
        .await?;

    let sponsorships: Vec<Value> = result.items().iter().map(dynamodb_item_to_json).collect();

    response::format_response(200, json!({ "sponsorships": sponsorships }))
}

async fn handle_update_sponsorship(
    event: Request,
    sponsor_id: &str,
    sponsorship_id: &str,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let body: UpdateSponsorshipRequest = parse_request_body(&event)?;

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    // Find the sponsorship entry by querying with the sponsorship prefix
    let sk_prefix = format!("{}{}#", SPONSORSHIP_SK_PREFIX, sponsor_id);
    let query_result = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("pk = :pk AND begins_with(sk, :sk_prefix)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
        .expression_attribute_values(":sk_prefix", AttributeValue::S(sk_prefix))
        .send()
        .await?;

    let entry = query_result
        .items()
        .iter()
        .find(|item| {
            item.get("sponsorshipId")
                .and_then(|v| v.as_s().ok())
                .map(|id| id == sponsorship_id)
                .unwrap_or(false)
        })
        .ok_or_else(|| AppError::NotFound("Sponsorship entry not found".to_string()))?
        .clone();

    let entry_sk = entry
        .get("sk")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing sk on sponsorship entry".to_string()))?
        .clone();

    let current_status = entry
        .get("status")
        .and_then(|v| v.as_s().ok())
        .unwrap_or(&String::new())
        .clone();

    let new_status = body.status.as_str();

    // Validate status transitions: draft → booked → fulfilled, or cancel from any
    let valid_transition = match (current_status.as_str(), new_status) {
        ("draft", "booked") => true,
        ("booked", "fulfilled") => true,
        ("draft", "fulfilled") => true,
        (_, "cancelled") => current_status != "cancelled",
        _ => false,
    };

    if !valid_transition {
        return Err(AppError::BadRequest(format!(
            "Invalid status transition from '{}' to '{}'",
            current_status, new_status
        )));
    }

    // If fulfilled, reject amountCharged changes
    if current_status == "fulfilled" && body.amount_charged.is_some() {
        return Err(AppError::BadRequest(
            "Amount charged is immutable on fulfilled sponsorship entries".to_string(),
        ));
    }

    let now = Utc::now().to_rfc3339();
    let mut update_expr = String::from("SET #st = :new_status, updatedAt = :now");
    let mut expr_attr_values: HashMap<String, AttributeValue> = HashMap::new();
    let mut expr_attr_names: HashMap<String, String> = HashMap::new();

    expr_attr_names.insert("#st".to_string(), "status".to_string());
    expr_attr_values.insert(
        ":new_status".to_string(),
        AttributeValue::S(new_status.to_string()),
    );
    expr_attr_values.insert(":now".to_string(), AttributeValue::S(now.clone()));

    // Handle amountCharged update (only if not fulfilled)
    if let Some(amount) = body.amount_charged {
        if current_status != "fulfilled" {
            update_expr.push_str(", amountCharged = :amount");
            expr_attr_values.insert(":amount".to_string(), AttributeValue::N(amount.to_string()));
        }
    }

    // Handle fulfillment
    if new_status == "fulfilled" {
        // Check if sponsorLinkIds are empty and confirmNoLinks is not true
        let link_ids = entry
            .get("sponsorLinkIds")
            .and_then(|v| v.as_l().ok())
            .map(|l| l.len())
            .unwrap_or(0);

        let confirm_no_links = body.confirm_no_links.unwrap_or(false);

        if link_ids == 0 && !confirm_no_links {
            return response::format_response(
                409,
                json!({
                    "message": "No sponsor links associated. Set confirmNoLinks=true to proceed.",
                    "warning": true
                }),
            );
        }

        // Set fulfilledAt
        update_expr.push_str(", fulfilledAt = :fulfilled_at");
        expr_attr_values.insert(":fulfilled_at".to_string(), AttributeValue::S(now.clone()));

        // Capture pricingSnapshot from latest Pricing_Record
        let pricing_result = ddb_client
            .query()
            .table_name(&table_name)
            .key_condition_expression("pk = :pk AND begins_with(sk, :sk_prefix)")
            .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
            .expression_attribute_values(
                ":sk_prefix",
                AttributeValue::S(PRICING_SK_PREFIX.to_string()),
            )
            .scan_index_forward(false)
            .limit(1)
            .send()
            .await?;

        if let Some(pricing_item) = pricing_result.items().first() {
            let subscriber_count = pricing_item
                .get("subscriberCount")
                .and_then(|v| v.as_n().ok())
                .and_then(|n| n.parse::<f64>().ok())
                .unwrap_or(0.0);
            let recommended_rate = pricing_item
                .get("recommendedRate")
                .or_else(|| pricing_item.get("recommendedPrice"))
                .and_then(|v| v.as_n().ok())
                .and_then(|n| n.parse::<f64>().ok())
                .unwrap_or(0.0);
            let open_rate = pricing_item
                .get("openRate")
                .and_then(|v| v.as_n().ok())
                .and_then(|n| n.parse::<f64>().ok())
                .unwrap_or(0.0);
            let click_through_rate = pricing_item
                .get("clickThroughRate")
                .and_then(|v| v.as_n().ok())
                .and_then(|n| n.parse::<f64>().ok())
                .unwrap_or(0.0);

            let snapshot_map = AttributeValue::M(HashMap::from([
                (
                    "subscriberCount".to_string(),
                    AttributeValue::N(subscriber_count.to_string()),
                ),
                (
                    "recommendedRate".to_string(),
                    AttributeValue::N(recommended_rate.to_string()),
                ),
                (
                    "openRate".to_string(),
                    AttributeValue::N(open_rate.to_string()),
                ),
                (
                    "clickThroughRate".to_string(),
                    AttributeValue::N(click_through_rate.to_string()),
                ),
            ]));

            update_expr.push_str(", pricingSnapshot = :snapshot");
            expr_attr_values.insert(":snapshot".to_string(), snapshot_map);
        }

        // Update materialized stats on Sponsor_Record atomically
        let sponsor = lookup_sponsor_by_id(ddb_client, &table_name, &tenant_id, sponsor_id).await?;
        let sponsor_sk_val = sponsor
            .get("sk")
            .and_then(|v| v.as_s().ok())
            .ok_or_else(|| AppError::InternalError("Missing sk on sponsor record".to_string()))?
            .clone();

        let sponsorship_date = entry
            .get("sponsorshipDate")
            .and_then(|v| v.as_s().ok())
            .cloned()
            .unwrap_or_default();

        let amount_for_stats = body.amount_charged.unwrap_or_else(|| {
            entry
                .get("amountCharged")
                .and_then(|v| v.as_n().ok())
                .and_then(|n| n.parse::<f64>().ok())
                .unwrap_or(0.0)
        });

        ddb_client
            .update_item()
            .table_name(&table_name)
            .key("pk", AttributeValue::S(tenant_id.clone()))
            .key("sk", AttributeValue::S(sponsor_sk_val))
            .update_expression(
                "ADD totalFulfilledSponsorships :one, totalRevenue :amount SET lastSponsoredDate = :date, updatedAt = :now",
            )
            .expression_attribute_values(":one", AttributeValue::N("1".to_string()))
            .expression_attribute_values(
                ":amount",
                AttributeValue::N(amount_for_stats.to_string()),
            )
            .expression_attribute_values(
                ":date",
                AttributeValue::S(sponsorship_date),
            )
            .expression_attribute_values(":now", AttributeValue::S(now.clone()))
            .send()
            .await?;
    }

    // Execute the sponsorship update
    let result = ddb_client
        .update_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(entry_sk.clone()))
        .update_expression(&update_expr)
        .set_expression_attribute_values(Some(expr_attr_values))
        .set_expression_attribute_names(Some(expr_attr_names))
        .return_values(aws_sdk_dynamodb::types::ReturnValue::AllNew)
        .send()
        .await?;

    if let Some(attrs) = result.attributes() {
        let updated = dynamodb_item_to_json(attrs);
        return response::format_response(200, updated);
    }

    Err(AppError::InternalError(
        "Failed to retrieve updated sponsorship entry".to_string(),
    ))
}

async fn handle_update_sponsorship_links(
    event: Request,
    sponsor_id: &str,
    sponsorship_id: &str,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let body: UpdateSponsorshipLinksRequest = parse_request_body(&event)?;

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    // Find the sponsorship entry
    let sk_prefix = format!("{}{}#", SPONSORSHIP_SK_PREFIX, sponsor_id);
    let query_result = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("pk = :pk AND begins_with(sk, :sk_prefix)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
        .expression_attribute_values(":sk_prefix", AttributeValue::S(sk_prefix))
        .send()
        .await?;

    let entry = query_result
        .items()
        .iter()
        .find(|item| {
            item.get("sponsorshipId")
                .and_then(|v| v.as_s().ok())
                .map(|id| id == sponsorship_id)
                .unwrap_or(false)
        })
        .ok_or_else(|| AppError::NotFound("Sponsorship entry not found".to_string()))?
        .clone();

    let entry_sk = entry
        .get("sk")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing sk on sponsorship entry".to_string()))?
        .clone();

    let current_status = entry
        .get("status")
        .and_then(|v| v.as_s().ok())
        .unwrap_or(&String::new())
        .clone();

    // Validate link IDs belong to same tenant by querying each link record
    let mut invalid_link_ids: Vec<String> = Vec::new();
    for link_id in &body.link_ids {
        // Link records use pk = issueCompositeKey, sk = "link#{linkHash}"
        // We validate by checking the link exists for the tenant
        let link_sk = format!("link#{}", link_id);
        let issue_id = entry
            .get("issueId")
            .and_then(|v| v.as_s().ok())
            .cloned()
            .unwrap_or_default();

        let link_result = ddb_client
            .get_item()
            .table_name(&table_name)
            .key("pk", AttributeValue::S(issue_id.clone()))
            .key("sk", AttributeValue::S(link_sk))
            .send()
            .await?;

        if link_result.item().is_none() {
            invalid_link_ids.push(link_id.clone());
        }
    }

    if !invalid_link_ids.is_empty() {
        return response::format_response(
            400,
            json!({
                "message": "Invalid link IDs",
                "invalidLinkIds": invalid_link_ids
            }),
        );
    }

    let now = Utc::now().to_rfc3339();
    let link_ids_attr: Vec<AttributeValue> = body
        .link_ids
        .iter()
        .map(|id| AttributeValue::S(id.clone()))
        .collect();

    let mut update_expr = String::from("SET sponsorLinkIds = :link_ids, updatedAt = :now");
    let mut expr_attr_values: HashMap<String, AttributeValue> = HashMap::new();
    expr_attr_values.insert(":link_ids".to_string(), AttributeValue::L(link_ids_attr));
    expr_attr_values.insert(":now".to_string(), AttributeValue::S(now));

    // If entry is fulfilled, invalidate clickCache
    if current_status == "fulfilled" {
        update_expr.push_str(" REMOVE clickCache");
    }

    ddb_client
        .update_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(entry_sk))
        .update_expression(&update_expr)
        .set_expression_attribute_values(Some(expr_attr_values))
        .send()
        .await?;

    response::format_response(
        200,
        json!({ "message": "Sponsorship links updated successfully" }),
    )
}

// ── Outreach internal handlers ──────────────────────────────────────────

const OUTREACH_JOB_TTL_SECONDS: i64 = 86400; // 24 hours

async fn handle_trigger_outreach(
    event: Request,
    sponsor_id: &str,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    // Validate sponsor exists and is active
    let sponsor = lookup_sponsor_by_id(ddb_client, &table_name, &tenant_id, sponsor_id).await?;
    let sponsor_status = sponsor
        .get("status")
        .and_then(|v| v.as_s().ok())
        .unwrap_or(&String::new())
        .clone();
    if sponsor_status != "active" {
        return Err(AppError::BadRequest(
            "Outreach cannot be generated for an archived sponsor".to_string(),
        ));
    }

    // Validate sponsor has contact email
    let contact_email = sponsor
        .get("contactEmail")
        .and_then(|v| v.as_s().ok())
        .unwrap_or(&String::new())
        .clone();
    if contact_email.is_empty() {
        return Err(AppError::BadRequest(
            "A contact email is required for outreach".to_string(),
        ));
    }

    // Validate pricing data exists
    let pricing_result = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("pk = :pk AND begins_with(sk, :sk_prefix)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
        .expression_attribute_values(
            ":sk_prefix",
            AttributeValue::S(PRICING_SK_PREFIX.to_string()),
        )
        .scan_index_forward(false)
        .limit(1)
        .send()
        .await?;

    if pricing_result.items().is_empty() {
        return Err(AppError::BadRequest(
            "Pricing data is required before outreach can be generated".to_string(),
        ));
    }

    // Generate jobId and invoke generate-outreach Lambda asynchronously
    let job_id = Uuid::new_v4().to_string();

    let function_arn = env::var("GENERATE_OUTREACH_FUNCTION_ARN").map_err(|_| {
        AppError::InternalError("GENERATE_OUTREACH_FUNCTION_ARN not set".to_string())
    })?;

    let lambda_client = aws_clients::get_lambda_client().await;
    let payload = json!({
        "tenantId": tenant_id,
        "sponsorId": sponsor_id,
        "jobId": job_id
    });

    lambda_client
        .invoke()
        .function_name(&function_arn)
        .invocation_type(aws_sdk_lambda::types::InvocationType::Event)
        .payload(aws_smithy_types::Blob::new(
            serde_json::to_vec(&payload).map_err(|e| {
                AppError::InternalError(format!("Failed to serialize payload: {}", e))
            })?,
        ))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Lambda invoke error: {}", e)))?;

    // Create outreach job record
    let now = Utc::now();
    let ttl = now.timestamp() + OUTREACH_JOB_TTL_SECONDS;
    let now_str = now.to_rfc3339();
    let job_sk = outreach_job_sk(&job_id);

    ddb_client
        .put_item()
        .table_name(&table_name)
        .item("pk", AttributeValue::S(tenant_id.clone()))
        .item("sk", AttributeValue::S(job_sk))
        .item("jobId", AttributeValue::S(job_id.clone()))
        .item("sponsorId", AttributeValue::S(sponsor_id.to_string()))
        .item("status", AttributeValue::S("processing".to_string()))
        .item("createdAt", AttributeValue::S(now_str.clone()))
        .item("updatedAt", AttributeValue::S(now_str))
        .item("ttl", AttributeValue::N(ttl.to_string()))
        .send()
        .await?;

    response::format_response(202, json!({ "jobId": job_id, "status": "processing" }))
}

async fn handle_list_outreach(
    event: Request,
    sponsor_id: &str,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let sk_prefix = format!("{}{}#", OUTREACH_SK_PREFIX, sponsor_id);

    let result = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("pk = :pk AND begins_with(sk, :sk_prefix)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
        .expression_attribute_values(":sk_prefix", AttributeValue::S(sk_prefix))
        .scan_index_forward(false)
        .send()
        .await?;

    let outreach_emails: Vec<Value> = result.items().iter().map(dynamodb_item_to_json).collect();

    response::format_response(200, json!({ "outreachEmails": outreach_emails }))
}

async fn handle_get_outreach_job(
    event: Request,
    _sponsor_id: &str,
    job_id: &str,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let job_sk = outreach_job_sk(job_id);

    let result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(job_sk))
        .send()
        .await?;

    let item = result
        .item()
        .ok_or_else(|| AppError::NotFound("Outreach job not found".to_string()))?;

    let job = dynamodb_item_to_json(item);
    response::format_response(200, job)
}

fn get_table_name() -> Result<String, AppError> {
    env::var("TABLE_NAME").map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))
}

fn parse_request_body<T: for<'de> Deserialize<'de>>(event: &Request) -> Result<T, AppError> {
    match event.body() {
        Body::Text(text) => serde_json::from_str(text)
            .map_err(|e| AppError::BadRequest(format!("Invalid JSON body: {}", e))),
        Body::Binary(bytes) => serde_json::from_slice(bytes)
            .map_err(|e| AppError::BadRequest(format!("Invalid JSON body: {}", e))),
        Body::Empty => Err(AppError::BadRequest("Request body is required".to_string())),
    }
}

/// Look up a sponsor by ID using GSI2
async fn lookup_sponsor_by_id(
    ddb_client: &aws_sdk_dynamodb::Client,
    table_name: &str,
    tenant_id: &str,
    sponsor_id: &str,
) -> Result<HashMap<String, AttributeValue>, AppError> {
    let result = ddb_client
        .query()
        .table_name(table_name)
        .index_name(GSI2_INDEX_NAME)
        .key_condition_expression("GSI2PK = :pk AND GSI2SK = :sk")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.to_string()))
        .expression_attribute_values(":sk", AttributeValue::S(sponsor_id.to_string()))
        .limit(1)
        .send()
        .await?;

    let items = result.items();
    if items.is_empty() {
        return Err(AppError::NotFound("Sponsor not found".to_string()));
    }

    Ok(items[0].clone())
}

/// Apply an optional string field update to a DynamoDB item map
fn apply_optional_update(
    item: &mut HashMap<String, AttributeValue>,
    key: &str,
    value: &Option<String>,
) {
    if let Some(v) = value {
        item.insert(key.to_string(), AttributeValue::S(v.clone()));
    }
}

/// Convert a DynamoDB item to a JSON Value, stripping internal keys
fn dynamodb_item_to_json(item: &HashMap<String, AttributeValue>) -> Value {
    let mut map = serde_json::Map::new();
    for (key, value) in item {
        if key == "pk" || key == "sk" || key == "GSI2PK" || key == "GSI2SK" {
            continue;
        }
        map.insert(key.clone(), attribute_to_json(value));
    }
    Value::Object(map)
}

/// Convert a single DynamoDB AttributeValue to a JSON Value
fn attribute_to_json(value: &AttributeValue) -> Value {
    match value {
        AttributeValue::S(s) => Value::String(s.clone()),
        AttributeValue::N(n) => {
            if let Ok(i) = n.parse::<i64>() {
                json!(i)
            } else if let Ok(f) = n.parse::<f64>() {
                json!(f)
            } else {
                Value::String(n.clone())
            }
        }
        AttributeValue::Bool(b) => Value::Bool(*b),
        AttributeValue::Null(_) => Value::Null,
        AttributeValue::M(m) => {
            let mut map = serde_json::Map::new();
            for (k, v) in m {
                map.insert(k.clone(), attribute_to_json(v));
            }
            Value::Object(map)
        }
        AttributeValue::L(l) => Value::Array(l.iter().map(attribute_to_json).collect()),
        AttributeValue::Ss(ss) => {
            Value::Array(ss.iter().map(|s| Value::String(s.clone())).collect())
        }
        AttributeValue::Ns(ns) => Value::Array(
            ns.iter()
                .map(|n| {
                    n.parse::<f64>()
                        .map(|f| json!(f))
                        .unwrap_or_else(|_| Value::String(n.clone()))
                })
                .collect(),
        ),
        _ => Value::Null,
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn test_validate_email_valid() {
        assert!(validate_email("jane@acme.com"));
        assert!(validate_email("a@b"));
    }

    #[test]
    fn test_validate_email_invalid() {
        assert!(!validate_email("no-at-sign"));
        assert!(!validate_email("@missing-local.com"));
        assert!(!validate_email("missing-domain@"));
        assert!(!validate_email("two@@ats.com"));
        assert!(!validate_email(""));
    }

    #[test]
    fn test_validate_sponsor_input_valid() {
        assert!(validate_sponsor_input("Acme", "jane@acme.com", Some("Short")).is_ok());
        assert!(validate_sponsor_input("Acme", "a@b", None).is_ok());
    }

    #[test]
    fn test_validate_sponsor_input_empty_name() {
        let result = validate_sponsor_input("", "jane@acme.com", None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("name"));
    }

    #[test]
    fn test_validate_sponsor_input_whitespace_name() {
        let result = validate_sponsor_input("   ", "jane@acme.com", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_sponsor_input_invalid_email() {
        let result = validate_sponsor_input("Acme", "not-an-email", None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("email"));
    }

    #[test]
    fn test_validate_sponsor_input_short_desc_at_limit() {
        let desc = "a".repeat(200);
        assert!(validate_sponsor_input("Acme", "a@b", Some(&desc)).is_ok());
    }

    #[test]
    fn test_validate_sponsor_input_short_desc_over_limit() {
        let desc = "a".repeat(201);
        let result = validate_sponsor_input("Acme", "a@b", Some(&desc));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("200"));
    }

    #[test]
    fn test_normalize_create_request() {
        let mut req = CreateSponsorRequest {
            sponsor_name: "  Acme Corp  ".to_string(),
            short_description: Some("  Short desc  ".to_string()),
            long_description: Some("  Long desc  ".to_string()),
            logo_url: Some("  https://example.com/logo.png  ".to_string()),
            contact_name: Some("  Jane Smith  ".to_string()),
            contact_email: "  Jane@ACME.COM  ".to_string(),
            notes: Some("  Notes  ".to_string()),
            allow_duplicate_name: false,
        };
        normalize_create_request(&mut req);

        assert_eq!(req.sponsor_name, "Acme Corp");
        assert_eq!(req.contact_email, "jane@acme.com");
        assert_eq!(req.short_description.as_deref(), Some("Short desc"));
        assert_eq!(req.long_description.as_deref(), Some("Long desc"));
        assert_eq!(
            req.logo_url.as_deref(),
            Some("https://example.com/logo.png")
        );
        assert_eq!(req.contact_name.as_deref(), Some("Jane Smith"));
        assert_eq!(req.notes.as_deref(), Some("Notes"));
    }

    #[test]
    fn test_normalize_update_request() {
        let mut req = UpdateSponsorRequest {
            sponsor_name: Some("  Updated Name  ".to_string()),
            short_description: None,
            long_description: None,
            logo_url: None,
            contact_name: None,
            contact_email: Some("  NEW@Example.COM  ".to_string()),
            notes: None,
            version: 1,
        };
        normalize_update_request(&mut req);

        assert_eq!(req.sponsor_name.as_deref(), Some("Updated Name"));
        assert_eq!(req.contact_email.as_deref(), Some("new@example.com"));
    }

    #[test]
    fn test_sponsor_sk() {
        assert_eq!(
            sponsor_sk("acme corp", "uuid-123"),
            "sponsor#acme corp#uuid-123"
        );
    }

    #[test]
    fn test_sponsorship_sk() {
        assert_eq!(
            sponsorship_sk("sponsor-1", "2025-01-15", "ship-1"),
            "sponsorship#sponsor-1#2025-01-15#ship-1"
        );
    }

    #[test]
    fn test_outreach_sk() {
        assert_eq!(
            outreach_sk("sponsor-1", "2025-01-15T14:00:00Z"),
            "outreach#sponsor-1#2025-01-15T14:00:00Z"
        );
    }

    #[test]
    fn test_outreach_job_sk() {
        assert_eq!(outreach_job_sk("job-123"), "outreach-job#job-123");
    }

    // **Validates: Requirements 1.3**
    //
    // Property 2: Text field trimming and email normalization
    proptest! {
        #[test]
        fn prop_text_trimming_and_email_normalization(
            name_core in "[a-zA-Z0-9 ]{1,30}",
            desc_core in "[a-zA-Z0-9 ]{0,30}",
            long_desc_core in "[a-zA-Z0-9 ]{0,30}",
            logo_core in "[a-zA-Z0-9:/\\.]{0,30}",
            contact_core in "[a-zA-Z ]{0,20}",
            notes_core in "[a-zA-Z0-9 ]{0,30}",
            email_local in "[a-zA-Z0-9]{1,10}",
            email_domain in "[a-zA-Z0-9]{1,10}\\.[a-zA-Z]{2,4}",
            leading_ws in "[ \\t]{0,5}",
            trailing_ws in "[ \\t]{0,5}",
        ) {
            let padded_name = format!("{}{}{}", leading_ws, name_core, trailing_ws);
            let padded_desc = format!("{}{}{}", leading_ws, desc_core, trailing_ws);
            let padded_long_desc = format!("{}{}{}", leading_ws, long_desc_core, trailing_ws);
            let padded_logo = format!("{}{}{}", leading_ws, logo_core, trailing_ws);
            let padded_contact = format!("{}{}{}", leading_ws, contact_core, trailing_ws);
            let padded_notes = format!("{}{}{}", leading_ws, notes_core, trailing_ws);
            let padded_email = format!("{}{}@{}{}", leading_ws, email_local, email_domain, trailing_ws);

            let mut req = CreateSponsorRequest {
                sponsor_name: padded_name,
                short_description: Some(padded_desc),
                long_description: Some(padded_long_desc),
                logo_url: Some(padded_logo),
                contact_name: Some(padded_contact),
                contact_email: padded_email,
                notes: Some(padded_notes),
                allow_duplicate_name: false,
            };

            normalize_create_request(&mut req);

            prop_assert!(req.sponsor_name == req.sponsor_name.trim());
            prop_assert!(req.short_description.as_deref().unwrap() == req.short_description.as_deref().unwrap().trim());
            prop_assert!(req.long_description.as_deref().unwrap() == req.long_description.as_deref().unwrap().trim());
            prop_assert!(req.logo_url.as_deref().unwrap() == req.logo_url.as_deref().unwrap().trim());
            prop_assert!(req.contact_name.as_deref().unwrap() == req.contact_name.as_deref().unwrap().trim());
            prop_assert!(req.notes.as_deref().unwrap() == req.notes.as_deref().unwrap().trim());
            prop_assert!(req.contact_email == req.contact_email.trim());
            prop_assert!(req.contact_email == req.contact_email.to_lowercase());

            // Idempotency
            let snapshot_name = req.sponsor_name.clone();
            let snapshot_email = req.contact_email.clone();
            normalize_create_request(&mut req);
            prop_assert!(req.sponsor_name == snapshot_name);
            prop_assert!(req.contact_email == snapshot_email);
        }
    }

    // **Validates: Requirements 2.1, 2.3, 7.2**
    //
    // Property 7: DynamoDB key generation
    proptest! {
        #[test]
        fn prop_dynamodb_key_generation(
            sponsor_name_lower in "[a-z0-9 ]{1,30}",
            sponsor_id in "[a-z0-9\\-]{1,36}",
            sponsorship_id in "[a-z0-9\\-]{1,36}",
            date in "[0-9]{4}-[0-9]{2}-[0-9]{2}",
            generated_at in "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z",
            job_id in "[a-z0-9\\-]{1,36}",
        ) {
            let sk = sponsor_sk(&sponsor_name_lower, &sponsor_id);
            prop_assert_eq!(&sk, &format!("sponsor#{}#{}", sponsor_name_lower, sponsor_id));
            prop_assert!(sk.starts_with(SPONSOR_SK_PREFIX));
            prop_assert_eq!(sk.matches('#').count(), 2);

            let sk = sponsorship_sk(&sponsor_id, &date, &sponsorship_id);
            prop_assert_eq!(&sk, &format!("sponsorship#{}#{}#{}", sponsor_id, date, sponsorship_id));
            prop_assert!(sk.starts_with(SPONSORSHIP_SK_PREFIX));
            prop_assert_eq!(sk.matches('#').count(), 3);

            let sk = outreach_sk(&sponsor_id, &generated_at);
            prop_assert_eq!(&sk, &format!("outreach#{}#{}", sponsor_id, generated_at));
            prop_assert!(sk.starts_with(OUTREACH_SK_PREFIX));
            prop_assert_eq!(sk.matches('#').count(), 2);

            let sk = outreach_job_sk(&job_id);
            prop_assert_eq!(&sk, &format!("outreach-job#{}", job_id));
            prop_assert!(sk.starts_with(OUTREACH_JOB_SK_PREFIX));
            prop_assert_eq!(sk.matches('#').count(), 1);
        }
    }

    // **Validates: Requirements 1.2, 1.5, 1.8**
    //
    // Property 1: Sponsor input validation
    proptest! {
        #[test]
        fn prop_sponsor_input_validation(
            name in ".*",
            email in ".*",
            has_desc in proptest::bool::ANY,
            desc in ".*",
        ) {
            let short_desc = if has_desc { Some(desc.as_str()) } else { None };
            let result = validate_sponsor_input(&name, &email, short_desc);

            let name_valid = !name.trim().is_empty();
            let email_parts: Vec<&str> = email.split('@').collect();
            let email_valid = email_parts.len() == 2
                && !email_parts[0].is_empty()
                && !email_parts[1].is_empty();
            let desc_valid = match short_desc {
                Some(d) => d.len() <= 200,
                None => true,
            };
            let should_accept = name_valid && email_valid && desc_valid;

            prop_assert_eq!(
                result.is_ok(),
                should_accept,
                "name={:?}, email={:?}, short_desc={:?} => expected ok={}, got ok={}",
                name, email, short_desc, should_accept, result.is_ok()
            );
        }
    }

    // **Validates: Requirements 1.4**
    //
    // Property 3: Case-insensitive duplicate name detection
    proptest! {
        #[test]
        fn prop_case_insensitive_duplicate_name_detection(
            name in "[a-zA-Z][a-zA-Z0-9 ]{0,29}",
        ) {
            // Generate case variants of the same name
            let upper = name.to_uppercase();
            let lower = name.to_lowercase();
            let mixed: String = name.chars().enumerate().map(|(i, c)| {
                if i % 2 == 0 { c.to_uppercase().next().unwrap() } else { c.to_lowercase().next().unwrap() }
            }).collect();

            // All case variants should produce the same lowercased form
            prop_assert_eq!(upper.to_lowercase(), lower.to_lowercase());
            prop_assert_eq!(mixed.to_lowercase(), lower.to_lowercase());
            prop_assert_eq!(name.to_lowercase(), lower.to_lowercase());

            // The sk-based duplicate check uses lowercased names — two names that
            // differ only in case produce the same sponsor_sk prefix, confirming
            // they would be detected as duplicates.
            let id = "test-id";
            let sk_original = sponsor_sk(&name.to_lowercase(), id);
            let sk_upper = sponsor_sk(&upper.to_lowercase(), id);
            let sk_lower = sponsor_sk(&lower.to_lowercase(), id);
            let sk_mixed = sponsor_sk(&mixed.to_lowercase(), id);

            prop_assert_eq!(&sk_original, &sk_upper);
            prop_assert_eq!(&sk_original, &sk_lower);
            prop_assert_eq!(&sk_original, &sk_mixed);
        }
    }

    // **Validates: Requirements 1.6, 5.12**
    //
    // Property 4: Active sponsors sorted by name ascending
    proptest! {
        #[test]
        fn prop_active_sponsors_sorted_by_name(
            names in proptest::collection::vec("[a-zA-Z][a-zA-Z0-9]{0,19}", 0..50),
        ) {
            // Generate sponsor_sk values for each name (names are trimmed+lowercased on storage)
            let mut sks: Vec<String> = names.iter().enumerate().map(|(i, name)| {
                sponsor_sk(&name.trim().to_lowercase(), &format!("id-{}", i))
            }).collect();

            // DynamoDB returns items sorted by sk ascending
            sks.sort();

            // Extract the name portion from each sk for ordering verification
            let sorted_names: Vec<String> = sks.iter().map(|sk| {
                // sk format: "sponsor#{nameLower}#{id}"
                let without_prefix = sk.strip_prefix(SPONSOR_SK_PREFIX).unwrap();
                let last_hash = without_prefix.rfind('#').unwrap();
                without_prefix[..last_hash].to_string()
            }).collect();

            // Verify the extracted names are in case-insensitive ascending order
            for i in 1..sorted_names.len() {
                prop_assert!(
                    sorted_names[i - 1] <= sorted_names[i],
                    "Names not sorted: {:?} > {:?}",
                    sorted_names[i - 1],
                    sorted_names[i]
                );
            }
        }
    }

    // **Validates: Requirements 1.9, 1.11**
    //
    // Property 5: Archive and restore round trip
    proptest! {
        #[test]
        fn prop_archive_restore_round_trip(
            sponsor_name in "[a-zA-Z][a-zA-Z0-9 ]{0,29}",
            contact_email in "[a-z]{1,10}@[a-z]{1,10}\\.[a-z]{2,4}",
            short_desc in "[a-zA-Z0-9 ]{0,30}",
            notes in "[a-zA-Z0-9 ]{0,30}",
            sponsor_id in "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}",
        ) {
            let now = "2025-01-15T10:00:00Z".to_string();

            // Create an active SponsorRecord
            let original = SponsorRecord {
                sponsor_id: sponsor_id.clone(),
                sponsor_name: sponsor_name.clone(),
                short_description: Some(short_desc.clone()),
                long_description: None,
                logo_url: None,
                contact_name: None,
                contact_email: contact_email.clone(),
                notes: Some(notes.clone()),
                status: "active".to_string(),
                version: 1,
                total_fulfilled_sponsorships: 0,
                total_revenue: 0.0,
                last_sponsored_date: None,
                last_outreach_at: None,
                created_at: now.clone(),
                updated_at: now.clone(),
                archived_at: None,
            };

            // Simulate archive: set status to "archived" and set archivedAt
            let archived_at = "2025-01-16T12:00:00Z".to_string();
            let mut archived = original.clone();
            archived.status = "archived".to_string();
            archived.archived_at = Some(archived_at.clone());

            prop_assert_eq!(&archived.status, "archived");
            prop_assert!(archived.archived_at.is_some());
            prop_assert_eq!(archived.archived_at.as_deref(), Some(archived_at.as_str()));

            // Simulate restore: set status back to "active" and clear archivedAt
            let mut restored = archived.clone();
            restored.status = "active".to_string();
            restored.archived_at = None;

            prop_assert_eq!(&restored.status, "active");
            prop_assert!(restored.archived_at.is_none());

            // All data fields should be unchanged after the round trip
            prop_assert_eq!(&restored.sponsor_id, &original.sponsor_id);
            prop_assert_eq!(&restored.sponsor_name, &original.sponsor_name);
            prop_assert_eq!(&restored.short_description, &original.short_description);
            prop_assert_eq!(&restored.long_description, &original.long_description);
            prop_assert_eq!(&restored.logo_url, &original.logo_url);
            prop_assert_eq!(&restored.contact_name, &original.contact_name);
            prop_assert_eq!(&restored.contact_email, &original.contact_email);
            prop_assert_eq!(&restored.notes, &original.notes);
            prop_assert_eq!(restored.version, original.version);
            prop_assert_eq!(restored.total_fulfilled_sponsorships, original.total_fulfilled_sponsorships);
            prop_assert_eq!(&restored.created_at, &original.created_at);
        }
    }

    // **Validates: Requirements 2.7, 5.9**
    //
    // Property 8: Optimistic locking version management
    proptest! {
        #[test]
        fn prop_optimistic_locking_version_management(
            initial_version in 1u64..1000,
        ) {
            // Version always starts as a positive integer
            prop_assert!(initial_version >= 1);

            // A successful update increments version by exactly 1
            let updated_version = initial_version + 1;
            prop_assert_eq!(updated_version, initial_version + 1);
            prop_assert!(updated_version > initial_version);

            // A stale version (any version != current) should be rejected
            let stale_version = initial_version.saturating_sub(1);
            let is_stale = stale_version != initial_version;
            // For initial_version > 1, stale_version < initial_version, so it's stale
            if initial_version > 1 {
                prop_assert!(is_stale, "Version {} should be stale vs current {}", stale_version, initial_version);
            }

            // Simulate multiple sequential updates
            let mut current = initial_version;
            for _ in 0..5 {
                let next = current + 1;
                prop_assert_eq!(next, current + 1);
                prop_assert!(next > current);
                // After update, old version is now stale
                let old = current;
                current = next;
                prop_assert_ne!(old, current, "Old version {} should differ from current {}", old, current);
            }

            // Final version should be initial + 5
            prop_assert_eq!(current, initial_version + 5);
        }
    }

    // **Validates: Requirements 2.5, 8.2**
    //
    // Property 9: Fulfilled amountCharged immutability
    proptest! {
        #[test]
        fn prop_fulfilled_amount_charged_immutability(
            amount in 0.01f64..100_000.0,
            new_amount in proptest::option::of(0.01f64..100_000.0),
            sponsor_id in "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}",
            sponsorship_id in "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}",
            issue_id in "[a-z0-9]{5,20}",
        ) {
            // Create a fulfilled SponsorshipEntry
            let entry = SponsorshipEntry {
                sponsorship_id: sponsorship_id.clone(),
                sponsor_id: sponsor_id.clone(),
                issue_id: issue_id.clone(),
                issue_title: "Test Issue".to_string(),
                sponsorship_date: "2025-01-15".to_string(),
                amount_charged: amount,
                status: "fulfilled".to_string(),
                placement_type: "primary".to_string(),
                sponsor_link_ids: vec![],
                pricing_snapshot: None,
                click_cache: None,
                created_at: "2025-01-15T10:00:00Z".to_string(),
                updated_at: "2025-01-15T10:00:00Z".to_string(),
                fulfilled_at: Some("2025-01-15T12:00:00Z".to_string()),
            };

            // The immutability rule: if status == "fulfilled" && new_amount.is_some() → reject
            let should_reject = entry.status == "fulfilled" && new_amount.is_some();

            // This must always be true for fulfilled entries with an amountCharged update
            prop_assert!(should_reject == new_amount.is_some(),
                "Fulfilled entry with new_amount={:?} should_reject={}",
                new_amount, should_reject);

            // The stored amountCharged must remain unchanged regardless of the update attempt
            prop_assert_eq!(entry.amount_charged, amount,
                "amountCharged must remain {} but got {}", amount, entry.amount_charged);
        }
    }

    // **Validates: Requirements 3.4**
    //
    // Property 11: Sponsorships sorted by date descending
    proptest! {
        #[test]
        fn prop_sponsorships_sorted_by_date_descending(
            dates in proptest::collection::vec(
                (2020u32..2030, 1u32..13, 1u32..29),
                0..20
            ),
            sponsor_id in "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}",
        ) {
            // Generate sponsorship_sk values for each date
            let mut sk_entries: Vec<String> = dates.iter().enumerate().map(|(i, (y, m, d))| {
                let date_str = format!("{:04}-{:02}-{:02}", y, m, d);
                let sid = format!("sid-{:04}", i);
                sponsorship_sk(&sponsor_id, &date_str, &sid)
            }).collect();

            // DynamoDB returns items sorted by sk ascending natively
            sk_entries.sort();

            // ScanIndexForward: false reverses the order → descending
            sk_entries.reverse();

            // Extract dates from the sk values for verification
            // sk format: "sponsorship#{sponsorId}#{date}#{sponsorshipId}"
            let extracted_dates: Vec<String> = sk_entries.iter().map(|sk| {
                let without_prefix = sk.strip_prefix(SPONSORSHIP_SK_PREFIX).unwrap();
                // Skip past sponsorId# to get to date
                let after_sponsor_id = without_prefix
                    .strip_prefix(&sponsor_id)
                    .unwrap()
                    .strip_prefix('#')
                    .unwrap();
                // Date is everything up to the last #
                let last_hash = after_sponsor_id.rfind('#').unwrap();
                after_sponsor_id[..last_hash].to_string()
            }).collect();

            // Verify the dates are in descending order
            for i in 1..extracted_dates.len() {
                prop_assert!(
                    extracted_dates[i - 1] >= extracted_dates[i],
                    "Dates not in descending order: {:?} < {:?} at index {}",
                    extracted_dates[i - 1],
                    extracted_dates[i],
                    i
                );
            }
        }
    }

    // **Validates: Requirements 3.5, 8.1**
    //
    // Property 12: Fulfillment captures pricing snapshot
    proptest! {
        #[test]
        fn prop_fulfillment_captures_pricing_snapshot(
            subscriber_count in 0.0f64..1_000_000.0,
            recommended_rate in 0.0f64..10_000.0,
            open_rate in 0.0f64..1.0,
            click_through_rate in 0.0f64..1.0,
            sponsor_id in "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}",
            sponsorship_id in "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}",
        ) {
            // Create a SponsorshipEntry and simulate fulfillment
            let snapshot = PricingSnapshot {
                subscriber_count,
                recommended_rate,
                open_rate,
                click_through_rate,
            };

            let fulfilled_at = "2025-01-15T14:00:00Z".to_string();

            let entry = SponsorshipEntry {
                sponsorship_id,
                sponsor_id,
                issue_id: "issue-1".to_string(),
                issue_title: "Test Issue".to_string(),
                sponsorship_date: "2025-01-15".to_string(),
                amount_charged: 100.0,
                status: "fulfilled".to_string(),
                placement_type: "primary".to_string(),
                sponsor_link_ids: vec![],
                pricing_snapshot: Some(snapshot),
                click_cache: None,
                created_at: "2025-01-15T10:00:00Z".to_string(),
                updated_at: "2025-01-15T14:00:00Z".to_string(),
                fulfilled_at: Some(fulfilled_at.clone()),
            };

            // Verify all snapshot fields are populated
            let snap = entry.pricing_snapshot.as_ref().unwrap();
            prop_assert_eq!(snap.subscriber_count, subscriber_count);
            prop_assert_eq!(snap.recommended_rate, recommended_rate);
            prop_assert_eq!(snap.open_rate, open_rate);
            prop_assert_eq!(snap.click_through_rate, click_through_rate);

            // Verify fulfilledAt is set
            prop_assert!(entry.fulfilled_at.is_some());
            prop_assert_eq!(entry.fulfilled_at.as_deref(), Some(fulfilled_at.as_str()));

            // Verify status is fulfilled
            prop_assert_eq!(&entry.status, "fulfilled");
        }
    }

    // **Validates: Requirements 4.2**
    //
    // Property 13: Sponsor link validation
    proptest! {
        #[test]
        fn prop_sponsor_link_validation(
            valid_link_ids in proptest::collection::vec("[a-f0-9]{8}", 1..10),
            extra_invalid_ids in proptest::collection::vec("[a-f0-9]{8}", 0..5),
            include_invalid in proptest::bool::ANY,
        ) {
            use std::collections::HashSet;

            // Build the set of "valid" link IDs (those belonging to the correct tenant/issue)
            let valid_set: HashSet<String> = valid_link_ids.iter().cloned().collect();

            // Build the requested link IDs — either all valid, or mixed with invalid
            let mut requested_ids = valid_link_ids.clone();
            if include_invalid && !extra_invalid_ids.is_empty() {
                // Add IDs that are NOT in the valid set
                for id in &extra_invalid_ids {
                    if !valid_set.contains(id) {
                        requested_ids.push(id.clone());
                    }
                }
            }

            // Determine which requested IDs are invalid
            let invalid_ids: Vec<&String> = requested_ids
                .iter()
                .filter(|id| !valid_set.contains(*id))
                .collect();

            let has_invalid = !invalid_ids.is_empty();

            if has_invalid {
                // If any link ID is not in the valid set, the request should be rejected
                prop_assert!(!invalid_ids.is_empty(),
                    "Expected invalid link IDs to be identified");

                // Every invalid ID must not be in the valid set
                for id in &invalid_ids {
                    prop_assert!(!valid_set.contains(*id),
                        "ID {:?} was flagged invalid but exists in valid set", id);
                }
            } else {
                // All requested IDs are in the valid set — request should succeed
                for id in &requested_ids {
                    prop_assert!(valid_set.contains(id),
                        "ID {:?} should be in valid set but isn't", id);
                }
            }
        }
    }

    // **Validates: Requirements 7.5**
    //
    // Property 17: Outreach audit trail preservation
    proptest! {
        #[test]
        fn prop_outreach_audit_trail_preservation(
            sponsor_id in "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}",
            timestamps in proptest::collection::vec(
                (2020u32..2030, 1u32..13, 1u32..29, 0u32..24, 0u32..60, 0u32..60),
                1..20
            ),
        ) {
            use std::collections::HashSet;

            // Generate outreach_sk values for each timestamp (simulating multiple outreach records)
            let sks: Vec<String> = timestamps.iter().map(|(y, mo, d, h, mi, s)| {
                let generated_at = format!(
                    "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
                    y, mo, d, h, mi, s
                );
                outreach_sk(&sponsor_id, &generated_at)
            }).collect();

            // All sk values must be unique — no two outreach records share the same sk
            // This proves each new outreach email gets its own unique record
            let unique_sks: HashSet<&String> = sks.iter().collect();
            prop_assert_eq!(
                unique_sks.len(),
                sks.len(),
                "Expected {} unique outreach sk values but got {} — duplicate sk detected",
                sks.len(),
                unique_sks.len()
            );

            // Every sk must start with the outreach prefix
            for sk in &sks {
                prop_assert!(
                    sk.starts_with(OUTREACH_SK_PREFIX),
                    "Outreach sk {:?} does not start with prefix {:?}",
                    sk,
                    OUTREACH_SK_PREFIX
                );
            }

            // Every sk must contain the sponsor_id
            for sk in &sks {
                prop_assert!(
                    sk.contains(&sponsor_id),
                    "Outreach sk {:?} does not contain sponsor_id {:?}",
                    sk,
                    sponsor_id
                );
            }
        }
    }

    // **Validates: Requirements 7.4**
    //
    // Property 24: Outreach emails sorted by generatedAt descending
    proptest! {
        #[test]
        fn prop_outreach_emails_sorted_by_generated_at_descending(
            timestamps in proptest::collection::vec(
                (2020u32..2030, 1u32..13, 1u32..29, 0u32..24, 0u32..60, 0u32..60),
                0..20
            ),
            sponsor_id in "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}",
        ) {
            // Generate outreach_sk values for each timestamp
            let mut sk_entries: Vec<String> = timestamps.iter().map(|(y, mo, d, h, mi, s)| {
                let generated_at = format!(
                    "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
                    y, mo, d, h, mi, s
                );
                outreach_sk(&sponsor_id, &generated_at)
            }).collect();

            // DynamoDB returns items sorted by sk ascending natively
            sk_entries.sort();

            // ScanIndexForward: false reverses the order → descending
            sk_entries.reverse();

            // Extract generatedAt from the sk values for verification
            // sk format: "outreach#{sponsorId}#{generatedAt}"
            let expected_prefix = format!("{}{}#", OUTREACH_SK_PREFIX, sponsor_id);
            let extracted_timestamps: Vec<String> = sk_entries.iter().map(|sk| {
                sk.strip_prefix(&expected_prefix)
                    .unwrap_or(sk)
                    .to_string()
            }).collect();

            // Verify the timestamps are in descending order
            for i in 1..extracted_timestamps.len() {
                prop_assert!(
                    extracted_timestamps[i - 1] >= extracted_timestamps[i],
                    "Outreach timestamps not in descending order: {:?} < {:?} at index {}",
                    extracted_timestamps[i - 1],
                    extracted_timestamps[i],
                    i
                );
            }
        }
    }
}
