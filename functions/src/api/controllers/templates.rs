use crate::controllers::template_render;
use aws_sdk_dynamodb::types::AttributeValue;
use lambda_http::{Body, Error, Request, Response};
use newsletter::admin::{auth, aws_clients, error::AppError, response};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_dynamo::from_item;
use serde_json::{json, Value};
use std::env;
use std::sync::OnceLock;
use uuid::Uuid;

// ── Constants ──────────────────────────────────────────────────────────

const TEMPLATE_SK_PREFIX: &str = "template#";
const TEMPLATE_GSI1PK_PREFIX: &str = "template#";

const NAME_MAX_LEN: usize = 100;
const DESCRIPTION_MAX_LEN: usize = 500;
const CATEGORY_MAX_LEN: usize = 50;
/// Template content is stored inline in the DynamoDB item. DynamoDB items are
/// capped at 400KB, so we cap content well below that to leave room for the
/// rest of the record. Realistic email templates are well under this.
const CONTENT_MAX_LEN: usize = 256 * 1024;
const SAMPLE_DATA_MAX_LEN: usize = 64 * 1024;

static INVALID_NAME_CHARS: OnceLock<Regex> = OnceLock::new();

fn invalid_name_regex() -> &'static Regex {
    INVALID_NAME_CHARS.get_or_init(|| {
        Regex::new(r#"[<>:"/\\|?*\x00-\x1f]"#).expect("Failed to compile template name regex")
    })
}

// ── Key patterns ───────────────────────────────────────────────────────

fn template_sk(template_id: &str) -> String {
    format!("{}{}", TEMPLATE_SK_PREFIX, template_id)
}

fn template_gsi1pk(tenant_id: &str) -> String {
    format!("{}{}", TEMPLATE_GSI1PK_PREFIX, tenant_id)
}

/// Normalize a template name for case-insensitive uniqueness and sorting.
fn normalize_name(name: &str) -> String {
    name.trim().to_lowercase()
}

// ── Data types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TemplateRecord {
    pub pk: String,
    pub sk: String,
    #[serde(rename = "GSI1PK")]
    pub gsi1pk: String,
    #[serde(rename = "GSI1SK")]
    pub gsi1sk: String,
    #[serde(rename = "templateId")]
    pub template_id: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub content: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "sampleData"
    )]
    pub sample_data: Option<String>,
    pub version: u64,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
struct TemplateSummary {
    #[serde(rename = "templateId")]
    template_id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    category: Option<String>,
    version: u64,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

impl From<TemplateRecord> for TemplateSummary {
    fn from(t: TemplateRecord) -> Self {
        TemplateSummary {
            template_id: t.template_id,
            name: t.name,
            description: t.description,
            category: t.category,
            version: t.version,
            created_at: t.created_at,
            updated_at: t.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
struct TemplateDetail {
    #[serde(rename = "templateId")]
    template_id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    category: Option<String>,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "sampleData")]
    sample_data: Option<Value>,
    version: u64,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

impl From<TemplateRecord> for TemplateDetail {
    fn from(t: TemplateRecord) -> Self {
        let sample_data = t
            .sample_data
            .as_deref()
            .and_then(|s| serde_json::from_str::<Value>(s).ok());

        TemplateDetail {
            template_id: t.template_id,
            name: t.name,
            description: t.description,
            category: t.category,
            content: t.content,
            sample_data,
            version: t.version,
            created_at: t.created_at,
            updated_at: t.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
struct ListTemplatesResponse {
    templates: Vec<TemplateSummary>,
    total: usize,
}

#[derive(Deserialize)]
struct CreateTemplateRequest {
    name: Option<String>,
    description: Option<String>,
    category: Option<String>,
    content: Option<String>,
    #[serde(rename = "sampleData")]
    sample_data: Option<Value>,
}

#[derive(Deserialize)]
struct UpdateTemplateRequest {
    name: Option<String>,
    description: Option<String>,
    category: Option<String>,
    content: Option<String>,
    #[serde(rename = "sampleData")]
    sample_data: Option<Value>,
}

/// Request body for previewing an arbitrary, unsaved template from the editor.
#[derive(Deserialize)]
struct PreviewRequest {
    content: Option<String>,
    /// Editor-provided sample data to merge against. Accepts either
    /// `sampleData` or `data` for convenience.
    #[serde(rename = "sampleData")]
    sample_data: Option<Value>,
    data: Option<Value>,
}

/// Request body for previewing a saved template. The stored content is used;
/// callers may override the sample data with `data`/`sampleData`.
#[derive(Default, Deserialize)]
struct PreviewSavedRequest {
    #[serde(default, rename = "sampleData")]
    sample_data: Option<Value>,
    #[serde(default)]
    data: Option<Value>,
}

#[derive(Serialize)]
struct PreviewResponse {
    html: String,
}

// ── Validation ─────────────────────────────────────────────────────────

fn validate_name(name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "Template name is required".to_string(),
        ));
    }

    if trimmed.chars().count() > NAME_MAX_LEN {
        return Err(AppError::BadRequest(format!(
            "Template name must be {} characters or less",
            NAME_MAX_LEN
        )));
    }

    if invalid_name_regex().is_match(trimmed) {
        return Err(AppError::BadRequest(
            "Template name contains invalid characters".to_string(),
        ));
    }

    Ok(trimmed.to_string())
}

fn validate_description(description: &str) -> Result<(), AppError> {
    if description.chars().count() > DESCRIPTION_MAX_LEN {
        return Err(AppError::BadRequest(format!(
            "Description must be {} characters or less",
            DESCRIPTION_MAX_LEN
        )));
    }
    Ok(())
}

fn validate_category(category: &str) -> Result<(), AppError> {
    if category.chars().count() > CATEGORY_MAX_LEN {
        return Err(AppError::BadRequest(format!(
            "Category must be {} characters or less",
            CATEGORY_MAX_LEN
        )));
    }
    Ok(())
}

fn validate_content(content: &str) -> Result<(), AppError> {
    if content.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Template content is required".to_string(),
        ));
    }

