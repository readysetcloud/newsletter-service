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

const SNIPPET_SK_PREFIX: &str = "snippet#";
const SNIPPET_GSI1PK_PREFIX: &str = "snippet#";

const NAME_MAX_LEN: usize = 100;
const DESCRIPTION_MAX_LEN: usize = 500;
/// Snippet content is stored inline in the DynamoDB item. DynamoDB items are
/// capped at 400KB, so we cap content well below that to leave room for the
/// rest of the record. Realistic Handlebars partials are well under this.
const CONTENT_MAX_LEN: usize = 256 * 1024;

const PARAMETER_NAME_MAX_LEN: usize = 100;
const ALLOWED_PARAMETER_TYPES: [&str; 6] =
    ["string", "number", "boolean", "select", "textarea", "url"];

static SNIPPET_NAME_RE: OnceLock<Regex> = OnceLock::new();

/// Snippet names are referenced inside Handlebars templates as `{{> name }}`,
/// so they must be a valid partial identifier: start with a letter and contain
/// only letters, digits, underscores, and hyphens (no spaces).
fn snippet_name_regex() -> &'static Regex {
    SNIPPET_NAME_RE.get_or_init(|| {
        Regex::new(r"^[a-zA-Z][a-zA-Z0-9_-]*$").expect("Failed to compile snippet name regex")
    })
}

// ── Key patterns ───────────────────────────────────────────────────────

fn snippet_sk(snippet_id: &str) -> String {
    format!("{}{}", SNIPPET_SK_PREFIX, snippet_id)
}

fn snippet_gsi1pk(tenant_id: &str) -> String {
    format!("{}{}", SNIPPET_GSI1PK_PREFIX, tenant_id)
}

/// Normalize a snippet name for case-insensitive uniqueness and sorting.
fn normalize_name(name: &str) -> String {
    name.trim().to_lowercase()
}

