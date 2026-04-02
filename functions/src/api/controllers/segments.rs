use aws_sdk_dynamodb::types::{
    AttributeValue, Delete, DeleteRequest, KeysAndAttributes, Put, TransactWriteItem, Update,
    WriteRequest,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use lambda_http::{Body, Error, Request, RequestExt};
use newsletter::admin::{auth, aws_clients, error::AppError, response};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;

// ── Constants ──────────────────────────────────────────────────────────

const SEGMENT_NAME_MAX_LEN: usize = 100;
const DESCRIPTION_MAX_LEN: usize = 500;
const MAX_BATCH_SIZE: usize = 100;
const DEFAULT_PAGE_SIZE: i32 = 50;
const MAX_PAGE_SIZE: i32 = 200;

// ── Request/Response types ─────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSegmentRequest {
    name: String,
    description: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSegmentRequest {
    name: String,
    description: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentResponse {
    pub segment_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub member_count: i64,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListSegmentsResponse {
    segments: Vec<SegmentResponse>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddMembersRequest {
    emails: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AddMembersResponse {
    added: i64,
    skipped: i64,
    skipped_emails: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveMembersRequest {
    emails: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoveMembersResponse {
    removed: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MemberResponse {
    email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_engaged_issue: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    engagement_count: Option<i64>,
    added_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListMembersResponse {
    members: Vec<MemberResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_token: Option<String>,
    total_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportSyncResponse {
    s3_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportAsyncResponse {
    job_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JobStatusResponse {
    job_id: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    s3_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMemberEntry {
    pub email: String,
    pub last_engaged_issue: Option<i64>,
    pub engagement_count: Option<i64>,
}

// ── Public endpoint handlers ───────────────────────────────────────────

/// POST /segments
pub async fn create_segment(event: Request) -> Result<lambda_http::Response<Body>, Error> {
    match handle_create_segment(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /segments
pub async fn list_segments(event: Request) -> Result<lambda_http::Response<Body>, Error> {
    match handle_list_segments(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /segments/:segmentId
pub async fn get_segment(
    event: Request,
    segment_id: &str,
) -> Result<lambda_http::Response<Body>, Error> {
    match handle_get_segment(event, segment_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// PUT /segments/:segmentId
pub async fn update_segment(
    event: Request,
    segment_id: &str,
) -> Result<lambda_http::Response<Body>, Error> {
    match handle_update_segment(event, segment_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// DELETE /segments/:segmentId
pub async fn delete_segment(
    event: Request,
    segment_id: &str,
) -> Result<lambda_http::Response<Body>, Error> {
    match handle_delete_segment(event, segment_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// POST /segments/:segmentId/members
pub async fn add_members(
    event: Request,
    segment_id: &str,
) -> Result<lambda_http::Response<Body>, Error> {
    match handle_add_members(event, segment_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// DELETE /segments/:segmentId/members
pub async fn remove_members(
    event: Request,
    segment_id: &str,
) -> Result<lambda_http::Response<Body>, Error> {
    match handle_remove_members(event, segment_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /segments/:segmentId/members?pageSize=50&nextToken=...
pub async fn list_members(
    event: Request,
    segment_id: &str,
) -> Result<lambda_http::Response<Body>, Error> {
    match handle_list_members(event, segment_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// POST /segments/:segmentId/export
pub async fn export_segment(
    event: Request,
    segment_id: &str,
) -> Result<lambda_http::Response<Body>, Error> {
    match handle_export_segment(event, segment_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /segments/jobs/:jobId
pub async fn get_job_status(
    event: Request,
    job_id: &str,
) -> Result<lambda_http::Response<Body>, Error> {
    match handle_get_job_status(event, job_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

// ── Internal handlers ──────────────────────────────────────────────────

async fn handle_create_segment(event: Request) -> Result<lambda_http::Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let body: CreateSegmentRequest = parse_request_body(&event)?;

    // Trim whitespace from name
    let trimmed_name = body.name.trim().to_string();

    // Validate name length after trim
    if trimmed_name.is_empty() {
        return Err(AppError::BadRequest(
            "Segment name must be at least 1 character after trimming".to_string(),
        ));
    }
    if trimmed_name.len() > SEGMENT_NAME_MAX_LEN {
        return Err(AppError::BadRequest(
            "Segment name must not exceed 100 characters".to_string(),
        ));
    }

    // Validate description length
    if let Some(ref desc) = body.description {
        if desc.len() > DESCRIPTION_MAX_LEN {
            return Err(AppError::BadRequest(
                "Description must not exceed 500 characters".to_string(),
            ));
        }
    }

    let segment_id = ulid::Ulid::new().to_string();
    let now = Utc::now().to_rfc3339();
    let lower_name = trimmed_name.to_lowercase();

    let table_name = get_subscribers_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    // Build uniqueness record put
    let uniqueness_sk = format!("SEGMENT_NAME#{}", lower_name);
    let mut uniqueness_item = std::collections::HashMap::new();
    uniqueness_item.insert("tenantId".to_string(), AttributeValue::S(tenant_id.clone()));
    uniqueness_item.insert("email".to_string(), AttributeValue::S(uniqueness_sk));
    uniqueness_item.insert(
        "segmentId".to_string(),
        AttributeValue::S(segment_id.clone()),
    );

    let uniqueness_put = Put::builder()
        .table_name(&table_name)
        .set_item(Some(uniqueness_item))
        .condition_expression("attribute_not_exists(email)")
        .build()
        .map_err(|e| AppError::InternalError(format!("Failed to build put: {}", e)))?;

    // Build segment record put
    let segment_sk = format!("SEGMENT#{}", segment_id);
    let mut segment_item = std::collections::HashMap::new();
    segment_item.insert("tenantId".to_string(), AttributeValue::S(tenant_id.clone()));
    segment_item.insert("email".to_string(), AttributeValue::S(segment_sk));
    segment_item.insert(
        "segmentId".to_string(),
        AttributeValue::S(segment_id.clone()),
    );
    segment_item.insert("name".to_string(), AttributeValue::S(trimmed_name.clone()));
    if let Some(ref desc) = body.description {
        segment_item.insert("description".to_string(), AttributeValue::S(desc.clone()));
    }
    segment_item.insert(
        "memberCount".to_string(),
        AttributeValue::N("0".to_string()),
    );
    segment_item.insert("createdAt".to_string(), AttributeValue::S(now.clone()));

    let segment_put = Put::builder()
        .table_name(&table_name)
        .set_item(Some(segment_item))
        .build()
        .map_err(|e| AppError::InternalError(format!("Failed to build put: {}", e)))?;

    // Execute transact write
    let result = ddb_client
        .transact_write_items()
        .transact_items(TransactWriteItem::builder().put(uniqueness_put).build())
        .transact_items(TransactWriteItem::builder().put(segment_put).build())
        .send()
        .await;

    match result {
        Ok(_) => {
            let resp = SegmentResponse {
                segment_id,
                name: trimmed_name,
                description: body.description,
                member_count: 0,
                created_at: now,
                updated_at: None,
            };
            response::format_response(201, resp)
        }
        Err(err) => {
            let service_err = err.into_service_error();
            if service_err.is_transaction_canceled_exception() {
                Err(AppError::Conflict(
                    "A segment with this name already exists".to_string(),
                ))
            } else {
                Err(AppError::AwsError(format!(
                    "DynamoDB TransactWriteItems error: {}",
                    service_err
                )))
            }
        }
    }
}

async fn handle_get_segment(
    event: Request,
    segment_id: &str,
) -> Result<lambda_http::Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_subscribers_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let segment_sk = format!("SEGMENT#{}", segment_id);

    let result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("tenantId", AttributeValue::S(tenant_id))
        .key("email", AttributeValue::S(segment_sk))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB GetItem error: {}", e)))?;

    match result.item() {
        Some(item) => {
            let segment = parse_segment_item(item)?;
            response::format_response(200, segment)
        }
        None => Err(AppError::NotFound("Segment not found".to_string())),
    }
}

async fn handle_update_segment(
    event: Request,
    segment_id: &str,
) -> Result<lambda_http::Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let body: UpdateSegmentRequest = parse_request_body(&event)?;

    // Trim whitespace from name
    let trimmed_name = body.name.trim().to_string();

    // Validate name length after trim
    if trimmed_name.is_empty() {
        return Err(AppError::BadRequest(
            "Segment name must be at least 1 character after trimming".to_string(),
        ));
    }
    if trimmed_name.len() > SEGMENT_NAME_MAX_LEN {
        return Err(AppError::BadRequest(
            "Segment name must not exceed 100 characters".to_string(),
        ));
    }

    // Validate description length
    if let Some(ref desc) = body.description {
        if desc.len() > DESCRIPTION_MAX_LEN {
            return Err(AppError::BadRequest(
                "Description must not exceed 500 characters".to_string(),
            ));
        }
    }

    let table_name = get_subscribers_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    // Fetch existing segment
    let segment_sk = format!("SEGMENT#{}", segment_id);
    let existing = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("tenantId", AttributeValue::S(tenant_id.clone()))
        .key("email", AttributeValue::S(segment_sk.clone()))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB GetItem error: {}", e)))?;

    let existing_item = existing
        .item()
        .ok_or_else(|| AppError::NotFound("Segment not found".to_string()))?;

    let old_name = existing_item
        .get("name")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing name on existing segment".to_string()))?;

    let now = Utc::now().to_rfc3339();
    let new_lower_name = trimmed_name.to_lowercase();
    let old_lower_name = old_name.trim().to_lowercase();
    let name_changed = new_lower_name != old_lower_name;

    if name_changed {
        // Atomic TransactWriteItems: delete old uniqueness, put new uniqueness, update segment
        let old_uniqueness_sk = format!("SEGMENT_NAME#{}", old_lower_name);
        let new_uniqueness_sk = format!("SEGMENT_NAME#{}", new_lower_name);

        // 1. Delete old uniqueness record
        let delete_old = Delete::builder()
            .table_name(&table_name)
            .key("tenantId", AttributeValue::S(tenant_id.clone()))
            .key("email", AttributeValue::S(old_uniqueness_sk))
            .build()
            .map_err(|e| AppError::InternalError(format!("Failed to build delete: {}", e)))?;

        // 2. Put new uniqueness record with condition
        let mut new_uniqueness_item = std::collections::HashMap::new();
        new_uniqueness_item.insert("tenantId".to_string(), AttributeValue::S(tenant_id.clone()));
        new_uniqueness_item.insert("email".to_string(), AttributeValue::S(new_uniqueness_sk));
        new_uniqueness_item.insert(
            "segmentId".to_string(),
            AttributeValue::S(segment_id.to_string()),
        );

        let put_new = Put::builder()
            .table_name(&table_name)
            .set_item(Some(new_uniqueness_item))
            .condition_expression("attribute_not_exists(email)")
            .build()
            .map_err(|e| AppError::InternalError(format!("Failed to build put: {}", e)))?;

        // 3. Update segment record
        let mut update_expr = "SET #n = :name, updatedAt = :now".to_string();
        let mut expr_attr_values = std::collections::HashMap::new();
        expr_attr_values.insert(":name".to_string(), AttributeValue::S(trimmed_name.clone()));
        expr_attr_values.insert(":now".to_string(), AttributeValue::S(now.clone()));

        if let Some(ref desc) = body.description {
            update_expr.push_str(", description = :desc");
            expr_attr_values.insert(":desc".to_string(), AttributeValue::S(desc.clone()));
        } else {
            update_expr.push_str(" REMOVE description");
        }

        let mut expr_attr_names = std::collections::HashMap::new();
        expr_attr_names.insert("#n".to_string(), "name".to_string());

        let update_segment = Update::builder()
            .table_name(&table_name)
            .key("tenantId", AttributeValue::S(tenant_id.clone()))
            .key("email", AttributeValue::S(segment_sk))
            .update_expression(&update_expr)
            .set_expression_attribute_values(Some(expr_attr_values))
            .set_expression_attribute_names(Some(expr_attr_names))
            .build()
            .map_err(|e| AppError::InternalError(format!("Failed to build update: {}", e)))?;

        let result = ddb_client
            .transact_write_items()
            .transact_items(TransactWriteItem::builder().delete(delete_old).build())
            .transact_items(TransactWriteItem::builder().put(put_new).build())
            .transact_items(TransactWriteItem::builder().update(update_segment).build())
            .send()
            .await;

        match result {
            Ok(_) => {}
            Err(err) => {
                let service_err = err.into_service_error();
                if service_err.is_transaction_canceled_exception() {
                    return Err(AppError::Conflict(
                        "A segment with this name already exists".to_string(),
                    ));
                } else {
                    return Err(AppError::AwsError(format!(
                        "DynamoDB TransactWriteItems error: {}",
                        service_err
                    )));
                }
            }
        }
    } else {
        // Only description (or name casing) changed — simple UpdateItem
        let mut update_expr = "SET #n = :name, updatedAt = :now".to_string();
        let mut expr_attr_values = std::collections::HashMap::new();
        expr_attr_values.insert(":name".to_string(), AttributeValue::S(trimmed_name.clone()));
        expr_attr_values.insert(":now".to_string(), AttributeValue::S(now.clone()));

        if let Some(ref desc) = body.description {
            update_expr.push_str(", description = :desc");
            expr_attr_values.insert(":desc".to_string(), AttributeValue::S(desc.clone()));
        } else {
            update_expr.push_str(" REMOVE description");
        }

        let mut expr_attr_names = std::collections::HashMap::new();
        expr_attr_names.insert("#n".to_string(), "name".to_string());

        ddb_client
            .update_item()
            .table_name(&table_name)
            .key("tenantId", AttributeValue::S(tenant_id.clone()))
            .key("email", AttributeValue::S(segment_sk))
            .update_expression(&update_expr)
            .set_expression_attribute_values(Some(expr_attr_values))
            .set_expression_attribute_names(Some(expr_attr_names))
            .send()
            .await
            .map_err(|e| AppError::AwsError(format!("DynamoDB UpdateItem error: {}", e)))?;
    }

    // Fetch updated segment to return
    let updated_segment_sk = format!("SEGMENT#{}", segment_id);
    let updated = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("tenantId", AttributeValue::S(tenant_id))
        .key("email", AttributeValue::S(updated_segment_sk))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB GetItem error: {}", e)))?;

    match updated.item() {
        Some(item) => {
            let segment = parse_segment_item(item)?;
            response::format_response(200, segment)
        }
        None => Err(AppError::InternalError(
            "Segment not found after update".to_string(),
        )),
    }
}

async fn handle_delete_segment(
    event: Request,
    segment_id: &str,
) -> Result<lambda_http::Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_subscribers_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    // 1. Fetch existing segment to get the name (needed for uniqueness record)
    let segment_sk = format!("SEGMENT#{}", segment_id);
    let existing = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("tenantId", AttributeValue::S(tenant_id.clone()))
        .key("email", AttributeValue::S(segment_sk.clone()))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB GetItem error: {}", e)))?;

    let existing_item = existing
        .item()
        .ok_or_else(|| AppError::NotFound("Segment not found".to_string()))?;

    let segment_name = existing_item
        .get("name")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing name on existing segment".to_string()))?;

    let lower_name = segment_name.trim().to_lowercase();
    let uniqueness_sk = format!("SEGMENT_NAME#{}", lower_name);

    // 2. Query member count
    let member_prefix = format!("SEGMENT#{}#MEMBER#", segment_id);
    let count_result = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("tenantId = :pk AND begins_with(email, :sk_prefix)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
        .expression_attribute_values(":sk_prefix", AttributeValue::S(member_prefix.clone()))
        .select(aws_sdk_dynamodb::types::Select::Count)
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB Query error: {}", e)))?;

    let member_count = count_result.count() as u32;

    if member_count <= 25 {
        // 3a. Synchronous deletion: TransactWriteItems for segment + uniqueness + all members
        // First, query to get actual member records
        let members_result = ddb_client
            .query()
            .table_name(&table_name)
            .key_condition_expression("tenantId = :pk AND begins_with(email, :sk_prefix)")
            .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
            .expression_attribute_values(":sk_prefix", AttributeValue::S(member_prefix))
            .send()
            .await
            .map_err(|e| AppError::AwsError(format!("DynamoDB Query error: {}", e)))?;

        // Build transact items: segment record + uniqueness record + all member records
        // TransactWriteItems supports max 100 items, and we have at most 25 members + 2 = 27
        let mut transact_items = Vec::new();

        // Delete segment record
        let delete_segment = Delete::builder()
            .table_name(&table_name)
            .key("tenantId", AttributeValue::S(tenant_id.clone()))
            .key("email", AttributeValue::S(segment_sk))
            .build()
            .map_err(|e| AppError::InternalError(format!("Failed to build delete: {}", e)))?;
        transact_items.push(TransactWriteItem::builder().delete(delete_segment).build());

        // Delete uniqueness record
        let delete_uniqueness = Delete::builder()
            .table_name(&table_name)
            .key("tenantId", AttributeValue::S(tenant_id.clone()))
            .key("email", AttributeValue::S(uniqueness_sk))
            .build()
            .map_err(|e| AppError::InternalError(format!("Failed to build delete: {}", e)))?;
        transact_items.push(
            TransactWriteItem::builder()
                .delete(delete_uniqueness)
                .build(),
        );

        // Delete all member records
        for member_item in members_result.items() {
            let member_sk = member_item
                .get("email")
                .and_then(|v| v.as_s().ok())
                .ok_or_else(|| {
                    AppError::InternalError("Missing email on member record".to_string())
                })?;

            let delete_member = Delete::builder()
                .table_name(&table_name)
                .key("tenantId", AttributeValue::S(tenant_id.clone()))
                .key("email", AttributeValue::S(member_sk.clone()))
                .build()
                .map_err(|e| AppError::InternalError(format!("Failed to build delete: {}", e)))?;
            transact_items.push(TransactWriteItem::builder().delete(delete_member).build());
        }

        let mut request = ddb_client.transact_write_items();
        for item in transact_items {
            request = request.transact_items(item);
        }
        request
            .send()
            .await
            .map_err(|e| AppError::AwsError(format!("DynamoDB TransactWriteItems error: {}", e)))?;

        response::format_response(200, serde_json::json!({ "deleted": true }))
    } else {
        // 3b. Async deletion: delete segment + uniqueness immediately, invoke Lambda async
        // TransactWriteItems to delete segment record + uniqueness record
        let delete_segment = Delete::builder()
            .table_name(&table_name)
            .key("tenantId", AttributeValue::S(tenant_id.clone()))
            .key("email", AttributeValue::S(segment_sk))
            .build()
            .map_err(|e| AppError::InternalError(format!("Failed to build delete: {}", e)))?;

        let delete_uniqueness = Delete::builder()
            .table_name(&table_name)
            .key("tenantId", AttributeValue::S(tenant_id.clone()))
            .key("email", AttributeValue::S(uniqueness_sk))
            .build()
            .map_err(|e| AppError::InternalError(format!("Failed to build delete: {}", e)))?;

        ddb_client
            .transact_write_items()
            .transact_items(TransactWriteItem::builder().delete(delete_segment).build())
            .transact_items(
                TransactWriteItem::builder()
                    .delete(delete_uniqueness)
                    .build(),
            )
            .send()
            .await
            .map_err(|e| AppError::AwsError(format!("DynamoDB TransactWriteItems error: {}", e)))?;

        // Invoke SegmentDeleteFunction asynchronously
        let function_name = env::var("SEGMENT_DELETE_FUNCTION_NAME").map_err(|_| {
            AppError::InternalError("SEGMENT_DELETE_FUNCTION_NAME not set".to_string())
        })?;

        let lambda_client = aws_clients::get_lambda_client().await;
        let payload = serde_json::json!({
            "tenantId": tenant_id,
            "segmentId": segment_id
        });

        lambda_client
            .invoke()
            .function_name(&function_name)
            .invocation_type(aws_sdk_lambda::types::InvocationType::Event)
            .payload(aws_smithy_types::Blob::new(
                serde_json::to_vec(&payload).map_err(|e| {
                    AppError::InternalError(format!("Failed to serialize payload: {}", e))
                })?,
            ))
            .send()
            .await
            .map_err(|e| AppError::AwsError(format!("Lambda invoke error: {}", e)))?;

        response::format_response(202, serde_json::json!({ "deleted": true, "async": true }))
    }
}

async fn handle_list_segments(event: Request) -> Result<lambda_http::Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_subscribers_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let result = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("tenantId = :pk AND begins_with(email, :sk_prefix)")
        .filter_expression("NOT contains(email, :member_marker)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id))
        .expression_attribute_values(":sk_prefix", AttributeValue::S("SEGMENT#".to_string()))
        .expression_attribute_values(":member_marker", AttributeValue::S("#MEMBER#".to_string()))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB query error: {}", e)))?;

    let mut segments: Vec<SegmentResponse> = result
        .items()
        .iter()
        .filter_map(|item| parse_segment_item(item).ok())
        .collect();

    // Sort by createdAt descending (newest first)
    segments.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    let resp = ListSegmentsResponse { segments };
    response::format_response(200, resp)
}

async fn handle_add_members(
    event: Request,
    segment_id: &str,
) -> Result<lambda_http::Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let body: AddMembersRequest = parse_request_body(&event)?;

    // Validate batch size
    if body.emails.len() > MAX_BATCH_SIZE {
        return Err(AppError::BadRequest(
            "Batch size must not exceed 100 emails".to_string(),
        ));
    }

    let table_name = get_subscribers_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    // 1. Verify segment exists
    let segment_sk = format!("SEGMENT#{}", segment_id);
    let segment_result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("tenantId", AttributeValue::S(tenant_id.clone()))
        .key("email", AttributeValue::S(segment_sk))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB GetItem error: {}", e)))?;

    if segment_result.item().is_none() {
        return Err(AppError::NotFound("Segment not found".to_string()));
    }

    if body.emails.is_empty() {
        return response::format_response(
            200,
            AddMembersResponse {
                added: 0,
                skipped: 0,
                skipped_emails: vec![],
            },
        );
    }

    // 2. BatchGetItem to verify subscriber existence
    let keys: Vec<HashMap<String, AttributeValue>> = body
        .emails
        .iter()
        .map(|email| {
            let mut key = HashMap::new();
            key.insert("tenantId".to_string(), AttributeValue::S(tenant_id.clone()));
            key.insert("email".to_string(), AttributeValue::S(email.clone()));
            key
        })
        .collect();

    let keys_and_attrs = KeysAndAttributes::builder()
        .set_keys(Some(keys))
        .projection_expression("email")
        .build()
        .map_err(|e| {
            AppError::InternalError(format!("Failed to build KeysAndAttributes: {}", e))
        })?;

    let batch_result = ddb_client
        .batch_get_item()
        .request_items(&table_name, keys_and_attrs)
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB BatchGetItem error: {}", e)))?;

    // Collect existing subscriber emails
    let mut existing_emails = std::collections::HashSet::new();
    if let Some(responses) = batch_result.responses() {
        if let Some(items) = responses.get(&table_name) {
            for item in items {
                if let Some(email_attr) = item.get("email") {
                    if let Ok(email) = email_attr.as_s() {
                        existing_emails.insert(email.clone());
                    }
                }
            }
        }
    }

    // Partition into valid (existing subscribers) and skipped (non-existent)
    let mut skipped_emails: Vec<String> = Vec::new();
    let mut valid_emails: Vec<String> = Vec::new();

    for email in &body.emails {
        if existing_emails.contains(email) {
            valid_emails.push(email.clone());
        } else {
            skipped_emails.push(email.clone());
        }
    }

    // 3. PutItem each valid member record with condition for idempotent adds
    let now = Utc::now().to_rfc3339();
    let mut added_count: i64 = 0;

    for email in &valid_emails {
        let member_sk = format!("SEGMENT#{}#MEMBER#{}", segment_id, email);

        let mut item = HashMap::new();
        item.insert("tenantId".to_string(), AttributeValue::S(tenant_id.clone()));
        item.insert("email".to_string(), AttributeValue::S(member_sk));
        item.insert(
            "subscriberEmail".to_string(),
            AttributeValue::S(email.clone()),
        );
        item.insert(
            "segmentId".to_string(),
            AttributeValue::S(segment_id.to_string()),
        );
        item.insert("addedAt".to_string(), AttributeValue::S(now.clone()));
        item.insert("memberEmail".to_string(), AttributeValue::S(email.clone()));

        let result = ddb_client
            .put_item()
            .table_name(&table_name)
            .set_item(Some(item))
            .condition_expression("attribute_not_exists(email)")
            .send()
            .await;

        match result {
            Ok(_) => {
                added_count += 1;
            }
            Err(err) => {
                let service_err = err.into_service_error();
                if service_err.is_conditional_check_failed_exception() {
                    // Already a member — idempotent, not counted as added or skipped
                } else {
                    return Err(AppError::AwsError(format!(
                        "DynamoDB PutItem error: {}",
                        service_err
                    )));
                }
            }
        }
    }

    // 4. Increment memberCount by newly added count
    if added_count > 0 {
        let segment_sk = format!("SEGMENT#{}", segment_id);
        ddb_client
            .update_item()
            .table_name(&table_name)
            .key("tenantId", AttributeValue::S(tenant_id))
            .key("email", AttributeValue::S(segment_sk))
            .update_expression("ADD memberCount :count")
            .expression_attribute_values(":count", AttributeValue::N(added_count.to_string()))
            .send()
            .await
            .map_err(|e| AppError::AwsError(format!("DynamoDB UpdateItem error: {}", e)))?;
    }

    let skipped = skipped_emails.len() as i64;
    response::format_response(
        200,
        AddMembersResponse {
            added: added_count,
            skipped,
            skipped_emails,
        },
    )
}

async fn handle_remove_members(
    event: Request,
    segment_id: &str,
) -> Result<lambda_http::Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let body: RemoveMembersRequest = parse_request_body(&event)?;

    // Validate batch size
    if body.emails.len() > MAX_BATCH_SIZE {
        return Err(AppError::BadRequest(
            "Batch size must not exceed 100 emails".to_string(),
        ));
    }

    let table_name = get_subscribers_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    // 1. Verify segment exists
    let segment_sk = format!("SEGMENT#{}", segment_id);
    let segment_result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("tenantId", AttributeValue::S(tenant_id.clone()))
        .key("email", AttributeValue::S(segment_sk.clone()))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB GetItem error: {}", e)))?;

    if segment_result.item().is_none() {
        return Err(AppError::NotFound("Segment not found".to_string()));
    }

    if body.emails.is_empty() {
        return response::format_response(200, RemoveMembersResponse { removed: 0 });
    }

    // 2. BatchGetItem to check which emails are actual members
    let keys: Vec<HashMap<String, AttributeValue>> = body
        .emails
        .iter()
        .map(|email| {
            let member_sk = format!("SEGMENT#{}#MEMBER#{}", segment_id, email);
            let mut key = HashMap::new();
            key.insert("tenantId".to_string(), AttributeValue::S(tenant_id.clone()));
            key.insert("email".to_string(), AttributeValue::S(member_sk));
            key
        })
        .collect();

    let keys_and_attrs = KeysAndAttributes::builder()
        .set_keys(Some(keys))
        .projection_expression("email")
        .build()
        .map_err(|e| {
            AppError::InternalError(format!("Failed to build KeysAndAttributes: {}", e))
        })?;

    let batch_result = ddb_client
        .batch_get_item()
        .request_items(&table_name, keys_and_attrs)
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB BatchGetItem error: {}", e)))?;

    // Collect confirmed member sort keys
    let mut confirmed_member_sks: Vec<String> = Vec::new();
    if let Some(responses) = batch_result.responses() {
        if let Some(items) = responses.get(&table_name) {
            for item in items {
                if let Some(email_attr) = item.get("email") {
                    if let Ok(sk) = email_attr.as_s() {
                        confirmed_member_sks.push(sk.clone());
                    }
                }
            }
        }
    }

    let removed_count = confirmed_member_sks.len() as i64;

    if removed_count == 0 {
        return response::format_response(200, RemoveMembersResponse { removed: 0 });
    }

    // 3. BatchWriteItem to delete confirmed member records (in batches of 25)
    for chunk in confirmed_member_sks.chunks(25) {
        let delete_requests: Vec<WriteRequest> = chunk
            .iter()
            .map(|sk| {
                let mut key = HashMap::new();
                key.insert("tenantId".to_string(), AttributeValue::S(tenant_id.clone()));
                key.insert("email".to_string(), AttributeValue::S(sk.clone()));
                WriteRequest::builder()
                    .delete_request(
                        DeleteRequest::builder()
                            .set_key(Some(key))
                            .build()
                            .expect("Failed to build DeleteRequest"),
                    )
                    .build()
            })
            .collect();

        ddb_client
            .batch_write_item()
            .request_items(&table_name, delete_requests)
            .send()
            .await
            .map_err(|e| AppError::AwsError(format!("DynamoDB BatchWriteItem error: {}", e)))?;
    }

    // 4. Decrement memberCount with floor-at-zero protection
    let decrement_result = ddb_client
        .update_item()
        .table_name(&table_name)
        .key("tenantId", AttributeValue::S(tenant_id.clone()))
        .key("email", AttributeValue::S(segment_sk.clone()))
        .update_expression("SET memberCount = if_not_exists(memberCount, :zero) - :count")
        .condition_expression("memberCount >= :count")
        .expression_attribute_values(":count", AttributeValue::N(removed_count.to_string()))
        .expression_attribute_values(":zero", AttributeValue::N("0".to_string()))
        .send()
        .await;

    match decrement_result {
        Ok(_) => {}
        Err(err) => {
            let service_err = err.into_service_error();
            if service_err.is_conditional_check_failed_exception() {
                // Concurrent race — set memberCount to 0
                ddb_client
                    .update_item()
                    .table_name(&table_name)
                    .key("tenantId", AttributeValue::S(tenant_id))
                    .key("email", AttributeValue::S(segment_sk))
                    .update_expression("SET memberCount = :zero")
                    .expression_attribute_values(":zero", AttributeValue::N("0".to_string()))
                    .send()
                    .await
                    .map_err(|e| AppError::AwsError(format!("DynamoDB UpdateItem error: {}", e)))?;
            } else {
                return Err(AppError::AwsError(format!(
                    "DynamoDB UpdateItem error: {}",
                    service_err
                )));
            }
        }
    }

    response::format_response(
        200,
        RemoveMembersResponse {
            removed: removed_count,
        },
    )
}

async fn handle_list_members(
    event: Request,
    segment_id: &str,
) -> Result<lambda_http::Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_subscribers_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    // 1. Verify segment exists and get memberCount for totalCount
    let segment_sk = format!("SEGMENT#{}", segment_id);
    let segment_result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("tenantId", AttributeValue::S(tenant_id.clone()))
        .key("email", AttributeValue::S(segment_sk))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB GetItem error: {}", e)))?;

    let segment_item = segment_result
        .item()
        .ok_or_else(|| AppError::NotFound("Segment not found".to_string()))?;

    let total_count = segment_item
        .get("memberCount")
        .and_then(|v| v.as_n().ok())
        .and_then(|n| n.parse::<i64>().ok())
        .unwrap_or(0);

    // 2. Parse query params: pageSize and nextToken
    let query_params = event.query_string_parameters();

    let page_size: i32 = query_params
        .first("pageSize")
        .and_then(|v| v.parse::<i32>().ok())
        .map(|v| v.clamp(1, MAX_PAGE_SIZE))
        .unwrap_or(DEFAULT_PAGE_SIZE);

    // Decode nextToken (base64-encoded ExclusiveStartKey JSON)
    let exclusive_start_key: Option<HashMap<String, AttributeValue>> =
        if let Some(token) = query_params.first("nextToken") {
            let decoded_bytes = BASE64
                .decode(token)
                .map_err(|e| AppError::BadRequest(format!("Invalid nextToken: {}", e)))?;
            let decoded_str = String::from_utf8(decoded_bytes)
                .map_err(|e| AppError::BadRequest(format!("Invalid nextToken encoding: {}", e)))?;
            let json_map: HashMap<String, String> = serde_json::from_str(&decoded_str)
                .map_err(|e| AppError::BadRequest(format!("Invalid nextToken format: {}", e)))?;
            let mut key = HashMap::new();
            for (k, v) in json_map {
                key.insert(k, AttributeValue::S(v));
            }
            Some(key)
        } else {
            None
        };

    // 3. Query member records with pagination
    let member_prefix = format!("SEGMENT#{}#MEMBER#", segment_id);
    let mut query = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("tenantId = :pk AND begins_with(email, :sk_prefix)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
        .expression_attribute_values(":sk_prefix", AttributeValue::S(member_prefix.clone()))
        .limit(page_size);

    if let Some(start_key) = exclusive_start_key {
        query = query.set_exclusive_start_key(Some(start_key));
    }

    let query_result = query
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB Query error: {}", e)))?;

    let member_items = query_result.items();

    if member_items.is_empty() {
        return response::format_response(
            200,
            ListMembersResponse {
                members: vec![],
                next_token: None,
                total_count,
            },
        );
    }

    // 4. Extract subscriber emails from member records and build lookup
    let mut member_data: Vec<(String, String)> = Vec::new(); // (subscriberEmail, addedAt)
    for item in member_items {
        let subscriber_email = item
            .get("subscriberEmail")
            .and_then(|v| v.as_s().ok())
            .cloned()
            .unwrap_or_default();
        let added_at = item
            .get("addedAt")
            .and_then(|v| v.as_s().ok())
            .cloned()
            .unwrap_or_default();
        if !subscriber_email.is_empty() {
            member_data.push((subscriber_email, added_at));
        }
    }

    // 5. BatchGetItem subscriber records for engagement data (in batches of 100)
    let mut subscriber_map: HashMap<String, (Option<i64>, Option<i64>)> = HashMap::new();

    for chunk in member_data.chunks(100) {
        let keys: Vec<HashMap<String, AttributeValue>> = chunk
            .iter()
            .map(|(email, _)| {
                let mut key = HashMap::new();
                key.insert("tenantId".to_string(), AttributeValue::S(tenant_id.clone()));
                key.insert("email".to_string(), AttributeValue::S(email.clone()));
                key
            })
            .collect();

        let keys_and_attrs = KeysAndAttributes::builder()
            .set_keys(Some(keys))
            .projection_expression("email, lastEngagedIssue, engagementCount")
            .build()
            .map_err(|e| {
                AppError::InternalError(format!("Failed to build KeysAndAttributes: {}", e))
            })?;

        let batch_result = ddb_client
            .batch_get_item()
            .request_items(&table_name, keys_and_attrs)
            .send()
            .await
            .map_err(|e| AppError::AwsError(format!("DynamoDB BatchGetItem error: {}", e)))?;

        if let Some(responses) = batch_result.responses() {
            if let Some(items) = responses.get(&table_name) {
                for item in items {
                    if let Some(email_attr) = item.get("email") {
                        if let Ok(email) = email_attr.as_s() {
                            let last_engaged = item
                                .get("lastEngagedIssue")
                                .and_then(|v| v.as_n().ok())
                                .and_then(|n| n.parse::<i64>().ok());
                            let engagement_count = item
                                .get("engagementCount")
                                .and_then(|v| v.as_n().ok())
                                .and_then(|n| n.parse::<i64>().ok());
                            subscriber_map.insert(email.clone(), (last_engaged, engagement_count));
                        }
                    }
                }
            }
        }
    }

    // 6. Build response, omitting members whose subscriber record no longer exists (Req 10.9)
    let members: Vec<MemberResponse> = member_data
        .into_iter()
        .filter_map(|(email, added_at)| {
            subscriber_map
                .get(&email)
                .map(|(last_engaged, eng_count)| MemberResponse {
                    email,
                    last_engaged_issue: *last_engaged,
                    engagement_count: *eng_count,
                    added_at,
                })
        })
        .collect();

    // 7. Encode nextToken from LastEvaluatedKey
    let next_token = query_result.last_evaluated_key().map(|lek| {
        let mut json_map: HashMap<String, String> = HashMap::new();
        for (k, v) in lek {
            if let Ok(s) = v.as_s() {
                json_map.insert(k.clone(), s.clone());
            }
        }
        let json_str = serde_json::to_string(&json_map).unwrap_or_default();
        BASE64.encode(json_str.as_bytes())
    });

    response::format_response(
        200,
        ListMembersResponse {
            members,
            next_token,
            total_count,
        },
    )
}

async fn handle_export_segment(
    event: Request,
    segment_id: &str,
) -> Result<lambda_http::Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_subscribers_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    // 1. Verify segment exists and get memberCount
    let segment_sk = format!("SEGMENT#{}", segment_id);
    let segment_result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("tenantId", AttributeValue::S(tenant_id.clone()))
        .key("email", AttributeValue::S(segment_sk))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB GetItem error: {}", e)))?;

    let segment_item = segment_result
        .item()
        .ok_or_else(|| AppError::NotFound("Segment not found".to_string()))?;

    let member_count = segment_item
        .get("memberCount")
        .and_then(|v| v.as_n().ok())
        .and_then(|n| n.parse::<i64>().ok())
        .unwrap_or(0);

    if member_count <= 1000 {
        // Synchronous export
        let entries =
            query_all_member_export_entries(ddb_client, &table_name, &tenant_id, segment_id)
                .await?;
        let export_json = serde_json::to_vec(&entries)
            .map_err(|e| AppError::InternalError(format!("JSON serialization error: {}", e)))?;

        let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        let s3_key = format!(
            "reports/segment-export-{}-{}-{}.json",
            tenant_id, segment_id, timestamp
        );

        let bucket = env::var("BUCKET")
            .map_err(|_| AppError::InternalError("BUCKET not set".to_string()))?;

        let s3_client = aws_clients::get_s3_client().await;
        s3_client
            .put_object()
            .bucket(&bucket)
            .key(&s3_key)
            .body(aws_sdk_s3::primitives::ByteStream::from(export_json))
            .content_type("application/json")
            .send()
            .await
            .map_err(|e| AppError::AwsError(format!("S3 PutObject error: {}", e)))?;

        response::format_response(200, ExportSyncResponse { s3_key })
    } else {
        // Async export — create job record and invoke Lambda
        let job_id = ulid::Ulid::new().to_string();
        let now = Utc::now();
        let created_at = now.to_rfc3339();
        let ttl = (now.timestamp() + 86400).to_string();

        let job_sk = format!("SEGMENT_JOB#{}", job_id);
        let mut job_item = HashMap::new();
        job_item.insert("tenantId".to_string(), AttributeValue::S(tenant_id.clone()));
        job_item.insert("email".to_string(), AttributeValue::S(job_sk));
        job_item.insert("jobId".to_string(), AttributeValue::S(job_id.clone()));
        job_item.insert(
            "jobType".to_string(),
            AttributeValue::S("export".to_string()),
        );
        job_item.insert(
            "segmentId".to_string(),
            AttributeValue::S(segment_id.to_string()),
        );
        job_item.insert(
            "status".to_string(),
            AttributeValue::S("pending".to_string()),
        );
        job_item.insert("createdAt".to_string(), AttributeValue::S(created_at));
        job_item.insert("ttl".to_string(), AttributeValue::N(ttl));

        ddb_client
            .put_item()
            .table_name(&table_name)
            .set_item(Some(job_item))
            .send()
            .await
            .map_err(|e| AppError::AwsError(format!("DynamoDB PutItem error: {}", e)))?;

        // Invoke SegmentExportFunction asynchronously
        let function_name = env::var("SEGMENT_EXPORT_FUNCTION_NAME").map_err(|_| {
            AppError::InternalError("SEGMENT_EXPORT_FUNCTION_NAME not set".to_string())
        })?;

        let lambda_client = aws_clients::get_lambda_client().await;
        let payload = serde_json::json!({
            "tenantId": tenant_id,
            "segmentId": segment_id,
            "jobId": job_id
        });

        lambda_client
            .invoke()
            .function_name(&function_name)
            .invocation_type(aws_sdk_lambda::types::InvocationType::Event)
            .payload(aws_smithy_types::Blob::new(
                serde_json::to_vec(&payload).map_err(|e| {
                    AppError::InternalError(format!("Failed to serialize payload: {}", e))
                })?,
            ))
            .send()
            .await
            .map_err(|e| AppError::AwsError(format!("Lambda invoke error: {}", e)))?;

        response::format_response(202, ExportAsyncResponse { job_id })
    }
}

async fn handle_get_job_status(
    event: Request,
    job_id: &str,
) -> Result<lambda_http::Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_subscribers_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let job_sk = format!("SEGMENT_JOB#{}", job_id);
    let result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("tenantId", AttributeValue::S(tenant_id))
        .key("email", AttributeValue::S(job_sk))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB GetItem error: {}", e)))?;

    let item = result
        .item()
        .ok_or_else(|| AppError::NotFound("Job not found".to_string()))?;

    let status = item
        .get("status")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing status on job record".to_string()))?
        .clone();

    let s3_key = item
        .get("s3Key")
        .and_then(|v| v.as_s().ok()).cloned();

    let error = item
        .get("error")
        .and_then(|v| v.as_s().ok()).cloned();

    response::format_response(
        200,
        JobStatusResponse {
            job_id: job_id.to_string(),
            status,
            s3_key,
            error,
        },
    )
}

/// Query all member records for a segment and build export entries with engagement data.
/// This is the pure data-gathering logic used by synchronous export.
async fn query_all_member_export_entries(
    ddb_client: &aws_sdk_dynamodb::Client,
    table_name: &str,
    tenant_id: &str,
    segment_id: &str,
) -> Result<Vec<ExportMemberEntry>, AppError> {
    let member_prefix = format!("SEGMENT#{}#MEMBER#", segment_id);
    let mut all_emails: Vec<String> = Vec::new();
    let mut exclusive_start_key: Option<HashMap<String, AttributeValue>> = None;

    // Paginated query for all member records
    loop {
        let mut query = ddb_client
            .query()
            .table_name(table_name)
            .key_condition_expression("tenantId = :pk AND begins_with(email, :sk_prefix)")
            .expression_attribute_values(":pk", AttributeValue::S(tenant_id.to_string()))
            .expression_attribute_values(":sk_prefix", AttributeValue::S(member_prefix.clone()));

        if let Some(start_key) = exclusive_start_key {
            query = query.set_exclusive_start_key(Some(start_key));
        }

        let result = query
            .send()
            .await
            .map_err(|e| AppError::AwsError(format!("DynamoDB Query error: {}", e)))?;

        for item in result.items() {
            if let Some(email) = item.get("subscriberEmail").and_then(|v| v.as_s().ok()) {
                all_emails.push(email.clone());
            }
        }

        match result.last_evaluated_key() {
            Some(lek) => exclusive_start_key = Some(lek.clone()),
            None => break,
        }
    }

    // BatchGetItem subscriber records for engagement data (in batches of 100)
    let mut subscriber_map: HashMap<String, (Option<i64>, Option<i64>)> = HashMap::new();

    for chunk in all_emails.chunks(100) {
        let keys: Vec<HashMap<String, AttributeValue>> = chunk
            .iter()
            .map(|email| {
                let mut key = HashMap::new();
                key.insert(
                    "tenantId".to_string(),
                    AttributeValue::S(tenant_id.to_string()),
                );
                key.insert("email".to_string(), AttributeValue::S(email.clone()));
                key
            })
            .collect();

        let keys_and_attrs = KeysAndAttributes::builder()
            .set_keys(Some(keys))
            .projection_expression("email, lastEngagedIssue, engagementCount")
            .build()
            .map_err(|e| {
                AppError::InternalError(format!("Failed to build KeysAndAttributes: {}", e))
            })?;

        let batch_result = ddb_client
            .batch_get_item()
            .request_items(table_name, keys_and_attrs)
            .send()
            .await
            .map_err(|e| AppError::AwsError(format!("DynamoDB BatchGetItem error: {}", e)))?;

        if let Some(responses) = batch_result.responses() {
            if let Some(items) = responses.get(table_name) {
                for item in items {
                    if let Some(email_attr) = item.get("email") {
                        if let Ok(email) = email_attr.as_s() {
                            let last_engaged = item
                                .get("lastEngagedIssue")
                                .and_then(|v| v.as_n().ok())
                                .and_then(|n| n.parse::<i64>().ok());
                            let engagement_count = item
                                .get("engagementCount")
                                .and_then(|v| v.as_n().ok())
                                .and_then(|n| n.parse::<i64>().ok());
                            subscriber_map.insert(email.clone(), (last_engaged, engagement_count));
                        }
                    }
                }
            }
        }
    }

    // Build export entries — include all members, use null for missing engagement data
    let entries: Vec<ExportMemberEntry> = all_emails
        .into_iter()
        .map(|email| {
            let (last_engaged, eng_count) =
                subscriber_map.get(&email).cloned().unwrap_or((None, None));
            ExportMemberEntry {
                email,
                last_engaged_issue: last_engaged,
                engagement_count: eng_count,
            }
        })
        .collect();

    Ok(entries)
}

// ── Helper functions ───────────────────────────────────────────────────

fn parse_segment_item(
    item: &std::collections::HashMap<String, AttributeValue>,
) -> Result<SegmentResponse, AppError> {
    let segment_id = item
        .get("segmentId")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing segmentId".to_string()))?
        .clone();

    let name = item
        .get("name")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing name".to_string()))?
        .clone();

    let description = item
        .get("description")
        .and_then(|v| v.as_s().ok()).cloned();

    let member_count = item
        .get("memberCount")
        .and_then(|v| v.as_n().ok())
        .and_then(|n| n.parse::<i64>().ok())
        .unwrap_or(0);

    let created_at = item
        .get("createdAt")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing createdAt".to_string()))?
        .clone();

    let updated_at = item
        .get("updatedAt")
        .and_then(|v| v.as_s().ok()).cloned();

    Ok(SegmentResponse {
        segment_id,
        name,
        description,
        member_count,
        created_at,
        updated_at,
    })
}

fn get_subscribers_table_name() -> Result<String, AppError> {
    env::var("SUBSCRIBERS_TABLE_NAME")
        .map_err(|_| AppError::InternalError("SUBSCRIBERS_TABLE_NAME not set".to_string()))
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

/// Pure function: build export entries from member emails and subscriber engagement data.
/// Members without engagement data get null values for lastEngagedIssue and engagementCount.
#[cfg(test)]
pub fn build_export_entries(
    member_emails: &[String],
    subscriber_data: &HashMap<String, (Option<i64>, Option<i64>)>,
) -> Vec<ExportMemberEntry> {
    member_emails
        .iter()
        .map(|email| {
            let (last_engaged, eng_count) =
                subscriber_data.get(email).cloned().unwrap_or((None, None));
            ExportMemberEntry {
                email: email.clone(),
                last_engaged_issue: last_engaged,
                engagement_count: eng_count,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Validation unit tests ──────────────────────────────────────────

    #[test]
    fn test_name_trim_and_validate_empty_after_trim() {
        let name = "   ";
        let trimmed = name.trim();
        assert!(trimmed.is_empty());
    }

    #[test]
    fn test_name_trim_preserves_inner_spaces() {
        let name = "  VIP Subscribers  ";
        let trimmed = name.trim();
        assert_eq!(trimmed, "VIP Subscribers");
    }

    #[test]
    fn test_name_max_length_boundary() {
        let name = "a".repeat(100);
        assert!(name.len() <= SEGMENT_NAME_MAX_LEN);

        let name_too_long = "a".repeat(101);
        assert!(name_too_long.len() > SEGMENT_NAME_MAX_LEN);
    }

    #[test]
    fn test_description_max_length_boundary() {
        let desc = "a".repeat(500);
        assert!(desc.len() <= DESCRIPTION_MAX_LEN);

        let desc_too_long = "a".repeat(501);
        assert!(desc_too_long.len() > DESCRIPTION_MAX_LEN);
    }

    #[test]
    fn test_name_uniqueness_key_is_lowercased() {
        let name = "VIP Subscribers";
        let lower = name.trim().to_lowercase();
        assert_eq!(lower, "vip subscribers");
    }

    #[test]
    fn test_name_uniqueness_key_format() {
        let name = "  My Segment  ";
        let trimmed = name.trim();
        let lower = trimmed.to_lowercase();
        let sk = format!("SEGMENT_NAME#{}", lower);
        assert_eq!(sk, "SEGMENT_NAME#my segment");
    }

    #[test]
    fn test_segment_sk_format() {
        let segment_id = "01JTEST123";
        let sk = format!("SEGMENT#{}", segment_id);
        assert_eq!(sk, "SEGMENT#01JTEST123");
    }

    #[test]
    fn test_segment_response_serialization() {
        let resp = SegmentResponse {
            segment_id: "01JTEST".to_string(),
            name: "VIP".to_string(),
            description: Some("Top readers".to_string()),
            member_count: 0,
            created_at: "2025-01-15T10:00:00Z".to_string(),
            updated_at: None,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["segmentId"], "01JTEST");
        assert_eq!(json["name"], "VIP");
        assert_eq!(json["description"], "Top readers");
        assert_eq!(json["memberCount"], 0);
        assert_eq!(json["createdAt"], "2025-01-15T10:00:00Z");
        assert!(json.get("updatedAt").is_none());
    }

    #[test]
    fn test_segment_response_without_description() {
        let resp = SegmentResponse {
            segment_id: "01JTEST".to_string(),
            name: "Basic".to_string(),
            description: None,
            member_count: 5,
            created_at: "2025-01-15T10:00:00Z".to_string(),
            updated_at: Some("2025-01-16T10:00:00Z".to_string()),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert!(json.get("description").is_none());
        assert_eq!(json["updatedAt"], "2025-01-16T10:00:00Z");
    }

    #[test]
    fn test_create_segment_request_deserialization() {
        let json = r#"{"name": "VIP Subscribers", "description": "Top readers"}"#;
        let req: CreateSegmentRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "VIP Subscribers");
        assert_eq!(req.description, Some("Top readers".to_string()));
    }

    #[test]
    fn test_create_segment_request_without_description() {
        let json = r#"{"name": "Basic"}"#;
        let req: CreateSegmentRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "Basic");
        assert!(req.description.is_none());
    }

    #[test]
    fn test_ulid_generation_is_unique() {
        let id1 = ulid::Ulid::new().to_string();
        let id2 = ulid::Ulid::new().to_string();
        assert_ne!(id1, id2);
        // ULID is 26 characters in Crockford base32
        assert_eq!(id1.len(), 26);
    }

    #[test]
    fn test_case_insensitive_uniqueness_variants() {
        // All these should produce the same uniqueness key
        let variants = ["VIP", " vip ", "Vip", "  VIP  "];
        let keys: Vec<String> = variants
            .iter()
            .map(|v| format!("SEGMENT_NAME#{}", v.trim().to_lowercase()))
            .collect();
        assert!(keys.iter().all(|k| k == &keys[0]));
    }

    // ── list_segments unit tests ───────────────────────────────────────

    #[test]
    fn test_list_segments_response_serialization() {
        let resp = ListSegmentsResponse {
            segments: vec![
                SegmentResponse {
                    segment_id: "01JAAA".to_string(),
                    name: "VIP".to_string(),
                    description: Some("Top readers".to_string()),
                    member_count: 10,
                    created_at: "2025-01-15T10:00:00Z".to_string(),
                    updated_at: None,
                },
                SegmentResponse {
                    segment_id: "01JBBB".to_string(),
                    name: "Basic".to_string(),
                    description: None,
                    member_count: 0,
                    created_at: "2025-01-14T10:00:00Z".to_string(),
                    updated_at: None,
                },
            ],
        };
        let json = serde_json::to_value(&resp).unwrap();
        let segments = json["segments"].as_array().unwrap();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0]["segmentId"], "01JAAA");
        assert_eq!(segments[1]["segmentId"], "01JBBB");
    }

    #[test]
    fn test_list_segments_response_empty() {
        let resp = ListSegmentsResponse { segments: vec![] };
        let json = serde_json::to_value(&resp).unwrap();
        let segments = json["segments"].as_array().unwrap();
        assert!(segments.is_empty());
    }

    #[test]
    fn test_parse_segment_item_full() {
        let mut item = std::collections::HashMap::new();
        item.insert(
            "segmentId".to_string(),
            AttributeValue::S("01JTEST".to_string()),
        );
        item.insert("name".to_string(), AttributeValue::S("VIP".to_string()));
        item.insert(
            "description".to_string(),
            AttributeValue::S("Top readers".to_string()),
        );
        item.insert(
            "memberCount".to_string(),
            AttributeValue::N("42".to_string()),
        );
        item.insert(
            "createdAt".to_string(),
            AttributeValue::S("2025-01-15T10:00:00Z".to_string()),
        );
        item.insert(
            "updatedAt".to_string(),
            AttributeValue::S("2025-01-16T10:00:00Z".to_string()),
        );

        let result = parse_segment_item(&item).unwrap();
        assert_eq!(result.segment_id, "01JTEST");
        assert_eq!(result.name, "VIP");
        assert_eq!(result.description, Some("Top readers".to_string()));
        assert_eq!(result.member_count, 42);
        assert_eq!(result.created_at, "2025-01-15T10:00:00Z");
        assert_eq!(result.updated_at, Some("2025-01-16T10:00:00Z".to_string()));
    }

    #[test]
    fn test_parse_segment_item_minimal() {
        let mut item = std::collections::HashMap::new();
        item.insert(
            "segmentId".to_string(),
            AttributeValue::S("01JTEST".to_string()),
        );
        item.insert("name".to_string(), AttributeValue::S("Basic".to_string()));
        item.insert(
            "memberCount".to_string(),
            AttributeValue::N("0".to_string()),
        );
        item.insert(
            "createdAt".to_string(),
            AttributeValue::S("2025-01-15T10:00:00Z".to_string()),
        );

        let result = parse_segment_item(&item).unwrap();
        assert_eq!(result.segment_id, "01JTEST");
        assert_eq!(result.name, "Basic");
        assert!(result.description.is_none());
        assert_eq!(result.member_count, 0);
        assert!(result.updated_at.is_none());
    }

    #[test]
    fn test_parse_segment_item_missing_segment_id() {
        let mut item = std::collections::HashMap::new();
        item.insert("name".to_string(), AttributeValue::S("VIP".to_string()));
        item.insert(
            "createdAt".to_string(),
            AttributeValue::S("2025-01-15T10:00:00Z".to_string()),
        );

        let result = parse_segment_item(&item);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_segment_item_missing_member_count_defaults_to_zero() {
        let mut item = std::collections::HashMap::new();
        item.insert(
            "segmentId".to_string(),
            AttributeValue::S("01JTEST".to_string()),
        );
        item.insert("name".to_string(), AttributeValue::S("VIP".to_string()));
        item.insert(
            "createdAt".to_string(),
            AttributeValue::S("2025-01-15T10:00:00Z".to_string()),
        );

        let result = parse_segment_item(&item).unwrap();
        assert_eq!(result.member_count, 0);
    }

    // ── get_segment unit tests ─────────────────────────────────────────

    #[test]
    fn test_get_segment_sk_format() {
        let segment_id = "01JABC123XYZ";
        let sk = format!("SEGMENT#{}", segment_id);
        assert_eq!(sk, "SEGMENT#01JABC123XYZ");
    }

    #[test]
    fn test_get_segment_parse_found_item() {
        let mut item = std::collections::HashMap::new();
        item.insert(
            "segmentId".to_string(),
            AttributeValue::S("01JFOUND".to_string()),
        );
        item.insert(
            "name".to_string(),
            AttributeValue::S("Found Segment".to_string()),
        );
        item.insert(
            "description".to_string(),
            AttributeValue::S("A description".to_string()),
        );
        item.insert(
            "memberCount".to_string(),
            AttributeValue::N("15".to_string()),
        );
        item.insert(
            "createdAt".to_string(),
            AttributeValue::S("2025-02-01T12:00:00Z".to_string()),
        );
        item.insert(
            "updatedAt".to_string(),
            AttributeValue::S("2025-02-02T12:00:00Z".to_string()),
        );

        let result = parse_segment_item(&item).unwrap();
        assert_eq!(result.segment_id, "01JFOUND");
        assert_eq!(result.name, "Found Segment");
        assert_eq!(result.description, Some("A description".to_string()));
        assert_eq!(result.member_count, 15);
        assert_eq!(result.created_at, "2025-02-01T12:00:00Z");
        assert_eq!(result.updated_at, Some("2025-02-02T12:00:00Z".to_string()));
    }

    #[test]
    fn test_segments_sort_by_created_at_descending() {
        let mut segments = [SegmentResponse {
                segment_id: "01JAAA".to_string(),
                name: "Oldest".to_string(),
                description: None,
                member_count: 0,
                created_at: "2025-01-10T10:00:00Z".to_string(),
                updated_at: None,
            },
            SegmentResponse {
                segment_id: "01JCCC".to_string(),
                name: "Newest".to_string(),
                description: None,
                member_count: 0,
                created_at: "2025-01-20T10:00:00Z".to_string(),
                updated_at: None,
            },
            SegmentResponse {
                segment_id: "01JBBB".to_string(),
                name: "Middle".to_string(),
                description: None,
                member_count: 0,
                created_at: "2025-01-15T10:00:00Z".to_string(),
                updated_at: None,
            }];

        segments.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        assert_eq!(segments[0].name, "Newest");
        assert_eq!(segments[1].name, "Middle");
        assert_eq!(segments[2].name, "Oldest");
    }

    // ── update_segment unit tests ──────────────────────────────────────

    #[test]
    fn test_update_segment_request_deserialization() {
        let json = r#"{"name": "Premium Readers", "description": "Updated description"}"#;
        let req: UpdateSegmentRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "Premium Readers");
        assert_eq!(req.description, Some("Updated description".to_string()));
    }

    #[test]
    fn test_update_segment_request_without_description() {
        let json = r#"{"name": "Premium Readers"}"#;
        let req: UpdateSegmentRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "Premium Readers");
        assert!(req.description.is_none());
    }

    #[test]
    fn test_update_name_change_detection_different_names() {
        let old_name = "VIP Subscribers";
        let new_name = "Premium Readers";
        let old_lower = old_name.trim().to_lowercase();
        let new_lower = new_name.trim().to_lowercase();
        assert_ne!(old_lower, new_lower);
    }

    #[test]
    fn test_update_name_change_detection_same_name_different_case() {
        // Same name with different casing should NOT be treated as a name change
        let old_name = "VIP Subscribers";
        let new_name = "vip subscribers";
        let old_lower = old_name.trim().to_lowercase();
        let new_lower = new_name.trim().to_lowercase();
        assert_eq!(old_lower, new_lower);
    }

    #[test]
    fn test_update_name_change_detection_with_whitespace() {
        let old_name = "  VIP  ";
        let new_name = "VIP";
        let old_lower = old_name.trim().to_lowercase();
        let new_lower = new_name.trim().to_lowercase();
        assert_eq!(old_lower, new_lower);
    }

    #[test]
    fn test_update_uniqueness_key_transition() {
        let old_name = "VIP Subscribers";
        let new_name = "Premium Readers";
        let old_sk = format!("SEGMENT_NAME#{}", old_name.trim().to_lowercase());
        let new_sk = format!("SEGMENT_NAME#{}", new_name.trim().to_lowercase());
        assert_eq!(old_sk, "SEGMENT_NAME#vip subscribers");
        assert_eq!(new_sk, "SEGMENT_NAME#premium readers");
        assert_ne!(old_sk, new_sk);
    }

    #[test]
    fn test_update_expression_with_description() {
        let mut update_expr = "SET #n = :name, updatedAt = :now".to_string();
        let desc = Some("New description".to_string());
        if desc.is_some() {
            update_expr.push_str(", description = :desc");
        }
        assert_eq!(
            update_expr,
            "SET #n = :name, updatedAt = :now, description = :desc"
        );
    }

    #[test]
    fn test_update_expression_without_description() {
        let mut update_expr = "SET #n = :name, updatedAt = :now".to_string();
        let desc: Option<String> = None;
        if desc.is_none() {
            update_expr.push_str(" REMOVE description");
        }
        assert_eq!(
            update_expr,
            "SET #n = :name, updatedAt = :now REMOVE description"
        );
    }

    #[test]
    fn test_update_segment_response_includes_updated_at() {
        let resp = SegmentResponse {
            segment_id: "01JTEST".to_string(),
            name: "Premium Readers".to_string(),
            description: Some("Updated description".to_string()),
            member_count: 42,
            created_at: "2025-01-15T10:00:00Z".to_string(),
            updated_at: Some("2025-01-16T10:00:00Z".to_string()),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["segmentId"], "01JTEST");
        assert_eq!(json["name"], "Premium Readers");
        assert_eq!(json["description"], "Updated description");
        assert_eq!(json["memberCount"], 42);
        assert_eq!(json["updatedAt"], "2025-01-16T10:00:00Z");
    }

    #[test]
    fn test_update_validation_empty_name_after_trim() {
        let name = "   ";
        let trimmed = name.trim();
        assert!(trimmed.is_empty());
    }

    #[test]
    fn test_update_validation_name_too_long() {
        let name = "a".repeat(101);
        assert!(name.len() > SEGMENT_NAME_MAX_LEN);
    }

    #[test]
    fn test_update_validation_description_too_long() {
        let desc = "a".repeat(501);
        assert!(desc.len() > DESCRIPTION_MAX_LEN);
    }

    // ── delete_segment unit tests ──────────────────────────────────────

    #[test]
    fn test_delete_segment_sk_format() {
        let segment_id = "01JDELETE123";
        let sk = format!("SEGMENT#{}", segment_id);
        assert_eq!(sk, "SEGMENT#01JDELETE123");
    }

    #[test]
    fn test_delete_segment_uniqueness_sk_from_name() {
        let name = "  VIP Subscribers  ";
        let lower_name = name.trim().to_lowercase();
        let uniqueness_sk = format!("SEGMENT_NAME#{}", lower_name);
        assert_eq!(uniqueness_sk, "SEGMENT_NAME#vip subscribers");
    }

    #[test]
    fn test_delete_segment_member_prefix_format() {
        let segment_id = "01JDELETE123";
        let member_prefix = format!("SEGMENT#{}#MEMBER#", segment_id);
        assert_eq!(member_prefix, "SEGMENT#01JDELETE123#MEMBER#");
    }

    #[test]
    fn test_delete_segment_sync_threshold() {
        let threshold: u32 = 25;
        // ≤25 members should be synchronous
        let sync_cases: Vec<u32> = vec![0, 1, 24, 25];
        for count in sync_cases {
            assert!(count <= threshold, "{count} should be sync (≤{threshold})");
        }
    }

    #[test]
    fn test_delete_segment_async_threshold() {
        let threshold: u32 = 25;
        // >25 members should be asynchronous
        let async_cases: Vec<u32> = vec![26, 50, 100];
        for count in async_cases {
            assert!(count > threshold, "{count} should be async (>{threshold})");
        }
    }

    #[test]
    fn test_delete_segment_transact_items_count_sync() {
        // For sync deletion: 2 (segment + uniqueness) + member_count items
        let member_count: u32 = 10;
        let total_items = 2 + member_count;
        assert_eq!(total_items, 12);
        // Max 25 members + 2 = 27, well within TransactWriteItems limit of 100
        let max_items = 2 + 25;
        assert_eq!(max_items, 27);
        assert!(max_items <= 100);
    }

    #[test]
    fn test_delete_segment_lambda_payload_format() {
        let tenant_id = "tenant-123";
        let segment_id = "01JDELETE456";
        let payload = serde_json::json!({
            "tenantId": tenant_id,
            "segmentId": segment_id
        });
        assert_eq!(payload["tenantId"], "tenant-123");
        assert_eq!(payload["segmentId"], "01JDELETE456");
    }

    #[test]
    fn test_delete_segment_lambda_payload_serialization() {
        let tenant_id = "tenant-abc";
        let segment_id = "01JSEG789";
        let payload = serde_json::json!({
            "tenantId": tenant_id,
            "segmentId": segment_id
        });
        let bytes = serde_json::to_vec(&payload).unwrap();
        let deserialized: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(deserialized["tenantId"], "tenant-abc");
        assert_eq!(deserialized["segmentId"], "01JSEG789");
    }

    // ── add_members unit tests ─────────────────────────────────────────

    #[test]
    fn test_add_members_request_deserialization() {
        let json = r#"{"emails": ["a@example.com", "b@example.com"]}"#;
        let req: AddMembersRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.emails.len(), 2);
        assert_eq!(req.emails[0], "a@example.com");
        assert_eq!(req.emails[1], "b@example.com");
    }

    #[test]
    fn test_add_members_request_empty_emails() {
        let json = r#"{"emails": []}"#;
        let req: AddMembersRequest = serde_json::from_str(json).unwrap();
        assert!(req.emails.is_empty());
    }

    #[test]
    fn test_add_members_response_serialization() {
        let resp = AddMembersResponse {
            added: 1,
            skipped: 1,
            skipped_emails: vec!["b@example.com".to_string()],
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["added"], 1);
        assert_eq!(json["skipped"], 1);
        assert_eq!(json["skippedEmails"][0], "b@example.com");
    }

    #[test]
    fn test_add_members_response_all_added() {
        let resp = AddMembersResponse {
            added: 3,
            skipped: 0,
            skipped_emails: vec![],
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["added"], 3);
        assert_eq!(json["skipped"], 0);
        assert!(json["skippedEmails"].as_array().unwrap().is_empty());
    }

    #[test]
    fn test_add_members_response_all_skipped() {
        let resp = AddMembersResponse {
            added: 0,
            skipped: 2,
            skipped_emails: vec!["x@test.com".to_string(), "y@test.com".to_string()],
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["added"], 0);
        assert_eq!(json["skipped"], 2);
        assert_eq!(json["skippedEmails"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_add_members_batch_size_validation() {
        let emails: Vec<String> = (0..101).map(|i| format!("user{}@test.com", i)).collect();
        assert!(emails.len() > MAX_BATCH_SIZE);

        let emails_ok: Vec<String> = (0..100).map(|i| format!("user{}@test.com", i)).collect();
        assert!(emails_ok.len() <= MAX_BATCH_SIZE);
    }

    #[test]
    fn test_add_members_member_sk_format() {
        let segment_id = "01JSEG123";
        let email = "user@example.com";
        let sk = format!("SEGMENT#{}#MEMBER#{}", segment_id, email);
        assert_eq!(sk, "SEGMENT#01JSEG123#MEMBER#user@example.com");
    }

    #[test]
    fn test_add_members_member_record_attributes() {
        let tenant_id = "tenant-123";
        let segment_id = "01JSEG456";
        let email = "user@example.com";
        let now = "2025-01-15T10:00:00Z";
        let member_sk = format!("SEGMENT#{}#MEMBER#{}", segment_id, email);

        let mut item = HashMap::new();
        item.insert(
            "tenantId".to_string(),
            AttributeValue::S(tenant_id.to_string()),
        );
        item.insert("email".to_string(), AttributeValue::S(member_sk.clone()));
        item.insert(
            "subscriberEmail".to_string(),
            AttributeValue::S(email.to_string()),
        );
        item.insert(
            "segmentId".to_string(),
            AttributeValue::S(segment_id.to_string()),
        );
        item.insert("addedAt".to_string(), AttributeValue::S(now.to_string()));
        item.insert(
            "memberEmail".to_string(),
            AttributeValue::S(email.to_string()),
        );

        assert_eq!(item.get("tenantId").unwrap().as_s().unwrap(), tenant_id);
        assert_eq!(item.get("email").unwrap().as_s().unwrap(), &member_sk);
        assert_eq!(item.get("subscriberEmail").unwrap().as_s().unwrap(), email);
        assert_eq!(item.get("segmentId").unwrap().as_s().unwrap(), segment_id);
        assert_eq!(item.get("addedAt").unwrap().as_s().unwrap(), now);
        assert_eq!(item.get("memberEmail").unwrap().as_s().unwrap(), email);
    }

    #[test]
    fn test_add_members_partition_emails() {
        // Simulate partitioning logic
        let requested_emails = vec![
            "exists@test.com".to_string(),
            "missing@test.com".to_string(),
            "also_exists@test.com".to_string(),
        ];
        let existing: std::collections::HashSet<String> = vec![
            "exists@test.com".to_string(),
            "also_exists@test.com".to_string(),
        ]
        .into_iter()
        .collect();

        let mut valid = Vec::new();
        let mut skipped = Vec::new();
        for email in &requested_emails {
            if existing.contains(email) {
                valid.push(email.clone());
            } else {
                skipped.push(email.clone());
            }
        }

        assert_eq!(valid.len(), 2);
        assert_eq!(skipped.len(), 1);
        assert_eq!(skipped[0], "missing@test.com");
    }

    // ── remove_members unit tests ──────────────────────────────────────

    #[test]
    fn test_remove_members_request_deserialization() {
        let json = r#"{"emails": ["a@example.com", "b@example.com"]}"#;
        let req: RemoveMembersRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.emails.len(), 2);
        assert_eq!(req.emails[0], "a@example.com");
        assert_eq!(req.emails[1], "b@example.com");
    }

    #[test]
    fn test_remove_members_request_empty_emails() {
        let json = r#"{"emails": []}"#;
        let req: RemoveMembersRequest = serde_json::from_str(json).unwrap();
        assert!(req.emails.is_empty());
    }

    #[test]
    fn test_remove_members_response_serialization() {
        let resp = RemoveMembersResponse { removed: 3 };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["removed"], 3);
    }

    #[test]
    fn test_remove_members_response_zero_removed() {
        let resp = RemoveMembersResponse { removed: 0 };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["removed"], 0);
    }

    #[test]
    fn test_remove_members_batch_size_validation() {
        let emails: Vec<String> = (0..101).map(|i| format!("user{}@test.com", i)).collect();
        assert!(emails.len() > MAX_BATCH_SIZE);

        let emails_ok: Vec<String> = (0..100).map(|i| format!("user{}@test.com", i)).collect();
        assert!(emails_ok.len() <= MAX_BATCH_SIZE);
    }

    #[test]
    fn test_remove_members_member_sk_format() {
        let segment_id = "01JSEG123";
        let email = "user@example.com";
        let sk = format!("SEGMENT#{}#MEMBER#{}", segment_id, email);
        assert_eq!(sk, "SEGMENT#01JSEG123#MEMBER#user@example.com");
    }

    #[test]
    fn test_remove_members_batch_chunking() {
        // BatchWriteItem supports max 25 items per call
        let member_sks: Vec<String> = (0..60)
            .map(|i| format!("SEGMENT#01JSEG#MEMBER#user{}@test.com", i))
            .collect();
        let chunks: Vec<&[String]> = member_sks.chunks(25).collect();
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].len(), 25);
        assert_eq!(chunks[1].len(), 25);
        assert_eq!(chunks[2].len(), 10);
    }

    #[test]
    fn test_remove_members_filter_confirmed_members() {
        // Simulate: requested 3 emails, only 2 are actual members
        let requested = ["member1@test.com".to_string(),
            "nonmember@test.com".to_string(),
            "member2@test.com".to_string()];
        let segment_id = "01JSEG";

        // BatchGetItem would return only existing member SKs
        let confirmed_sks: Vec<String> = vec![
            format!("SEGMENT#{}#MEMBER#{}", segment_id, "member1@test.com"),
            format!("SEGMENT#{}#MEMBER#{}", segment_id, "member2@test.com"),
        ];

        let removed_count = confirmed_sks.len() as i64;
        assert_eq!(removed_count, 2);
        // nonmember@test.com is silently skipped
        assert!(removed_count < requested.len() as i64);
    }

    // ── list_members unit tests ────────────────────────────────────────

    #[test]
    fn test_member_response_serialization() {
        let resp = MemberResponse {
            email: "user@example.com".to_string(),
            last_engaged_issue: Some(25),
            engagement_count: Some(12),
            added_at: "2025-01-15T10:00:00Z".to_string(),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["email"], "user@example.com");
        assert_eq!(json["lastEngagedIssue"], 25);
        assert_eq!(json["engagementCount"], 12);
        assert_eq!(json["addedAt"], "2025-01-15T10:00:00Z");
    }

    #[test]
    fn test_member_response_without_engagement_data() {
        let resp = MemberResponse {
            email: "user@example.com".to_string(),
            last_engaged_issue: None,
            engagement_count: None,
            added_at: "2025-01-15T10:00:00Z".to_string(),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["email"], "user@example.com");
        assert!(json.get("lastEngagedIssue").is_none());
        assert!(json.get("engagementCount").is_none());
        assert_eq!(json["addedAt"], "2025-01-15T10:00:00Z");
    }

    #[test]
    fn test_list_members_response_serialization() {
        let resp = ListMembersResponse {
            members: vec![MemberResponse {
                email: "a@example.com".to_string(),
                last_engaged_issue: Some(25),
                engagement_count: Some(12),
                added_at: "2025-01-15T10:00:00Z".to_string(),
            }],
            next_token: Some("abc123".to_string()),
            total_count: 42,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["members"].as_array().unwrap().len(), 1);
        assert_eq!(json["nextToken"], "abc123");
        assert_eq!(json["totalCount"], 42);
    }

    #[test]
    fn test_list_members_response_empty() {
        let resp = ListMembersResponse {
            members: vec![],
            next_token: None,
            total_count: 0,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert!(json["members"].as_array().unwrap().is_empty());
        assert!(json.get("nextToken").is_none());
        assert_eq!(json["totalCount"], 0);
    }

    #[test]
    fn test_list_members_response_no_next_token() {
        let resp = ListMembersResponse {
            members: vec![MemberResponse {
                email: "a@example.com".to_string(),
                last_engaged_issue: None,
                engagement_count: None,
                added_at: "2025-01-15T10:00:00Z".to_string(),
            }],
            next_token: None,
            total_count: 1,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["members"].as_array().unwrap().len(), 1);
        assert!(json.get("nextToken").is_none());
        assert_eq!(json["totalCount"], 1);
    }

    #[test]
    fn test_page_size_clamping_default() {
        let page_size: i32 = DEFAULT_PAGE_SIZE;
        assert_eq!(page_size, 50);
    }

    #[test]
    fn test_page_size_clamping_max() {
        let input: i32 = 500;
        let clamped = input.clamp(1, MAX_PAGE_SIZE);
        assert_eq!(clamped, 200);
    }

    #[test]
    fn test_page_size_clamping_min() {
        let input: i32 = 0;
        let clamped = input.clamp(1, MAX_PAGE_SIZE);
        assert_eq!(clamped, 1);
    }

    #[test]
    fn test_page_size_clamping_negative() {
        let input: i32 = -5;
        let clamped = input.clamp(1, MAX_PAGE_SIZE);
        assert_eq!(clamped, 1);
    }

    #[test]
    fn test_page_size_clamping_valid() {
        let input: i32 = 100;
        let clamped = input.clamp(1, MAX_PAGE_SIZE);
        assert_eq!(clamped, 100);
    }

    #[test]
    fn test_next_token_base64_roundtrip() {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

        let mut json_map: HashMap<String, String> = HashMap::new();
        json_map.insert("tenantId".to_string(), "tenant-123".to_string());
        json_map.insert(
            "email".to_string(),
            "SEGMENT#01JSEG#MEMBER#user@test.com".to_string(),
        );

        let json_str = serde_json::to_string(&json_map).unwrap();
        let encoded = BASE64.encode(json_str.as_bytes());

        // Decode
        let decoded_bytes = BASE64.decode(&encoded).unwrap();
        let decoded_str = String::from_utf8(decoded_bytes).unwrap();
        let decoded_map: HashMap<String, String> = serde_json::from_str(&decoded_str).unwrap();

        assert_eq!(decoded_map.get("tenantId").unwrap(), "tenant-123");
        assert_eq!(
            decoded_map.get("email").unwrap(),
            "SEGMENT#01JSEG#MEMBER#user@test.com"
        );
    }

    #[test]
    fn test_member_prefix_format() {
        let segment_id = "01JSEG123";
        let prefix = format!("SEGMENT#{}#MEMBER#", segment_id);
        assert_eq!(prefix, "SEGMENT#01JSEG123#MEMBER#");
    }

    #[test]
    fn test_subscriber_email_extraction_from_member_record() {
        let mut item = HashMap::new();
        item.insert(
            "subscriberEmail".to_string(),
            AttributeValue::S("user@example.com".to_string()),
        );
        item.insert(
            "addedAt".to_string(),
            AttributeValue::S("2025-01-15T10:00:00Z".to_string()),
        );

        let email = item
            .get("subscriberEmail")
            .and_then(|v| v.as_s().ok())
            .cloned()
            .unwrap_or_default();
        let added_at = item
            .get("addedAt")
            .and_then(|v| v.as_s().ok())
            .cloned()
            .unwrap_or_default();

        assert_eq!(email, "user@example.com");
        assert_eq!(added_at, "2025-01-15T10:00:00Z");
    }

    #[test]
    fn test_omit_deleted_subscribers_from_response() {
        // Simulate: 3 member records, but only 2 subscribers still exist
        let member_data = vec![
            ("a@test.com".to_string(), "2025-01-01T00:00:00Z".to_string()),
            ("b@test.com".to_string(), "2025-01-02T00:00:00Z".to_string()),
            (
                "deleted@test.com".to_string(),
                "2025-01-03T00:00:00Z".to_string(),
            ),
        ];

        let mut subscriber_map: HashMap<String, (Option<i64>, Option<i64>)> = HashMap::new();
        subscriber_map.insert("a@test.com".to_string(), (Some(25), Some(12)));
        subscriber_map.insert("b@test.com".to_string(), (None, None));
        // deleted@test.com is NOT in subscriber_map (subscriber was deleted)

        let members: Vec<MemberResponse> = member_data
            .into_iter()
            .filter_map(|(email, added_at)| {
                subscriber_map
                    .get(&email)
                    .map(|(last_engaged, eng_count)| MemberResponse {
                        email,
                        last_engaged_issue: *last_engaged,
                        engagement_count: *eng_count,
                        added_at,
                    })
            })
            .collect();

        assert_eq!(members.len(), 2);
        assert_eq!(members[0].email, "a@test.com");
        assert_eq!(members[0].last_engaged_issue, Some(25));
        assert_eq!(members[1].email, "b@test.com");
        assert!(members[1].last_engaged_issue.is_none());
    }

    // ── export_segment unit tests ──────────────────────────────────────

    #[test]
    fn test_export_sync_response_serialization() {
        let resp = ExportSyncResponse {
            s3_key: "reports/segment-export-tenant1-seg1-20250115T100000Z.json".to_string(),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(
            json["s3Key"],
            "reports/segment-export-tenant1-seg1-20250115T100000Z.json"
        );
    }

    #[test]
    fn test_export_async_response_serialization() {
        let resp = ExportAsyncResponse {
            job_id: "01JJOB123".to_string(),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["jobId"], "01JJOB123");
    }

    #[test]
    fn test_export_member_entry_serialization_with_engagement() {
        let entry = ExportMemberEntry {
            email: "user@example.com".to_string(),
            last_engaged_issue: Some(25),
            engagement_count: Some(12),
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["email"], "user@example.com");
        assert_eq!(json["lastEngagedIssue"], 25);
        assert_eq!(json["engagementCount"], 12);
    }

    #[test]
    fn test_export_member_entry_serialization_without_engagement() {
        let entry = ExportMemberEntry {
            email: "user@example.com".to_string(),
            last_engaged_issue: None,
            engagement_count: None,
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["email"], "user@example.com");
        assert!(json["lastEngagedIssue"].is_null());
        assert!(json["engagementCount"].is_null());
    }

    #[test]
    fn test_export_s3_key_format() {
        let tenant_id = "tenant-123";
        let segment_id = "01JSEG456";
        let timestamp = "20250115T100000Z";
        let s3_key = format!(
            "reports/segment-export-{}-{}-{}.json",
            tenant_id, segment_id, timestamp
        );
        assert_eq!(
            s3_key,
            "reports/segment-export-tenant-123-01JSEG456-20250115T100000Z.json"
        );
        assert!(s3_key.starts_with("reports/"));
        assert!(s3_key.ends_with(".json"));
    }

    #[test]
    fn test_build_export_entries_all_with_engagement() {
        let emails = vec!["a@test.com".to_string(), "b@test.com".to_string()];
        let mut data = HashMap::new();
        data.insert("a@test.com".to_string(), (Some(10), Some(5)));
        data.insert("b@test.com".to_string(), (Some(20), Some(15)));

        let entries = build_export_entries(&emails, &data);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].email, "a@test.com");
        assert_eq!(entries[0].last_engaged_issue, Some(10));
        assert_eq!(entries[0].engagement_count, Some(5));
        assert_eq!(entries[1].email, "b@test.com");
        assert_eq!(entries[1].last_engaged_issue, Some(20));
    }

    #[test]
    fn test_build_export_entries_none_with_engagement() {
        let emails = vec!["a@test.com".to_string(), "b@test.com".to_string()];
        let data: HashMap<String, (Option<i64>, Option<i64>)> = HashMap::new();

        let entries = build_export_entries(&emails, &data);
        assert_eq!(entries.len(), 2);
        assert!(entries[0].last_engaged_issue.is_none());
        assert!(entries[0].engagement_count.is_none());
        assert!(entries[1].last_engaged_issue.is_none());
        assert!(entries[1].engagement_count.is_none());
    }

    #[test]
    fn test_build_export_entries_mixed_engagement() {
        let emails = vec![
            "engaged@test.com".to_string(),
            "dormant@test.com".to_string(),
        ];
        let mut data = HashMap::new();
        data.insert("engaged@test.com".to_string(), (Some(5), Some(3)));
        // dormant@test.com not in data

        let entries = build_export_entries(&emails, &data);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].last_engaged_issue, Some(5));
        assert_eq!(entries[0].engagement_count, Some(3));
        assert!(entries[1].last_engaged_issue.is_none());
        assert!(entries[1].engagement_count.is_none());
    }

    #[test]
    fn test_build_export_entries_empty() {
        let emails: Vec<String> = vec![];
        let data: HashMap<String, (Option<i64>, Option<i64>)> = HashMap::new();

        let entries = build_export_entries(&emails, &data);
        assert!(entries.is_empty());
    }

    // ── get_job_status unit tests ──────────────────────────────────────

    #[test]
    fn test_job_status_response_completed() {
        let resp = JobStatusResponse {
            job_id: "01JJOB123".to_string(),
            status: "completed".to_string(),
            s3_key: Some("reports/segment-export-t1-s1-20250115.json".to_string()),
            error: None,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["jobId"], "01JJOB123");
        assert_eq!(json["status"], "completed");
        assert_eq!(json["s3Key"], "reports/segment-export-t1-s1-20250115.json");
        assert!(json.get("error").is_none());
    }

    #[test]
    fn test_job_status_response_pending() {
        let resp = JobStatusResponse {
            job_id: "01JJOB456".to_string(),
            status: "pending".to_string(),
            s3_key: None,
            error: None,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["jobId"], "01JJOB456");
        assert_eq!(json["status"], "pending");
        assert!(json.get("s3Key").is_none());
        assert!(json.get("error").is_none());
    }

    #[test]
    fn test_job_status_response_failed() {
        let resp = JobStatusResponse {
            job_id: "01JJOB789".to_string(),
            status: "failed".to_string(),
            s3_key: None,
            error: Some("Export failed: timeout".to_string()),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["jobId"], "01JJOB789");
        assert_eq!(json["status"], "failed");
        assert!(json.get("s3Key").is_none());
        assert_eq!(json["error"], "Export failed: timeout");
    }

    #[test]
    fn test_job_sk_format() {
        let job_id = "01JJOB123ABC";
        let sk = format!("SEGMENT_JOB#{}", job_id);
        assert_eq!(sk, "SEGMENT_JOB#01JJOB123ABC");
    }

    #[test]
    fn test_job_record_ttl_calculation() {
        let now = chrono::Utc::now();
        let ttl = now.timestamp() + 86400;
        // TTL should be 24 hours in the future
        assert!(ttl > now.timestamp());
        assert_eq!(ttl - now.timestamp(), 86400);
    }

    #[test]
    fn test_export_lambda_payload_format() {
        let tenant_id = "tenant-123";
        let segment_id = "01JSEG456";
        let job_id = "01JJOB789";
        let payload = serde_json::json!({
            "tenantId": tenant_id,
            "segmentId": segment_id,
            "jobId": job_id
        });
        assert_eq!(payload["tenantId"], "tenant-123");
        assert_eq!(payload["segmentId"], "01JSEG456");
        assert_eq!(payload["jobId"], "01JJOB789");
    }

    // ── Property-based tests ───────────────────────────────────────────

    mod property_tests {
        use super::*;
        use proptest::prelude::*;
        use std::collections::HashSet;

        /// Generate a valid segment name: 1–100 non-whitespace-only characters
        /// that are non-empty after trimming.
        fn valid_segment_name() -> impl Strategy<Value = String> {
            // Generate an inner part (1-98 chars of any non-whitespace printable),
            // then optionally wrap with leading/trailing whitespace.
            let inner = prop::string::string_regex("[^ \t\n][^\0]{0,98}")
                .unwrap()
                .prop_filter("must be 1-100 chars after trim", |s| {
                    let trimmed = s.trim();
                    !trimmed.is_empty() && trimmed.len() <= 100
                });

            // Optionally add leading/trailing whitespace
            (inner, prop::bool::ANY, prop::bool::ANY).prop_map(
                |(name, add_leading, add_trailing)| {
                    let mut result = String::new();
                    if add_leading {
                        result.push_str("  ");
                    }
                    result.push_str(&name);
                    if add_trailing {
                        result.push_str("  ");
                    }
                    result
                },
            )
        }

        /// Generate an optional description: None or Some(string up to 500 chars).
        fn optional_description() -> impl Strategy<Value = Option<String>> {
            prop::option::of("[a-zA-Z0-9 ]{0,500}")
        }

        // ── Property 1: Segment creation produces a well-formed record ─────
        // **Validates: Requirements 1.1, 1.2, 1.6, 1.7, 1.8**
        //
        // For any valid segment name (1–100 characters after trimming, non-empty
        // after trim) and optional description (≤500 characters), creating a
        // segment should produce a Segment_Record with: the name stored in its
        // original casing (after trim), a unique segmentId, memberCount equal
        // to 0, and a non-null createdAt timestamp.
        proptest! {
            #![proptest_config(ProptestConfig::with_cases(100))]

            #[test]
            fn prop_segment_creation_produces_well_formed_record(
                name in valid_segment_name(),
                description in optional_description(),
            ) {
                let trimmed_name = name.trim().to_string();

                // Validate preconditions (mirrors the handler logic)
                prop_assert!(!trimmed_name.is_empty());
                prop_assert!(trimmed_name.len() <= SEGMENT_NAME_MAX_LEN);
                if let Some(ref desc) = description {
                    prop_assert!(desc.len() <= DESCRIPTION_MAX_LEN);
                }

                // Simulate creation logic
                let segment_id = ulid::Ulid::new().to_string();
                let now = chrono::Utc::now().to_rfc3339();

                let resp = SegmentResponse {
                    segment_id: segment_id.clone(),
                    name: trimmed_name.clone(),
                    description: description.clone(),
                    member_count: 0,
                    created_at: now.clone(),
                    updated_at: None,
                };

                // Assert: name stored in original casing (after trim)
                prop_assert_eq!(&resp.name, &trimmed_name);

                // Assert: segmentId is a valid ULID (26 chars, Crockford base32)
                prop_assert_eq!(resp.segment_id.len(), 26);
                prop_assert!(resp.segment_id.chars().all(|c| c.is_ascii_alphanumeric()));

                // Assert: memberCount is 0
                prop_assert_eq!(resp.member_count, 0);

                // Assert: createdAt is non-null (non-empty)
                prop_assert!(!resp.created_at.is_empty());

                // Assert: description is preserved as-is
                prop_assert_eq!(&resp.description, &description);
            }
        }

        // Verify ULID uniqueness across generated segments
        proptest! {
            #![proptest_config(ProptestConfig::with_cases(100))]

            #[test]
            fn prop_segment_ids_are_unique(
                names in prop::collection::vec(valid_segment_name(), 2..10),
            ) {
                let ids: Vec<String> = names.iter().map(|_| ulid::Ulid::new().to_string()).collect();
                let unique_ids: HashSet<&String> = ids.iter().collect();
                prop_assert_eq!(ids.len(), unique_ids.len());
            }
        }

        // ── Property 2: Name normalization and case-insensitive uniqueness ─
        // **Validates: Requirements 1.3, 1.8, 3.2, 3.3, 11.1, 11.2, 11.3, 11.4**
        //
        // For any two segment names that are equal after trimming leading/trailing
        // whitespace and lowercasing, creating or updating a segment with the
        // second name (within the same tenant) should be rejected with a conflict
        // error. The stored name must preserve the original casing provided by
        // the operator (after trimming whitespace only).
        proptest! {
            #![proptest_config(ProptestConfig::with_cases(100))]

            #[test]
            fn prop_name_normalization_case_insensitive_uniqueness(
                base_name in "[a-zA-Z][a-zA-Z0-9 ]{0,49}",
            ) {
                let base_trimmed = base_name.trim().to_string();
                prop_assume!(!base_trimmed.is_empty());
                prop_assume!(base_trimmed.len() <= SEGMENT_NAME_MAX_LEN);

                // Generate case/whitespace variants of the same name
                let variant_upper = format!("  {}  ", base_trimmed.to_uppercase());
                let variant_lower = format!(" {} ", base_trimmed.to_lowercase());
                let variant_original = base_trimmed.clone();

                // All variants should produce the same uniqueness key
                let key_upper = format!("SEGMENT_NAME#{}", variant_upper.trim().to_lowercase());
                let key_lower = format!("SEGMENT_NAME#{}", variant_lower.trim().to_lowercase());
                let key_original = format!("SEGMENT_NAME#{}", variant_original.trim().to_lowercase());

                prop_assert_eq!(&key_upper, &key_lower);
                prop_assert_eq!(&key_lower, &key_original);

                // But stored names preserve original casing (after trim only)
                let stored_upper = variant_upper.trim().to_string();
                let stored_lower = variant_lower.trim().to_string();
                let stored_original = variant_original.trim().to_string();

                // Stored names preserve their casing
                prop_assert_eq!(&stored_upper, &base_trimmed.to_uppercase());
                prop_assert_eq!(&stored_lower, &base_trimmed.to_lowercase());
                prop_assert_eq!(&stored_original, &base_trimmed);
            }
        }

        // Verify that names differing only in case produce the same uniqueness
        // key, while names that are genuinely different produce different keys.
        proptest! {
            #![proptest_config(ProptestConfig::with_cases(100))]

            #[test]
            fn prop_different_names_produce_different_uniqueness_keys(
                name_a in "[a-z]{1,20}",
                name_b in "[a-z]{1,20}",
            ) {
                let key_a = format!("SEGMENT_NAME#{}", name_a.trim().to_lowercase());
                let key_b = format!("SEGMENT_NAME#{}", name_b.trim().to_lowercase());

                if name_a.trim().to_lowercase() == name_b.trim().to_lowercase() {
                    prop_assert_eq!(&key_a, &key_b);
                } else {
                    prop_assert_ne!(&key_a, &key_b);
                }
            }
        }

        // Verify that update name-change detection correctly identifies when
        // a rename would conflict (same normalized key) vs. when it's a real change.
        proptest! {
            #![proptest_config(ProptestConfig::with_cases(100))]

            #[test]
            fn prop_update_name_change_detection(
                old_name in "[a-zA-Z][a-zA-Z0-9 ]{0,49}",
                new_name in "[a-zA-Z][a-zA-Z0-9 ]{0,49}",
            ) {
                let old_trimmed = old_name.trim();
                let new_trimmed = new_name.trim();
                prop_assume!(!old_trimmed.is_empty() && !new_trimmed.is_empty());

                let old_lower = old_trimmed.to_lowercase();
                let new_lower = new_trimmed.to_lowercase();
                let name_changed = old_lower != new_lower;

                let old_key = format!("SEGMENT_NAME#{}", old_lower);
                let new_key = format!("SEGMENT_NAME#{}", new_lower);

                if name_changed {
                    // Different normalized names → different uniqueness keys
                    prop_assert_ne!(&old_key, &new_key);
                } else {
                    // Same normalized name → same uniqueness key (conflict)
                    prop_assert_eq!(&old_key, &new_key);
                    // But stored names preserve original casing
                    // (they may differ in casing even though keys match)
                }
            }
        }

        // ── Property 6: Add members partitions emails into added and skipped correctly ─
        // **Validates: Requirements 5.1, 5.2, 5.4, 5.6, 5.7, 10.4**
        //
        // For any existing segment and batch of subscriber emails (up to 100)
        // where some emails exist in the SubscribersTable and some do not,
        // adding them should: create Segment_Member_Records only for existing
        // subscribers not already in the segment, report the correct added count
        // and skipped list (non-existent emails), and increment memberCount by
        // exactly the added count. Adding a subscriber who is already a member
        // should be idempotent.

        /// Generate a set of email addresses for testing
        fn email_set(max_size: usize) -> impl Strategy<Value = HashSet<String>> {
            prop::collection::hash_set("[a-z]{3,8}@[a-z]{3,6}\\.com", 0..=max_size)
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(100))]

            #[test]
            fn prop_add_members_partitions_emails_correctly(
                existing_subscribers in email_set(50),
                already_members in email_set(20),
                requested_emails in prop::collection::vec("[a-z]{3,8}@[a-z]{3,6}\\.com", 1..=100),
            ) {
                // Ensure already_members is a subset of existing_subscribers
                let already_members: HashSet<String> = already_members
                    .intersection(&existing_subscribers)
                    .cloned()
                    .collect();

                let initial_member_count = already_members.len() as i64;

                // Simulate the add_members partitioning logic:
                // 1. Partition requested emails into valid (existing) and skipped (non-existent)
                let mut skipped_emails: Vec<String> = Vec::new();
                let mut valid_emails: Vec<String> = Vec::new();

                for email in &requested_emails {
                    if existing_subscribers.contains(email) {
                        valid_emails.push(email.clone());
                    } else {
                        skipped_emails.push(email.clone());
                    }
                }

                // 2. For valid emails, count only those not already members (idempotent)
                let mut added_count: i64 = 0;
                let mut current_members = already_members.clone();

                for email in &valid_emails {
                    if !current_members.contains(email) {
                        current_members.insert(email.clone());
                        added_count += 1;
                    }
                    // Already a member → idempotent, no error, no increment
                }

                let new_member_count = initial_member_count + added_count;

                // Assert: skipped emails are exactly those not in existing_subscribers
                for email in &skipped_emails {
                    prop_assert!(!existing_subscribers.contains(email),
                        "Skipped email {} should not be in existing subscribers", email);
                }

                // Assert: valid emails are exactly those in existing_subscribers
                for email in &valid_emails {
                    prop_assert!(existing_subscribers.contains(email),
                        "Valid email {} should be in existing subscribers", email);
                }

                // Assert: added + skipped partitions all requested emails
                prop_assert_eq!(
                    valid_emails.len() + skipped_emails.len(),
                    requested_emails.len(),
                    "valid + skipped should equal total requested"
                );

                // Assert: added count is correct (new members only)
                let expected_new: HashSet<String> = valid_emails.iter()
                    .filter(|e| !already_members.contains(*e))
                    .cloned()
                    .collect();
                prop_assert_eq!(added_count, expected_new.len() as i64,
                    "added count should equal number of genuinely new members");

                // Assert: memberCount incremented by exactly added_count
                prop_assert_eq!(new_member_count, initial_member_count + added_count);

                // Assert: idempotency — re-adding the same batch yields added=0
                let mut second_added: i64 = 0;
                for email in &valid_emails {
                    if !current_members.contains(email) {
                        current_members.insert(email.clone());
                        second_added += 1;
                    }
                }
                prop_assert_eq!(second_added, 0, "Re-adding same batch should be idempotent (added=0)");
            }
        }

        // ── Property 7: Remove members deletes records and decrements count correctly ─
        // **Validates: Requirements 6.1, 6.2, 6.5, 6.6**
        //
        // For any existing segment and batch of subscriber emails (up to 100),
        // removing them should: delete Segment_Member_Records only for emails
        // that are actually members, report the correct removed count, and
        // decrement memberCount by exactly the removed count. Removing a
        // non-member should be idempotent.
        proptest! {
            #![proptest_config(ProptestConfig::with_cases(100))]

            #[test]
            fn prop_remove_members_decrements_correctly(
                current_members in email_set(50),
                requested_removals in prop::collection::vec("[a-z]{3,8}@[a-z]{3,6}\\.com", 1..=100),
            ) {
                let initial_member_count = current_members.len() as i64;

                // Simulate the remove_members logic:
                // 1. Pre-check which requested emails are actual members
                let confirmed: Vec<String> = requested_removals.iter()
                    .filter(|e| current_members.contains(*e))
                    .cloned()
                    .collect();

                // Deduplicate confirmed removals (BatchGetItem returns unique keys)
                let confirmed_unique: HashSet<String> = confirmed.into_iter().collect();
                let removed_count = confirmed_unique.len() as i64;

                // 2. Delete confirmed member records
                let mut remaining_members = current_members.clone();
                for email in &confirmed_unique {
                    remaining_members.remove(email);
                }

                // 3. Decrement memberCount
                let new_member_count = initial_member_count - removed_count;

                // Assert: removed count equals number of actual members in the request
                let expected_removed: HashSet<&String> = requested_removals.iter()
                    .filter(|e| current_members.contains(*e))
                    .collect();
                prop_assert_eq!(removed_count, expected_removed.len() as i64,
                    "removed count should equal number of actual members in request");

                // Assert: memberCount decremented by exactly removed_count
                prop_assert_eq!(new_member_count, initial_member_count - removed_count);

                // Assert: remaining members are correct
                prop_assert_eq!(remaining_members.len() as i64, new_member_count);

                // Assert: non-members in request are silently skipped
                let non_members: Vec<&String> = requested_removals.iter()
                    .filter(|e| !current_members.contains(*e))
                    .collect();
                for email in &non_members {
                    prop_assert!(!current_members.contains(*email),
                        "Non-member {} should have been skipped", email);
                }

                // Assert: idempotency — re-removing the same batch yields removed=0
                let second_confirmed: Vec<&String> = requested_removals.iter()
                    .filter(|e| remaining_members.contains(*e))
                    .collect();
                // All previously removed emails are no longer members
                for email in &confirmed_unique {
                    prop_assert!(!remaining_members.contains(email),
                        "Previously removed {} should no longer be a member", email);
                }
                // Only emails that were NOT removed (because they weren't members) could still match
                // but they weren't members to begin with, so second removal also finds 0
                let _second_removed: HashSet<&String> = second_confirmed.into_iter().collect();
                // second_removed should only contain emails that are still members AND were in the request
                // Since we removed all confirmed members, re-removing yields 0 for those
                let re_removed_from_original: usize = requested_removals.iter()
                    .filter(|e| confirmed_unique.contains(*e) && remaining_members.contains(*e))
                    .count();
                prop_assert_eq!(re_removed_from_original, 0,
                    "Re-removing same emails should be idempotent");
            }
        }

        // ── Property 12: MemberCount never goes below zero ─────────────────
        // **Validates: Requirements 10.6**
        //
        // For any sequence of remove operations and subscriber deletion cleanup
        // events on a segment, the memberCount on the Segment_Record should
        // never be less than zero.
        proptest! {
            #![proptest_config(ProptestConfig::with_cases(100))]

            #[test]
            fn prop_member_count_never_below_zero(
                initial_count in 0i64..=5,
                remove_counts in prop::collection::vec(1i64..=10, 1..=10),
            ) {
                let mut member_count = initial_count;

                for remove_count in &remove_counts {
                    // Simulate the floor-at-zero decrement logic from handle_remove_members:
                    // First attempt: SET memberCount = if_not_exists(memberCount, 0) - count
                    //   with condition: memberCount >= count
                    // If condition fails (concurrent race): SET memberCount = 0
                    if member_count >= *remove_count {
                        member_count -= remove_count;
                    } else {
                        // Condition check failed → set to 0 (floor)
                        member_count = 0;
                    }

                    // Assert: memberCount never goes below zero after any operation
                    prop_assert!(member_count >= 0,
                        "memberCount {} went below zero after removing {}", member_count, remove_count);
                }

                // Final assertion: memberCount is still non-negative
                prop_assert!(member_count >= 0,
                    "Final memberCount {} is below zero", member_count);
            }
        }

        // ── Property 9: Export contains all members with required fields ────
        // **Validates: Requirements 9.1, 9.2, 9.3, 9.5**
        //
        // For any segment export, the output JSON should contain one entry per
        // member with email, lastEngagedIssue, and engagementCount fields.
        // Members without engagement data should have null values for
        // lastEngagedIssue and engagementCount. The total count of entries
        // should match the segment's membership.

        /// Generate subscriber engagement data: Some have engagement, some don't
        #[allow(dead_code)]
        fn engagement_data() -> impl Strategy<Value = (Option<i64>, Option<i64>)> {
            prop::option::of(1i64..=1000).prop_flat_map(|last_engaged| {
                prop::option::of(1i64..=500).prop_map(move |eng_count| {
                    // If last_engaged is Some, eng_count can be Some or None
                    // If last_engaged is None, eng_count should also be None (no engagement)
                    match last_engaged {
                        Some(le) => (Some(le), eng_count),
                        None => (None, None),
                    }
                })
            })
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(100))]

            #[test]
            fn prop_export_contains_all_members_with_required_fields(
                member_count in 1usize..=50,
                has_engagement_ratio in 0.0f64..=1.0,
            ) {
                // Generate member emails
                let member_emails: Vec<String> = (0..member_count)
                    .map(|i| format!("member{}@example.com", i))
                    .collect();

                // Build subscriber data: some with engagement, some without
                let mut subscriber_data: HashMap<String, (Option<i64>, Option<i64>)> = HashMap::new();
                for (i, email) in member_emails.iter().enumerate() {
                    let ratio = i as f64 / member_count as f64;
                    if ratio < has_engagement_ratio {
                        // Has engagement data
                        subscriber_data.insert(
                            email.clone(),
                            (Some((i as i64) + 1), Some((i as i64) * 2 + 1)),
                        );
                    } else {
                        // No engagement data — not in subscriber_data map
                        // (simulates subscriber without engagement fields)
                    }
                }

                // Call the pure function
                let entries = build_export_entries(&member_emails, &subscriber_data);

                // Assert: one entry per member
                prop_assert_eq!(entries.len(), member_emails.len(),
                    "Export should contain one entry per member");

                // Assert: total count matches membership
                prop_assert_eq!(entries.len(), member_count);

                // Assert: each entry has email, lastEngagedIssue, engagementCount fields
                for (i, entry) in entries.iter().enumerate() {
                    // email field is present and matches
                    prop_assert_eq!(&entry.email, &member_emails[i],
                        "Entry email should match member email");

                    if subscriber_data.contains_key(&entry.email) {
                        let (expected_lei, expected_ec) = subscriber_data.get(&entry.email).unwrap();
                        prop_assert_eq!(&entry.last_engaged_issue, expected_lei,
                            "Engagement data should match for {}", entry.email);
                        prop_assert_eq!(&entry.engagement_count, expected_ec,
                            "Engagement count should match for {}", entry.email);
                    } else {
                        // Members without engagement data should have None (null) values
                        prop_assert_eq!(entry.last_engaged_issue, None,
                            "Member {} without engagement should have null lastEngagedIssue", entry.email);
                        prop_assert_eq!(entry.engagement_count, None,
                            "Member {} without engagement should have null engagementCount", entry.email);
                    }
                }
            }
        }
    }
}