    if content.len() > CONTENT_MAX_LEN {
        return Err(AppError::BadRequest(format!(
            "Template content must be {}KB or less",
            CONTENT_MAX_LEN / 1024
        )));
    }

    // Compile the content as Handlebars to surface syntax errors early.
    // Unknown partials (i.e. macros that aren't managed yet) are resolved at
    // render time, not registration, so they do not fail this check.
    let mut hb = handlebars::Handlebars::new();
    hb.register_template_string("__validate__", content)
        .map_err(|e| {
            AppError::BadRequest(format!("Template content is not valid Handlebars: {}", e))
        })?;

    Ok(())
}

/// Validate and serialize optional sample data to a JSON string for storage.
fn serialize_sample_data(sample_data: Option<&Value>) -> Result<Option<String>, AppError> {
    match sample_data {
        None | Some(Value::Null) => Ok(None),
        Some(value) => {
            let serialized = serde_json::to_string(value).map_err(|e| {
                AppError::BadRequest(format!("Sample data must be valid JSON: {}", e))
            })?;
            if serialized.len() > SAMPLE_DATA_MAX_LEN {
                return Err(AppError::BadRequest(format!(
                    "Sample data must be {}KB or less",
                    SAMPLE_DATA_MAX_LEN / 1024
                )));
            }
            Ok(Some(serialized))
        }
    }
}

// ── Handlers ───────────────────────────────────────────────────────────