// ── Data types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SnippetParameter {
    pub name: String,
    #[serde(rename = "type")]
    pub param_type: String,
    pub required: bool,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "defaultValue"
    )]
    pub default_value: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SnippetRecord {
    pub pk: String,
    pub sk: String,
    #[serde(rename = "GSI1PK")]
    pub gsi1pk: String,
    #[serde(rename = "GSI1SK")]
    pub gsi1sk: String,
    #[serde(rename = "snippetId")]
    pub snippet_id: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameters: Option<Vec<SnippetParameter>>,
    pub version: u64,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
struct SnippetSummary {
    #[serde(rename = "snippetId")]
    snippet_id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    version: u64,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

impl From<SnippetRecord> for SnippetSummary {
    fn from(s: SnippetRecord) -> Self {
        SnippetSummary {
            snippet_id: s.snippet_id,
            name: s.name,
            description: s.description,
            version: s.version,
            created_at: s.created_at,
            updated_at: s.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
struct SnippetDetail {
    #[serde(rename = "snippetId")]
    snippet_id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    parameters: Option<Vec<SnippetParameter>>,
    version: u64,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

impl From<SnippetRecord> for SnippetDetail {
    fn from(s: SnippetRecord) -> Self {
        SnippetDetail {
            snippet_id: s.snippet_id,
            name: s.name,
            description: s.description,
            content: s.content,
            parameters: s.parameters,
            version: s.version,
            created_at: s.created_at,
            updated_at: s.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
struct ListSnippetsResponse {
    snippets: Vec<SnippetSummary>,
    total: usize,
}

#[derive(Deserialize)]
struct CreateSnippetRequest {
    name: Option<String>,
    description: Option<String>,
    content: Option<String>,
    parameters: Option<Vec<SnippetParameter>>,
}

#[derive(Deserialize)]
struct UpdateSnippetRequest {
    name: Option<String>,
    description: Option<String>,
    content: Option<String>,
    parameters: Option<Vec<SnippetParameter>>,
}

// ── Validation ─────────────────────────────────────────────────────────

fn validate_name(name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err(AppError::BadRequest("Snippet name is required".to_string()));
    }

    if trimmed.chars().count() > NAME_MAX_LEN {
        return Err(AppError::BadRequest(format!(
            "Snippet name must be {} characters or less",
            NAME_MAX_LEN
        )));
    }

    if !snippet_name_regex().is_match(trimmed) {
        return Err(AppError::BadRequest(
            "Snippet name must start with a letter and contain only letters, numbers, underscores, and hyphens (no spaces)"
                .to_string(),
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

fn validate_content(content: &str) -> Result<(), AppError> {
    if content.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Snippet content is required".to_string(),
        ));
    }

    if content.len() > CONTENT_MAX_LEN {
        return Err(AppError::BadRequest(format!(
            "Snippet content must be {}KB or less",
            CONTENT_MAX_LEN / 1024
        )));
    }

    // Compile the content as Handlebars to surface syntax errors early.
    // Unknown partials (i.e. other snippets that aren't managed yet) are
    // resolved at render time, not registration, so they do not fail this check.
    let mut hb = handlebars::Handlebars::new();
    hb.register_template_string("__validate__", content)
        .map_err(|e| {
            AppError::BadRequest(format!("Snippet content is not valid Handlebars: {}", e))
        })?;

    Ok(())
}

/// Validate the optional parameter schema. Each parameter must have a non-empty
/// name, a recognized type, and `options` are only meaningful for `select`.
fn validate_parameters(parameters: &[SnippetParameter]) -> Result<(), AppError> {
    for parameter in parameters {
        let name = parameter.name.trim();
        if name.is_empty() {
            return Err(AppError::BadRequest(
                "Each parameter must have a name".to_string(),
            ));
        }
        if name.chars().count() > PARAMETER_NAME_MAX_LEN {
            return Err(AppError::BadRequest(format!(
                "Parameter name must be {} characters or less",
                PARAMETER_NAME_MAX_LEN
            )));
        }
        if !ALLOWED_PARAMETER_TYPES.contains(&parameter.param_type.as_str()) {
            return Err(AppError::BadRequest(format!(
                "Parameter \"{}\" has an unsupported type \"{}\"",
                name, parameter.param_type
            )));
        }
        if let Some(ref description) = parameter.description {
            validate_description(description)?;
        }
        if parameter.param_type == "select" {
            match &parameter.options {
                Some(options) if !options.is_empty() => {}
                _ => {
                    return Err(AppError::BadRequest(format!(
                        "Parameter \"{}\" of type select must include at least one option",
                        name
                    )));
                }
            }
        }
    }
    Ok(())
}

/// Normalize parameters for storage (trim names/descriptions).
fn normalize_parameters(parameters: Vec<SnippetParameter>) -> Vec<SnippetParameter> {
    parameters
        .into_iter()
        .map(|p| SnippetParameter {
            name: p.name.trim().to_string(),
            param_type: p.param_type,
            required: p.required,
            default_value: p.default_value,
            description: p.description.map(|d| d.trim().to_string()),
            options: p.options,
        })
        .collect()
}

// ── Handlers ───────────────────────────────────────────────────────────

pub async fn list_snippets(event: Request) -> Result<Response<Body>, Error> {
    match handle_list_snippets(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_list_snippets(event: Request) -> Result<Response<Body>, AppError> {
    let tenant_id = require_tenant(&event)?;
    let snippets = query_snippets_by_tenant(&tenant_id).await?;

    let summaries: Vec<SnippetSummary> = snippets.into_iter().map(SnippetSummary::from).collect();

    response::format_response(
        200,
        ListSnippetsResponse {
            total: summaries.len(),
            snippets: summaries,
        },
    )
}

pub async fn create_snippet(event: Request) -> Result<Response<Body>, Error> {
    match handle_create_snippet(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_create_snippet(event: Request) -> Result<Response<Body>, AppError> {
    let tenant_id = require_tenant(&event)?;

    let body: CreateSnippetRequest = serde_json::from_slice(event.body())
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    let name = validate_name(body.name.as_deref().unwrap_or_default())?;
    let content = body.content.unwrap_or_default();
    validate_content(&content)?;

    if let Some(ref description) = body.description {
        validate_description(description)?;
    }

    let parameters = match body.parameters {
        Some(parameters) => {
            validate_parameters(&parameters)?;
            Some(normalize_parameters(parameters))
        }
        None => None,
    };

    if snippet_name_exists(&tenant_id, &name, None).await? {
        return Err(AppError::Conflict(format!(
            "A snippet with the name \"{}\" already exists",
            name
        )));
    }

    let snippet_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let record = SnippetRecord {
        pk: tenant_id.clone(),
        sk: snippet_sk(&snippet_id),
        gsi1pk: snippet_gsi1pk(&tenant_id),
        gsi1sk: normalize_name(&name),
        snippet_id,
        tenant_id,
        name,
        description: body.description.map(|d| d.trim().to_string()),
        content,
        parameters,
        version: 1,
        created_at: now.clone(),
        updated_at: now,
    };

    put_snippet(&record, true).await?;

    response::format_response(201, SnippetDetail::from(record))
}

pub async fn get_snippet(
    event: Request,
    snippet_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_get_snippet(event, snippet_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_get_snippet(
    event: Request,
    snippet_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let tenant_id = require_tenant(&event)?;
    let snippet_id =
        snippet_id.ok_or_else(|| AppError::BadRequest("Snippet ID is required".to_string()))?;

    let record = get_snippet_record(&tenant_id, &snippet_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Snippet not found".to_string()))?;

    response::format_response(200, SnippetDetail::from(record))
}

pub async fn update_snippet(
    event: Request,
    snippet_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_update_snippet(event, snippet_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_update_snippet(
    event: Request,
    snippet_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let tenant_id = require_tenant(&event)?;
    let snippet_id =
        snippet_id.ok_or_else(|| AppError::BadRequest("Snippet ID is required".to_string()))?;

    let body: UpdateSnippetRequest = serde_json::from_slice(event.body())
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    if body.name.is_none()
        && body.description.is_none()
        && body.content.is_none()
        && body.parameters.is_none()
    {
        return Err(AppError::BadRequest(
            "At least one field must be provided for update".to_string(),
        ));
    }

    let mut record = get_snippet_record(&tenant_id, &snippet_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Snippet not found".to_string()))?;

    if let Some(name) = body.name {
        let validated = validate_name(&name)?;
        if normalize_name(&validated) != record.gsi1sk
            && snippet_name_exists(&tenant_id, &validated, Some(&snippet_id)).await?
        {
            return Err(AppError::Conflict(format!(
                "A snippet with the name \"{}\" already exists",
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

    if let Some(content) = body.content {
        validate_content(&content)?;
        record.content = content;
    }

    if let Some(parameters) = body.parameters {
        validate_parameters(&parameters)?;
        record.parameters = Some(normalize_parameters(parameters));
    }

    record.version += 1;
    record.updated_at = chrono::Utc::now().to_rfc3339();

    put_snippet(&record, false).await?;

    response::format_response(200, SnippetDetail::from(record))
}

pub async fn delete_snippet(
    event: Request,
    snippet_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_delete_snippet(event, snippet_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_delete_snippet(
    event: Request,
    snippet_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let tenant_id = require_tenant(&event)?;
    let snippet_id =
        snippet_id.ok_or_else(|| AppError::BadRequest("Snippet ID is required".to_string()))?;

    let client = aws_clients::get_dynamodb_client().await;
    let table_name = table_name()?;

    client
        .delete_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(tenant_id))
        .key("sk", AttributeValue::S(snippet_sk(&snippet_id)))
        .condition_expression("attribute_exists(pk) AND attribute_exists(sk)")
        .send()
        .await
        .map_err(|e| {
            if e.to_string().contains("ConditionalCheckFailed") {
                AppError::NotFound("Snippet not found".to_string())
            } else {
                AppError::AwsError(format!("DynamoDB delete failed: {}", e))
            }
        })?;

    response::format_response(200, json!({ "message": "Snippet deleted" }))
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

async fn query_snippets_by_tenant(tenant_id: &str) -> Result<Vec<SnippetRecord>, AppError> {
    let client = aws_clients::get_dynamodb_client().await;
    let table_name = table_name()?;

    let result = client
        .query()
        .table_name(table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :gsi1pk")
        .expression_attribute_values(":gsi1pk", AttributeValue::S(snippet_gsi1pk(tenant_id)))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to query snippets: {}", e)))?;

    let snippets = result
        .items()
        .iter()
        .filter_map(|item| {
            from_item::<_, SnippetRecord>(item.clone())
                .map_err(|e| tracing::error!("Failed to deserialize snippet: {}", e))
                .ok()
        })
        .collect();

    Ok(snippets)
}

async fn get_snippet_record(
    tenant_id: &str,
    snippet_id: &str,
) -> Result<Option<SnippetRecord>, AppError> {
    let client = aws_clients::get_dynamodb_client().await;
    let table_name = table_name()?;

    let result = client
        .get_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S(snippet_sk(snippet_id)))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to get snippet: {}", e)))?;

    match result.item {
        Some(item) => {
            let record: SnippetRecord = from_item(item).map_err(|e| {
                AppError::InternalError(format!("Failed to deserialize snippet: {}", e))
            })?;
            Ok(Some(record))
        }
        None => Ok(None),
    }
}

/// Returns true if a snippet with the given (case-insensitive) name already
/// exists for the tenant, optionally excluding a specific snippet id.
async fn snippet_name_exists(
    tenant_id: &str,
    name: &str,
    exclude_snippet_id: Option<&str>,
) -> Result<bool, AppError> {
    let client = aws_clients::get_dynamodb_client().await;
    let table_name = table_name()?;

    let result = client
        .query()
        .table_name(table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :gsi1pk AND GSI1SK = :name")
        .expression_attribute_values(":gsi1pk", AttributeValue::S(snippet_gsi1pk(tenant_id)))
        .expression_attribute_values(":name", AttributeValue::S(normalize_name(name)))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to check snippet name: {}", e)))?;

    let exists = result.items().iter().any(|item| {
        let item_id = item.get("snippetId").and_then(|v| v.as_s().ok());
        match (item_id, exclude_snippet_id) {
            (Some(id), Some(exclude)) => id != exclude,
            (Some(_), None) => true,
            _ => false,
        }
    });

    Ok(exists)
}

async fn put_snippet(record: &SnippetRecord, ensure_new: bool) -> Result<(), AppError> {
    let client = aws_clients::get_dynamodb_client().await;
    let table_name = table_name()?;

    let item = serde_dynamo::to_item(record)
        .map_err(|e| AppError::InternalError(format!("Failed to serialize snippet: {}", e)))?;

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
                AppError::Conflict("Snippet already exists".to_string())
            } else {
                AppError::NotFound("Snippet not found".to_string())
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
    fn test_snippet_sk() {
        assert_eq!(snippet_sk("abc-123"), "snippet#abc-123");
    }

    #[test]
    fn test_snippet_gsi1pk() {
        assert_eq!(snippet_gsi1pk("tenant-1"), "snippet#tenant-1");
    }

    #[test]
    fn test_normalize_name() {
        assert_eq!(normalize_name("  Sponsor_Block  "), "sponsor_block");
    }

    #[test]
    fn test_validate_name_ok() {
        assert_eq!(validate_name("  sponsorBlock  ").unwrap(), "sponsorBlock");
        assert_eq!(validate_name("Footer-1").unwrap(), "Footer-1");
        assert_eq!(validate_name("a_b_c").unwrap(), "a_b_c");
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
        // Spaces are not allowed because the name is a partial identifier.
        assert!(validate_name("bad name").is_err());
        assert!(validate_name("bad/name").is_err());
        assert!(validate_name("bad<name>").is_err());
        // Must start with a letter.
        assert!(validate_name("1abc").is_err());
        assert!(validate_name("-abc").is_err());
        assert!(validate_name("_abc").is_err());
    }

    #[test]
    fn test_validate_content_empty() {
        assert!(validate_content("   ").is_err());
    }

    #[test]
    fn test_validate_content_valid_handlebars() {
        assert!(validate_content("<div>{{ title }}</div>{{#each items}}{{this}}{{/each}}").is_ok());
    }

    #[test]
    fn test_validate_content_unknown_partial_is_allowed() {
        // Partials (other snippets) are resolved at render time, so referencing
        // one that isn't registered should still validate successfully.
        assert!(validate_content("<div>{{> otherSnippet }}</div>").is_ok());
    }

    #[test]
    fn test_validate_content_invalid_handlebars() {
        // Unclosed block helper should fail to compile.
        assert!(validate_content("{{#if foo}}no close").is_err());
    }

    #[test]
    fn test_validate_parameters_ok() {
        let parameters = vec![
            SnippetParameter {
                name: "title".to_string(),
                param_type: "string".to_string(),
                required: true,
                default_value: None,
                description: Some("The title".to_string()),
                options: None,
            },
            SnippetParameter {
                name: "tone".to_string(),
                param_type: "select".to_string(),
                required: false,
                default_value: Some(json!("formal")),
                description: None,
                options: Some(vec!["formal".to_string(), "casual".to_string()]),
            },
        ];
        assert!(validate_parameters(&parameters).is_ok());
    }

    #[test]
    fn test_validate_parameters_empty_name() {
        let parameters = vec![SnippetParameter {
            name: "  ".to_string(),
            param_type: "string".to_string(),
            required: false,
            default_value: None,
            description: None,
            options: None,
        }];
        assert!(validate_parameters(&parameters).is_err());
    }

    #[test]
    fn test_validate_parameters_unknown_type() {
        let parameters = vec![SnippetParameter {
            name: "x".to_string(),
            param_type: "datetime".to_string(),
            required: false,
            default_value: None,
            description: None,
            options: None,
        }];
        assert!(validate_parameters(&parameters).is_err());
    }

    #[test]
    fn test_validate_parameters_select_requires_options() {
        let parameters = vec![SnippetParameter {
            name: "tone".to_string(),
            param_type: "select".to_string(),
            required: false,
            default_value: None,
            description: None,
            options: None,
        }];
        assert!(validate_parameters(&parameters).is_err());

        let empty_options = vec![SnippetParameter {
            name: "tone".to_string(),
            param_type: "select".to_string(),
            required: false,
            default_value: None,
            description: None,
            options: Some(vec![]),
        }];
        assert!(validate_parameters(&empty_options).is_err());
    }

    #[test]
    fn test_normalize_parameters_trims() {
        let parameters = vec![SnippetParameter {
            name: "  title  ".to_string(),
            param_type: "string".to_string(),
            required: true,
            default_value: None,
            description: Some("  desc  ".to_string()),
            options: None,
        }];
        let normalized = normalize_parameters(parameters);
        assert_eq!(normalized[0].name, "title");
        assert_eq!(normalized[0].description, Some("desc".to_string()));
    }

    #[test]
    fn test_detail_round_trips_parameters() {
        let record = SnippetRecord {
            pk: "tenant".to_string(),
            sk: snippet_sk("s1"),
            gsi1pk: snippet_gsi1pk("tenant"),
            gsi1sk: "sponsorblock".to_string(),
            snippet_id: "s1".to_string(),
            tenant_id: "tenant".to_string(),
            name: "sponsorBlock".to_string(),
            description: None,
            content: "<div>{{ title }}</div>".to_string(),
            parameters: Some(vec![SnippetParameter {
                name: "title".to_string(),
                param_type: "string".to_string(),
                required: true,
                default_value: None,
                description: None,
                options: None,
            }]),
            version: 1,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        };
        let detail = SnippetDetail::from(record);
        assert_eq!(detail.parameters.as_ref().unwrap().len(), 1);
        assert_eq!(detail.parameters.unwrap()[0].name, "title");
    }
}