pub async fn list_templates(event: Request) -> Result<Response<Body>, Error> {
    match handle_list_templates(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_list_templates(event: Request) -> Result<Response<Body>, AppError> {
    let tenant_id = require_tenant(&event)?;
    let templates = query_templates_by_tenant(&tenant_id).await?;

    let summaries: Vec<TemplateSummary> =
        templates.into_iter().map(TemplateSummary::from).collect();

    response::format_response(
        200,
        ListTemplatesResponse {
            total: summaries.len(),
            templates: summaries,
        },
    )
}

pub async fn create_template(event: Request) -> Result<Response<Body>, Error> {
    match handle_create_template(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_create_template(event: Request) -> Result<Response<Body>, AppError> {
    let tenant_id = require_tenant(&event)?;

    let body: CreateTemplateRequest = serde_json::from_slice(event.body())
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    let name = validate_name(body.name.as_deref().unwrap_or_default())?;
    let content = body.content.unwrap_or_default();
    validate_content(&content)?;

    if let Some(ref description) = body.description {
        validate_description(description)?;
    }
    if let Some(ref category) = body.category {
        validate_category(category)?;
    }
    let sample_data = serialize_sample_data(body.sample_data.as_ref())?;

    if template_name_exists(&tenant_id, &name, None).await? {
        return Err(AppError::Conflict(format!(
            "A template with the name \"{}\" already exists",
            name
        )));
    }

    let template_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let record = TemplateRecord {
        pk: tenant_id.clone(),
        sk: template_sk(&template_id),
        gsi1pk: template_gsi1pk(&tenant_id),
        gsi1sk: normalize_name(&name),
        template_id,
        tenant_id,
        name,
        description: body.description.map(|d| d.trim().to_string()),
        category: body.category.map(|c| c.trim().to_string()),
        content,
        sample_data,
        version: 1,
        created_at: now.clone(),
        updated_at: now,
    };

    put_template(&record, true).await?;

    response::format_response(201, TemplateDetail::from(record))
}

pub async fn get_template(
    event: Request,
    template_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_get_template(event, template_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_get_template(
    event: Request,
    template_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let tenant_id = require_tenant(&event)?;
    let template_id =
        template_id.ok_or_else(|| AppError::BadRequest("Template ID is required".to_string()))?;

    let record = get_template_record(&tenant_id, &template_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Template not found".to_string()))?;

    response::format_response(200, TemplateDetail::from(record))
}

pub async fn update_template(
    event: Request,
    template_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_update_template(event, template_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_update_template(
    event: Request,
    template_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let tenant_id = require_tenant(&event)?;
    let template_id =
        template_id.ok_or_else(|| AppError::BadRequest("Template ID is required".to_string()))?;

    let body: UpdateTemplateRequest = serde_json::from_slice(event.body())
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    if body.name.is_none()
        && body.description.is_none()
        && body.category.is_none()
        && body.content.is_none()
        && body.sample_data.is_none()
    {
        return Err(AppError::BadRequest(
            "At least one field must be provided for update".to_string(),
        ));
    }

    let mut record = get_template_record(&tenant_id, &template_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Template not found".to_string()))?;

    if let Some(name) = body.name {
        let validated = validate_name(&name)?;
        if normalize_name(&validated) != record.gsi1sk
            && template_name_exists(&tenant_id, &validated, Some(&template_id)).await?
        {
            return Err(AppError::Conflict(format!(
                "A template with the name \"{}\" already exists",
                validated
            )));
        }
        record.gsi1sk = normalize_name(&validated);
        record.name = validated;
    }

    if let Some(description) = body.description {
        validate_description(&description)?;
        record.description = Some(description.trim().to_string());
    }

    if let Some(category) = body.category {
        validate_category(&category)?;
        record.category = Some(category.trim().to_string());
    }

    if let Some(content) = body.content {
        validate_content(&content)?;
        record.content = content;
    }

    if let Some(ref sample_data) = body.sample_data {
        record.sample_data = serialize_sample_data(Some(sample_data))?;
    }

    record.version += 1;
    record.updated_at = chrono::Utc::now().to_rfc3339();

    put_template(&record, false).await?;

    response::format_response(200, TemplateDetail::from(record))
}

pub async fn delete_template(
    event: Request,
    template_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_delete_template(event, template_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_delete_template(
    event: Request,
    template_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let tenant_id = require_tenant(&event)?;
    let template_id =
        template_id.ok_or_else(|| AppError::BadRequest("Template ID is required".to_string()))?;

    let client = aws_clients::get_dynamodb_client().await;
    let table_name = table_name()?;

    client
        .delete_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(tenant_id))
        .key("sk", AttributeValue::S(template_sk(&template_id)))
        .condition_expression("attribute_exists(pk) AND attribute_exists(sk)")
        .send()
        .await
        .map_err(|e| {
            if e.to_string().contains("ConditionalCheckFailed") {
                AppError::NotFound("Template not found".to_string())
            } else {
                AppError::AwsError(format!("DynamoDB delete failed: {}", e))
            }
        })?;

    response::format_response(200, json!({ "message": "Template deleted" }))
}

// ── Preview ────────────────────────────────────────────────────────────

/// `POST /templates/preview` — render arbitrary, unsaved editor content.
pub async fn preview_template(event: Request) -> Result<Response<Body>, Error> {
    match handle_preview_template(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_preview_template(event: Request) -> Result<Response<Body>, AppError> {
    let tenant_id = require_tenant(&event)?;

    let body: PreviewRequest = serde_json::from_slice(event.body())
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    let content = body.content.unwrap_or_default();
    if content.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Template content is required".to_string(),
        ));
    }
    if content.len() > CONTENT_MAX_LEN {
        return Err(AppError::BadRequest(format!(
            "Template content must be {}KB or less",
            CONTENT_MAX_LEN / 1024
        )));
    }

    // Prefer explicit data, fall back to sampleData, else an empty object.
    let data = body.data.or(body.sample_data).unwrap_or_else(|| json!({}));

    render_preview(&tenant_id, &content, &data).await
}

/// `POST /templates/{templateId}/preview` — render a saved template, using its
/// stored sample data unless the caller overrides it.
pub async fn preview_saved_template(
    event: Request,
    template_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_preview_saved_template(event, template_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_preview_saved_template(
    event: Request,
    template_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let tenant_id = require_tenant(&event)?;
    let template_id =
        template_id.ok_or_else(|| AppError::BadRequest("Template ID is required".to_string()))?;

    // Body is optional; default to no overrides when absent or empty.
    let body: PreviewSavedRequest = if event.body().is_empty() {
        PreviewSavedRequest::default()
    } else {
        serde_json::from_slice(event.body())
            .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?
    };

    let record = get_template_record(&tenant_id, &template_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Template not found".to_string()))?;

    // Override data wins; otherwise fall back to the template's stored
    // sample data; otherwise an empty object.
    let stored_sample = record
        .sample_data
        .as_deref()
        .and_then(|s| serde_json::from_str::<Value>(s).ok());

    let data = body
        .data
        .or(body.sample_data)
        .or(stored_sample)
        .unwrap_or_else(|| json!({}));

    render_preview(&tenant_id, &record.content, &data).await
}

/// Shared preview rendering: load the tenant's snippets, render with the
/// missing-partial→empty rule, and wrap the HTML in a JSON response.
async fn render_preview(
    tenant_id: &str,
    content: &str,
    data: &Value,
) -> Result<Response<Body>, AppError> {
    let snippets = template_render::query_snippets_by_tenant(tenant_id).await?;
    let html = template_render::render_template(content, data, &snippets)?;
    response::format_response(200, PreviewResponse { html })
}

// ── Persistence helpers ────────────────────────────────────────────────

fn require_tenant(event: &Request) -> Result<String, AppError> {
    let user_context = auth::get_user_context(event)?;
    user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))
}

fn table_name() -> Result<String, AppError> {
    env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not configured".to_string()))
}

async fn query_templates_by_tenant(tenant_id: &str) -> Result<Vec<TemplateRecord>, AppError> {
    let client = aws_clients::get_dynamodb_client().await;
    let table_name = table_name()?;

    let result = client
        .query()
        .table_name(table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :gsi1pk")
        .expression_attribute_values(":gsi1pk", AttributeValue::S(template_gsi1pk(tenant_id)))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to query templates: {}", e)))?;

    let templates = result
        .items()
        .iter()
        .filter_map(|item| {
            from_item::<_, TemplateRecord>(item.clone())
                .map_err(|e| tracing::error!("Failed to deserialize template: {}", e))
                .ok()
        })
        .collect();

    Ok(templates)
}

async fn get_template_record(
    tenant_id: &str,
    template_id: &str,
) -> Result<Option<TemplateRecord>, AppError> {
    let client = aws_clients::get_dynamodb_client().await;
    let table_name = table_name()?;

    let result = client
        .get_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S(template_sk(template_id)))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to get template: {}", e)))?;

    match result.item {
        Some(item) => {
            let record: TemplateRecord = from_item(item).map_err(|e| {
                AppError::InternalError(format!("Failed to deserialize template: {}", e))
            })?;
            Ok(Some(record))
        }
        None => Ok(None),
    }
}

/// Returns true if a template with the given (case-insensitive) name already
/// exists for the tenant, optionally excluding a specific template id.
async fn template_name_exists(
    tenant_id: &str,
    name: &str,
    exclude_template_id: Option<&str>,
) -> Result<bool, AppError> {
    let client = aws_clients::get_dynamodb_client().await;
    let table_name = table_name()?;

    let result = client
        .query()
        .table_name(table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :gsi1pk AND GSI1SK = :name")
        .expression_attribute_values(":gsi1pk", AttributeValue::S(template_gsi1pk(tenant_id)))
        .expression_attribute_values(":name", AttributeValue::S(normalize_name(name)))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to check template name: {}", e)))?;

    let exists = result.items().iter().any(|item| {
        let item_id = item.get("templateId").and_then(|v| v.as_s().ok());
        match (item_id, exclude_template_id) {
            (Some(id), Some(exclude)) => id != exclude,
            (Some(_), None) => true,
            _ => false,
        }
    });

    Ok(exists)
}

async fn put_template(record: &TemplateRecord, ensure_new: bool) -> Result<(), AppError> {
    let client = aws_clients::get_dynamodb_client().await;
    let table_name = table_name()?;

    let item = serde_dynamo::to_item(record)
        .map_err(|e| AppError::InternalError(format!("Failed to serialize template: {}", e)))?;

    let mut request = client
        .put_item()
        .table_name(table_name)
        .set_item(Some(item));

    if ensure_new {
        request =
            request.condition_expression("attribute_not_exists(pk) AND attribute_not_exists(sk)");
    } else {
        request = request.condition_expression("attribute_exists(pk) AND attribute_exists(sk)");
    }

    request.send().await.map_err(|e| {
        if e.to_string().contains("ConditionalCheckFailed") {
            if ensure_new {
                AppError::Conflict("Template already exists".to_string())
            } else {
                AppError::NotFound("Template not found".to_string())
            }
        } else {
            AppError::AwsError(format!("DynamoDB put failed: {}", e))
        }
    })?;

    Ok(())
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_template_sk() {
        assert_eq!(template_sk("abc-123"), "template#abc-123");
    }

    #[test]
    fn test_template_gsi1pk() {
        assert_eq!(template_gsi1pk("tenant-1"), "template#tenant-1");
    }

    #[test]
    fn test_normalize_name() {
        assert_eq!(normalize_name("  Welcome Email  "), "welcome email");
    }

    #[test]
    fn test_validate_name_ok() {
        assert_eq!(validate_name("  My Template  ").unwrap(), "My Template");
    }

    #[test]
    fn test_validate_name_empty() {
        assert!(validate_name("   ").is_err());
    }

    #[test]
    fn test_validate_name_too_long() {
        let long = "a".repeat(NAME_MAX_LEN + 1);
        assert!(validate_name(&long).is_err());
    }

    #[test]
    fn test_validate_name_invalid_chars() {
        assert!(validate_name("bad/name").is_err());
        assert!(validate_name("bad<name>").is_err());
    }

    #[test]
    fn test_validate_content_empty() {
        assert!(validate_content("   ").is_err());
    }

    #[test]
    fn test_validate_content_valid_handlebars() {
        assert!(validate_content("<h1>{{ title }}</h1>{{#each items}}{{this}}{{/each}}").is_ok());
    }

    #[test]
    fn test_validate_content_unknown_partial_is_allowed() {
        // Partials (macros) are resolved at render time, so referencing one that
        // isn't registered should still validate successfully.
        assert!(validate_content("<div>{{> sponsorBlock }}</div>").is_ok());
    }

    #[test]
    fn test_validate_content_invalid_handlebars() {
        // Unclosed block helper should fail to compile.
        assert!(validate_content("{{#if foo}}no close").is_err());
    }

    #[test]
    fn test_serialize_sample_data_none() {
        assert_eq!(serialize_sample_data(None).unwrap(), None);
        assert_eq!(serialize_sample_data(Some(&Value::Null)).unwrap(), None);
    }

    #[test]
    fn test_serialize_sample_data_object() {
        let value = json!({ "title": "Hi", "count": 3 });
        let serialized = serialize_sample_data(Some(&value)).unwrap().unwrap();
        let parsed: Value = serde_json::from_str(&serialized).unwrap();
        assert_eq!(parsed, value);
    }

    #[test]
    fn test_detail_parses_sample_data() {
        let record = TemplateRecord {
            pk: "tenant".to_string(),
            sk: template_sk("t1"),
            gsi1pk: template_gsi1pk("tenant"),
            gsi1sk: "welcome".to_string(),
            template_id: "t1".to_string(),
            tenant_id: "tenant".to_string(),
            name: "Welcome".to_string(),
            description: None,
            category: None,
            content: "<h1>{{title}}</h1>".to_string(),
            sample_data: Some("{\"title\":\"Hi\"}".to_string()),
            version: 1,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        };
        let detail = TemplateDetail::from(record);
        assert_eq!(detail.sample_data, Some(json!({ "title": "Hi" })));
    }
}
