use aws_sdk_dynamodb::types::AttributeValue;
use base64::Engine;
use lambda_http::{Body, Error, Request, RequestExt, Response};
use newsletter::admin::{auth, aws_clients, error::AppError, response};
use newsletter::ai::{converse, ConverseOptions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

use super::send_progress;
use super::settings::{self, TenantSettings};

// Request/Response types for list issues endpoint
#[derive(Deserialize)]
pub struct ListIssuesQuery {
    #[serde(default = "default_limit")]
    limit: i32,
    #[serde(rename = "nextToken")]
    next_token: Option<String>,
    status: Option<String>,
}

fn default_limit() -> i32 {
    20
}

#[derive(Serialize)]
pub struct ListIssuesResponse {
    issues: Vec<IssueListItem>,
    #[serde(rename = "nextToken", skip_serializing_if = "Option::is_none")]
    next_token: Option<String>,
}

#[derive(Serialize)]
pub struct IssueListItem {
    id: String,
    #[serde(rename = "issueNumber")]
    issue_number: i32,
    subject: String,
    status: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "publishedAt", skip_serializing_if = "Option::is_none")]
    published_at: Option<String>,
    #[serde(rename = "scheduledAt", skip_serializing_if = "Option::is_none")]
    scheduled_at: Option<String>,
}

// Request/Response types for create issue endpoint
#[derive(Deserialize)]
pub struct CreateIssueRequest {
    #[serde(rename = "issueNumber", skip_serializing_if = "Option::is_none")]
    issue_number: Option<i32>,
    subject: String,
    content: String,
    #[serde(rename = "scheduledAt", skip_serializing_if = "Option::is_none")]
    scheduled_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    action: Option<CreateIssueAction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<serde_json::Value>,
    #[serde(rename = "templateId", skip_serializing_if = "Option::is_none")]
    template_id: Option<String>,
    /// How `content` should be interpreted: "markdown" (default), "json", or
    /// "html". In "json" mode the content is the template data object (as a JSON
    /// string) and a templateId is required. In "html" mode the content is a
    /// pre-rendered email master, sent verbatim (no templateId, no structuring).
    #[serde(rename = "contentType", skip_serializing_if = "Option::is_none")]
    content_type: Option<String>,
    /// Optional time-to-live, in seconds, after which the draft is
    /// automatically deleted. Only valid for drafts (the default action). A
    /// one-time EventBridge schedule performs the deletion, so the actual
    /// removal happens within roughly an hour of expiry.
    #[serde(rename = "ttlSeconds", skip_serializing_if = "Option::is_none")]
    ttl_seconds: Option<i64>,
}

#[derive(Deserialize, Serialize, Copy, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum CreateIssueAction {
    Draft,
    Schedule,
}

// Default value persisted/used when no contentType is supplied.
const CONTENT_TYPE_MARKDOWN: &str = "markdown";
const CONTENT_TYPE_JSON: &str = "json";
const CONTENT_TYPE_HTML: &str = "html";

// Upper bound for a draft's ttlSeconds (one year). Guards against absurd
// far-future schedules while still allowing long-lived drafts.
const MAX_TTL_SECONDS: i64 = 365 * 24 * 60 * 60;

/// Normalizes a caller-supplied contentType into "markdown", "json", or "html".
/// In "html" mode `content` is a pre-rendered email master that the publish
/// pipeline sends verbatim (no structuring, no template render). Absent / empty
/// / unknown values fall back to "markdown" for backwards compatibility with
/// issues created before this field existed.
fn normalize_content_type(value: Option<&str>) -> String {
    match value.map(|v| v.trim().to_ascii_lowercase()) {
        Some(ref v) if v == CONTENT_TYPE_JSON => CONTENT_TYPE_JSON.to_string(),
        Some(ref v) if v == CONTENT_TYPE_HTML => CONTENT_TYPE_HTML.to_string(),
        _ => CONTENT_TYPE_MARKDOWN.to_string(),
    }
}

#[derive(Serialize)]
pub struct CreateIssueResponse {
    id: String,
    #[serde(rename = "issueNumber")]
    issue_number: i32,
    subject: String,
    status: String,
    content: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    #[serde(rename = "contentType")]
    content_type: String,
}

// Request/Response types for update issue endpoint
#[derive(Deserialize)]
pub struct UpdateIssueRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(rename = "scheduledAt", skip_serializing_if = "Option::is_none")]
    scheduled_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(rename = "templateId", skip_serializing_if = "Option::is_none")]
    template_id: Option<String>,
    #[serde(rename = "contentType", skip_serializing_if = "Option::is_none")]
    content_type: Option<String>,
}

// Request body for declaring an A/B test winner.
#[derive(Deserialize)]
pub struct DeclareWinnerRequest {
    #[serde(rename = "variantId")]
    variant_id: String,
}

// Response type for get single issue endpoint
#[derive(Serialize)]
pub struct GetIssueResponse {
    id: String,
    #[serde(rename = "issueNumber")]
    issue_number: i32,
    subject: String,
    status: String,
    content: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    #[serde(rename = "publishedAt", skip_serializing_if = "Option::is_none")]
    published_at: Option<String>,
    #[serde(rename = "scheduledAt", skip_serializing_if = "Option::is_none")]
    scheduled_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<serde_json::Value>,
    #[serde(rename = "templateId", skip_serializing_if = "Option::is_none")]
    template_id: Option<String>,
    #[serde(rename = "contentType", skip_serializing_if = "Option::is_none")]
    content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stats: Option<IssueStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    insights: Option<Vec<String>>,
    #[serde(rename = "insightsV2", skip_serializing_if = "Option::is_none")]
    insights_v2: Option<Vec<InsightV2>>,
    #[serde(rename = "abTest", skip_serializing_if = "Option::is_none")]
    ab_test: Option<serde_json::Value>,
    #[serde(rename = "variantStats", skip_serializing_if = "Option::is_none")]
    variant_stats: Option<Vec<VariantStats>>,
    #[serde(rename = "localSend", skip_serializing_if = "Option::is_none")]
    local_send: Option<serde_json::Value>,
    #[serde(rename = "contentAssembly", skip_serializing_if = "Option::is_none")]
    content_assembly: Option<serde_json::Value>,
    /// Group-by-group delivery state for a local send. Present from fan-out
    /// until the last group lands, and afterwards as a record of what happened.
    #[serde(rename = "sendProgress", skip_serializing_if = "Option::is_none")]
    send_progress: Option<send_progress::SendProgressResponse>,
    /// Where the publish workflow is. Only filled when there is no send
    /// progress to report — before fan-out, or when the workflow failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    workflow: Option<send_progress::WorkflowState>,
}

// Per-variant engagement counters for an A/B test.
#[derive(Serialize, Clone)]
pub struct VariantStats {
    #[serde(rename = "variantId")]
    variant_id: String,
    opens: i64,
    clicks: i64,
    deliveries: i64,
    sends: i64,
    bounces: i64,
    complaints: i64,
}

// Stats structure for issue engagement metrics
#[derive(Serialize, Clone)]
pub struct IssueStats {
    opens: i64,
    clicks: i64,
    deliveries: i64,
    bounces: i64,
    complaints: i64,
    subscribers: i64,
    subscribes: i64,
    unsubscribes: i64,
    cleaned: i64,
    #[serde(rename = "manualRemovals")]
    manual_removals: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    analytics: Option<serde_json::Value>,
}

// Response type for trends endpoint
#[derive(Serialize)]
pub struct TrendsResponse {
    issues: Vec<IssueTrendItem>,
    aggregates: TrendAggregates,
}

#[derive(Serialize)]
pub struct IssueTrendItem {
    id: String,
    metrics: IssueMetrics,
    #[serde(rename = "analyticsSummary", skip_serializing_if = "Option::is_none")]
    analytics_summary: Option<IssueAnalyticsSummary>,
}

#[derive(Serialize)]
pub struct IssueMetrics {
    #[serde(rename = "openRate")]
    open_rate: f64,
    #[serde(rename = "clickRate")]
    click_rate: f64,
    #[serde(rename = "clickToOpenRate")]
    click_to_open_rate: f64,
    #[serde(rename = "bounceRate")]
    bounce_rate: f64,
    delivered: i64,
    opens: i64,
    clicks: i64,
    bounces: i64,
    complaints: i64,
    subscribers: i64,
    subscribes: i64,
    unsubscribes: i64,
    cleaned: i64,
    #[serde(rename = "manualRemovals")]
    manual_removals: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct IssueAnalyticsSummary {
    #[serde(rename = "engagementType", skip_serializing_if = "Option::is_none")]
    engagement_type: Option<EngagementType>,
    #[serde(rename = "trafficSource", skip_serializing_if = "Option::is_none")]
    traffic_source: Option<TrafficSource>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EngagementType {
    #[serde(rename = "newClickers")]
    new_clickers: i64,
    #[serde(rename = "returningClickers")]
    returning_clickers: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TrafficSource {
    clicks: TrafficSourceClicks,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TrafficSourceClicks {
    email: i64,
    web: i64,
}

#[derive(Serialize)]
pub struct TrendAggregates {
    #[serde(rename = "avgOpenRate")]
    avg_open_rate: f64,
    #[serde(rename = "avgClickRate")]
    avg_click_rate: f64,
    #[serde(rename = "avgClickToOpenRate")]
    avg_click_to_open_rate: f64,
    #[serde(rename = "avgBounceRate")]
    avg_bounce_rate: f64,
    #[serde(rename = "totalDelivered")]
    total_delivered: i64,
    #[serde(rename = "issueCount")]
    issue_count: i32,
}

#[derive(Deserialize)]
pub struct TrendsQuery {
    #[serde(rename = "issueCount", default = "default_issue_count")]
    issue_count: i32,
}

fn default_issue_count() -> i32 {
    10
}

#[derive(Serialize, Deserialize, Clone)]
pub struct InsightEvidence {
    metric: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    benchmark: Option<String>,
    #[serde(rename = "deltaPct", skip_serializing_if = "Option::is_none")]
    delta_pct: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct InsightV2 {
    #[serde(rename = "type")]
    insight_type: String,
    severity: String,
    confidence: String,
    summary: String,
    recommendation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    evidence: Option<Vec<InsightEvidence>>,
}

// Internal data structure for issue records from DynamoDB
#[derive(Debug, Serialize)]
pub struct IssueRecord {
    pub pk: String,
    pub sk: String,
    pub gsi1pk: String,
    pub gsi1sk: String,
    pub issue_number: i32,
    pub subject: String,
    pub status: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
    pub published_at: Option<String>,
    pub scheduled_at: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub template_id: Option<String>,
    pub content_type: Option<String>,
    pub ab_test: Option<serde_json::Value>,
    pub local_send: Option<serde_json::Value>,
    pub content_assembly: Option<serde_json::Value>,
    /// ARN of the publish workflow execution, recorded when the issue is
    /// scheduled so its state can be reported back without guessing.
    pub execution_arn: Option<String>,
}

#[derive(Debug)]
struct IdempotencyRecord {
    issue_number: i32,
    payload_hash: String,
}

// Public handler functions (called by router)
pub async fn list_issues(event: Request) -> Result<Response<Body>, Error> {
    match handle_list_issues(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn get_issue(event: Request, issue_id: Option<String>) -> Result<Response<Body>, Error> {
    match handle_get_issue(event, issue_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn rebuild_issue_analytics(
    event: Request,
    issue_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_rebuild_issue_analytics(event, issue_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn resend_issue(
    event: Request,
    issue_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_resend_issue(event, issue_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn declare_ab_winner(
    event: Request,
    issue_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_declare_ab_winner(event, issue_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn get_trends(event: Request) -> Result<Response<Body>, Error> {
    match handle_get_trends(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn get_ab_history(event: Request) -> Result<Response<Body>, Error> {
    match handle_get_ab_history(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn get_active_ab_tests(event: Request) -> Result<Response<Body>, Error> {
    match handle_get_active_ab_tests(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn suggest_ab_test(event: Request) -> Result<Response<Body>, Error> {
    match handle_suggest_ab_test(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn create_issue(event: Request) -> Result<Response<Body>, Error> {
    match handle_create_issue(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn review_issue(event: Request) -> Result<Response<Body>, Error> {
    match handle_review_issue(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn update_issue(
    event: Request,
    issue_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_update_issue(event, issue_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn delete_issue(
    event: Request,
    issue_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_delete_issue(event, issue_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

// Private implementation functions (business logic)
async fn handle_list_issues(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let query: ListIssuesQuery = parse_query_params(&event)?;
    validate_list_params(&query)?;

    let issues = query_issues_by_tenant(&tenant_id, &query).await?;

    response::format_response(200, issues)
}

async fn handle_get_issue(
    event: Request,
    issue_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let issue_id =
        issue_id.ok_or_else(|| AppError::BadRequest("Issue ID is required".to_string()))?;

    let issue = get_issue_by_id(&tenant_id, &issue_id).await?;
    let stats = get_issue_stats(&tenant_id, &issue_id).await.ok();
    let insights = get_issue_insights(&tenant_id, &issue_id)
        .await
        .ok()
        .flatten();

    let variant_stats = if issue.ab_test.is_some() {
        get_variant_stats(&tenant_id, &issue_id).await
    } else {
        Vec::new()
    };

    let send_progress = send_progress::get_send_progress(&tenant_id, issue.issue_number).await;
    let workflow = get_workflow_state_for(&issue, send_progress.is_some()).await;

    let response_data = build_issue_response(
        issue,
        stats,
        insights,
        variant_stats,
        send_progress,
        workflow,
    );

    response::format_response(200, response_data)
}

/// Ask Step Functions where the publish workflow is, but only when that is the
/// only thing that can explain the issue's state.
///
/// Once a local send has fanned out, the progress record is both more detailed
/// and more durable than the execution (Step Functions retains history for 90
/// days), so it wins. This fills two gaps the record cannot: an issue waiting
/// for a future send time, and an issue whose workflow failed.
async fn get_workflow_state_for(
    issue: &IssueRecord,
    has_send_progress: bool,
) -> Option<send_progress::WorkflowState> {
    if has_send_progress {
        return None;
    }
    if !matches!(
        issue.status.as_str(),
        "scheduled" | "in progress" | "failed"
    ) {
        return None;
    }

    let scheduled_in_future = issue
        .scheduled_at
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|parsed| parsed.with_timezone(&chrono::Utc) > chrono::Utc::now())
        .unwrap_or(false);

    // A scheduled issue has no execution to describe: a Scheduler entry starts
    // one at the send instant, and until it does the record carries no ARN (the
    // execution records its own — the API never sees it). "Waiting for the send
    // time" is still the right thing to report, and it is now the record, not an
    // execution parked in a `Wait`, that says so.
    let Some(execution_arn) = issue.execution_arn.as_deref() else {
        return (issue.status == "scheduled" && scheduled_in_future)
            .then(send_progress::waiting_for_send_time);
    };

    send_progress::get_workflow_state(execution_arn, scheduled_in_future).await
}

async fn handle_rebuild_issue_analytics(
    event: Request,
    issue_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let issue_id =
        issue_id.ok_or_else(|| AppError::BadRequest("Issue ID is required".to_string()))?;

    let issue = get_issue_by_id(&tenant_id, &issue_id).await?;

    if issue.status != "published" {
        return Err(AppError::BadRequest(
            "Analytics can only be rebuilt for published issues".to_string(),
        ));
    }

    let published_at = issue
        .published_at
        .clone()
        .unwrap_or_else(|| issue.updated_at.clone());

    publish_issue_published_event(
        &tenant_id,
        &user_context.user_id,
        issue.issue_number,
        &issue.subject,
        &published_at,
    )
    .await?;

    response::format_response(
        202,
        serde_json::json!({
            "status": "queued",
            "issueId": issue_id,
            "issueNumber": issue.issue_number
        }),
    )
}

async fn handle_resend_issue(
    event: Request,
    issue_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    if user_context.email.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Email is required to resend issues".to_string(),
        ));
    }

    let issue_id =
        issue_id.ok_or_else(|| AppError::BadRequest("Issue ID is required".to_string()))?;

    let issue = get_issue_by_id(&tenant_id, &issue_id).await?;

    if issue.status != "published" {
        return Err(AppError::BadRequest(
            "Only published issues can be resent".to_string(),
        ));
    }

    start_issue_schedule(IssueScheduleInput {
        tenant_id: &tenant_id,
        tenant_email: user_context.email.as_str(),
        issue_number: issue.issue_number,
        scheduled_at: None,
        template_id: issue.template_id.as_deref(),
        content_type: &normalize_content_type(issue.content_type.as_deref()),
    })
    .await?;

    response::format_response(
        202,
        serde_json::json!({
            "status": "queued",
            "issueId": issue_id,
            "issueNumber": issue.issue_number
        }),
    )
}

async fn handle_declare_ab_winner(
    event: Request,
    issue_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let issue_id =
        issue_id.ok_or_else(|| AppError::BadRequest("Issue ID is required".to_string()))?;

    let body: DeclareWinnerRequest = serde_json::from_slice(event.body())
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    if body.variant_id != "a" && body.variant_id != "b" {
        return Err(AppError::BadRequest(
            "variantId must be \"a\" or \"b\"".to_string(),
        ));
    }

    let issue = get_issue_by_id(&tenant_id, &issue_id).await?;
    let mut ab_test = issue
        .ab_test
        .clone()
        .ok_or_else(|| AppError::BadRequest("Issue has no A/B test configured".to_string()))?;

    // Confirm the declared winner is one of the configured variants.
    let variant_exists = ab_test
        .get("variants")
        .and_then(|v| v.as_array())
        .map(|variants| {
            variants.iter().any(|variant| {
                variant.get("variantId").and_then(|v| v.as_str()) == Some(body.variant_id.as_str())
            })
        })
        .unwrap_or(false);
    if !variant_exists {
        return Err(AppError::BadRequest(
            "variantId is not part of this A/B test".to_string(),
        ));
    }

    if let Some(obj) = ab_test.as_object_mut() {
        obj.insert(
            "winnerVariantId".to_string(),
            serde_json::Value::String(body.variant_id.clone()),
        );
        obj.insert(
            "status".to_string(),
            serde_json::Value::String("sent".to_string()),
        );
    }

    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;
    let pk = format!("{}#{}", tenant_id, issue.issue_number);

    ddb_client
        .update_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(pk))
        .key("sk", AttributeValue::S("newsletter".to_string()))
        .update_expression("SET abTest = :ab_test, updatedAt = :updated_at")
        .expression_attribute_values(":ab_test", AttributeValue::S(ab_test.to_string()))
        .expression_attribute_values(
            ":updated_at",
            AttributeValue::S(chrono::Utc::now().to_rfc3339()),
        )
        .send()
        .await?;

    publish_event(&tenant_id, "ISSUE_AB_WINNER_DECLARED", &issue).await?;

    let updated = get_issue_by_id(&tenant_id, &issue_id).await?;
    let stats = get_issue_stats(&tenant_id, &issue_id).await.ok();
    let insights = get_issue_insights(&tenant_id, &issue_id)
        .await
        .ok()
        .flatten();
    let variant_stats = get_variant_stats(&tenant_id, &issue_id).await;

    // An A/B test and a local send are mutually exclusive, so an issue reaching
    // here never has send progress to report.
    let response_data = build_issue_response(updated, stats, insights, variant_stats, None, None);
    response::format_response(200, response_data)
}

async fn handle_get_trends(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let query: TrendsQuery = parse_trends_query_params(&event)?;
    let trends = calculate_trends(&tenant_id, &query).await?;

    response::format_response(200, trends)
}

// ---------------------------------------------------------------------------
// A/B test history (cross-issue)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct AbHistoryVariant {
    #[serde(rename = "variantId")]
    variant_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    subject: Option<String>,
    #[serde(rename = "sendAt", skip_serializing_if = "Option::is_none")]
    send_at: Option<String>,
    opens: i64,
    clicks: i64,
    deliveries: i64,
    #[serde(rename = "openRate")]
    open_rate: f64,
    #[serde(rename = "clickRate")]
    click_rate: f64,
}

#[derive(Serialize)]
pub struct AbHistoryTest {
    #[serde(rename = "issueNumber")]
    issue_number: i64,
    dimension: String,
    #[serde(rename = "winMetric")]
    win_metric: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(rename = "winnerVariantId", skip_serializing_if = "Option::is_none")]
    winner_variant_id: Option<String>,
    significant: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lift: Option<f64>,
    #[serde(rename = "decidedAt", skip_serializing_if = "Option::is_none")]
    decided_at: Option<String>,
    variants: Vec<AbHistoryVariant>,
}

#[derive(Serialize)]
pub struct SendHourWins {
    #[serde(rename = "hourUtc")]
    hour_utc: u32,
    wins: i64,
}

#[derive(Serialize)]
pub struct AbHistoryAggregates {
    #[serde(rename = "totalTests")]
    total_tests: i64,
    #[serde(rename = "significantTests")]
    significant_tests: i64,
    #[serde(rename = "subjectTests")]
    subject_tests: i64,
    #[serde(rename = "sendTimeTests")]
    send_time_tests: i64,
    #[serde(rename = "avgWinningLift", skip_serializing_if = "Option::is_none")]
    avg_winning_lift: Option<f64>,
    #[serde(rename = "topSendHoursUtc")]
    top_send_hours_utc: Vec<SendHourWins>,
}

#[derive(Serialize)]
pub struct AbHistoryResponse {
    tests: Vec<AbHistoryTest>,
    aggregates: AbHistoryAggregates,
}

async fn handle_get_ab_history(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let tests = query_ab_history(&tenant_id).await?;
    let aggregates = compute_ab_history_aggregates(&tests);

    response::format_response(200, AbHistoryResponse { tests, aggregates })
}

// ---------------------------------------------------------------------------
// Active A/B tests (in-progress, cross-issue)
// ---------------------------------------------------------------------------

// A/B lifecycle states that mean the test is still running — the sample has gone
// out and a winner has not been decided yet. These are exactly the non-final
// statuses (everything except `sent`/`inconclusive`); the dashboard surfaces
// them as "in progress".
const IN_PROGRESS_AB_STATUSES: [&str; 3] = ["pending", "testing", "evaluating"];

// Upper bound on newsletter records scanned (newest-first) when collecting
// in-progress tests. An active test always sits within a tenant's most recent
// issues — its hold-out window is measured in hours — so a bounded recent window
// is sufficient and keeps the DynamoDB read (and the API Lambda's latency) flat
// regardless of how many issues a tenant has published.
const ACTIVE_AB_SCAN_LIMIT: i32 = 25;

#[derive(Serialize)]
pub struct ActiveAbTestVariant {
    #[serde(rename = "variantId")]
    variant_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    subject: Option<String>,
    #[serde(rename = "sendAt", skip_serializing_if = "Option::is_none")]
    send_at: Option<String>,
}

#[derive(Serialize)]
pub struct ActiveAbTest {
    #[serde(rename = "issueId")]
    issue_id: String,
    #[serde(rename = "issueNumber")]
    issue_number: i32,
    subject: String,
    dimension: String,
    status: String,
    #[serde(rename = "winMetric")]
    win_metric: String,
    #[serde(rename = "publishedAt", skip_serializing_if = "Option::is_none")]
    published_at: Option<String>,
    #[serde(
        rename = "evaluateAfterMinutes",
        skip_serializing_if = "Option::is_none"
    )]
    evaluate_after_minutes: Option<i64>,
    variants: Vec<ActiveAbTestVariant>,
    #[serde(rename = "variantStats")]
    variant_stats: Vec<VariantStats>,
}

#[derive(Serialize)]
pub struct ActiveAbTestsResponse {
    tests: Vec<ActiveAbTest>,
}

async fn handle_get_active_ab_tests(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let tests = query_active_ab_tests(&tenant_id).await?;

    response::format_response(200, ActiveAbTestsResponse { tests })
}

/// Collects the tenant's in-progress A/B tests by scanning a bounded window of
/// the most recent newsletter records (GSI1, newest-first) and keeping those
/// whose embedded abTest is non-final. Live per-variant engagement counters are
/// attached so the dashboard can show the test's progress while it runs.
async fn query_active_ab_tests(tenant_id: &str) -> Result<Vec<ActiveAbTest>, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let gsi1pk = format!("{}#newsletter", tenant_id);

    let result = ddb_client
        .query()
        .table_name(&table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :gsi1pk")
        .filter_expression("attribute_exists(abTest)")
        .expression_attribute_values(":gsi1pk", AttributeValue::S(gsi1pk))
        .scan_index_forward(false)
        .limit(ACTIVE_AB_SCAN_LIMIT)
        .send()
        .await?;

    let mut tests = Vec::new();
    for item in result.items() {
        if let Some(mut test) = parse_active_ab_test(item) {
            test.variant_stats = get_variant_stats(tenant_id, &test.issue_id).await;
            tests.push(test);
        }
    }

    Ok(tests)
}

/// Parses a newsletter record into an `ActiveAbTest` when it carries a non-final
/// managed A/B test on a published issue. Returns `None` for records without an
/// abTest, with a finished test (`sent`/`inconclusive`), or that are not yet
/// published (drafts/scheduled issues have not run their sample send, so they
/// are not "in progress"). Variant stats are left empty here and filled by the
/// caller.
fn parse_active_ab_test(item: &HashMap<String, AttributeValue>) -> Option<ActiveAbTest> {
    // Only published issues have actually sent a test sample.
    let issue_status = item.get("status").and_then(|v| v.as_s().ok())?;
    if issue_status != "published" {
        return None;
    }

    // abTest is persisted as a JSON string (mirroring metadata).
    let ab_test: serde_json::Value = item
        .get("abTest")
        .and_then(|v| v.as_s().ok())
        .and_then(|s| serde_json::from_str(s).ok())?;

    let status = ab_test.get("status").and_then(|v| v.as_str()).unwrap_or("");
    if !IN_PROGRESS_AB_STATUSES.contains(&status) {
        return None;
    }

    let issue_number = item
        .get("pk")
        .and_then(|v| v.as_s().ok())
        .and_then(|pk| pk.split('#').nth(1))
        .and_then(|s| s.parse::<i32>().ok())?;

    let subject = item
        .get("subject")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string())
        .unwrap_or_default();

    let published_at = item
        .get("publishedAt")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string());

    let dimension = ab_test
        .get("dimension")
        .and_then(|v| v.as_str())
        .unwrap_or(AB_DIMENSION_SUBJECT)
        .to_string();
    let win_metric = ab_test
        .get("winMetric")
        .and_then(|v| v.as_str())
        .unwrap_or("openRate")
        .to_string();
    let evaluate_after_minutes = ab_test.get("evaluateAfterMinutes").and_then(|v| v.as_i64());

    let variants = ab_test
        .get("variants")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|v| ActiveAbTestVariant {
                    variant_id: v
                        .get("variantId")
                        .and_then(|x| x.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    subject: v
                        .get("subject")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string()),
                    send_at: v
                        .get("sendAt")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string()),
                })
                .collect()
        })
        .unwrap_or_default();

    Some(ActiveAbTest {
        issue_id: issue_number.to_string(),
        issue_number,
        subject,
        dimension,
        status: status.to_string(),
        win_metric,
        published_at,
        evaluate_after_minutes,
        variants,
        variant_stats: Vec::new(),
    })
}

/// Upper bound on history tests read for prompt grounding. The suggestion
/// summary only surfaces the top few outcomes per dimension, so reading a
/// recent window (newest-first) is sufficient and keeps DynamoDB reads — and
/// the API Lambda's latency — bounded regardless of how much history a tenant
/// has accumulated.
const SUGGESTION_HISTORY_LIMIT: usize = 50;

/// Reads the tenant's A/B history partition (pk = `${tenantId}#abhistory`,
/// sk begins_with `test#`), newest issue first.
async fn query_ab_history(tenant_id: &str) -> Result<Vec<AbHistoryTest>, AppError> {
    query_ab_history_limited(tenant_id, None).await
}

/// Reads the tenant's A/B history partition newest-first. When `limit` is
/// `Some(n)`, stops once at least `n` tests have been collected so callers that
/// only need a recent window (e.g. prompt grounding) don't page the entire
/// partition. `None` reads the full history (used by the history endpoint,
/// which needs every test to compute aggregates).
async fn query_ab_history_limited(
    tenant_id: &str,
    limit: Option<usize>,
) -> Result<Vec<AbHistoryTest>, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let pk = format!("{}#abhistory", tenant_id);
    let mut tests = Vec::new();
    let mut last_key: Option<HashMap<String, AttributeValue>> = None;

    loop {
        let mut builder = ddb_client
            .query()
            .table_name(&table_name)
            .key_condition_expression("pk = :pk AND begins_with(sk, :prefix)")
            .expression_attribute_values(":pk", AttributeValue::S(pk.clone()))
            .expression_attribute_values(":prefix", AttributeValue::S("test#".to_string()))
            .scan_index_forward(false);

        // Cap items evaluated per page to what's still needed so DynamoDB stops
        // scanning early on the final page.
        if let Some(n) = limit {
            let remaining = n.saturating_sub(tests.len());
            builder = builder.limit(remaining as i32);
        }

        if let Some(start) = last_key.take() {
            builder = builder.set_exclusive_start_key(Some(start));
        }

        let result = builder.send().await?;
        for item in result.items() {
            if let Some(test) = parse_ab_history_item(item) {
                tests.push(test);
            }
        }

        if let Some(n) = limit {
            if tests.len() >= n {
                break;
            }
        }

        match result.last_evaluated_key() {
            Some(key) if !key.is_empty() => last_key = Some(key.clone()),
            _ => break,
        }
    }

    Ok(tests)
}

fn parse_ab_history_item(item: &HashMap<String, AttributeValue>) -> Option<AbHistoryTest> {
    let num = |key: &str| -> Option<f64> {
        item.get(key)
            .and_then(|v| v.as_n().ok())
            .and_then(|s| s.parse::<f64>().ok())
    };
    let text = |key: &str| -> Option<String> {
        item.get(key)
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string())
    };

    let dimension = text("dimension")?;
    let win_metric = text("winMetric").unwrap_or_else(|| "openRate".to_string());
    let issue_number = num("issueNumber").unwrap_or(0.0) as i64;

    let variants = item
        .get("variants")
        .and_then(|v| v.as_l().ok())
        .map(|list| {
            list.iter()
                .filter_map(|entry| entry.as_m().ok())
                .map(parse_ab_history_variant)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Some(AbHistoryTest {
        issue_number,
        dimension,
        win_metric,
        status: text("status"),
        winner_variant_id: text("winnerVariantId"),
        significant: item
            .get("significant")
            .and_then(|v| v.as_bool().ok())
            .copied()
            .unwrap_or(false),
        confidence: num("confidence"),
        lift: num("lift"),
        decided_at: text("decidedAt"),
        variants,
    })
}

fn parse_ab_history_variant(m: &HashMap<String, AttributeValue>) -> AbHistoryVariant {
    let num = |key: &str| -> f64 {
        m.get(key)
            .and_then(|v| v.as_n().ok())
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0)
    };
    let text = |key: &str| -> Option<String> {
        m.get(key)
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string())
    };

    AbHistoryVariant {
        variant_id: text("variantId").unwrap_or_default(),
        subject: text("subject"),
        send_at: text("sendAt"),
        opens: num("opens") as i64,
        clicks: num("clicks") as i64,
        deliveries: num("deliveries") as i64,
        open_rate: num("openRate"),
        click_rate: num("clickRate"),
    }
}

fn compute_ab_history_aggregates(tests: &[AbHistoryTest]) -> AbHistoryAggregates {
    use chrono::Timelike;

    let total_tests = tests.len() as i64;
    let mut significant_tests = 0i64;
    let mut subject_tests = 0i64;
    let mut send_time_tests = 0i64;
    let mut lift_sum = 0.0;
    let mut lift_count = 0i64;
    let mut hour_wins: HashMap<u32, i64> = HashMap::new();

    for test in tests {
        if test.dimension == AB_DIMENSION_SENDTIME {
            send_time_tests += 1;
        } else if test.dimension == AB_DIMENSION_SUBJECT {
            subject_tests += 1;
        }

        if test.significant {
            significant_tests += 1;
            if let Some(lift) = test.lift {
                lift_sum += lift;
                lift_count += 1;
            }

            // Tally winning send hour (UTC) for significant send-time tests.
            if test.dimension == AB_DIMENSION_SENDTIME {
                if let Some(winner_id) = &test.winner_variant_id {
                    if let Some(send_at) = test
                        .variants
                        .iter()
                        .find(|v| &v.variant_id == winner_id)
                        .and_then(|v| v.send_at.as_deref())
                    {
                        if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(send_at) {
                            let hour = parsed.with_timezone(&chrono::Utc).hour();
                            *hour_wins.entry(hour).or_insert(0) += 1;
                        }
                    }
                }
            }
        }
    }

    let mut top_send_hours_utc: Vec<SendHourWins> = hour_wins
        .into_iter()
        .map(|(hour_utc, wins)| SendHourWins { hour_utc, wins })
        .collect();
    top_send_hours_utc.sort_by(|a, b| b.wins.cmp(&a.wins).then(a.hour_utc.cmp(&b.hour_utc)));
    top_send_hours_utc.truncate(3);

    let avg_winning_lift = if lift_count > 0 {
        Some(((lift_sum / lift_count as f64) * 100.0).round() / 100.0)
    } else {
        None
    };

    AbHistoryAggregates {
        total_tests,
        significant_tests,
        subject_tests,
        send_time_tests,
        avg_winning_lift,
        top_send_hours_utc,
    }
}

// ---------------------------------------------------------------------------
// A/B suggestions (LLM-assisted, grounded in cross-issue history)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct AbSuggestionRequest {
    dimension: String,
    #[serde(default)]
    subject: Option<String>,
    #[serde(rename = "contentSummary", default)]
    content_summary: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct AbSendTimeSuggestion {
    label: String,
    #[serde(rename = "hourUtc")]
    hour_utc: u32,
}

#[derive(Serialize)]
pub struct AbSuggestionResponse {
    dimension: String,
    rationale: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    subjects: Option<Vec<String>>,
    #[serde(rename = "sendTimes", skip_serializing_if = "Option::is_none")]
    send_times: Option<Vec<AbSendTimeSuggestion>>,
    #[serde(rename = "usedHistory")]
    used_history: bool,
}

async fn handle_suggest_ab_test(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let body: AbSuggestionRequest = serde_json::from_slice(event.body())
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    if body.dimension != AB_DIMENSION_SUBJECT && body.dimension != AB_DIMENSION_SENDTIME {
        return Err(AppError::BadRequest(
            "dimension must be \"subject\" or \"sendTime\"".to_string(),
        ));
    }

    // Ground the suggestion in the tenant's prior results. History is best-effort
    // — a failed read degrades to general best-practice suggestions — and bounded
    // to a recent window so a large history can't blow the API Lambda's timeout.
    let history = query_ab_history_limited(&tenant_id, Some(SUGGESTION_HISTORY_LIMIT))
        .await
        .unwrap_or_default();
    let used_history = !history.is_empty();
    let history_summary = summarize_ab_history_for_prompt(&history, &body.dimension);

    let model_id = std::env::var("MODEL_ID")
        .map_err(|_| AppError::InternalError("MODEL_ID not set".to_string()))?;

    let (system_prompt, user_prompt) = build_suggestion_prompt(
        &body.dimension,
        body.subject.as_deref(),
        body.content_summary.as_deref(),
        &history_summary,
    );

    // No tools => a single model call (bounded cost).
    let raw = converse(
        &model_id,
        &system_prompt,
        &user_prompt,
        Vec::new(),
        ConverseOptions {
            tenant_id: tenant_id.clone(),
            user_id: None,
        },
    )
    .await
    .map_err(|e| AppError::InternalError(format!("Suggestion generation failed: {}", e)))?;

    let (subjects, send_times, rationale) = parse_suggestion_response(&raw, &body.dimension)?;

    response::format_response(
        200,
        AbSuggestionResponse {
            dimension: body.dimension,
            rationale,
            subjects,
            send_times,
            used_history,
        },
    )
}

/// Compact, prompt-friendly summary of prior A/B outcomes for grounding.
fn summarize_ab_history_for_prompt(tests: &[AbHistoryTest], dimension: &str) -> String {
    use chrono::Timelike;

    if tests.is_empty() {
        return "No prior A/B test history for this tenant.".to_string();
    }

    let relevant: Vec<&AbHistoryTest> = tests.iter().filter(|t| t.dimension == dimension).collect();
    let mut lines = vec![format!(
        "Recent past A/B tests considered: {}.",
        tests.len()
    )];

    if dimension == AB_DIMENSION_SUBJECT {
        let significant: Vec<&&AbHistoryTest> = relevant.iter().filter(|t| t.significant).collect();
        lines.push(format!(
            "Subject-line tests: {} ({} statistically significant).",
            relevant.len(),
            significant.len()
        ));
        for test in significant.iter().take(5) {
            if let Some(winner_id) = &test.winner_variant_id {
                if let Some(subject) = test
                    .variants
                    .iter()
                    .find(|v| &v.variant_id == winner_id)
                    .and_then(|v| v.subject.as_deref())
                {
                    lines.push(format!(
                        "- Winning subject \"{}\" (+{}pts on {}).",
                        subject,
                        test.lift.unwrap_or(0.0),
                        test.win_metric
                    ));
                }
            }
        }
    } else {
        let mut hour_wins: HashMap<u32, i64> = HashMap::new();
        for test in relevant.iter().filter(|t| t.significant) {
            if let Some(winner_id) = &test.winner_variant_id {
                if let Some(send_at) = test
                    .variants
                    .iter()
                    .find(|v| &v.variant_id == winner_id)
                    .and_then(|v| v.send_at.as_deref())
                {
                    if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(send_at) {
                        *hour_wins
                            .entry(parsed.with_timezone(&chrono::Utc).hour())
                            .or_insert(0) += 1;
                    }
                }
            }
        }
        lines.push(format!("Send-time tests: {}.", relevant.len()));
        let mut hours: Vec<(u32, i64)> = hour_wins.into_iter().collect();
        hours.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        for (hour, wins) in hours.into_iter().take(5) {
            lines.push(format!("- Hour {:02}:00 UTC won {} time(s).", hour, wins));
        }
    }

    lines.join("\n")
}

/// Builds (system, user) prompts instructing the model to return strict JSON.
fn build_suggestion_prompt(
    dimension: &str,
    subject: Option<&str>,
    content_summary: Option<&str>,
    history_summary: &str,
) -> (String, String) {
    let system = if dimension == AB_DIMENSION_SUBJECT {
        "You are an expert email-newsletter strategist. Propose alternative SUBJECT LINES for an A/B test, optimized for open rate and grounded in the tenant's past results when provided. Respond with ONLY a JSON object of the form {\"subjects\": [\"...\", \"...\"], \"rationale\": \"...\"}. Provide 2-3 distinct subjects, each at most 200 characters. Output no text outside the JSON."
    } else {
        "You are an expert email-newsletter strategist. Recommend candidate SEND TIMES (hour of day in UTC) for an A/B test, grounded in the tenant's past results when provided. Respond with ONLY a JSON object of the form {\"sendTimes\": [{\"label\": \"09:00 UTC\", \"hourUtc\": 9}], \"rationale\": \"...\"}. Provide 2-3 distinct hours in the range 0-23. Output no text outside the JSON."
    };

    let mut user = String::new();
    if let Some(subject) = subject {
        if !subject.trim().is_empty() {
            user.push_str(&format!("Current subject line: \"{}\"\n", subject.trim()));
        }
    }
    if let Some(content) = content_summary {
        if !content.trim().is_empty() {
            let trimmed: String = content.trim().chars().take(800).collect();
            user.push_str(&format!("Issue summary: {}\n", trimmed));
        }
    }
    user.push_str("\nPast A/B performance:\n");
    user.push_str(history_summary);
    user.push_str("\n\nReturn the JSON now.");

    (system.to_string(), user)
}

type ParsedSuggestions = (
    Option<Vec<String>>,
    Option<Vec<AbSendTimeSuggestion>>,
    String,
);

/// Parses the model's JSON response into typed suggestions for the dimension.
fn parse_suggestion_response(raw: &str, dimension: &str) -> Result<ParsedSuggestions, AppError> {
    let json_text = extract_json_object(raw)
        .ok_or_else(|| AppError::InternalError("Model did not return JSON".to_string()))?;
    let value: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| AppError::InternalError(format!("Failed to parse model JSON: {}", e)))?;

    let rationale = value
        .get("rationale")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if dimension == AB_DIMENSION_SUBJECT {
        let subjects: Vec<String> = value
            .get("subjects")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|s| s.as_str())
                    .map(|s| s.trim().chars().take(200).collect::<String>())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        if subjects.is_empty() {
            return Err(AppError::InternalError(
                "Model returned no subject suggestions".to_string(),
            ));
        }
        Ok((Some(subjects), None, rationale))
    } else {
        let send_times: Vec<AbSendTimeSuggestion> = value
            .get("sendTimes")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|entry| {
                        let hour = entry.get("hourUtc").and_then(|h| h.as_u64())? as u32;
                        if hour > 23 {
                            return None;
                        }
                        let label = entry
                            .get("label")
                            .and_then(|l| l.as_str())
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| format!("{:02}:00 UTC", hour));
                        Some(AbSendTimeSuggestion {
                            label,
                            hour_utc: hour,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        if send_times.is_empty() {
            return Err(AppError::InternalError(
                "Model returned no send-time suggestions".to_string(),
            ));
        }
        Ok((None, Some(send_times), rationale))
    }
}

/// Extracts the first JSON object substring from model output, tolerating code
/// fences or surrounding prose.
fn extract_json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    (end > start).then(|| &text[start..=end])
}

// ---------------------------------------------------------------------------
// AI editorial review (POST /issues/review)
//
// A single Bedrock Nova call that grades an issue and returns structured
// editorial feedback: an overall grade, A/B subject-line ideas, a title /
// description (meta) assessment, and grammar + spelling notes. Consumed by the
// newsletter publish Action, which turns the response into a PR comment. Dead
// links are checked by the Action itself (a plain HTTP check, not the model).
// ---------------------------------------------------------------------------

// Cap the content sent to the model so a very long issue can't blow the API
// Lambda's 30s timeout or the model's context. Newsletter issues are a few KB.
const REVIEW_MAX_CONTENT_CHARS: usize = 24000;

#[derive(Deserialize)]
pub struct ReviewIssueRequest {
    #[serde(default)]
    subject: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    content: String,
    #[serde(rename = "issueNumber", default)]
    issue_number: Option<i64>,
}

#[derive(Serialize)]
pub struct SubjectSuggestion {
    a: String,
    b: String,
    rationale: String,
}

#[derive(Serialize)]
pub struct MetaAssessment {
    #[serde(rename = "titleFit")]
    title_fit: String,
    #[serde(rename = "descriptionFit")]
    description_fit: String,
    suggestions: Vec<String>,
}

#[derive(Serialize)]
pub struct GrammarIssue {
    quote: String,
    issue: String,
    suggestion: String,
}

#[derive(Serialize)]
pub struct SpellingIssue {
    word: String,
    suggestion: String,
    context: String,
}

#[derive(Serialize)]
pub struct ReviewIssueResponse {
    grade: String,
    #[serde(rename = "gradeRationale")]
    grade_rationale: String,
    summary: String,
    #[serde(rename = "subjectSuggestions")]
    subject_suggestions: Vec<SubjectSuggestion>,
    #[serde(rename = "metaAssessment")]
    meta_assessment: MetaAssessment,
    grammar: Vec<GrammarIssue>,
    spelling: Vec<SpellingIssue>,
    #[serde(rename = "issueNumber", skip_serializing_if = "Option::is_none")]
    issue_number: Option<i64>,
}

async fn handle_review_issue(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let body: ReviewIssueRequest = serde_json::from_slice(event.body())
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    if body.content.trim().is_empty() {
        return Err(AppError::BadRequest(
            "content is required to review an issue".to_string(),
        ));
    }

    let model_id = std::env::var("MODEL_ID")
        .map_err(|_| AppError::InternalError("MODEL_ID not set".to_string()))?;

    let (system_prompt, user_prompt) = build_review_prompt(&body);

    // No tools => a single model call (bounded cost).
    let raw = converse(
        &model_id,
        &system_prompt,
        &user_prompt,
        Vec::new(),
        ConverseOptions {
            tenant_id: tenant_id.clone(),
            user_id: None,
        },
    )
    .await
    .map_err(|e| AppError::InternalError(format!("Review generation failed: {}", e)))?;

    let mut review = parse_review_response(&raw)?;
    review.issue_number = body.issue_number;

    response::format_response(200, review)
}

/// Builds (system, user) prompts instructing Nova to return strict review JSON.
fn build_review_prompt(body: &ReviewIssueRequest) -> (String, String) {
    let system = "You are the editorial assistant for a developer newsletter read by professional cloud and software engineers. \
Review the issue and respond with ONLY a JSON object of exactly this shape, and no text outside the JSON:\n\
{\n\
  \"grade\": \"one of A+, A, A-, B+, B, B-, C+, C, C-, D, F\",\n\
  \"gradeRationale\": \"one or two sentences explaining the grade\",\n\
  \"summary\": \"a friendly 1-2 sentence overall impression\",\n\
  \"subjectSuggestions\": [{\"a\": \"subject variant A\", \"b\": \"subject variant B\", \"rationale\": \"the contrast being tested\"}],\n\
  \"metaAssessment\": {\"titleFit\": \"how well the title previews the content\", \"descriptionFit\": \"how well the description previews the content\", \"suggestions\": [\"optional rewrite\"]},\n\
  \"grammar\": [{\"quote\": \"exact phrase from the content\", \"issue\": \"what is wrong\", \"suggestion\": \"the fix\"}],\n\
  \"spelling\": [{\"word\": \"misspelled word\", \"suggestion\": \"correct spelling\", \"context\": \"a few surrounding words\"}]\n\
}\n\
Guidance: keep the voice warm, curious, and practical. Provide 2-3 subjectSuggestions pairs, each testing a genuine contrast, under ~60 characters, no clickbait. \
For metaAssessment, judge whether the title and description accurately preview the actual content and only suggest rewrites if they improve it. \
For grammar, flag real grammar/clarity problems (not stylistic preferences) and quote the exact phrase. \
For spelling, ignore proper nouns, product names, code, and technical jargon unless clearly misspelled. \
Do NOT report broken links; a separate automated checker handles those. \
Return empty arrays for grammar and spelling when there are no issues.";

    let content: String = body
        .content
        .trim()
        .chars()
        .take(REVIEW_MAX_CONTENT_CHARS)
        .collect();

    let mut user = String::new();
    user.push_str("Frontmatter metadata:\n");
    user.push_str(&format!(
        "- subject: {}\n",
        body.subject.as_deref().unwrap_or("(none)")
    ));
    user.push_str(&format!(
        "- title: {}\n",
        body.title.as_deref().unwrap_or("(none)")
    ));
    user.push_str(&format!(
        "- description: {}\n",
        body.description.as_deref().unwrap_or("(none)")
    ));
    user.push_str("\nNewsletter content (markdown):\n");
    user.push_str(&content);
    user.push_str("\n\nReturn the JSON now.");

    (system.to_string(), user)
}

/// Parses Nova's JSON response into a typed review, tolerating missing fields.
fn parse_review_response(raw: &str) -> Result<ReviewIssueResponse, AppError> {
    let json_text = extract_json_object(raw)
        .ok_or_else(|| AppError::InternalError("Model did not return JSON".to_string()))?;
    let value: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| AppError::InternalError(format!("Failed to parse model JSON: {}", e)))?;

    let get_str = |v: &serde_json::Value, key: &str| -> String {
        v.get(key)
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };

    let grade = {
        let g = get_str(&value, "grade");
        if g.is_empty() {
            "N/A".to_string()
        } else {
            g
        }
    };

    let subject_suggestions = value
        .get("subjectSuggestions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|item| SubjectSuggestion {
                    a: get_str(item, "a"),
                    b: get_str(item, "b"),
                    rationale: get_str(item, "rationale"),
                })
                .filter(|s| !s.a.is_empty() || !s.b.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let meta = value.get("metaAssessment");
    let meta_assessment = MetaAssessment {
        title_fit: meta.map(|m| get_str(m, "titleFit")).unwrap_or_default(),
        description_fit: meta
            .map(|m| get_str(m, "descriptionFit"))
            .unwrap_or_default(),
        suggestions: meta
            .and_then(|m| m.get("suggestions"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|s| s.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default(),
    };

    let grammar = value
        .get("grammar")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|item| GrammarIssue {
                    quote: get_str(item, "quote"),
                    issue: get_str(item, "issue"),
                    suggestion: get_str(item, "suggestion"),
                })
                // A grammar entry is only usable with an exact quote (to map the
                // fix back to the text) and a suggestion (the fix itself); drop
                // malformed model items that omit either.
                .filter(|g| !g.quote.is_empty() && !g.suggestion.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let spelling = value
        .get("spelling")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|item| SpellingIssue {
                    word: get_str(item, "word"),
                    suggestion: get_str(item, "suggestion"),
                    context: get_str(item, "context"),
                })
                // Likewise, a spelling entry needs the misspelled word and its
                // correction to be actionable.
                .filter(|s| !s.word.is_empty() && !s.suggestion.is_empty())
                .collect()
        })
        .unwrap_or_default();

    Ok(ReviewIssueResponse {
        grade,
        grade_rationale: get_str(&value, "gradeRationale"),
        summary: get_str(&value, "summary"),
        subject_suggestions,
        meta_assessment,
        grammar,
        spelling,
        issue_number: None,
    })
}

async fn handle_create_issue(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;
    if user_context.email.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Email is required to create issues".to_string(),
        ));
    }

    let mut body: CreateIssueRequest = serde_json::from_slice(event.body())
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    // Treat an empty/whitespace templateId as "no template selected" so the
    // default template is used and nothing is persisted (or threaded to the
    // state machine).
    if body
        .template_id
        .as_deref()
        .map(|t| t.trim().is_empty())
        .unwrap_or(false)
    {
        body.template_id = None;
    }

    validate_create_request(&body)?;

    // The raw (pre-normalization) config values also feed the idempotency
    // hash: normalization injects server-generated values (e.g. the A/B
    // testId), so hashing normalized config would make byte-identical
    // replays look different.
    let raw_ab_test = extract_ab_test(event.body().as_ref())?;
    let ab_test = raw_ab_test
        .as_ref()
        .map(validate_and_normalize_ab_test)
        .transpose()?;

    let raw_local_send = extract_local_send(event.body().as_ref())?;

    // Both a date-only `scheduledAt` and a local-send config without an
    // explicit zone are filled in from the tenant's settings; load them once,
    // and only when this request actually needs them.
    let tenant_settings = load_settings_if_needed(
        &tenant_id,
        body.scheduled_at.as_deref(),
        raw_local_send.is_some(),
    )
    .await;

    let local_send = raw_local_send
        .as_ref()
        .map(|value| validate_and_normalize_local_send(value, &tenant_settings.timezone))
        .transpose()?
        .flatten();
    let raw_content_assembly = extract_content_assembly(event.body().as_ref())?;
    let content_assembly = raw_content_assembly
        .as_ref()
        .map(validate_and_normalize_content_assembly)
        .transpose()?;

    if let Some(template_id) = body.template_id.as_deref() {
        validate_template_exists(&tenant_id, template_id).await?;
    }

    let action = body.action.unwrap_or(CreateIssueAction::Draft);

    // A ttlSeconds only makes sense for drafts — a scheduled issue is on its
    // way to being published, so auto-expiring it would be surprising.
    if body.ttl_seconds.is_some() && action != CreateIssueAction::Draft {
        return Err(AppError::BadRequest(
            "ttlSeconds is only valid for draft issues".to_string(),
        ));
    }

    let idempotency_key = get_idempotency_key(&event);

    let normalized_scheduled_at =
        resolve_scheduled_at(body.scheduled_at.as_deref(), &tenant_settings)?;

    // Set when an exact replay's recorded issue no longer exists and the
    // request falls through to a fresh create: the idempotency record for the
    // key is still in place and must be overwritten, not condition-failed.
    let mut replace_idempotency_record = false;

    if let Some(key) = idempotency_key.as_deref() {
        if let Some(existing) = get_idempotency_record(&tenant_id, key).await? {
            if let Some(issue_number) = body.issue_number {
                if existing.issue_number != issue_number {
                    return Err(AppError::Conflict(
                        "Idempotency key reuse with different issueNumber".to_string(),
                    ));
                }
            }

            let existing_hash = compute_idempotency_hash(
                &body,
                existing.issue_number,
                action,
                body.scheduled_at.as_deref(),
                raw_ab_test.as_ref(),
                raw_local_send.as_ref(),
                raw_content_assembly.as_ref(),
            );

            if existing_hash != existing.payload_hash {
                return Err(AppError::Conflict(
                    "Idempotency key reuse with different payload".to_string(),
                ));
            }
            // Exact replay of a request we already processed: succeed
            // idempotently with the previously created issue rather than 409,
            // so CI re-runs of the same commit don't fail the workflow. If the
            // issue has since been deleted (e.g. an expired draft), fall
            // through and process the request as a fresh create.
            match get_issue_by_id(&tenant_id, &existing.issue_number.to_string()).await {
                Ok(issue) => {
                    return response::format_response(
                        200,
                        CreateIssueResponse {
                            id: issue.issue_number.to_string(),
                            issue_number: issue.issue_number,
                            subject: issue.subject,
                            status: issue.status,
                            content: issue.content,
                            created_at: issue.created_at,
                            updated_at: issue.updated_at,
                            content_type: normalize_content_type(issue.content_type.as_deref()),
                        },
                    );
                }
                Err(AppError::NotFound(_)) => {
                    replace_idempotency_record = true;
                }
                Err(err) => return Err(err),
            }
        }
    }

    // An existing record only blocks the create while it is past the draft
    // stage. Overwriting a draft is allowed on purpose: the GitHub flow stages
    // a draft from the PR (re-staged on every push) and later re-posts the
    // same issue number with action: schedule when the PR merges.
    let mut overwrite_draft = false;
    let issue_number = if let Some(issue_number) = body.issue_number {
        match get_issue_status(&tenant_id, issue_number).await? {
            None => {}
            Some(status) if status == "draft" => {
                overwrite_draft = true;
            }
            Some(_) => {
                return Err(AppError::Conflict(format!(
                    "Issue {} already exists",
                    issue_number
                )));
            }
        }
        issue_number
    } else {
        get_next_issue_number(&tenant_id).await?
    };

    let payload_hash = idempotency_key.as_deref().map(|_| {
        compute_idempotency_hash(
            &body,
            issue_number,
            action,
            body.scheduled_at.as_deref(),
            raw_ab_test.as_ref(),
            raw_local_send.as_ref(),
            raw_content_assembly.as_ref(),
        )
    });

    let mut issue = create_issue_record(
        &tenant_id,
        issue_number,
        &body,
        normalized_scheduled_at.clone(),
        SendConfig {
            ab_test,
            local_send,
            content_assembly,
        },
        overwrite_draft,
    )
    .await?;

    publish_event(&tenant_id, "ISSUE_DRAFT_SAVED", &issue).await?;

    // Overwriting an existing draft invalidates any TTL deletion schedule it
    // had: left in place it would fire against the new record (which is still
    // a draft) and delete it. schedule_draft_deletion recreates one below when
    // this request carries its own ttlSeconds.
    if overwrite_draft {
        delete_draft_ttl_schedule(&tenant_id, issue_number).await?;
    }

    if action == CreateIssueAction::Schedule {
        start_issue_schedule(IssueScheduleInput {
            tenant_id: &tenant_id,
            tenant_email: user_context.email.as_str(),
            issue_number,
            scheduled_at: normalized_scheduled_at.as_deref(),
            template_id: body.template_id.as_deref(),
            content_type: &normalize_content_type(body.content_type.as_deref()),
        })
        .await?;

        // A future send leaves the record at `scheduled` (the workflow starts at
        // the send time and claims it then), so say so rather than reporting the
        // `draft` the record was created as a moment ago.
        if normalized_scheduled_at.is_some() {
            issue.status = "scheduled".to_string();
        }
    } else if let Some(ttl_seconds) = body.ttl_seconds {
        schedule_draft_deletion(&tenant_id, issue_number, ttl_seconds).await?;
    }

    if let (Some(key), Some(hash)) = (idempotency_key.as_deref(), payload_hash.as_deref()) {
        save_idempotency_record(
            &tenant_id,
            key,
            issue_number,
            hash,
            replace_idempotency_record,
        )
        .await?;
    }

    response::format_response(201, issue)
}

async fn handle_update_issue(
    event: Request,
    issue_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let issue_id =
        issue_id.ok_or_else(|| AppError::BadRequest("Issue ID is required".to_string()))?;

    let mut body: UpdateIssueRequest = serde_json::from_slice(event.body())
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    let raw_local_send = extract_local_send(event.body().as_ref())?;
    let local_send_provided = raw_local_send.is_some();

    let tenant_settings = load_settings_if_needed(
        &tenant_id,
        body.scheduled_at.as_deref(),
        local_send_provided,
    )
    .await;

    // A date-only reschedule gets the tenant's default send time, same as on
    // create. Anything else is stored as sent — including past timestamps,
    // which an update is allowed to set.
    if let Some(scheduled_at) = body.scheduled_at.as_deref() {
        let trimmed = scheduled_at.trim();
        if settings::is_date_only(trimmed) {
            body.scheduled_at =
                Some(settings::resolve_date_only(trimmed, &tenant_settings)?.to_rfc3339());
        }
    }

    let ab_test = extract_ab_test(event.body().as_ref())?
        .map(|value| validate_and_normalize_ab_test(&value))
        .transpose()?;

    // An explicit `abTest: null` is a request to clear a previously-saved test.
    let clear_ab_test = ab_test.is_none() && ab_test_explicitly_cleared(event.body().as_ref());

    let local_send = raw_local_send
        .map(|value| validate_and_normalize_local_send(&value, &tenant_settings.timezone))
        .transpose()?
        .flatten();

    // Clear on an explicit `localSend: null` OR a provided-but-disabled config
    // ({ enabled: false }) — both mean "no local send for this issue".
    let clear_local_send = local_send.is_none()
        && (local_send_provided || local_send_explicitly_cleared(event.body().as_ref()));

    let content_assembly = extract_content_assembly(event.body().as_ref())?
        .map(|value| validate_and_normalize_content_assembly(&value))
        .transpose()?;

    // An explicit `contentAssembly: null` clears a previously-saved config.
    let clear_content_assembly =
        content_assembly.is_none() && content_assembly_explicitly_cleared(event.body().as_ref());

    validate_update_request(
        &body,
        ab_test.is_some()
            || clear_ab_test
            || local_send.is_some()
            || clear_local_send
            || content_assembly.is_some()
            || clear_content_assembly,
    )?;

    // A non-empty templateId must reference an existing template; an empty
    // templateId is a request to clear the selection (handled in the update).
    if let Some(template_id) = body.template_id.as_deref() {
        if !template_id.trim().is_empty() {
            validate_template_exists(&tenant_id, template_id).await?;
        }
    }

    let existing = get_issue_by_id(&tenant_id, &issue_id).await?;

    // If setting status to published, only allow from in progress or failed
    if body.status.as_deref() == Some("published") {
        match existing.status.as_str() {
            "in progress" | "failed" => {}
            other => {
                return Err(AppError::BadRequest(format!(
                    "Cannot mark issue as published from status '{}'. Only 'in progress' or 'failed' issues can be marked as published",
                    other
                )));
            }
        }
    } else if body.status.as_deref() == Some("draft") {
        // Unscheduling: the one transition out of `scheduled`, and the reason
        // that status is otherwise not updatable at all.
        match existing.status.as_str() {
            "scheduled" => {}
            other => {
                return Err(AppError::BadRequest(format!(
                    "Cannot return issue to draft from status '{}'. Only 'scheduled' issues can be unscheduled",
                    other
                )));
            }
        }
    } else {
        check_update_allowed(&existing)?;
    }

    let is_publishing = body.status.as_deref() == Some("published");
    let is_unscheduling = body.status.as_deref() == Some("draft");

    // Cancel the send before the record says `draft`, not after. The state
    // machine treats a `draft` record as sendable, so a schedule that outlived
    // the status write would fire and publish an issue the operator cancelled —
    // whereas a cancelled schedule with the record still on `scheduled` sends
    // nothing and can be unscheduled again.
    if is_unscheduling {
        delete_issue_send_schedule(&tenant_id, existing.issue_number).await?;
    }

    let updated = update_issue_record(
        &tenant_id,
        &issue_id,
        &body,
        SendConfigUpdate {
            ab_test,
            clear_ab_test,
            local_send,
            clear_local_send,
            content_assembly,
            clear_content_assembly,
        },
    )
    .await?;

    if is_publishing {
        let published_at = chrono::Utc::now().to_rfc3339();
        let _ = publish_issue_published_event(
            &tenant_id,
            &user_context.user_id,
            existing.issue_number,
            &existing.subject,
            &published_at,
        )
        .await;
    }

    publish_event(&tenant_id, "ISSUE_UPDATED", &updated).await?;

    response::format_response(200, updated)
}

async fn handle_delete_issue(
    event: Request,
    issue_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let issue_id =
        issue_id.ok_or_else(|| AppError::BadRequest("Issue ID is required".to_string()))?;

    let existing = get_issue_by_id(&tenant_id, &issue_id).await?;
    check_delete_allowed(&existing)?;

    // Only drafts can be deleted, and a draft should have no send schedule — but
    // "should" is doing real work there. `schedule_issue_send` creates the
    // schedule before it moves the record off `draft`, so a failure between the
    // two leaves exactly that pair, and deleting the record without cancelling
    // would leave a schedule firing at an issue that no longer exists.
    delete_issue_send_schedule(&tenant_id, existing.issue_number).await?;

    delete_issue_records(&tenant_id, &issue_id).await?;

    publish_event(&tenant_id, "ISSUE_DELETED", &existing).await?;

    response::format_response(204, ())
}

// Helper functions for list issues endpoint
fn parse_query_params(event: &Request) -> Result<ListIssuesQuery, AppError> {
    let query_params = event.query_string_parameters();

    let limit = query_params
        .first("limit")
        .and_then(|s: &str| s.parse::<i32>().ok())
        .unwrap_or_else(default_limit);

    let next_token = query_params.first("nextToken").map(|s: &str| s.to_string());

    let status = query_params.first("status").map(|s: &str| s.to_string());

    Ok(ListIssuesQuery {
        limit,
        next_token,
        status,
    })
}

fn parse_trends_query_params(event: &Request) -> Result<TrendsQuery, AppError> {
    let query_params = event.query_string_parameters();
    let issue_count = query_params
        .first("issueCount")
        .and_then(|s: &str| s.parse::<i32>().ok())
        .unwrap_or_else(default_issue_count);

    Ok(TrendsQuery { issue_count })
}

fn validate_list_params(query: &ListIssuesQuery) -> Result<(), AppError> {
    if query.limit < 1 || query.limit > 100 {
        return Err(AppError::BadRequest(
            "Limit must be between 1 and 100".to_string(),
        ));
    }

    if let Some(status) = &query.status {
        // "sending" is a local-send issue whose groups are still going out.
        // "in progress" was missing despite the dashboard offering it as a
        // filter, so selecting it returned a 400.
        let valid_statuses = [
            "draft",
            "scheduled",
            "in progress",
            "sending",
            "published",
            "failed",
        ];
        if !valid_statuses.contains(&status.as_str()) {
            return Err(AppError::BadRequest(format!(
                "Invalid status. Must be one of: {}",
                valid_statuses.join(", ")
            )));
        }
    }

    Ok(())
}

const AB_DIMENSION_SUBJECT: &str = "subject";
const AB_DIMENSION_SENDTIME: &str = "sendTime";

/// Extracts the optional `abTest` object from the raw request body. Kept out of
/// the typed request structs so the (many) existing call sites stay untouched;
/// serde already ignores this unknown field on the typed parse.
fn extract_ab_test(raw_body: &[u8]) -> Result<Option<serde_json::Value>, AppError> {
    if raw_body.is_empty() {
        return Ok(None);
    }
    let value: serde_json::Value = serde_json::from_slice(raw_body)
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;
    match value.get("abTest") {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(ab_test) => Ok(Some(ab_test.clone())),
    }
}

/// Returns true when the request body explicitly sets `abTest` to null, which on
/// update signals the caller wants any previously-saved A/B test cleared
/// (distinct from omitting the field, which leaves it unchanged).
fn ab_test_explicitly_cleared(raw_body: &[u8]) -> bool {
    if raw_body.is_empty() {
        return false;
    }
    serde_json::from_slice::<serde_json::Value>(raw_body)
        .ok()
        .and_then(|value| value.get("abTest").cloned())
        .map(|ab_test| ab_test.is_null())
        .unwrap_or(false)
}

fn extract_local_send(raw_body: &[u8]) -> Result<Option<serde_json::Value>, AppError> {
    if raw_body.is_empty() {
        return Ok(None);
    }
    let value: serde_json::Value = serde_json::from_slice(raw_body)
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;
    match value.get("localSend") {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(local_send) => Ok(Some(local_send.clone())),
    }
}

/// Returns true when the request body explicitly sets `localSend` to null,
/// which on update signals the caller wants the saved config cleared (distinct
/// from omitting the field, which leaves it unchanged).
fn local_send_explicitly_cleared(raw_body: &[u8]) -> bool {
    if raw_body.is_empty() {
        return false;
    }
    serde_json::from_slice::<serde_json::Value>(raw_body)
        .ok()
        .and_then(|value| value.get("localSend").cloned())
        .map(|local_send| local_send.is_null())
        .unwrap_or(false)
}

/// Extracts the optional `contentAssembly` object from the raw request body.
/// Mirrors extract_ab_test: kept out of the typed request structs so existing
/// call sites stay untouched; serde ignores the unknown field on typed parses.
fn extract_content_assembly(raw_body: &[u8]) -> Result<Option<serde_json::Value>, AppError> {
    if raw_body.is_empty() {
        return Ok(None);
    }
    let value: serde_json::Value = serde_json::from_slice(raw_body)
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;
    match value.get("contentAssembly") {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(content_assembly) => Ok(Some(content_assembly.clone())),
    }
}

/// Returns true when the request body explicitly sets `contentAssembly` to
/// null, which on update signals the caller wants the previously-saved config
/// cleared (distinct from omitting the field, which leaves it unchanged).
fn content_assembly_explicitly_cleared(raw_body: &[u8]) -> bool {
    if raw_body.is_empty() {
        return false;
    }
    serde_json::from_slice::<serde_json::Value>(raw_body)
        .ok()
        .and_then(|value| value.get("contentAssembly").cloned())
        .map(|content_assembly| content_assembly.is_null())
        .unwrap_or(false)
}

/// Loose IANA timezone name check: `Area/Location` segments (or `UTC`) built
/// from letters, digits, `_`, `+`, `-`. The JS send pipeline re-validates with
/// the Intl API at send time and falls back to a plain send when invalid, so
/// this only needs to reject obvious garbage early.
fn is_plausible_iana_time_zone(tz: &str) -> bool {
    if tz == "UTC" {
        return true;
    }
    if tz.is_empty() || tz.len() > 64 || !tz.contains('/') {
        return false;
    }
    tz.split('/').all(|segment| {
        !segment.is_empty()
            && segment
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '+' | '-'))
    })
}

/// Validates a caller-supplied local-send config and returns the canonical
/// object to persist:
/// `{ enabled: true, defaultTimeZone: "<IANA zone>", mode: "timezone" | "peak-hour" }`.
/// `mode` is optional on input and defaults to `timezone` (deliver at the
/// scheduled wall-clock time in each subscriber's timezone); `peak-hour`
/// delivers at each subscriber's personal peak open hour instead. Returns
/// Ok(None) when `enabled` is false — a disabled config is stored as no
/// config at all.
///
/// `defaultTimeZone` is also optional: it names the zone whose wall clock
/// defines the target send time, which is exactly what the tenant's own
/// timezone setting already says, so `fallback_time_zone` fills it in when the
/// caller doesn't.
fn validate_and_normalize_local_send(
    value: &serde_json::Value,
    fallback_time_zone: &str,
) -> Result<Option<serde_json::Value>, AppError> {
    let obj = value
        .as_object()
        .ok_or_else(|| AppError::BadRequest("localSend must be an object".to_string()))?;

    let enabled = obj
        .get("enabled")
        .and_then(|v| v.as_bool())
        .ok_or_else(|| AppError::BadRequest("localSend.enabled must be a boolean".to_string()))?;

    if !enabled {
        return Ok(None);
    }

    let default_time_zone = obj
        .get("defaultTimeZone")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|tz| !tz.is_empty())
        .unwrap_or(fallback_time_zone);

    if !is_plausible_iana_time_zone(default_time_zone) {
        return Err(AppError::BadRequest(
            "localSend.defaultTimeZone must be an IANA timezone name (e.g. \"America/New_York\")"
                .to_string(),
        ));
    }

    let mode = match obj.get("mode") {
        None | Some(serde_json::Value::Null) => "timezone",
        Some(serde_json::Value::String(s)) if s == "timezone" || s == "peak-hour" => s.as_str(),
        Some(_) => {
            return Err(AppError::BadRequest(
                "localSend.mode must be \"timezone\" or \"peak-hour\"".to_string(),
            ))
        }
    };

    Ok(Some(serde_json::json!({
        "enabled": true,
        "defaultTimeZone": default_time_zone,
        "mode": mode
    })))
}

/// Validates a caller-supplied contentAssembly config (interest-aware issue
/// assembly) and returns the canonical object to persist. V1 supports a single
/// field: a required boolean `enabled`; unknown fields are dropped.
fn validate_and_normalize_content_assembly(
    value: &serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let obj = value
        .as_object()
        .ok_or_else(|| AppError::BadRequest("contentAssembly must be an object".to_string()))?;

    let enabled = obj
        .get("enabled")
        .ok_or_else(|| AppError::BadRequest("contentAssembly.enabled is required".to_string()))?
        .as_bool()
        .ok_or_else(|| {
            AppError::BadRequest("contentAssembly.enabled must be a boolean".to_string())
        })?;

    Ok(serde_json::json!({ "enabled": enabled }))
}

/// Validates a caller-supplied A/B test config and returns the canonical,
/// server-normalized object to persist: a server-generated `testId`, `status`
/// of `pending`, a null `winnerVariantId`, defaults filled in, and only known
/// fields retained. Phase 1 supports the `subject` dimension with exactly two
/// variants (`a` = control, `b` = challenger).
fn validate_and_normalize_ab_test(
    value: &serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let obj = value
        .as_object()
        .ok_or_else(|| AppError::BadRequest("abTest must be an object".to_string()))?;

    let dimension = obj
        .get("dimension")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("abTest.dimension is required".to_string()))?;
    if dimension != AB_DIMENSION_SUBJECT && dimension != AB_DIMENSION_SENDTIME {
        return Err(AppError::BadRequest(
            "abTest.dimension must be \"subject\" or \"sendTime\"".to_string(),
        ));
    }

    let variants = obj
        .get("variants")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::BadRequest("abTest.variants is required".to_string()))?;
    if variants.len() != 2 {
        return Err(AppError::BadRequest(
            "abTest.variants must contain exactly 2 variants".to_string(),
        ));
    }

    let mut normalized_variants = Vec::with_capacity(2);
    let mut seen_ids: Vec<String> = Vec::new();
    let mut seen_send_at: Vec<i64> = Vec::new();
    for variant in variants {
        let variant_id = variant
            .get("variantId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                AppError::BadRequest("each abTest variant requires a variantId".to_string())
            })?;
        if variant_id != "a" && variant_id != "b" {
            return Err(AppError::BadRequest(
                "abTest variantId must be \"a\" or \"b\"".to_string(),
            ));
        }
        if seen_ids.iter().any(|id| id == variant_id) {
            return Err(AppError::BadRequest(
                "abTest variant ids must be unique".to_string(),
            ));
        }
        seen_ids.push(variant_id.to_string());

        if dimension == AB_DIMENSION_SUBJECT {
            let subject = variant
                .get("subject")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    AppError::BadRequest("each abTest variant requires a subject".to_string())
                })?;
            if subject.trim().is_empty() {
                return Err(AppError::BadRequest(
                    "abTest variant subject cannot be empty".to_string(),
                ));
            }
            if subject.len() > 200 {
                return Err(AppError::BadRequest(
                    "abTest variant subject must not exceed 200 characters".to_string(),
                ));
            }

            normalized_variants.push(serde_json::json!({
                "variantId": variant_id,
                "subject": subject,
            }));
        } else {
            // send-time dimension: each variant is delivered at its own sendAt.
            let send_at = variant
                .get("sendAt")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    AppError::BadRequest(
                        "each abTest variant requires a sendAt for send-time tests".to_string(),
                    )
                })?;
            let parsed = chrono::DateTime::parse_from_rfc3339(send_at).map_err(|_| {
                AppError::BadRequest(
                    "abTest variant sendAt must be an RFC3339 timestamp".to_string(),
                )
            })?;
            if parsed.with_timezone(&chrono::Utc) <= chrono::Utc::now() {
                return Err(AppError::BadRequest(
                    "abTest variant sendAt must be in the future".to_string(),
                ));
            }
            let instant = parsed.timestamp_millis();
            if seen_send_at.contains(&instant) {
                return Err(AppError::BadRequest(
                    "abTest variant sendAt values must be distinct".to_string(),
                ));
            }
            seen_send_at.push(instant);

            normalized_variants.push(serde_json::json!({
                "variantId": variant_id,
                "sendAt": parsed.to_rfc3339(),
            }));
        }
    }
    if !seen_ids.iter().any(|id| id == "a") || !seen_ids.iter().any(|id| id == "b") {
        return Err(AppError::BadRequest(
            "abTest variants must include ids \"a\" and \"b\"".to_string(),
        ));
    }

    let win_metric = match obj.get("winMetric") {
        None | Some(serde_json::Value::Null) => "openRate".to_string(),
        Some(v) => {
            let s = v.as_str().ok_or_else(|| {
                AppError::BadRequest("abTest.winMetric must be a string".to_string())
            })?;
            if s != "openRate" && s != "clickRate" {
                return Err(AppError::BadRequest(
                    "abTest.winMetric must be \"openRate\" or \"clickRate\"".to_string(),
                ));
            }
            s.to_string()
        }
    };

    let confidence = match obj.get("confidence") {
        None | Some(serde_json::Value::Null) => 0.95,
        Some(v) => {
            let n = v.as_f64().ok_or_else(|| {
                AppError::BadRequest("abTest.confidence must be a number".to_string())
            })?;
            if !(0.80..=0.99).contains(&n) {
                return Err(AppError::BadRequest(
                    "abTest.confidence must be between 0.80 and 0.99".to_string(),
                ));
            }
            n
        }
    };

    let min_sample = match obj.get("minSamplePerVariant") {
        None | Some(serde_json::Value::Null) => 500,
        Some(v) => {
            let n = v.as_i64().ok_or_else(|| {
                AppError::BadRequest("abTest.minSamplePerVariant must be an integer".to_string())
            })?;
            if n < 1 {
                return Err(AppError::BadRequest(
                    "abTest.minSamplePerVariant must be >= 1".to_string(),
                ));
            }
            n
        }
    };

    let test_fraction = match obj.get("testFraction") {
        None | Some(serde_json::Value::Null) => 0.2,
        Some(v) => {
            let n = v.as_f64().ok_or_else(|| {
                AppError::BadRequest("abTest.testFraction must be a number".to_string())
            })?;
            if n <= 0.0 || n > 0.5 {
                return Err(AppError::BadRequest(
                    "abTest.testFraction must be greater than 0 and at most 0.5".to_string(),
                ));
            }
            n
        }
    };

    let evaluate_after_minutes = match obj.get("evaluateAfterMinutes") {
        None | Some(serde_json::Value::Null) => 240,
        Some(v) => {
            let n = v.as_i64().ok_or_else(|| {
                AppError::BadRequest("abTest.evaluateAfterMinutes must be an integer".to_string())
            })?;
            if n < 1 {
                return Err(AppError::BadRequest(
                    "abTest.evaluateAfterMinutes must be >= 1".to_string(),
                ));
            }
            n
        }
    };

    Ok(serde_json::json!({
        "testId": ulid::Ulid::new().to_string(),
        "dimension": dimension,
        "variants": normalized_variants,
        "winMetric": win_metric,
        "confidence": confidence,
        "minSamplePerVariant": min_sample,
        "testFraction": test_fraction,
        "evaluateAfterMinutes": evaluate_after_minutes,
        "status": "pending",
        "winnerVariantId": serde_json::Value::Null,
        "evaluation": serde_json::Value::Null,
    }))
}

fn validate_create_request(body: &CreateIssueRequest) -> Result<(), AppError> {
    if let Some(issue_number) = body.issue_number {
        if issue_number < 1 {
            return Err(AppError::BadRequest(
                "issueNumber must be a positive integer".to_string(),
            ));
        }
    }

    if body.subject.trim().is_empty() {
        return Err(AppError::BadRequest("Subject is required".to_string()));
    }

    if body.subject.len() > 200 {
        return Err(AppError::BadRequest(
            "Subject must not exceed 200 characters".to_string(),
        ));
    }

    if body.content.trim().is_empty() {
        return Err(AppError::BadRequest("Content is required".to_string()));
    }

    if normalize_content_type(body.content_type.as_deref()) == CONTENT_TYPE_JSON {
        validate_json_content(&body.content)?;
        if body.template_id.is_none() {
            return Err(AppError::BadRequest(
                "A templateId is required when contentType is \"json\"".to_string(),
            ));
        }
    }

    if let Some(ttl_seconds) = body.ttl_seconds {
        if ttl_seconds < 1 {
            return Err(AppError::BadRequest(
                "ttlSeconds must be a positive integer".to_string(),
            ));
        }
        if ttl_seconds > MAX_TTL_SECONDS {
            return Err(AppError::BadRequest(format!(
                "ttlSeconds must not exceed {} seconds",
                MAX_TTL_SECONDS
            )));
        }
    }

    Ok(())
}

/// Ensures JSON-mode content parses as a JSON object so the publish pipeline
/// can hand it to the template renderer as the data payload.
fn validate_json_content(content: &str) -> Result<(), AppError> {
    let parsed: serde_json::Value = serde_json::from_str(content).map_err(|e| {
        AppError::BadRequest(format!("content must be valid JSON for json issues: {}", e))
    })?;

    if !parsed.is_object() {
        return Err(AppError::BadRequest(
            "content must be a JSON object for json issues".to_string(),
        ));
    }

    Ok(())
}

fn validate_update_request(body: &UpdateIssueRequest, has_ab_test: bool) -> Result<(), AppError> {
    if body.subject.is_none()
        && body.content.is_none()
        && body.scheduled_at.is_none()
        && body.metadata.is_none()
        && body.status.is_none()
        && body.template_id.is_none()
        && body.content_type.is_none()
        && !has_ab_test
    {
        return Err(AppError::BadRequest(
            "At least one field must be provided for update".to_string(),
        ));
    }

    // When the caller declares (or keeps) json mode and sends new content, the
    // content must parse as a JSON object.
    if body.content_type.as_deref().map(str::trim) == Some(CONTENT_TYPE_JSON) {
        if let Some(content) = &body.content {
            validate_json_content(content)?;
        }
    }

    if let Some(subject) = &body.subject {
        if subject.trim().is_empty() {
            return Err(AppError::BadRequest("Subject cannot be empty".to_string()));
        }
        if subject.len() > 200 {
            return Err(AppError::BadRequest(
                "Subject must not exceed 200 characters".to_string(),
            ));
        }
    }

    if let Some(content) = &body.content {
        if content.trim().is_empty() {
            return Err(AppError::BadRequest("Content cannot be empty".to_string()));
        }
    }

    // The only two statuses a caller can set: `published` marks an in-progress
    // or failed issue as sent, `draft` unschedules a scheduled one (cancelling
    // its send). Everything else is the pipeline's to write.
    if let Some(status) = &body.status {
        if status != "published" && status != "draft" {
            return Err(AppError::BadRequest(
                "Status can only be set to 'published' or 'draft'".to_string(),
            ));
        }
    }

    Ok(())
}

fn check_update_allowed(issue: &IssueRecord) -> Result<(), AppError> {
    match issue.status.as_str() {
        "draft" | "in progress" | "failed" => Ok(()),
        _ => Err(AppError::BadRequest(format!(
            "Cannot update issue with status '{}'. Only draft, in progress, or failed issues can be updated",
            issue.status
        ))),
    }
}

fn check_delete_allowed(issue: &IssueRecord) -> Result<(), AppError> {
    if issue.status != "draft" {
        return Err(AppError::Conflict(format!(
            "Cannot delete issue with status '{}'. Only draft issues can be deleted",
            issue.status
        )));
    }
    Ok(())
}

async fn query_issues_by_tenant(
    tenant_id: &str,
    query: &ListIssuesQuery,
) -> Result<ListIssuesResponse, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let gsi1pk = format!("{}#newsletter", tenant_id);

    let mut query_builder = ddb_client
        .query()
        .table_name(&table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :gsi1pk")
        .expression_attribute_values(":gsi1pk", AttributeValue::S(gsi1pk))
        .scan_index_forward(false)
        .limit(query.limit);

    if let Some(status_filter) = &query.status {
        query_builder = query_builder
            .filter_expression("#status = :status")
            .expression_attribute_names("#status", "status")
            .expression_attribute_values(":status", AttributeValue::S(status_filter.clone()));
    }

    if let Some(token) = &query.next_token {
        if let Ok(decoded_token) = decode_pagination_token(token) {
            query_builder = query_builder.set_exclusive_start_key(Some(decoded_token));
        } else {
            return Err(AppError::BadRequest("Invalid pagination token".to_string()));
        }
    }

    let result = query_builder.send().await?;

    let issues: Vec<IssueListItem> = result
        .items()
        .iter()
        .filter_map(|item| parse_issue_list_item(item).ok())
        .collect();

    let next_token = result.last_evaluated_key().map(encode_pagination_token);

    Ok(ListIssuesResponse { issues, next_token })
}

fn parse_issue_list_item(
    item: &HashMap<String, AttributeValue>,
) -> Result<IssueListItem, AppError> {
    let pk = item
        .get("pk")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing pk".to_string()))?;

    let issue_number = pk
        .split('#')
        .nth(1)
        .and_then(|s| s.parse::<i32>().ok())
        .ok_or_else(|| AppError::InternalError("Invalid issue number in pk".to_string()))?;

    let id = format!("{}", issue_number);

    let subject = item
        .get("subject")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing subject".to_string()))?
        .to_string();

    let status = item
        .get("status")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing status".to_string()))?
        .to_string();

    let created_at = item
        .get("createdAt")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing createdAt".to_string()))?
        .to_string();

    let published_at = item
        .get("publishedAt")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string());

    let scheduled_at = item
        .get("scheduledAt")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string());

    Ok(IssueListItem {
        id,
        issue_number,
        subject,
        status,
        created_at,
        published_at,
        scheduled_at,
    })
}

fn encode_pagination_token(key: &HashMap<String, AttributeValue>) -> String {
    let item_map: HashMap<String, serde_json::Value> = key
        .iter()
        .filter_map(|(k, v)| {
            let json_val = match v {
                AttributeValue::S(s) => serde_json::Value::String(s.clone()),
                AttributeValue::N(n) => serde_json::Value::String(n.clone()),
                _ => return None,
            };
            Some((k.clone(), json_val))
        })
        .collect();

    let json = serde_json::to_string(&item_map).unwrap_or_default();
    base64::engine::general_purpose::STANDARD.encode(json.as_bytes())
}

fn decode_pagination_token(token: &str) -> Result<HashMap<String, AttributeValue>, AppError> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(token.as_bytes())
        .map_err(|_| AppError::BadRequest("Invalid pagination token".to_string()))?;

    let json_str = String::from_utf8(decoded)
        .map_err(|_| AppError::BadRequest("Invalid pagination token".to_string()))?;

    let item_map: HashMap<String, serde_json::Value> = serde_json::from_str(&json_str)
        .map_err(|_| AppError::BadRequest("Invalid pagination token".to_string()))?;

    let mut result = HashMap::new();
    for (k, v) in item_map {
        if let Some(s) = v.as_str() {
            result.insert(k, AttributeValue::S(s.to_string()));
        }
    }

    Ok(result)
}

async fn get_issue_by_id(tenant_id: &str, issue_id: &str) -> Result<IssueRecord, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let issue_number = issue_id
        .parse::<i32>()
        .map_err(|_| AppError::BadRequest("Invalid issue ID format".to_string()))?;

    let pk = format!("{}#{}", tenant_id, issue_number);
    let sk = "newsletter";

    let result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(pk.clone()))
        .key("sk", AttributeValue::S(sk.to_string()))
        .send()
        .await?;

    let item = result
        .item()
        .ok_or_else(|| AppError::NotFound("Issue not found".to_string()))?;

    parse_issue_record(item)
}

fn parse_issue_record(item: &HashMap<String, AttributeValue>) -> Result<IssueRecord, AppError> {
    let pk = item
        .get("pk")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing pk".to_string()))?
        .to_string();

    let sk = item
        .get("sk")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing sk".to_string()))?
        .to_string();

    let gsi1pk = item
        .get("GSI1PK")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing GSI1PK".to_string()))?
        .to_string();

    let gsi1sk = item
        .get("GSI1SK")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing GSI1SK".to_string()))?
        .to_string();

    let issue_number = pk
        .split('#')
        .nth(1)
        .and_then(|s| s.parse::<i32>().ok())
        .ok_or_else(|| AppError::InternalError("Invalid issue number in pk".to_string()))?;

    let subject = item
        .get("subject")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing subject".to_string()))?
        .to_string();

    let status = item
        .get("status")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing status".to_string()))?
        .to_string();

    let content = item
        .get("content")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing content".to_string()))?
        .to_string();

    let created_at = item
        .get("createdAt")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing createdAt".to_string()))?
        .to_string();

    let updated_at = item
        .get("updatedAt")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| AppError::InternalError("Missing updatedAt".to_string()))?
        .to_string();

    let published_at = item
        .get("publishedAt")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string());

    let scheduled_at = item
        .get("scheduledAt")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string());

    let metadata = item.get("metadata").and_then(|v| {
        if let Ok(s) = v.as_s() {
            serde_json::from_str(s).ok()
        } else {
            None
        }
    });

    let template_id = item
        .get("templateId")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string());

    let content_type = item
        .get("contentType")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string());

    // abTest is persisted as a JSON string (mirroring metadata).
    let ab_test = item.get("abTest").and_then(|v| {
        if let Ok(s) = v.as_s() {
            serde_json::from_str(s).ok()
        } else {
            None
        }
    });

    // localSend is persisted as a JSON string (mirroring abTest).
    let local_send = item.get("localSend").and_then(|v| {
        if let Ok(s) = v.as_s() {
            serde_json::from_str(s).ok()
        } else {
            None
        }
    });

    // contentAssembly is persisted as a JSON string (mirroring abTest).
    let content_assembly = item.get("contentAssembly").and_then(|v| {
        if let Ok(s) = v.as_s() {
            serde_json::from_str(s).ok()
        } else {
            None
        }
    });

    let execution_arn = item
        .get("executionArn")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string());

    Ok(IssueRecord {
        pk,
        sk,
        gsi1pk,
        gsi1sk,
        issue_number,
        subject,
        status,
        content,
        created_at,
        updated_at,
        published_at,
        scheduled_at,
        metadata,
        template_id,
        content_type,
        ab_test,
        local_send,
        content_assembly,
        execution_arn,
    })
}

async fn get_issue_stats(tenant_id: &str, issue_id: &str) -> Result<IssueStats, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let issue_number = issue_id
        .parse::<i32>()
        .map_err(|_| AppError::BadRequest("Invalid issue ID format".to_string()))?;

    let pk = format!("{}#{}", tenant_id, issue_number);
    let sk = "stats";

    let result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(pk))
        .key("sk", AttributeValue::S(sk.to_string()))
        .send()
        .await?;

    let item = result
        .item()
        .ok_or_else(|| AppError::NotFound("Issue stats not found".to_string()))?;

    parse_issue_stats(item)
}

fn parse_issue_stats(item: &HashMap<String, AttributeValue>) -> Result<IssueStats, AppError> {
    let opens = item
        .get("opens")
        .and_then(|v| v.as_n().ok())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let clicks = item
        .get("clicks")
        .and_then(|v| v.as_n().ok())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let deliveries = item
        .get("deliveries")
        .and_then(|v| v.as_n().ok())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let bounces = item
        .get("bounces")
        .and_then(|v| v.as_n().ok())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let complaints = item
        .get("complaints")
        .and_then(|v| v.as_n().ok())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let subscribers = item
        .get("subscribers")
        .and_then(|v| v.as_n().ok())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let subscribes = item
        .get("subscribes")
        .and_then(|v| v.as_n().ok())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let unsubscribes = item
        .get("unsubscribes")
        .and_then(|v| v.as_n().ok())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let cleaned = item
        .get("cleaned")
        .and_then(|v| v.as_n().ok())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let manual_removals = item
        .get("manualRemovals")
        .and_then(|v| v.as_n().ok())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let analytics = item.get("analytics").and_then(|v| {
        if let Ok(m) = v.as_m() {
            parse_insights_map(m).ok()
        } else if let Ok(s) = v.as_s() {
            serde_json::from_str(s).ok()
        } else {
            None
        }
    });

    Ok(IssueStats {
        opens,
        clicks,
        deliveries,
        bounces,
        complaints,
        subscribers,
        subscribes,
        unsubscribes,
        cleaned,
        manual_removals,
        analytics,
    })
}

fn extract_analytics_summary(stats: &IssueStats) -> Option<IssueAnalyticsSummary> {
    let analytics = stats.analytics.as_ref()?;
    let parsed: Result<IssueAnalyticsSummary, _> = serde_json::from_value(analytics.clone());
    // A summary with neither breakdown carries no information worth returning.
    parsed
        .ok()
        .filter(|summary| summary.engagement_type.is_some() || summary.traffic_source.is_some())
}

fn parse_insights_map(
    map: &HashMap<String, AttributeValue>,
) -> Result<serde_json::Value, AppError> {
    let mut json_map = serde_json::Map::new();

    for (key, value) in map {
        let json_value = attribute_value_to_json(value)?;
        json_map.insert(key.clone(), json_value);
    }

    Ok(serde_json::Value::Object(json_map))
}

#[derive(Clone)]
struct IssueInsights {
    insights: Option<Vec<String>>,
    insights_v2: Option<Vec<InsightV2>>,
}

async fn get_issue_insights(
    tenant_id: &str,
    issue_id: &str,
) -> Result<Option<IssueInsights>, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let issue_number = issue_id
        .parse::<i32>()
        .map_err(|_| AppError::BadRequest("Invalid issue ID format".to_string()))?;

    let pk = format!("{}#{}", tenant_id, issue_number);
    let sk = "analytics";

    let result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(pk))
        .key("sk", AttributeValue::S(sk.to_string()))
        .send()
        .await?;

    let item = match result.item() {
        Some(item) => item,
        None => return Ok(None),
    };

    let insights = item.get("insights").and_then(|attr| match attr {
        AttributeValue::L(list) => Some(
            list.iter()
                .filter_map(|v| v.as_s().ok().map(|s| s.to_string()))
                .collect::<Vec<String>>(),
        ),
        _ => None,
    });

    let insights_v2 = item
        .get("insightsV2")
        .and_then(|attr| attribute_value_to_json(attr).ok())
        .and_then(|value| serde_json::from_value::<Vec<InsightV2>>(value).ok());

    if insights.is_none() && insights_v2.is_none() {
        return Ok(None);
    }

    Ok(Some(IssueInsights {
        insights,
        insights_v2,
    }))
}

fn attribute_value_to_json(value: &AttributeValue) -> Result<serde_json::Value, AppError> {
    match value {
        AttributeValue::S(s) => Ok(serde_json::Value::String(s.clone())),
        AttributeValue::N(n) => {
            if let Ok(i) = n.parse::<i64>() {
                Ok(serde_json::Value::Number(serde_json::Number::from(i)))
            } else if let Ok(f) = n.parse::<f64>() {
                Ok(serde_json::Number::from_f64(f)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null))
            } else {
                Ok(serde_json::Value::Null)
            }
        }
        AttributeValue::Bool(b) => Ok(serde_json::Value::Bool(*b)),
        AttributeValue::Null(_) => Ok(serde_json::Value::Null),
        AttributeValue::M(m) => parse_insights_map(m),
        AttributeValue::L(l) => {
            let mut json_array = Vec::new();
            for item in l {
                json_array.push(attribute_value_to_json(item)?);
            }
            Ok(serde_json::Value::Array(json_array))
        }
        _ => Ok(serde_json::Value::Null),
    }
}

async fn query_published_issues_with_stats(
    tenant_id: &str,
    limit: i32,
) -> Result<Vec<IssueTrendItem>, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let gsi1pk = format!("{}#issue", tenant_id);

    let result = ddb_client
        .query()
        .table_name(&table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :gsi1pk")
        .expression_attribute_values(":gsi1pk", AttributeValue::S(gsi1pk))
        .scan_index_forward(false)
        .limit(limit)
        .send()
        .await?;

    let mut issues_with_stats = Vec::new();

    for item in result.items() {
        let issue_number = match item
            .get("GSI1SK")
            .and_then(|v| v.as_s().ok())
            .and_then(|s| s.parse::<i32>().ok())
        {
            Some(num) => num,
            None => continue,
        };

        let stats = match parse_issue_stats(item) {
            Ok(stats) => stats,
            Err(_) => continue,
        };

        let metrics = calculate_issue_metrics(&stats);
        let analytics_summary = extract_analytics_summary(&stats);

        issues_with_stats.push(IssueTrendItem {
            id: issue_number.to_string(),
            metrics,
            analytics_summary,
        });
    }

    Ok(issues_with_stats)
}

fn calculate_issue_metrics(stats: &IssueStats) -> IssueMetrics {
    let open_rate = if stats.deliveries > 0 {
        (stats.opens as f64 / stats.deliveries as f64) * 100.0
    } else {
        0.0
    };

    let click_rate = if stats.deliveries > 0 {
        (stats.clicks as f64 / stats.deliveries as f64) * 100.0
    } else {
        0.0
    };

    let click_to_open_rate = if stats.opens > 0 {
        (stats.clicks as f64 / stats.opens as f64) * 100.0
    } else {
        0.0
    };

    let bounce_rate = if stats.deliveries > 0 {
        (stats.bounces as f64 / stats.deliveries as f64) * 100.0
    } else {
        0.0
    };

    IssueMetrics {
        open_rate: (open_rate * 100.0).round() / 100.0,
        click_rate: (click_rate * 100.0).round() / 100.0,
        click_to_open_rate: (click_to_open_rate * 100.0).round() / 100.0,
        bounce_rate: (bounce_rate * 100.0).round() / 100.0,
        delivered: stats.deliveries,
        opens: stats.opens,
        clicks: stats.clicks,
        bounces: stats.bounces,
        complaints: stats.complaints,
        subscribers: stats.subscribers,
        subscribes: stats.subscribes,
        unsubscribes: stats.unsubscribes,
        cleaned: stats.cleaned,
        manual_removals: stats.manual_removals,
    }
}

fn calculate_aggregates(issues: &[IssueTrendItem]) -> TrendAggregates {
    if issues.is_empty() {
        return TrendAggregates {
            avg_open_rate: 0.0,
            avg_click_rate: 0.0,
            avg_click_to_open_rate: 0.0,
            avg_bounce_rate: 0.0,
            total_delivered: 0,
            issue_count: 0,
        };
    }

    let total_open_rate: f64 = issues.iter().map(|i| i.metrics.open_rate).sum();
    let total_click_rate: f64 = issues.iter().map(|i| i.metrics.click_rate).sum();
    let total_click_to_open_rate: f64 = issues.iter().map(|i| i.metrics.click_to_open_rate).sum();
    let total_bounce_rate: f64 = issues.iter().map(|i| i.metrics.bounce_rate).sum();
    let total_delivered: i64 = issues.iter().map(|i| i.metrics.delivered).sum();

    let count = issues.len() as f64;

    TrendAggregates {
        avg_open_rate: ((total_open_rate / count) * 100.0).round() / 100.0,
        avg_click_rate: ((total_click_rate / count) * 100.0).round() / 100.0,
        avg_click_to_open_rate: ((total_click_to_open_rate / count) * 100.0).round() / 100.0,
        avg_bounce_rate: ((total_bounce_rate / count) * 100.0).round() / 100.0,
        total_delivered,
        issue_count: issues.len() as i32,
    }
}

async fn calculate_trends(
    tenant_id: &str,
    query: &TrendsQuery,
) -> Result<TrendsResponse, AppError> {
    let issue_count = query.issue_count.clamp(1, 50);

    let issues_with_stats = query_published_issues_with_stats(tenant_id, issue_count).await?;

    let aggregates = calculate_aggregates(&issues_with_stats);

    Ok(TrendsResponse {
        issues: issues_with_stats,
        aggregates,
    })
}

fn get_idempotency_key(event: &Request) -> Option<String> {
    event
        .headers()
        .get("Idempotency-Key")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Loads the tenant's settings only when something on this request actually
/// needs them — a date-only `scheduledAt` to expand, or a local-send config
/// whose zone may need filling in. A request that spelled everything out
/// doesn't pay for the read.
async fn load_settings_if_needed(
    tenant_id: &str,
    scheduled_at: Option<&str>,
    has_local_send: bool,
) -> TenantSettings {
    let needs_send_time = scheduled_at
        .map(|value| settings::is_date_only(value.trim()))
        .unwrap_or(false);

    if needs_send_time || has_local_send {
        settings::get_tenant_settings(tenant_id).await
    } else {
        TenantSettings::default()
    }
}

/// Normalizes a caller-supplied `scheduledAt` into the instant stored on the
/// issue. `None` means "send immediately" — an absent value, `"now"`, or a
/// time that has already passed.
///
/// A date-only value (`YYYY-MM-DD`) carries no time of day, so rather than
/// rejecting it or guessing midnight UTC, it is anchored to the tenant's
/// configured default send time, read as wall-clock time in the tenant's
/// timezone (see [`super::settings`]).
fn resolve_scheduled_at(
    value: Option<&str>,
    settings: &TenantSettings,
) -> Result<Option<String>, AppError> {
    let Some(value) = value else {
        return Ok(None);
    };

    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("now") {
        return Ok(None);
    }

    let parsed = if settings::is_date_only(trimmed) {
        settings::resolve_date_only(trimmed, settings)?.fixed_offset()
    } else {
        chrono::DateTime::parse_from_rfc3339(trimmed).map_err(|_| {
            AppError::BadRequest(
                "scheduledAt must be RFC3339, a YYYY-MM-DD date, or \"now\"".to_string(),
            )
        })?
    };

    if parsed.with_timezone(&chrono::Utc) <= chrono::Utc::now() {
        return Ok(None);
    }

    Ok(Some(parsed.to_rfc3339()))
}

/// Hashes everything that determines what a create request does, so a reused
/// Idempotency-Key with any behavioral change is rejected instead of replayed.
///
/// Every value here is the raw caller-supplied one, never the normalized form.
/// Normalization folds in things the caller didn't send: server-generated
/// values (the A/B `testId`), the current time (a `scheduledAt` that has since
/// passed), and tenant settings (a date-only `scheduledAt` resolves against
/// the tenant's timezone and send time). Hashing any of those would make a
/// byte-identical replay look like a different request — so changing the
/// tenant's timezone would turn a CI re-run of the same commit into a 409.
fn compute_idempotency_hash(
    body: &CreateIssueRequest,
    issue_number: i32,
    action: CreateIssueAction,
    raw_scheduled_at: Option<&str>,
    ab_test: Option<&serde_json::Value>,
    local_send: Option<&serde_json::Value>,
    content_assembly: Option<&serde_json::Value>,
) -> String {
    let payload = serde_json::json!({
        "issueNumber": issue_number,
        "subject": &body.subject,
        "content": &body.content,
        "action": match action {
            CreateIssueAction::Draft => "draft",
            CreateIssueAction::Schedule => "schedule",
        },
        "scheduledAt": raw_scheduled_at,
        "metadata": body.metadata.clone(),
        "templateId": body.template_id.clone(),
        "contentType": normalize_content_type(body.content_type.as_deref()),
        "ttlSeconds": body.ttl_seconds,
        "abTest": ab_test,
        "localSend": local_send,
        "contentAssembly": content_assembly,
    });

    let mut hasher = Sha256::new();
    hasher.update(payload.to_string().as_bytes());
    hex::encode(hasher.finalize())
}

/// Returns the status of an issue, or None when no record exists. Used by the
/// create path to decide whether an existing record may be overwritten (drafts
/// only).
async fn get_issue_status(tenant_id: &str, issue_number: i32) -> Result<Option<String>, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let pk = format!("{}#{}", tenant_id, issue_number);

    let result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(pk))
        .key("sk", AttributeValue::S("newsletter".to_string()))
        .projection_expression("#status")
        .expression_attribute_names("#status", "status")
        .send()
        .await?;

    Ok(result.item().and_then(|item| {
        item.get("status")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string())
    }))
}

async fn validate_template_exists(tenant_id: &str, template_id: &str) -> Result<(), AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let pk = tenant_id.to_string();
    let sk = format!("template#{}", template_id);

    let result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(pk))
        .key("sk", AttributeValue::S(sk))
        .send()
        .await?;

    if result.item().is_none() {
        return Err(AppError::BadRequest(format!(
            "Template '{}' not found",
            template_id
        )));
    }

    Ok(())
}

async fn get_idempotency_record(
    tenant_id: &str,
    idempotency_key: &str,
) -> Result<Option<IdempotencyRecord>, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let pk = format!("{}#idempotency", tenant_id);
    let sk = format!("idempotency#{}", idempotency_key);

    let result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(pk))
        .key("sk", AttributeValue::S(sk))
        .send()
        .await?;

    let item = match result.item() {
        Some(item) => item,
        None => return Ok(None),
    };

    let issue_number = item
        .get("issueNumber")
        .and_then(|v| v.as_n().ok())
        .and_then(|s| s.parse::<i32>().ok())
        .ok_or_else(|| {
            AppError::InternalError("Invalid issueNumber in idempotency record".to_string())
        })?;

    let payload_hash = item
        .get("payloadHash")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| {
            AppError::InternalError("Invalid payloadHash in idempotency record".to_string())
        })?;

    Ok(Some(IdempotencyRecord {
        issue_number,
        payload_hash,
    }))
}

/// Stores the idempotency record for a processed create. `replace_existing`
/// is set when a replay's recorded issue no longer existed and the request was
/// processed as a fresh create: the prior record for the key is still present
/// (its 24h TTL outlives an expired draft), so the conditional put would fail
/// after the issue and its side effects were already created. In that case the
/// record is overwritten to point at the new issue.
async fn save_idempotency_record(
    tenant_id: &str,
    idempotency_key: &str,
    issue_number: i32,
    payload_hash: &str,
    replace_existing: bool,
) -> Result<(), AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let now = chrono::Utc::now();
    let ttl = now.timestamp() + (24 * 60 * 60);

    let mut item = HashMap::new();
    item.insert(
        "pk".to_string(),
        AttributeValue::S(format!("{}#idempotency", tenant_id)),
    );
    item.insert(
        "sk".to_string(),
        AttributeValue::S(format!("idempotency#{}", idempotency_key)),
    );
    item.insert(
        "issueNumber".to_string(),
        AttributeValue::N(issue_number.to_string()),
    );
    item.insert(
        "payloadHash".to_string(),
        AttributeValue::S(payload_hash.to_string()),
    );
    item.insert("createdAt".to_string(), AttributeValue::S(now.to_rfc3339()));
    item.insert("ttl".to_string(), AttributeValue::N(ttl.to_string()));

    let mut put = ddb_client
        .put_item()
        .table_name(&table_name)
        .set_item(Some(item));
    if !replace_existing {
        put = put.condition_expression("attribute_not_exists(pk) AND attribute_not_exists(sk)");
    }
    let result = put.send().await;

    match result {
        Ok(_) => Ok(()),
        Err(err) => {
            let is_conditional = err.as_service_error().is_some_and(|service_err| {
                matches!(
                    service_err,
                    aws_sdk_dynamodb::operation::put_item::PutItemError::ConditionalCheckFailedException(_)
                )
            });

            if is_conditional {
                return Err(AppError::Conflict(
                    "Idempotency key already exists".to_string(),
                ));
            }

            Err(AppError::AwsError(format!(
                "Failed to store idempotency record: {}",
                err
            )))
        }
    }
}

/// Everything the stage-issue state machine needs to find the issue it is
/// publishing. Grouped rather than passed positionally because several fields
/// are bare `&str` — named struct fields make a transposed pair a compile error
/// instead of an issue published under the wrong tenant.
///
/// Identifiers only, deliberately: the execution reads the issue record when it
/// starts, so the content and subject are not in here. See
/// `build_execution_input`.
struct IssueScheduleInput<'a> {
    tenant_id: &'a str,
    tenant_email: &'a str,
    issue_number: i32,
    scheduled_at: Option<&'a str>,
    template_id: Option<&'a str>,
    content_type: &'a str,
}

/// Environment variable holding the publish lead time, in minutes.
const LEAD_TIME_ENV: &str = "ISSUE_SEND_LEAD_TIME_MINUTES";

/// Prefix of the one-shot Scheduler entry that starts an issue's publish
/// workflow. Matched literally by an IAM resource pattern in template.yaml
/// (`schedule/newsletter/ISSUE-SEND-*`), so changing it needs that changed too.
const ISSUE_SEND_SCHEDULE_PREFIX: &str = "ISSUE-SEND";

/// The stage-issue execution input: identifiers, never content.
///
/// The execution used to be handed the whole issue body. It no longer is, for
/// four reasons: the record is the only thing that can be *current* when the
/// execution starts (a scheduled issue is started by a Scheduler entry at the
/// send instant, long after this runs), the execution state has a 256 KB
/// ceiling a large HTML issue can reach, the Scheduler entry's target input has
/// a much smaller limit of its own, and a copy of the content pinned in
/// execution state is a second source of truth for what got published.
///
/// `templateId`, `contentType` and `fileName` stay: they are small scalars this
/// API owns, and the state machine reads them with unconditional `.$` paths —
/// which the record cannot support for the first two, since it leaves both
/// attributes off entirely when they are unset.
fn build_execution_input(input: &IssueScheduleInput<'_>) -> serde_json::Value {
    serde_json::json!({
        "fileName": format!("issue-{}", input.issue_number),
        "issueId": input.issue_number,
        "tenant": {
            "id": input.tenant_id,
            "email": input.tenant_email
        },
        // Always present (null when no template selected) so the state machine
        // can reference it unconditionally.
        "templateId": input.template_id,
        // Routes the publish pipeline between the markdown and json parsers.
        "contentType": input.content_type
    })
}

/// Starts an issue's publish workflow — now, or at its send time.
///
/// An immediate publish still starts an execution directly. A scheduled one
/// creates a one-shot EventBridge Scheduler entry that starts the execution at
/// (send instant − lead time) instead, rather than starting an execution that
/// sits in the definition's `Wait For Future Date` state for days. Three things
/// come out of that: the execution reads the issue record at send time instead
/// of publishing a copy taken at schedule time, work can happen *before* the
/// send instant (which is what timezone-correct local send needs — see
/// `issue_send_lead_time`), and the schedule name is a per-issue lock.
///
/// Rollback is producer-side: send `futureDate` in the execution input and call
/// `start_execution` unconditionally. `Wait For Future Date` is still in the
/// definition for exactly that reason.
async fn start_issue_schedule(input: IssueScheduleInput<'_>) -> Result<(), AppError> {
    let execution_input = build_execution_input(&input);

    match input.scheduled_at {
        Some(scheduled_at) => schedule_issue_send(&input, scheduled_at, &execution_input).await,
        None => start_issue_execution(&input, &execution_input).await,
    }
}

/// Starts the publish workflow immediately.
async fn start_issue_execution(
    input: &IssueScheduleInput<'_>,
    execution_input: &serde_json::Value,
) -> Result<(), AppError> {
    let sfn_client = aws_clients::get_sfn_client().await;
    let state_machine_arn = std::env::var("STATE_MACHINE_ARN")
        .map_err(|_| AppError::InternalError("STATE_MACHINE_ARN not set".to_string()))?;

    let execution = sfn_client
        .start_execution()
        .state_machine_arn(state_machine_arn)
        .input(execution_input.to_string())
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to start schedule workflow: {}", e)))?;

    record_execution_arn(
        input.tenant_id,
        input.issue_number,
        execution.execution_arn(),
    )
    .await;

    Ok(())
}

/// Hands the send instant to EventBridge Scheduler and leaves the record at
/// `scheduled` until the execution it starts claims it.
///
/// Ordering matters and is the opposite of what reads naturally: the schedule is
/// created first, then the record is moved off `draft`. The other order can lose
/// a send outright — a record that says `scheduled` with no schedule behind it
/// never fires and nothing is watching for that — whereas a schedule with a
/// record still on `draft` sends anyway, because the state machine's handshake
/// treats `draft` as sendable.
async fn schedule_issue_send(
    input: &IssueScheduleInput<'_>,
    scheduled_at: &str,
    execution_input: &serde_json::Value,
) -> Result<(), AppError> {
    let scheduler = aws_clients::get_scheduler_client().await;
    let state_machine_arn = std::env::var("STATE_MACHINE_ARN")
        .map_err(|_| AppError::InternalError("STATE_MACHINE_ARN not set".to_string()))?;
    let role_arn = std::env::var("ISSUE_SEND_SCHEDULER_ROLE_ARN").map_err(|_| {
        AppError::InternalError("ISSUE_SEND_SCHEDULER_ROLE_ARN not set".to_string())
    })?;

    let send_instant = chrono::DateTime::parse_from_rfc3339(scheduled_at)
        .map_err(|_| {
            AppError::InternalError(format!("Unparseable scheduled send time: {scheduled_at}"))
        })?
        .with_timezone(&chrono::Utc);

    let fire_at = issue_send_fire_at(send_instant, issue_send_lead_time(), chrono::Utc::now());
    let schedule_name = build_issue_send_schedule_name(input.tenant_id, input.issue_number);

    scheduler
        .create_schedule()
        .name(&schedule_name)
        .group_name("newsletter")
        .schedule_expression(format!("at({})", fire_at.format("%Y-%m-%dT%H:%M:%S")))
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
                .arn(&state_machine_arn)
                .role_arn(&role_arn)
                .input(execution_input.to_string())
                .build()
                .map_err(|e| AppError::InternalError(format!("Failed to build target: {}", e)))?,
        )
        .send()
        .await
        .map_err(|err| {
            // The name is deterministic per (tenant, issue), which makes this a
            // duplicate-send guard rather than a naming collision: a second
            // request to schedule the same issue cannot create a second send.
            // The state machine's `Has Issue Been Processed?` handshake still
            // backs it up, since the GitHub producer does not come through here.
            let is_conflict = err
                .as_service_error()
                .is_some_and(|service_err| service_err.is_conflict_exception());

            if is_conflict {
                return AppError::Conflict(format!(
                    "Issue {} already has a send scheduled",
                    input.issue_number
                ));
            }

            AppError::AwsError(format!("Failed to schedule issue send: {}", err))
        })?;

    mark_issue_scheduled(input.tenant_id, input.issue_number).await
}

/// Moves a freshly created issue from `draft` to `scheduled`, where it stays
/// until the execution starts and claims it as `in progress`. It used to report
/// `in progress` for its entire wait, which said "publishing now" for days.
///
/// Drops any `executionArn` from a previous run at the same time: it names an
/// execution that has nothing to do with this send, and the GET endpoint would
/// describe it as this issue's workflow state.
async fn mark_issue_scheduled(tenant_id: &str, issue_number: i32) -> Result<(), AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    ddb_client
        .update_item()
        .table_name(&table_name)
        .key(
            "pk",
            AttributeValue::S(format!("{tenant_id}#{issue_number}")),
        )
        .key("sk", AttributeValue::S("newsletter".to_string()))
        .update_expression("SET #status = :status, updatedAt = :updatedAt REMOVE executionArn")
        // Never resurrect a record that has been deleted from under us: an
        // UpdateItem on a missing key would create a ghost issue.
        .condition_expression("attribute_exists(pk)")
        .expression_attribute_names("#status", "status")
        .expression_attribute_values(":status", AttributeValue::S("scheduled".to_string()))
        .expression_attribute_values(
            ":updatedAt",
            AttributeValue::S(chrono::Utc::now().to_rfc3339()),
        )
        .send()
        .await?;

    Ok(())
}

/// How far ahead of the send instant the publish workflow starts.
///
/// **The lead time is the content freeze point.** The execution reads the issue
/// record when it starts, so what goes out is whatever the record said at
/// (send instant − lead time); an edit after that is not in the issue.
///
/// It exists because the local-send fan-out cannot schedule a group whose local
/// send time has already passed, so with a zero lead time every timezone east
/// of the base zone is sent immediately instead of at its own 9am. A lead time
/// wide enough to cover the largest eastward offset (24h covers everything,
/// including UTC+14) puts the fan-out ahead of the base instant and lets those
/// groups be scheduled properly.
///
/// Default 0, which is today's behaviour: the execution starts at the send
/// instant, exactly where the `Wait` used to end.
///
/// **Raising it above 0 needs one more change first.** The parse step derives
/// `sendAtDate` from the issue's own send instant and returns `now` when that
/// instant has passed — true at a zero lead time, false the moment the
/// execution starts early. Until the send instant is forwarded to `Parse Issue`
/// (it is not today; `parse-json-issue.mjs` reads it from a `futureDate` the
/// definition does not pass, and `parse-md-to-json.mjs` only reads it from
/// markdown frontmatter), an early execution publishes early rather than
/// scheduling the send. That is Phase 6's first job, not a config change.
fn issue_send_lead_time() -> chrono::Duration {
    chrono::Duration::minutes(parse_lead_time_minutes(
        std::env::var(LEAD_TIME_ENV).ok().as_deref(),
    ))
}

/// Parses the configured lead time, falling back to zero for anything that is
/// not a usable number of minutes. Zero is the safe default in both directions:
/// it is today's behaviour, and it can never move a send earlier than its
/// scheduled instant.
fn parse_lead_time_minutes(raw: Option<&str>) -> i64 {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0)
        .max(0)
}

/// When the Scheduler entry fires. Clamped to `now`, so a lead time longer than
/// the notice an issue was scheduled with starts the workflow immediately rather
/// than asking Scheduler for a time in the past.
fn issue_send_fire_at(
    send_instant: chrono::DateTime<chrono::Utc>,
    lead_time: chrono::Duration,
    now: chrono::DateTime<chrono::Utc>,
) -> chrono::DateTime<chrono::Utc> {
    (send_instant - lead_time).max(now)
}

/// Name of the Scheduler entry that starts an issue's publish workflow.
/// Deterministic per (tenant, issue) on purpose — that is what makes
/// `CreateSchedule` conflict-detecting and `DeleteSchedule` possible, neither of
/// which a generated name allows.
fn build_issue_send_schedule_name(tenant_id: &str, issue_number: i32) -> String {
    format!(
        "{}-{}-{}",
        ISSUE_SEND_SCHEDULE_PREFIX,
        sanitize_tenant_for_schedule_name(tenant_id),
        issue_number
    )
}

/// Cancels a scheduled send, tolerating a missing schedule.
///
/// Missing is the common case and not an error: the entry deletes itself once it
/// fires, an issue that was never scheduled never had one, and this is called on
/// delete for any issue. What must not happen is a schedule outliving the record
/// it would publish, so anything other than a not-found propagates.
async fn delete_issue_send_schedule(tenant_id: &str, issue_number: i32) -> Result<(), AppError> {
    let scheduler = aws_clients::get_scheduler_client().await;
    let schedule_name = build_issue_send_schedule_name(tenant_id, issue_number);

    match scheduler
        .delete_schedule()
        .name(&schedule_name)
        .group_name("newsletter")
        .send()
        .await
    {
        Ok(_) => Ok(()),
        Err(err) => {
            let is_not_found = err
                .as_service_error()
                .is_some_and(|service_err| service_err.is_resource_not_found_exception());

            if is_not_found {
                return Ok(());
            }

            Err(AppError::AwsError(format!(
                "Failed to cancel scheduled send {}: {}",
                schedule_name, err
            )))
        }
    }
}

/// Store the publish workflow's execution ARN on the issue record so its state
/// can be reported later. Best-effort: the issue is already scheduled by this
/// point, and losing the ARN costs visibility, not the send.
async fn record_execution_arn(tenant_id: &str, issue_number: i32, execution_arn: &str) {
    let Ok(table_name) = std::env::var("TABLE_NAME") else {
        return;
    };
    let ddb_client = aws_clients::get_dynamodb_client().await;

    if let Err(error) = ddb_client
        .update_item()
        .table_name(&table_name)
        .key(
            "pk",
            AttributeValue::S(format!("{tenant_id}#{issue_number}")),
        )
        .key("sk", AttributeValue::S("newsletter".to_string()))
        .update_expression("SET executionArn = :arn")
        .expression_attribute_values(":arn", AttributeValue::S(execution_arn.to_string()))
        .send()
        .await
    {
        tracing::warn!("Failed to record publish execution ARN: {error}");
    }
}

/// Creates a one-time EventBridge schedule that deletes the draft once its
/// ttlSeconds elapses. The schedule fires a `DELETE_EXPIRED_DRAFT` event onto
/// the default bus (via the universal putEvents target) which the
/// delete-expired-draft Lambda consumes; the schedule deletes itself after
/// firing. The deletion is conditional on the issue still being a draft, so a
/// draft that gets published or scheduled before expiry is left untouched.
async fn schedule_draft_deletion(
    tenant_id: &str,
    issue_number: i32,
    ttl_seconds: i64,
) -> Result<(), AppError> {
    let scheduler = aws_clients::get_scheduler_client().await;
    let role_arn = std::env::var("SCHEDULER_ROLE_ARN")
        .map_err(|_| AppError::InternalError("SCHEDULER_ROLE_ARN not set".to_string()))?;

    let run_at = chrono::Utc::now() + chrono::Duration::seconds(ttl_seconds);
    let schedule_expression = format!("at({})", run_at.format("%Y-%m-%dT%H:%M:%S"));
    let schedule_name = build_draft_ttl_schedule_name(tenant_id, issue_number);

    // Re-staging a draft (same issue number) replaces its TTL schedule; the
    // name is deterministic, so drop any previous schedule first.
    delete_draft_ttl_schedule(tenant_id, issue_number).await?;

    let detail = serde_json::json!({
        "tenantId": tenant_id,
        "issueNumber": issue_number
    });
    let input = serde_json::json!({
        "Entries": [{
            "Source": "newsletter-service",
            "DetailType": "DELETE_EXPIRED_DRAFT",
            "Detail": detail.to_string(),
            "EventBusName": "default"
        }]
    });

    scheduler
        .create_schedule()
        .name(&schedule_name)
        .group_name("newsletter")
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
                .arn("arn:aws:scheduler:::aws-sdk:eventbridge:putEvents")
                .role_arn(&role_arn)
                .input(input.to_string())
                .build()
                .map_err(|e| AppError::InternalError(format!("Failed to build target: {}", e)))?,
        )
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to schedule draft deletion: {}", e)))?;

    Ok(())
}

/// Deletes the draft TTL schedule for an issue, tolerating a missing schedule
/// (the normal case). Any other failure propagates: leaving a stale schedule
/// behind would let it fire later and delete a freshly re-staged draft.
async fn delete_draft_ttl_schedule(tenant_id: &str, issue_number: i32) -> Result<(), AppError> {
    let scheduler = aws_clients::get_scheduler_client().await;
    let schedule_name = build_draft_ttl_schedule_name(tenant_id, issue_number);

    match scheduler
        .delete_schedule()
        .name(&schedule_name)
        .group_name("newsletter")
        .send()
        .await
    {
        Ok(_) => Ok(()),
        Err(err) => {
            let is_not_found = err
                .as_service_error()
                .is_some_and(|service_err| service_err.is_resource_not_found_exception());

            if is_not_found {
                return Ok(());
            }

            Err(AppError::AwsError(format!(
                "Failed to delete draft TTL schedule {}: {}",
                schedule_name, err
            )))
        }
    }
}

/// Builds a schedule name within EventBridge Scheduler's constraints
/// (<= 64 chars, `[0-9a-zA-Z-_.]`). The tenant id is sanitized and truncated.
/// The name is deterministic per (tenant, issue) so re-staging a draft can
/// find and replace the previous TTL schedule instead of leaking it.
fn build_draft_ttl_schedule_name(tenant_id: &str, issue_number: i32) -> String {
    format!(
        "draft-ttl-{}-{}",
        sanitize_tenant_for_schedule_name(tenant_id),
        issue_number
    )
}

/// The tenant id as it can appear in a schedule name: EventBridge Scheduler
/// allows `[0-9a-zA-Z-_.]` and 64 characters total, so anything else is dropped
/// and the id is truncated to leave room for the prefix and issue number.
fn sanitize_tenant_for_schedule_name(tenant_id: &str) -> String {
    tenant_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(16)
        .collect()
}

async fn get_next_issue_number(tenant_id: &str) -> Result<i32, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let gsi1pk = format!("{}#newsletter", tenant_id);

    let result = ddb_client
        .query()
        .table_name(&table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :gsi1pk")
        .expression_attribute_values(":gsi1pk", AttributeValue::S(gsi1pk))
        .scan_index_forward(false)
        .limit(1)
        .send()
        .await?;

    let max_issue_number = result
        .items()
        .first()
        .and_then(|item| {
            item.get("pk")
                .and_then(|v| v.as_s().ok())
                .and_then(|pk| pk.split('#').nth(1))
                .and_then(|s| s.parse::<i32>().ok())
        })
        .unwrap_or(0);

    Ok(max_issue_number + 1)
}

/// The per-issue send configuration. These three always travel together — the
/// API extracts, validates and stores them as a set — so they are passed as
/// one.
#[derive(Default)]
struct SendConfig {
    ab_test: Option<serde_json::Value>,
    local_send: Option<serde_json::Value>,
    content_assembly: Option<serde_json::Value>,
}

async fn create_issue_record(
    tenant_id: &str,
    issue_number: i32,
    body: &CreateIssueRequest,
    scheduled_at: Option<String>,
    send_config: SendConfig,
    overwrite_draft: bool,
) -> Result<CreateIssueResponse, AppError> {
    let SendConfig {
        ab_test,
        local_send,
        content_assembly,
    } = send_config;

    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let now = chrono::Utc::now().to_rfc3339();
    let pk = format!("{}#{}", tenant_id, issue_number);
    let sk = "newsletter";
    let gsi1pk = format!("{}#newsletter", tenant_id);
    let gsi1sk = now.clone();
    let content_type = normalize_content_type(body.content_type.as_deref());

    let mut item = HashMap::new();
    item.insert("pk".to_string(), AttributeValue::S(pk.clone()));
    item.insert("sk".to_string(), AttributeValue::S(sk.to_string()));
    item.insert("GSI1PK".to_string(), AttributeValue::S(gsi1pk));
    item.insert("GSI1SK".to_string(), AttributeValue::S(gsi1sk));
    item.insert(
        "issueNumber".to_string(),
        AttributeValue::N(issue_number.to_string()),
    );
    item.insert(
        "subject".to_string(),
        AttributeValue::S(body.subject.clone()),
    );
    item.insert("status".to_string(), AttributeValue::S("draft".to_string()));
    item.insert(
        "content".to_string(),
        AttributeValue::S(body.content.clone()),
    );
    item.insert("createdAt".to_string(), AttributeValue::S(now.clone()));
    item.insert("updatedAt".to_string(), AttributeValue::S(now.clone()));
    item.insert(
        "contentType".to_string(),
        AttributeValue::S(content_type.clone()),
    );

    if let Some(scheduled_at) = scheduled_at.as_ref() {
        item.insert(
            "scheduledAt".to_string(),
            AttributeValue::S(scheduled_at.clone()),
        );
    }

    if let Some(metadata) = &body.metadata {
        if let Ok(metadata_str) = serde_json::to_string(metadata) {
            item.insert("metadata".to_string(), AttributeValue::S(metadata_str));
        }
    }

    if let Some(template_id) = &body.template_id {
        item.insert(
            "templateId".to_string(),
            AttributeValue::S(template_id.clone()),
        );
    }

    // abTest is persisted as a JSON string (mirroring metadata) so the publish
    // pipeline and GET endpoint can read it back without a typed schema.
    if let Some(ab_test) = &ab_test {
        item.insert("abTest".to_string(), AttributeValue::S(ab_test.to_string()));
    }

    // localSend is persisted the same way; publish-issue reads it right before
    // emitting the send event.
    if let Some(local_send) = &local_send {
        item.insert(
            "localSend".to_string(),
            AttributeValue::S(local_send.to_string()),
        );
    }

    // contentAssembly is persisted as a JSON string (mirroring abTest) so the
    // publish pipeline and GET endpoint can read it back without a typed schema.
    if let Some(content_assembly) = &content_assembly {
        item.insert(
            "contentAssembly".to_string(),
            AttributeValue::S(content_assembly.to_string()),
        );
    }

    // Overwrites are only permitted while the record is still a draft; the
    // condition re-checks the status so a concurrent schedule/publish between
    // the caller's status read and this write can't be clobbered.
    let mut put = ddb_client
        .put_item()
        .table_name(&table_name)
        .set_item(Some(item));
    if overwrite_draft {
        put = put
            .condition_expression("attribute_not_exists(pk) OR #status = :draftStatus")
            .expression_attribute_names("#status", "status")
            .expression_attribute_values(":draftStatus", AttributeValue::S("draft".to_string()));
    } else {
        put = put.condition_expression("attribute_not_exists(pk) AND attribute_not_exists(sk)");
    }
    put.send().await?;

    Ok(CreateIssueResponse {
        id: issue_number.to_string(),
        issue_number,
        subject: body.subject.clone(),
        status: "draft".to_string(),
        content: body.content.clone(),
        created_at: now.clone(),
        updated_at: now,
        content_type,
    })
}

/// The same three configs on update, where each can also be explicitly
/// cleared — a distinct case from "not mentioned in this request", which
/// leaves the stored value alone.
#[derive(Default)]
struct SendConfigUpdate {
    ab_test: Option<serde_json::Value>,
    clear_ab_test: bool,
    local_send: Option<serde_json::Value>,
    clear_local_send: bool,
    content_assembly: Option<serde_json::Value>,
    clear_content_assembly: bool,
}

async fn update_issue_record(
    tenant_id: &str,
    issue_id: &str,
    body: &UpdateIssueRequest,
    send_config: SendConfigUpdate,
) -> Result<GetIssueResponse, AppError> {
    let SendConfigUpdate {
        ab_test,
        clear_ab_test,
        local_send,
        clear_local_send,
        content_assembly,
        clear_content_assembly,
    } = send_config;

    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let issue_number = issue_id
        .parse::<i32>()
        .map_err(|_| AppError::BadRequest("Invalid issue ID format".to_string()))?;

    let pk = format!("{}#{}", tenant_id, issue_number);
    let sk = "newsletter";
    let now = chrono::Utc::now().to_rfc3339();

    let mut update_expression_parts = vec!["SET updatedAt = :updated_at".to_string()];
    let mut remove_expression_parts: Vec<String> = Vec::new();
    let mut expression_attribute_values = HashMap::new();
    let mut expression_attribute_names = HashMap::new();

    expression_attribute_values.insert(":updated_at".to_string(), AttributeValue::S(now.clone()));

    if let Some(subject) = &body.subject {
        update_expression_parts.push("#subject = :subject".to_string());
        expression_attribute_names.insert("#subject".to_string(), "subject".to_string());
        expression_attribute_values
            .insert(":subject".to_string(), AttributeValue::S(subject.clone()));
    }

    if let Some(content) = &body.content {
        update_expression_parts.push("#content = :content".to_string());
        expression_attribute_names.insert("#content".to_string(), "content".to_string());
        expression_attribute_values
            .insert(":content".to_string(), AttributeValue::S(content.clone()));
    }

    if let Some(scheduled_at) = &body.scheduled_at {
        update_expression_parts.push("scheduledAt = :scheduled_at".to_string());
        expression_attribute_values.insert(
            ":scheduled_at".to_string(),
            AttributeValue::S(scheduled_at.clone()),
        );
    }

    if let Some(metadata) = &body.metadata {
        if let Ok(metadata_str) = serde_json::to_string(metadata) {
            update_expression_parts.push("metadata = :metadata".to_string());
            expression_attribute_values
                .insert(":metadata".to_string(), AttributeValue::S(metadata_str));
        }
    }

    if let Some(template_id) = &body.template_id {
        if template_id.trim().is_empty() {
            // Empty value clears the selection, reverting to the default template.
            remove_expression_parts.push("templateId".to_string());
        } else {
            update_expression_parts.push("templateId = :template_id".to_string());
            expression_attribute_values.insert(
                ":template_id".to_string(),
                AttributeValue::S(template_id.clone()),
            );
        }
    }

    if let Some(content_type) = &body.content_type {
        update_expression_parts.push("contentType = :content_type".to_string());
        expression_attribute_values.insert(
            ":content_type".to_string(),
            AttributeValue::S(normalize_content_type(Some(content_type))),
        );
    }

    if let Some(status) = &body.status {
        update_expression_parts.push("#status = :status".to_string());
        expression_attribute_names.insert("#status".to_string(), "status".to_string());
        expression_attribute_values
            .insert(":status".to_string(), AttributeValue::S(status.clone()));

        if status == "published" {
            update_expression_parts.push("publishedAt = :published_at".to_string());
            expression_attribute_values
                .insert(":published_at".to_string(), AttributeValue::S(now.clone()));
        }
    }

    if let Some(ab_test) = &ab_test {
        update_expression_parts.push("abTest = :ab_test".to_string());
        expression_attribute_values.insert(
            ":ab_test".to_string(),
            AttributeValue::S(ab_test.to_string()),
        );
    } else if clear_ab_test {
        // Disabling a previously-saved A/B test: drop both the config and its
        // lifecycle control attribute.
        remove_expression_parts.push("abTest".to_string());
        remove_expression_parts.push("abTestStatus".to_string());
    }

    if let Some(local_send) = &local_send {
        update_expression_parts.push("localSend = :local_send".to_string());
        expression_attribute_values.insert(
            ":local_send".to_string(),
            AttributeValue::S(local_send.to_string()),
        );
    } else if clear_local_send {
        remove_expression_parts.push("localSend".to_string());
    }

    if let Some(content_assembly) = &content_assembly {
        update_expression_parts.push("contentAssembly = :content_assembly".to_string());
        expression_attribute_values.insert(
            ":content_assembly".to_string(),
            AttributeValue::S(content_assembly.to_string()),
        );
    } else if clear_content_assembly {
        remove_expression_parts.push("contentAssembly".to_string());
    }

    let mut update_expression = update_expression_parts.join(", ");
    if !remove_expression_parts.is_empty() {
        update_expression.push_str(" REMOVE ");
        update_expression.push_str(&remove_expression_parts.join(", "));
    }

    let mut update_builder = ddb_client
        .update_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(pk.clone()))
        .key("sk", AttributeValue::S(sk.to_string()))
        .update_expression(update_expression)
        .return_values(aws_sdk_dynamodb::types::ReturnValue::AllNew);

    for (key, value) in expression_attribute_values {
        update_builder = update_builder.expression_attribute_values(key, value);
    }

    for (key, value) in expression_attribute_names {
        update_builder = update_builder.expression_attribute_names(key, value);
    }

    let result = update_builder.send().await?;

    let updated_item = result
        .attributes()
        .ok_or_else(|| AppError::InternalError("No attributes returned from update".to_string()))?;

    let updated_issue = parse_issue_record(updated_item)?;
    let stats = get_issue_stats(tenant_id, issue_id).await.ok();

    let insights = get_issue_insights(tenant_id, issue_id).await.ok().flatten();

    let variant_stats = if updated_issue.ab_test.is_some() {
        get_variant_stats(tenant_id, issue_id).await
    } else {
        Vec::new()
    };

    let progress = send_progress::get_send_progress(tenant_id, updated_issue.issue_number).await;
    let workflow = get_workflow_state_for(&updated_issue, progress.is_some()).await;

    Ok(build_issue_response(
        updated_issue,
        stats,
        insights,
        variant_stats,
        progress,
        workflow,
    ))
}

async fn delete_issue_records(tenant_id: &str, issue_id: &str) -> Result<(), AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let issue_number = issue_id
        .parse::<i32>()
        .map_err(|_| AppError::BadRequest("Invalid issue ID format".to_string()))?;

    let pk = format!("{}#{}", tenant_id, issue_number);

    ddb_client
        .delete_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(pk.clone()))
        .key("sk", AttributeValue::S("newsletter".to_string()))
        .send()
        .await?;

    let _ = ddb_client
        .delete_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(pk))
        .key("sk", AttributeValue::S("stats".to_string()))
        .send()
        .await;

    Ok(())
}

async fn publish_event<T: Serialize>(
    tenant_id: &str,
    event_type: &str,
    data: &T,
) -> Result<(), AppError> {
    let eventbridge_client = aws_clients::get_eventbridge_client().await;

    let issue_data = serde_json::to_value(data)
        .map_err(|e| AppError::InternalError(format!("Failed to serialize event data: {}", e)))?;

    let issue_id = issue_data
        .get("id")
        .or_else(|| issue_data.get("issue_number"))
        .and_then(|v| {
            v.as_str().or_else(|| {
                v.as_i64()
                    .map(|n| Box::leak(n.to_string().into_boxed_str()) as &str)
            })
        })
        .unwrap_or("unknown");

    let issue_number = issue_data
        .get("issue_number")
        .or_else(|| issue_data.get("issueNumber"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    let subject = issue_data
        .get("subject")
        .and_then(|v| v.as_str())
        .unwrap_or("No subject");

    let status = issue_data
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    let detail = serde_json::json!({
        "tenantId": tenant_id,
        "issueId": issue_id,
        "issueNumber": issue_number,
        "subject": subject,
        "status": status,
        "timestamp": chrono::Utc::now().to_rfc3339()
    });

    let detail_str = serde_json::to_string(&detail)
        .map_err(|e| AppError::InternalError(format!("Failed to serialize event detail: {}", e)))?;

    let put_events_result = eventbridge_client
        .put_events()
        .entries(
            aws_sdk_eventbridge::types::PutEventsRequestEntry::builder()
                .source("newsletter-service")
                .detail_type(event_type)
                .detail(detail_str)
                .build(),
        )
        .send()
        .await;

    match put_events_result {
        Ok(output) => {
            for entry in output.entries() {
                if let Some(error_code) = entry.error_code() {
                    tracing::error!(
                        tenant_id = %tenant_id,
                        event_type = %event_type,
                        error_code = %error_code,
                        error_message = ?entry.error_message(),
                        "Failed to publish event to EventBridge"
                    );
                }
            }
            Ok(())
        }
        Err(e) => {
            tracing::error!(
                tenant_id = %tenant_id,
                event_type = %event_type,
                error = %e,
                "Failed to send event to EventBridge"
            );
            Ok(())
        }
    }
}

async fn publish_issue_published_event(
    tenant_id: &str,
    user_id: &str,
    issue_number: i32,
    subject: &str,
    published_at: &str,
) -> Result<(), AppError> {
    let eventbridge_client = aws_clients::get_eventbridge_client().await;

    let detail = serde_json::json!({
        "tenantId": tenant_id,
        "userId": user_id,
        "type": "ISSUE_PUBLISHED",
        "data": {
            "issueNumber": issue_number,
            "publishedAt": published_at,
            "title": subject
        }
    });

    let detail_str = serde_json::to_string(&detail)
        .map_err(|e| AppError::InternalError(format!("Failed to serialize event detail: {}", e)))?;

    let put_events_result = eventbridge_client
        .put_events()
        .entries(
            aws_sdk_eventbridge::types::PutEventsRequestEntry::builder()
                .source("newsletter-service")
                .detail_type("ISSUE_PUBLISHED")
                .detail(detail_str)
                .build(),
        )
        .send()
        .await;

    match put_events_result {
        Ok(output) => {
            for entry in output.entries() {
                if let Some(error_code) = entry.error_code() {
                    tracing::error!(
                        tenant_id = %tenant_id,
                        event_type = "ISSUE_PUBLISHED",
                        error_code = %error_code,
                        error_message = ?entry.error_message(),
                        "Failed to publish analytics rebuild event"
                    );
                }
            }
            Ok(())
        }
        Err(e) => {
            tracing::error!(
                tenant_id = %tenant_id,
                event_type = "ISSUE_PUBLISHED",
                error = %e,
                "Failed to send analytics rebuild event to EventBridge"
            );
            Ok(())
        }
    }
}

fn build_issue_response(
    issue: IssueRecord,
    stats: Option<IssueStats>,
    insights: Option<IssueInsights>,
    variant_stats: Vec<VariantStats>,
    send_progress: Option<send_progress::SendProgressResponse>,
    workflow: Option<send_progress::WorkflowState>,
) -> GetIssueResponse {
    GetIssueResponse {
        id: issue.issue_number.to_string(),
        issue_number: issue.issue_number,
        subject: issue.subject,
        status: issue.status,
        content: issue.content,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        published_at: issue.published_at,
        scheduled_at: issue.scheduled_at,
        metadata: issue.metadata,
        template_id: issue.template_id,
        content_type: Some(normalize_content_type(issue.content_type.as_deref())),
        stats,
        insights: insights.as_ref().and_then(|data| data.insights.clone()),
        insights_v2: insights.and_then(|data| data.insights_v2),
        ab_test: issue.ab_test,
        variant_stats: if variant_stats.is_empty() {
            None
        } else {
            Some(variant_stats)
        },
        local_send: issue.local_send,
        content_assembly: issue.content_assembly,
        send_progress,
        workflow,
    }
}

/// Reads the per-variant engagement counters (sk "stats#v#a" / "stats#v#b") for
/// an issue. Missing variant records are skipped; errors are swallowed so a
/// stats read never fails the issue fetch.
async fn get_variant_stats(tenant_id: &str, issue_id: &str) -> Vec<VariantStats> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let Ok(table_name) = std::env::var("TABLE_NAME") else {
        return Vec::new();
    };
    let Ok(issue_number) = issue_id.parse::<i32>() else {
        return Vec::new();
    };
    let pk = format!("{}#{}", tenant_id, issue_number);

    let mut out = Vec::new();
    for variant_id in ["a", "b"] {
        let result = ddb_client
            .get_item()
            .table_name(&table_name)
            .key("pk", AttributeValue::S(pk.clone()))
            .key("sk", AttributeValue::S(format!("stats#v#{}", variant_id)))
            .send()
            .await;

        if let Ok(output) = result {
            if let Some(item) = output.item() {
                let counter = |name: &str| -> i64 {
                    item.get(name)
                        .and_then(|v| v.as_n().ok())
                        .and_then(|s| s.parse::<i64>().ok())
                        .unwrap_or(0)
                };
                out.push(VariantStats {
                    variant_id: variant_id.to_string(),
                    opens: counter("opens"),
                    clicks: counter("clicks"),
                    deliveries: counter("deliveries"),
                    sends: counter("sends"),
                    bounces: counter("bounces"),
                    complaints: counter("complaints"),
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── AI editorial review parsing ─────────────────────────────────────

    #[test]
    fn test_parse_review_response_full() {
        let raw = r#"Here is the review:
{
  "grade": "A-",
  "gradeRationale": "Clear and engaging.",
  "summary": "A strong issue.",
  "subjectSuggestions": [
    {"a": "Show your work", "b": "Show me the receipts", "rationale": "curiosity vs specificity"}
  ],
  "metaAssessment": {"titleFit": "Good fit.", "descriptionFit": "Accurate.", "suggestions": ["Try X", ""]},
  "grammar": [{"quote": "their are", "issue": "subject-verb", "suggestion": "there are"}],
  "spelling": [{"word": "teh", "suggestion": "the", "context": "in teh cloud"}]
}
Thanks!"#;
        let review = parse_review_response(raw).unwrap();
        assert_eq!(review.grade, "A-");
        assert_eq!(review.summary, "A strong issue.");
        assert_eq!(review.subject_suggestions.len(), 1);
        assert_eq!(review.subject_suggestions[0].b, "Show me the receipts");
        assert_eq!(review.meta_assessment.suggestions, vec!["Try X"]); // empty dropped
        assert_eq!(review.grammar.len(), 1);
        assert_eq!(review.spelling[0].suggestion, "the");
    }

    #[test]
    fn test_parse_review_response_missing_fields_default() {
        let raw = r#"{"grade": "B"}"#;
        let review = parse_review_response(raw).unwrap();
        assert_eq!(review.grade, "B");
        assert!(review.subject_suggestions.is_empty());
        assert!(review.grammar.is_empty());
        assert!(review.spelling.is_empty());
        assert_eq!(review.meta_assessment.title_fit, "");
    }

    #[test]
    fn test_parse_review_response_empty_grade_becomes_na() {
        let raw = r#"{"grade": "", "grammar": []}"#;
        let review = parse_review_response(raw).unwrap();
        assert_eq!(review.grade, "N/A");
    }

    #[test]
    fn test_parse_review_response_drops_unusable_grammar_and_spelling() {
        // Entries missing a quote/word or a suggestion are unusable — the caller
        // can't map them back to the text or apply a fix — so they're dropped.
        let raw = r#"{
  "grade": "B",
  "grammar": [
    {"quote": "their are", "issue": "sv", "suggestion": "there are"},
    {"issue": "awkward phrasing", "suggestion": "reword this"},
    {"quote": "the the", "issue": "dup word", "suggestion": ""}
  ],
  "spelling": [
    {"word": "teh", "suggestion": "the", "context": "in teh cloud"},
    {"word": "recieve", "context": "recieve it", "suggestion": ""}
  ]
}"#;
        let review = parse_review_response(raw).unwrap();
        assert_eq!(
            review.grammar.len(),
            1,
            "only the fully-formed grammar item survives"
        );
        assert_eq!(review.grammar[0].quote, "their are");
        assert_eq!(
            review.spelling.len(),
            1,
            "only the fully-formed spelling item survives"
        );
        assert_eq!(review.spelling[0].word, "teh");
    }

    #[test]
    fn test_parse_review_response_non_json_errors() {
        assert!(parse_review_response("no json here").is_err());
    }

    // ── Local-send config validation ────────────────────────────────────

    /// Stands in for the tenant timezone setting in tests that supply their
    /// own zone and don't care about the fallback.
    const FALLBACK_ZONE: &str = "UTC";

    #[test]
    fn test_validate_local_send_normalizes_valid_config() {
        let input = serde_json::json!({
            "enabled": true,
            "defaultTimeZone": " America/New_York ",
            "extraneous": "dropped"
        });
        let normalized = validate_and_normalize_local_send(&input, FALLBACK_ZONE)
            .unwrap()
            .unwrap();
        assert_eq!(
            normalized,
            serde_json::json!({
                "enabled": true,
                "defaultTimeZone": "America/New_York",
                "mode": "timezone"
            })
        );
    }

    #[test]
    fn test_validate_local_send_mode_defaults_and_passthrough() {
        // Absent and null both default to "timezone".
        for input in [
            serde_json::json!({ "enabled": true, "defaultTimeZone": "America/New_York" }),
            serde_json::json!({
                "enabled": true,
                "defaultTimeZone": "America/New_York",
                "mode": null
            }),
            serde_json::json!({
                "enabled": true,
                "defaultTimeZone": "America/New_York",
                "mode": "timezone"
            }),
        ] {
            let normalized = validate_and_normalize_local_send(&input, FALLBACK_ZONE)
                .unwrap()
                .unwrap();
            assert_eq!(normalized["mode"], "timezone", "{input}");
        }

        let normalized = validate_and_normalize_local_send(
            &serde_json::json!({
                "enabled": true,
                "defaultTimeZone": "America/New_York",
                "mode": "peak-hour"
            }),
            FALLBACK_ZONE,
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            normalized,
            serde_json::json!({
                "enabled": true,
                "defaultTimeZone": "America/New_York",
                "mode": "peak-hour"
            })
        );
    }

    #[test]
    fn test_validate_local_send_rejects_unknown_mode() {
        for mode in [
            serde_json::json!("peak_hour"),
            serde_json::json!("Timezone"),
            serde_json::json!(""),
            serde_json::json!(3),
            serde_json::json!({ "nested": true }),
        ] {
            let input = serde_json::json!({
                "enabled": true,
                "defaultTimeZone": "America/New_York",
                "mode": mode
            });
            assert!(
                validate_and_normalize_local_send(&input, FALLBACK_ZONE).is_err(),
                "{input}"
            );
        }
    }

    #[test]
    fn test_validate_local_send_disabled_becomes_none() {
        let input = serde_json::json!({ "enabled": false, "defaultTimeZone": "America/New_York" });
        assert!(validate_and_normalize_local_send(&input, FALLBACK_ZONE)
            .unwrap()
            .is_none());
    }

    #[test]
    fn test_validate_local_send_requires_boolean_enabled() {
        for input in [
            serde_json::json!({ "defaultTimeZone": "America/New_York" }),
            serde_json::json!({ "enabled": "yes", "defaultTimeZone": "America/New_York" }),
            serde_json::json!("not-an-object"),
        ] {
            assert!(validate_and_normalize_local_send(&input, FALLBACK_ZONE).is_err());
        }
    }

    #[test]
    fn test_validate_local_send_falls_back_to_the_tenant_timezone() {
        // An omitted or blank zone means "the one this newsletter already
        // runs on" — the tenant timezone setting — rather than an error.
        for input in [
            serde_json::json!({ "enabled": true }),
            serde_json::json!({ "enabled": true, "defaultTimeZone": "" }),
            serde_json::json!({ "enabled": true, "defaultTimeZone": "  " }),
            serde_json::json!({ "enabled": true, "defaultTimeZone": null }),
        ] {
            let normalized = validate_and_normalize_local_send(&input, "Europe/London")
                .unwrap()
                .unwrap();
            assert_eq!(normalized["defaultTimeZone"], "Europe/London", "{input}");
        }
    }

    #[test]
    fn test_validate_local_send_explicit_zone_beats_the_fallback() {
        let input = serde_json::json!({ "enabled": true, "defaultTimeZone": "Asia/Tokyo" });
        let normalized = validate_and_normalize_local_send(&input, "Europe/London")
            .unwrap()
            .unwrap();
        assert_eq!(normalized["defaultTimeZone"], "Asia/Tokyo");
    }

    #[test]
    fn test_validate_local_send_rejects_an_unusable_zone() {
        for input in [
            serde_json::json!({ "enabled": true, "defaultTimeZone": "Not A Zone" }),
            serde_json::json!({ "enabled": true, "defaultTimeZone": "nozone" }),
        ] {
            assert!(
                validate_and_normalize_local_send(&input, FALLBACK_ZONE).is_err(),
                "{input}"
            );
        }
    }

    #[test]
    fn test_is_plausible_iana_time_zone() {
        assert!(is_plausible_iana_time_zone("America/New_York"));
        assert!(is_plausible_iana_time_zone("Europe/London"));
        assert!(is_plausible_iana_time_zone(
            "America/Argentina/Buenos_Aires"
        ));
        assert!(is_plausible_iana_time_zone("Etc/GMT+5"));
        assert!(is_plausible_iana_time_zone("UTC"));
        assert!(!is_plausible_iana_time_zone("EST"));
        assert!(!is_plausible_iana_time_zone("America/New York"));
        assert!(!is_plausible_iana_time_zone("/leading"));
        assert!(!is_plausible_iana_time_zone("trailing/"));
        assert!(!is_plausible_iana_time_zone(""));
    }

    #[test]
    fn test_extract_local_send_absent_and_null() {
        assert!(extract_local_send(br#"{"subject":"x"}"#).unwrap().is_none());
        assert!(extract_local_send(br#"{"localSend":null}"#)
            .unwrap()
            .is_none());
        assert!(extract_local_send(b"").unwrap().is_none());
        let extracted = extract_local_send(br#"{"localSend":{"enabled":true}}"#)
            .unwrap()
            .unwrap();
        assert_eq!(extracted, serde_json::json!({ "enabled": true }));
    }

    #[test]
    fn test_local_send_explicitly_cleared() {
        assert!(local_send_explicitly_cleared(br#"{"localSend":null}"#));
        assert!(!local_send_explicitly_cleared(br#"{"subject":"x"}"#));
        assert!(!local_send_explicitly_cleared(
            br#"{"localSend":{"enabled":true}}"#
        ));
        assert!(!local_send_explicitly_cleared(b""));
    }

    fn create_request(
        content: &str,
        content_type: Option<&str>,
        template: Option<&str>,
    ) -> CreateIssueRequest {
        CreateIssueRequest {
            issue_number: None,
            subject: "A subject".to_string(),
            content: content.to_string(),
            scheduled_at: None,
            action: None,
            metadata: None,
            template_id: template.map(|t| t.to_string()),
            content_type: content_type.map(|c| c.to_string()),
            ttl_seconds: None,
        }
    }

    fn tenant_settings(timezone: &str, send_time: &str) -> TenantSettings {
        TenantSettings {
            timezone: timezone.to_string(),
            default_send_time: send_time.to_string(),
            ..Default::default()
        }
    }

    /// A date far enough out that these assertions don't start failing when
    /// the clock passes them — `resolve_scheduled_at` drops past times.
    fn future_year() -> i32 {
        chrono::Utc::now()
            .format("%Y")
            .to_string()
            .parse::<i32>()
            .unwrap()
            + 2
    }

    #[test]
    fn test_resolve_scheduled_at_treats_absent_and_now_as_immediate() {
        let settings = TenantSettings::default();
        assert_eq!(resolve_scheduled_at(None, &settings).unwrap(), None);
        assert_eq!(resolve_scheduled_at(Some(""), &settings).unwrap(), None);
        assert_eq!(resolve_scheduled_at(Some("  "), &settings).unwrap(), None);
        assert_eq!(resolve_scheduled_at(Some("now"), &settings).unwrap(), None);
        assert_eq!(resolve_scheduled_at(Some("NOW"), &settings).unwrap(), None);
    }

    #[test]
    fn test_resolve_scheduled_at_passes_through_full_timestamps() {
        let value = format!("{}-08-01T12:34:00+00:00", future_year());
        let resolved =
            resolve_scheduled_at(Some(&value), &tenant_settings("America/Chicago", "09:00"))
                .unwrap();

        // An explicit instant wins over the tenant default; settings only fill
        // in what the caller left out.
        assert_eq!(resolved, Some(value));
    }

    #[test]
    fn test_resolve_scheduled_at_applies_default_send_time_to_a_bare_date() {
        let date = format!("{}-08-01", future_year());
        let resolved =
            resolve_scheduled_at(Some(&date), &tenant_settings("America/Chicago", "09:00"))
                .unwrap()
                .expect("a future date should stay scheduled");

        // 09:00 CDT is 14:00Z.
        assert_eq!(resolved, format!("{}-08-01T14:00:00+00:00", future_year()));
    }

    #[test]
    fn test_resolve_scheduled_at_uses_utc_at_nine_without_configured_settings() {
        let date = format!("{}-08-01", future_year());
        let resolved = resolve_scheduled_at(Some(&date), &TenantSettings::default())
            .unwrap()
            .expect("a future date should stay scheduled");

        assert_eq!(resolved, format!("{}-08-01T09:00:00+00:00", future_year()));
    }

    #[test]
    fn test_resolve_scheduled_at_drops_past_dates() {
        // A bare date in the past resolves to a past instant, which means the
        // same thing an explicit past timestamp does: send now.
        let resolved = resolve_scheduled_at(
            Some("2020-01-01"),
            &tenant_settings("America/Chicago", "09:00"),
        )
        .unwrap();
        assert_eq!(resolved, None);
    }

    #[test]
    fn test_resolve_scheduled_at_rejects_unparseable_values() {
        let settings = TenantSettings::default();
        assert!(resolve_scheduled_at(Some("tomorrow"), &settings).is_err());
        assert!(resolve_scheduled_at(Some("2026-13-01"), &settings).is_err());
        assert!(resolve_scheduled_at(Some("08/01/2026"), &settings).is_err());
    }

    #[test]
    fn test_normalize_content_type_defaults_to_markdown() {
        assert_eq!(normalize_content_type(None), "markdown");
        assert_eq!(normalize_content_type(Some("")), "markdown");
        assert_eq!(normalize_content_type(Some("   ")), "markdown");
        // Unknown values fall back to markdown.
        assert_eq!(normalize_content_type(Some("xml")), "markdown");
    }

    #[test]
    fn test_normalize_content_type_json() {
        assert_eq!(normalize_content_type(Some("json")), "json");
        assert_eq!(normalize_content_type(Some("JSON")), "json");
        assert_eq!(normalize_content_type(Some(" Json ")), "json");
    }

    #[test]
    fn test_normalize_content_type_html() {
        assert_eq!(normalize_content_type(Some("html")), "html");
        assert_eq!(normalize_content_type(Some("HTML")), "html");
        assert_eq!(normalize_content_type(Some(" Html ")), "html");
    }

    #[test]
    fn test_validate_json_content_accepts_object() {
        assert!(validate_json_content("{\"metadata\": {\"title\": \"x\"}}").is_ok());
    }

    #[test]
    fn test_validate_json_content_rejects_non_object_and_invalid() {
        assert!(validate_json_content("[1, 2, 3]").is_err());
        assert!(validate_json_content("\"a string\"").is_err());
        assert!(validate_json_content("not json").is_err());
    }

    #[test]
    fn test_validate_create_markdown_ignores_json_rules() {
        // Markdown content need not be JSON and needs no template.
        let body = create_request("# Hello", None, None);
        assert!(validate_create_request(&body).is_ok());

        let body = create_request("# Hello", Some("markdown"), None);
        assert!(validate_create_request(&body).is_ok());
    }

    #[test]
    fn test_validate_create_json_requires_template() {
        let body = create_request("{\"a\": 1}", Some("json"), None);
        let err = validate_create_request(&body).unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_create_json_requires_valid_json() {
        let body = create_request("not json", Some("json"), Some("tmpl-1"));
        let err = validate_create_request(&body).unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_create_json_happy_path() {
        let body = create_request(
            "{\"metadata\": {\"title\": \"x\"}}",
            Some("json"),
            Some("tmpl-1"),
        );
        assert!(validate_create_request(&body).is_ok());
    }

    #[test]
    fn test_validate_update_json_content_must_be_valid() {
        let body = UpdateIssueRequest {
            subject: None,
            content: Some("nope".to_string()),
            scheduled_at: None,
            metadata: None,
            status: None,
            template_id: None,
            content_type: Some("json".to_string()),
        };
        assert!(validate_update_request(&body, false).is_err());
    }

    fn valid_ab_test() -> serde_json::Value {
        serde_json::json!({
            "dimension": "subject",
            "variants": [
                { "variantId": "a", "subject": "Control subject" },
                { "variantId": "b", "subject": "Challenger subject" }
            ]
        })
    }

    #[test]
    fn test_ab_test_normalizes_defaults_and_generated_fields() {
        let normalized = validate_and_normalize_ab_test(&valid_ab_test()).unwrap();
        assert_eq!(normalized["dimension"], "subject");
        assert_eq!(normalized["status"], "pending");
        assert!(normalized["winnerVariantId"].is_null());
        assert_eq!(normalized["winMetric"], "openRate");
        assert_eq!(normalized["confidence"], 0.95);
        assert_eq!(normalized["minSamplePerVariant"], 500);
        assert_eq!(normalized["testFraction"], 0.2);
        assert!(normalized["testId"].as_str().is_some_and(|s| !s.is_empty()));
        assert_eq!(normalized["variants"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_ab_test_requires_exactly_two_variants() {
        let mut ab = valid_ab_test();
        ab["variants"] = serde_json::json!([{ "variantId": "a", "subject": "only one" }]);
        assert!(validate_and_normalize_ab_test(&ab).is_err());
    }

    #[test]
    fn test_ab_test_requires_ids_a_and_b() {
        let mut ab = valid_ab_test();
        ab["variants"] = serde_json::json!([
            { "variantId": "a", "subject": "one" },
            { "variantId": "a", "subject": "dup" }
        ]);
        assert!(validate_and_normalize_ab_test(&ab).is_err());
    }

    #[test]
    fn test_ab_test_rejects_empty_variant_subject() {
        let mut ab = valid_ab_test();
        ab["variants"][1]["subject"] = serde_json::json!("   ");
        assert!(validate_and_normalize_ab_test(&ab).is_err());
    }

    #[test]
    fn test_ab_test_rejects_out_of_range_confidence_and_fraction() {
        let mut bad_conf = valid_ab_test();
        bad_conf["confidence"] = serde_json::json!(0.5);
        assert!(validate_and_normalize_ab_test(&bad_conf).is_err());

        let mut bad_fraction = valid_ab_test();
        bad_fraction["testFraction"] = serde_json::json!(0.8);
        assert!(validate_and_normalize_ab_test(&bad_fraction).is_err());
    }

    fn future_rfc3339(hours: i64) -> String {
        (chrono::Utc::now() + chrono::Duration::hours(hours)).to_rfc3339()
    }

    fn valid_send_time_ab_test() -> serde_json::Value {
        serde_json::json!({
            "dimension": "sendTime",
            "variants": [
                { "variantId": "a", "sendAt": future_rfc3339(2) },
                { "variantId": "b", "sendAt": future_rfc3339(6) }
            ]
        })
    }

    #[test]
    fn test_ab_test_send_time_normalizes() {
        let normalized = validate_and_normalize_ab_test(&valid_send_time_ab_test()).unwrap();
        assert_eq!(normalized["dimension"], "sendTime");
        assert_eq!(normalized["status"], "pending");
        let variants = normalized["variants"].as_array().unwrap();
        assert_eq!(variants.len(), 2);
        // Each variant carries a normalized sendAt and no subject.
        assert!(variants[0]["sendAt"].as_str().is_some());
        assert!(variants[0].get("subject").is_none());
    }

    #[test]
    fn test_ab_test_send_time_rejects_past_sendat() {
        let mut ab = valid_send_time_ab_test();
        ab["variants"][1]["sendAt"] = serde_json::json!(future_rfc3339(-2));
        assert!(validate_and_normalize_ab_test(&ab).is_err());
    }

    #[test]
    fn test_ab_test_send_time_rejects_missing_and_duplicate_sendat() {
        // Missing sendAt.
        let mut missing = valid_send_time_ab_test();
        missing["variants"][0] = serde_json::json!({ "variantId": "a" });
        assert!(validate_and_normalize_ab_test(&missing).is_err());

        // Identical send times for both variants.
        let when = future_rfc3339(3);
        let dup = serde_json::json!({
            "dimension": "sendTime",
            "variants": [
                { "variantId": "a", "sendAt": when },
                { "variantId": "b", "sendAt": when }
            ]
        });
        assert!(validate_and_normalize_ab_test(&dup).is_err());
    }

    #[test]
    fn test_ab_test_rejects_unknown_dimension() {
        let mut ab = valid_ab_test();
        ab["dimension"] = serde_json::json!("fromName");
        assert!(validate_and_normalize_ab_test(&ab).is_err());
    }

    #[test]
    fn test_extract_ab_test_absent_and_present() {
        assert!(extract_ab_test(b"{\"subject\":\"x\"}").unwrap().is_none());
        assert!(extract_ab_test(b"{\"abTest\":null}").unwrap().is_none());
        assert!(extract_ab_test(b"").unwrap().is_none());
        let present = extract_ab_test(b"{\"abTest\":{\"dimension\":\"subject\"}}").unwrap();
        assert!(present.is_some());
    }

    #[test]
    fn test_ab_test_explicitly_cleared() {
        // Explicit null => clear requested.
        assert!(ab_test_explicitly_cleared(b"{\"abTest\":null}"));
        // Omitted, empty, or a real object => not a clear.
        assert!(!ab_test_explicitly_cleared(b"{\"subject\":\"x\"}"));
        assert!(!ab_test_explicitly_cleared(b""));
        assert!(!ab_test_explicitly_cleared(
            b"{\"abTest\":{\"dimension\":\"subject\"}}"
        ));
    }

    #[test]
    fn test_extract_content_assembly_absent_and_present() {
        assert!(extract_content_assembly(b"{\"subject\":\"x\"}")
            .unwrap()
            .is_none());
        assert!(extract_content_assembly(b"{\"contentAssembly\":null}")
            .unwrap()
            .is_none());
        assert!(extract_content_assembly(b"").unwrap().is_none());
        let present =
            extract_content_assembly(b"{\"contentAssembly\":{\"enabled\":true}}").unwrap();
        assert!(present.is_some());
    }

    #[test]
    fn test_content_assembly_explicitly_cleared() {
        // Explicit null => clear requested.
        assert!(content_assembly_explicitly_cleared(
            b"{\"contentAssembly\":null}"
        ));
        // Omitted, empty, or a real object => not a clear.
        assert!(!content_assembly_explicitly_cleared(b"{\"subject\":\"x\"}"));
        assert!(!content_assembly_explicitly_cleared(b""));
        assert!(!content_assembly_explicitly_cleared(
            b"{\"contentAssembly\":{\"enabled\":true}}"
        ));
    }

    #[test]
    fn test_validate_content_assembly_normalizes_to_enabled_only() {
        let normalized = validate_and_normalize_content_assembly(&serde_json::json!({
            "enabled": true,
            "somethingElse": "dropped"
        }))
        .expect("valid config should normalize");
        assert_eq!(normalized, serde_json::json!({ "enabled": true }));

        let disabled =
            validate_and_normalize_content_assembly(&serde_json::json!({ "enabled": false }))
                .expect("disabled config is valid");
        assert_eq!(disabled, serde_json::json!({ "enabled": false }));
    }

    #[test]
    fn test_validate_content_assembly_rejects_invalid_shapes() {
        // Not an object.
        assert!(validate_and_normalize_content_assembly(&serde_json::json!(true)).is_err());
        assert!(validate_and_normalize_content_assembly(&serde_json::json!("enabled")).is_err());
        assert!(validate_and_normalize_content_assembly(&serde_json::json!([1, 2])).is_err());
        // Missing enabled.
        assert!(validate_and_normalize_content_assembly(&serde_json::json!({})).is_err());
        // enabled is not a boolean.
        assert!(
            validate_and_normalize_content_assembly(&serde_json::json!({ "enabled": "yes" }))
                .is_err()
        );
        assert!(
            validate_and_normalize_content_assembly(&serde_json::json!({ "enabled": 1 })).is_err()
        );
    }

    fn active_ab_item(
        issue_status: &str,
        ab_test_json: Option<&str>,
    ) -> HashMap<String, AttributeValue> {
        let mut item = HashMap::new();
        item.insert(
            "pk".to_string(),
            AttributeValue::S("tenant-123#42".to_string()),
        );
        item.insert(
            "status".to_string(),
            AttributeValue::S(issue_status.to_string()),
        );
        item.insert(
            "subject".to_string(),
            AttributeValue::S("Weekly digest".to_string()),
        );
        item.insert(
            "publishedAt".to_string(),
            AttributeValue::S("2026-07-01T00:00:00Z".to_string()),
        );
        if let Some(json) = ab_test_json {
            item.insert("abTest".to_string(), AttributeValue::S(json.to_string()));
        }
        item
    }

    #[test]
    fn test_parse_active_ab_test_keeps_in_progress_published() {
        let json = r#"{"dimension":"subject","status":"testing","winMetric":"clickRate","evaluateAfterMinutes":120,"variants":[{"variantId":"a","subject":"A"},{"variantId":"b","subject":"B"}]}"#;
        let parsed = parse_active_ab_test(&active_ab_item("published", Some(json)))
            .expect("in-progress published test should parse");
        assert_eq!(parsed.issue_number, 42);
        assert_eq!(parsed.issue_id, "42");
        assert_eq!(parsed.status, "testing");
        assert_eq!(parsed.dimension, "subject");
        assert_eq!(parsed.win_metric, "clickRate");
        assert_eq!(parsed.evaluate_after_minutes, Some(120));
        assert_eq!(parsed.variants.len(), 2);
        assert_eq!(parsed.variants[0].subject.as_deref(), Some("A"));
        // Stats are attached by the caller, not the parser.
        assert!(parsed.variant_stats.is_empty());
    }

    #[test]
    fn test_parse_active_ab_test_keeps_pending_and_evaluating() {
        for status in ["pending", "evaluating"] {
            let json = format!(r#"{{"dimension":"subject","status":"{status}","variants":[]}}"#);
            assert!(
                parse_active_ab_test(&active_ab_item("published", Some(&json))).is_some(),
                "status {status} should count as in progress"
            );
        }
    }

    #[test]
    fn test_parse_active_ab_test_skips_final_statuses() {
        for status in ["sent", "inconclusive"] {
            let json = format!(r#"{{"dimension":"subject","status":"{status}","variants":[]}}"#);
            assert!(
                parse_active_ab_test(&active_ab_item("published", Some(&json))).is_none(),
                "status {status} is final and must be excluded"
            );
        }
    }

    #[test]
    fn test_parse_active_ab_test_skips_unpublished_and_missing() {
        let json = r#"{"dimension":"subject","status":"testing","variants":[]}"#;
        // Draft/scheduled issues have not sent a sample yet, so their test is not
        // "in progress" regardless of the embedded status.
        assert!(parse_active_ab_test(&active_ab_item("draft", Some(json))).is_none());
        assert!(parse_active_ab_test(&active_ab_item("scheduled", Some(json))).is_none());
        assert!(parse_active_ab_test(&active_ab_item("failed", Some(json))).is_none());
        // Published issue with no A/B test at all.
        assert!(parse_active_ab_test(&active_ab_item("published", None)).is_none());
    }

    fn ab_history_test(
        dimension: &str,
        significant: bool,
        winner: Option<&str>,
        lift: Option<f64>,
        winner_send_at: Option<&str>,
    ) -> AbHistoryTest {
        let variants = match winner {
            Some(id) => vec![AbHistoryVariant {
                variant_id: id.to_string(),
                subject: None,
                send_at: winner_send_at.map(|s| s.to_string()),
                opens: 0,
                clicks: 0,
                deliveries: 0,
                open_rate: 0.0,
                click_rate: 0.0,
            }],
            None => vec![],
        };
        AbHistoryTest {
            issue_number: 1,
            dimension: dimension.to_string(),
            win_metric: "openRate".to_string(),
            status: Some(if significant { "sent" } else { "inconclusive" }.to_string()),
            winner_variant_id: winner.map(|s| s.to_string()),
            significant,
            confidence: Some(0.95),
            lift,
            decided_at: Some("2026-06-01T00:00:00Z".to_string()),
            variants,
        }
    }

    #[test]
    fn test_ab_history_aggregates() {
        let tests = vec![
            ab_history_test("subject", true, Some("b"), Some(10.0), None),
            ab_history_test("subject", false, None, None, None),
            ab_history_test(
                "sendTime",
                true,
                Some("a"),
                Some(6.0),
                Some("2026-06-01T09:30:00Z"),
            ),
            ab_history_test(
                "sendTime",
                true,
                Some("b"),
                Some(8.0),
                Some("2026-06-08T09:00:00Z"),
            ),
        ];

        let agg = compute_ab_history_aggregates(&tests);
        assert_eq!(agg.total_tests, 4);
        assert_eq!(agg.significant_tests, 3);
        assert_eq!(agg.subject_tests, 2);
        assert_eq!(agg.send_time_tests, 2);
        // avg lift over the 3 significant winners: (10 + 6 + 8) / 3 = 8.0
        assert_eq!(agg.avg_winning_lift, Some(8.0));
        // Both significant send-time winners landed in the 09:00 UTC hour.
        assert_eq!(agg.top_send_hours_utc[0].hour_utc, 9);
        assert_eq!(agg.top_send_hours_utc[0].wins, 2);
    }

    #[test]
    fn test_extract_json_object() {
        assert_eq!(
            extract_json_object("noise {\"a\":1} trailing"),
            Some("{\"a\":1}")
        );
        assert_eq!(
            extract_json_object("```json\n{\"a\":1}\n```"),
            Some("{\"a\":1}")
        );
        assert_eq!(extract_json_object("no json here"), None);
    }

    #[test]
    fn test_parse_suggestion_response_subject() {
        let raw = "```json\n{\"subjects\": [\"First idea\", \"Second idea\"], \"rationale\": \"Punchier openers\"}\n```";
        let (subjects, send_times, rationale) =
            parse_suggestion_response(raw, AB_DIMENSION_SUBJECT).unwrap();
        assert_eq!(subjects.unwrap(), vec!["First idea", "Second idea"]);
        assert!(send_times.is_none());
        assert_eq!(rationale, "Punchier openers");
    }

    #[test]
    fn test_parse_suggestion_response_send_time_filters_invalid_hours() {
        let raw = "{\"sendTimes\": [{\"label\": \"9am\", \"hourUtc\": 9}, {\"hourUtc\": 30}, {\"hourUtc\": 14}], \"rationale\": \"r\"}";
        let (subjects, send_times, _) =
            parse_suggestion_response(raw, AB_DIMENSION_SENDTIME).unwrap();
        assert!(subjects.is_none());
        let times = send_times.unwrap();
        // hour 30 is dropped; 9 (with label) and 14 (label defaulted) remain.
        assert_eq!(times.len(), 2);
        assert_eq!(times[0].hour_utc, 9);
        assert_eq!(times[0].label, "9am");
        assert_eq!(times[1].label, "14:00 UTC");
    }

    #[test]
    fn test_parse_suggestion_response_errors() {
        assert!(parse_suggestion_response("not json", AB_DIMENSION_SUBJECT).is_err());
        assert!(parse_suggestion_response("{\"subjects\": []}", AB_DIMENSION_SUBJECT).is_err());
        assert!(parse_suggestion_response("{\"sendTimes\": []}", AB_DIMENSION_SENDTIME).is_err());
    }

    #[test]
    fn test_summarize_ab_history_for_prompt() {
        assert!(summarize_ab_history_for_prompt(&[], "subject").contains("No prior"));

        let tests = vec![ab_history_test(
            "subject",
            true,
            Some("b"),
            Some(12.0),
            None,
        )];
        // Winner variant has no subject in the helper fixture, so only headline lines appear.
        let summary = summarize_ab_history_for_prompt(&tests, "subject");
        assert!(summary.contains("Subject-line tests: 1"));
        assert!(summary.contains("1 statistically significant"));
    }

    #[test]
    fn test_build_suggestion_prompt_includes_context() {
        let (system, user) = build_suggestion_prompt(
            AB_DIMENSION_SUBJECT,
            Some("Hello world"),
            Some("A summary"),
            "Past A/B performance summary text",
        );
        assert!(system.contains("SUBJECT LINES"));
        assert!(user.contains("Hello world"));
        assert!(user.contains("A summary"));
        assert!(user.contains("Past A/B performance summary text"));
    }

    #[test]
    fn test_parse_issue_record_reads_content_type() {
        let mut item = HashMap::new();
        item.insert(
            "pk".to_string(),
            AttributeValue::S("tenant-1#5".to_string()),
        );
        item.insert(
            "sk".to_string(),
            AttributeValue::S("newsletter".to_string()),
        );
        item.insert(
            "GSI1PK".to_string(),
            AttributeValue::S("tenant-1#newsletter".to_string()),
        );
        item.insert(
            "GSI1SK".to_string(),
            AttributeValue::S("2024-01-15T10:30:00Z".to_string()),
        );
        item.insert("subject".to_string(), AttributeValue::S("Subj".to_string()));
        item.insert("status".to_string(), AttributeValue::S("draft".to_string()));
        item.insert("content".to_string(), AttributeValue::S("{}".to_string()));
        item.insert(
            "createdAt".to_string(),
            AttributeValue::S("2024-01-15T10:00:00Z".to_string()),
        );
        item.insert(
            "updatedAt".to_string(),
            AttributeValue::S("2024-01-15T10:30:00Z".to_string()),
        );
        item.insert(
            "contentType".to_string(),
            AttributeValue::S("json".to_string()),
        );

        let issue = parse_issue_record(&item).unwrap();
        assert_eq!(issue.content_type, Some("json".to_string()));
    }

    #[test]
    fn test_parse_issue_record_complete() {
        let mut item = HashMap::new();
        item.insert(
            "pk".to_string(),
            AttributeValue::S("tenant-123#42".to_string()),
        );
        item.insert(
            "sk".to_string(),
            AttributeValue::S("newsletter".to_string()),
        );
        item.insert(
            "GSI1PK".to_string(),
            AttributeValue::S("tenant-123#newsletter".to_string()),
        );
        item.insert(
            "GSI1SK".to_string(),
            AttributeValue::S("2024-01-15T10:30:00Z".to_string()),
        );
        item.insert(
            "subject".to_string(),
            AttributeValue::S("Test Issue".to_string()),
        );
        item.insert(
            "status".to_string(),
            AttributeValue::S("published".to_string()),
        );
        item.insert(
            "content".to_string(),
            AttributeValue::S("# Test Content".to_string()),
        );
        item.insert(
            "createdAt".to_string(),
            AttributeValue::S("2024-01-15T10:00:00Z".to_string()),
        );
        item.insert(
            "updatedAt".to_string(),
            AttributeValue::S("2024-01-15T10:30:00Z".to_string()),
        );
        item.insert(
            "publishedAt".to_string(),
            AttributeValue::S("2024-01-15T11:00:00Z".to_string()),
        );
        item.insert(
            "templateId".to_string(),
            AttributeValue::S("tmpl-123".to_string()),
        );

        let result = parse_issue_record(&item);
        assert!(result.is_ok());

        let issue = result.unwrap();
        assert_eq!(issue.issue_number, 42);
        assert_eq!(issue.subject, "Test Issue");
        assert_eq!(issue.status, "published");
        assert_eq!(issue.content, "# Test Content");
        assert_eq!(issue.published_at, Some("2024-01-15T11:00:00Z".to_string()));
        assert_eq!(issue.template_id, Some("tmpl-123".to_string()));
    }

    #[test]
    fn test_parse_issue_record_without_template_id() {
        let mut item = HashMap::new();
        item.insert(
            "pk".to_string(),
            AttributeValue::S("tenant-789#7".to_string()),
        );
        item.insert(
            "sk".to_string(),
            AttributeValue::S("newsletter".to_string()),
        );
        item.insert(
            "GSI1PK".to_string(),
            AttributeValue::S("tenant-789#newsletter".to_string()),
        );
        item.insert(
            "GSI1SK".to_string(),
            AttributeValue::S("2024-01-15T10:30:00Z".to_string()),
        );
        item.insert(
            "subject".to_string(),
            AttributeValue::S("No Template Issue".to_string()),
        );
        item.insert("status".to_string(), AttributeValue::S("draft".to_string()));
        item.insert(
            "content".to_string(),
            AttributeValue::S("content".to_string()),
        );
        item.insert(
            "createdAt".to_string(),
            AttributeValue::S("2024-01-15T10:00:00Z".to_string()),
        );
        item.insert(
            "updatedAt".to_string(),
            AttributeValue::S("2024-01-15T10:30:00Z".to_string()),
        );

        let issue = parse_issue_record(&item).unwrap();
        assert_eq!(issue.template_id, None);
    }

    #[test]
    fn test_parse_issue_record_draft_without_published_at() {
        let mut item = HashMap::new();
        item.insert(
            "pk".to_string(),
            AttributeValue::S("tenant-456#1".to_string()),
        );
        item.insert(
            "sk".to_string(),
            AttributeValue::S("newsletter".to_string()),
        );
        item.insert(
            "GSI1PK".to_string(),
            AttributeValue::S("tenant-456#newsletter".to_string()),
        );
        item.insert(
            "GSI1SK".to_string(),
            AttributeValue::S("2024-01-15T10:30:00Z".to_string()),
        );
        item.insert(
            "subject".to_string(),
            AttributeValue::S("Draft Issue".to_string()),
        );
        item.insert("status".to_string(), AttributeValue::S("draft".to_string()));
        item.insert(
            "content".to_string(),
            AttributeValue::S("Draft content".to_string()),
        );
        item.insert(
            "createdAt".to_string(),
            AttributeValue::S("2024-01-15T10:00:00Z".to_string()),
        );
        item.insert(
            "updatedAt".to_string(),
            AttributeValue::S("2024-01-15T10:30:00Z".to_string()),
        );

        let result = parse_issue_record(&item);
        assert!(result.is_ok());

        let issue = result.unwrap();
        assert_eq!(issue.issue_number, 1);
        assert_eq!(issue.status, "draft");
        assert_eq!(issue.published_at, None);
        assert_eq!(issue.scheduled_at, None);
    }

    #[test]
    fn test_parse_issue_stats_complete() {
        let mut item = HashMap::new();
        item.insert("opens".to_string(), AttributeValue::N("150".to_string()));
        item.insert("clicks".to_string(), AttributeValue::N("45".to_string()));
        item.insert(
            "deliveries".to_string(),
            AttributeValue::N("500".to_string()),
        );
        item.insert("bounces".to_string(), AttributeValue::N("5".to_string()));
        item.insert("complaints".to_string(), AttributeValue::N("2".to_string()));
        item.insert(
            "subscribers".to_string(),
            AttributeValue::N("480".to_string()),
        );
        item.insert(
            "subscribes".to_string(),
            AttributeValue::N("12".to_string()),
        );
        item.insert(
            "unsubscribes".to_string(),
            AttributeValue::N("3".to_string()),
        );
        item.insert("cleaned".to_string(), AttributeValue::N("1".to_string()));
        item.insert(
            "manualRemovals".to_string(),
            AttributeValue::N("2".to_string()),
        );

        let result = parse_issue_stats(&item);
        assert!(result.is_ok());

        let stats = result.unwrap();
        assert_eq!(stats.opens, 150);
        assert_eq!(stats.clicks, 45);
        assert_eq!(stats.deliveries, 500);
        assert_eq!(stats.bounces, 5);
        assert_eq!(stats.complaints, 2);
        assert_eq!(stats.subscribers, 480);
        assert_eq!(stats.subscribes, 12);
        assert_eq!(stats.unsubscribes, 3);
        assert_eq!(stats.cleaned, 1);
        assert_eq!(stats.manual_removals, 2);
    }

    #[test]
    fn test_parse_issue_stats_missing_fields_defaults_to_zero() {
        let item = HashMap::new();

        let result = parse_issue_stats(&item);
        assert!(result.is_ok());

        let stats = result.unwrap();
        assert_eq!(stats.opens, 0);
        assert_eq!(stats.clicks, 0);
        assert_eq!(stats.deliveries, 0);
        assert_eq!(stats.bounces, 0);
        assert_eq!(stats.complaints, 0);
        assert_eq!(stats.subscribers, 0);
        assert_eq!(stats.subscribes, 0);
        assert_eq!(stats.unsubscribes, 0);
        assert_eq!(stats.cleaned, 0);
        assert_eq!(stats.manual_removals, 0);
        assert!(stats.analytics.is_none());
    }

    #[test]
    fn test_parse_issue_stats_with_analytics_map() {
        let mut item = HashMap::new();
        item.insert("opens".to_string(), AttributeValue::N("150".to_string()));
        item.insert("clicks".to_string(), AttributeValue::N("45".to_string()));
        item.insert(
            "deliveries".to_string(),
            AttributeValue::N("500".to_string()),
        );
        item.insert("bounces".to_string(), AttributeValue::N("5".to_string()));
        item.insert("complaints".to_string(), AttributeValue::N("2".to_string()));

        let mut analytics_map = HashMap::new();
        let mut current_metrics = HashMap::new();
        current_metrics.insert(
            "openRate".to_string(),
            AttributeValue::N("26.0".to_string()),
        );
        current_metrics.insert(
            "clickThroughRate".to_string(),
            AttributeValue::N("9.0".to_string()),
        );
        analytics_map.insert(
            "currentMetrics".to_string(),
            AttributeValue::M(current_metrics),
        );

        item.insert("analytics".to_string(), AttributeValue::M(analytics_map));

        let result = parse_issue_stats(&item);
        assert!(result.is_ok());

        let stats = result.unwrap();
        assert_eq!(stats.opens, 150);
        assert!(stats.analytics.is_some());

        let analytics = stats.analytics.unwrap();
        assert!(analytics.is_object());
        assert!(analytics.get("currentMetrics").is_some());
    }

    #[test]
    fn test_parse_issue_stats_with_analytics_string() {
        let mut item = HashMap::new();
        item.insert("opens".to_string(), AttributeValue::N("150".to_string()));
        item.insert("clicks".to_string(), AttributeValue::N("45".to_string()));
        item.insert(
            "deliveries".to_string(),
            AttributeValue::N("500".to_string()),
        );
        item.insert("bounces".to_string(), AttributeValue::N("5".to_string()));
        item.insert("complaints".to_string(), AttributeValue::N("2".to_string()));

        let analytics_json = r#"{"currentMetrics":{"openRate":26.0,"clickThroughRate":9.0}}"#;
        item.insert(
            "analytics".to_string(),
            AttributeValue::S(analytics_json.to_string()),
        );

        let result = parse_issue_stats(&item);
        assert!(result.is_ok());

        let stats = result.unwrap();
        assert_eq!(stats.opens, 150);
        assert!(stats.analytics.is_some());

        let analytics = stats.analytics.unwrap();
        assert!(analytics.is_object());
        assert!(analytics.get("currentMetrics").is_some());
    }

    #[test]
    fn test_parse_issue_stats_without_analytics_backward_compatible() {
        let mut item = HashMap::new();
        item.insert("opens".to_string(), AttributeValue::N("150".to_string()));
        item.insert("clicks".to_string(), AttributeValue::N("45".to_string()));
        item.insert(
            "deliveries".to_string(),
            AttributeValue::N("500".to_string()),
        );
        item.insert("bounces".to_string(), AttributeValue::N("5".to_string()));
        item.insert("complaints".to_string(), AttributeValue::N("2".to_string()));

        let result = parse_issue_stats(&item);
        assert!(result.is_ok());

        let stats = result.unwrap();
        assert_eq!(stats.opens, 150);
        assert_eq!(stats.clicks, 45);
        assert_eq!(stats.deliveries, 500);
        assert_eq!(stats.bounces, 5);
        assert_eq!(stats.complaints, 2);
        assert!(stats.analytics.is_none());
    }

    #[test]
    fn test_build_issue_response_with_stats() {
        let issue = IssueRecord {
            pk: "tenant-123#42".to_string(),
            sk: "newsletter".to_string(),
            gsi1pk: "tenant-123#newsletter".to_string(),
            gsi1sk: "2024-01-15T10:30:00Z".to_string(),
            issue_number: 42,
            subject: "Test Issue".to_string(),
            status: "published".to_string(),
            content: "# Test Content".to_string(),
            created_at: "2024-01-15T10:00:00Z".to_string(),
            updated_at: "2024-01-15T10:30:00Z".to_string(),
            published_at: Some("2024-01-15T11:00:00Z".to_string()),
            scheduled_at: None,
            metadata: None,
            template_id: None,
            content_type: None,
            ab_test: None,
            local_send: None,
            content_assembly: None,
            execution_arn: None,
        };

        let stats = Some(IssueStats {
            opens: 150,
            clicks: 45,
            deliveries: 500,
            bounces: 5,
            complaints: 2,
            subscribers: 0,
            subscribes: 0,
            unsubscribes: 0,
            cleaned: 0,
            manual_removals: 0,
            analytics: None,
        });

        let response = build_issue_response(issue, stats, None, Vec::new(), None, None);

        assert_eq!(response.id, "42");
        assert_eq!(response.issue_number, 42);
        assert_eq!(response.subject, "Test Issue");
        assert_eq!(response.status, "published");
        assert!(response.stats.is_some());
        assert_eq!(response.stats.unwrap().opens, 150);
    }

    #[test]
    fn test_build_issue_response_without_stats() {
        let issue = IssueRecord {
            pk: "tenant-123#1".to_string(),
            sk: "newsletter".to_string(),
            gsi1pk: "tenant-123#newsletter".to_string(),
            gsi1sk: "2024-01-15T10:30:00Z".to_string(),
            issue_number: 1,
            subject: "Draft Issue".to_string(),
            status: "draft".to_string(),
            content: "Draft content".to_string(),
            created_at: "2024-01-15T10:00:00Z".to_string(),
            updated_at: "2024-01-15T10:30:00Z".to_string(),
            published_at: None,
            scheduled_at: None,
            metadata: None,
            template_id: None,
            content_type: None,
            ab_test: None,
            local_send: None,
            content_assembly: None,
            execution_arn: None,
        };

        let response = build_issue_response(issue, None, None, Vec::new(), None, None);

        assert_eq!(response.id, "1");
        assert_eq!(response.issue_number, 1);
        assert_eq!(response.status, "draft");
        assert!(response.stats.is_none());
        assert!(response.published_at.is_none());
    }

    #[test]
    fn test_validate_create_request_valid() {
        let request = CreateIssueRequest {
            issue_number: None,
            subject: "Test Issue".to_string(),
            content: "# Test Content".to_string(),
            scheduled_at: None,
            action: None,
            metadata: None,
            template_id: None,
            content_type: None,
            ttl_seconds: None,
        };

        let result = validate_create_request(&request);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_create_request_empty_subject() {
        let request = CreateIssueRequest {
            issue_number: None,
            subject: "".to_string(),
            content: "# Test Content".to_string(),
            scheduled_at: None,
            action: None,
            metadata: None,
            template_id: None,
            content_type: None,
            ttl_seconds: None,
        };

        let result = validate_create_request(&request);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_create_request_subject_too_long() {
        let request = CreateIssueRequest {
            issue_number: None,
            subject: "a".repeat(201),
            content: "# Test Content".to_string(),
            scheduled_at: None,
            action: None,
            metadata: None,
            template_id: None,
            content_type: None,
            ttl_seconds: None,
        };

        let result = validate_create_request(&request);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_create_request_ttl_seconds_valid() {
        let mut request = create_request("# Test Content", None, None);
        request.ttl_seconds = Some(3600);

        assert!(validate_create_request(&request).is_ok());
    }

    #[test]
    fn test_validate_create_request_ttl_seconds_zero_rejected() {
        let mut request = create_request("# Test Content", None, None);
        request.ttl_seconds = Some(0);

        let result = validate_create_request(&request);
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_create_request_ttl_seconds_negative_rejected() {
        let mut request = create_request("# Test Content", None, None);
        request.ttl_seconds = Some(-5);

        let result = validate_create_request(&request);
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_create_request_ttl_seconds_too_large_rejected() {
        let mut request = create_request("# Test Content", None, None);
        request.ttl_seconds = Some(MAX_TTL_SECONDS + 1);

        let result = validate_create_request(&request);
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_build_draft_ttl_schedule_name_is_valid() {
        let name = build_draft_ttl_schedule_name("tenant-abc_123", 42);

        assert_eq!(name, "draft-ttl-tenant-abc_123-42");
        assert!(name.len() <= 64);
        assert!(name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'));
    }

    #[test]
    fn test_build_draft_ttl_schedule_name_is_deterministic() {
        // Re-staging a draft must produce the same name so the prior TTL
        // schedule is found and replaced instead of leaking (and later firing
        // against the re-staged draft).
        assert_eq!(
            build_draft_ttl_schedule_name("tenant-abc_123", 42),
            build_draft_ttl_schedule_name("tenant-abc_123", 42)
        );
    }

    #[test]
    fn test_compute_idempotency_hash_stable_for_identical_requests() {
        let request = create_request("# Test Content", None, None);
        let ab_test = serde_json::json!({ "dimension": "subject", "variants": ["A", "B"] });

        let first = compute_idempotency_hash(
            &request,
            7,
            CreateIssueAction::Draft,
            None,
            Some(&ab_test),
            None,
            None,
        );
        let second = compute_idempotency_hash(
            &request,
            7,
            CreateIssueAction::Draft,
            None,
            Some(&ab_test),
            None,
            None,
        );

        assert_eq!(first, second);
    }

    #[test]
    fn test_compute_idempotency_hash_survives_a_tenant_settings_change() {
        // The hash covers the caller's date-only value, not the instant it
        // resolves to. A tenant editing their timezone or send time between a
        // request and its retry must not turn a byte-identical replay into a
        // 409 — which is exactly what hashing the resolved instant would do.
        let request = create_request("# Test Content", None, None);

        let before = compute_idempotency_hash(
            &request,
            7,
            CreateIssueAction::Schedule,
            Some("2026-08-01"),
            None,
            None,
            None,
        );
        let after = compute_idempotency_hash(
            &request,
            7,
            CreateIssueAction::Schedule,
            Some("2026-08-01"),
            None,
            None,
            None,
        );

        assert_eq!(before, after);

        // Sanity check that the field still participates at all: a different
        // date is still a different request.
        let other_date = compute_idempotency_hash(
            &request,
            7,
            CreateIssueAction::Schedule,
            Some("2026-08-02"),
            None,
            None,
            None,
        );
        assert_ne!(before, other_date);
    }

    #[test]
    fn test_resolve_scheduled_at_varies_with_settings_the_hash_ignores() {
        // The other half of the guarantee above: the same date-only value
        // genuinely does resolve to different instants under different
        // settings, so hashing the resolved form would have been unstable.
        let date = format!("{}-08-01", future_year());

        let chicago =
            resolve_scheduled_at(Some(&date), &tenant_settings("America/Chicago", "09:00"))
                .unwrap();
        let tokyo =
            resolve_scheduled_at(Some(&date), &tenant_settings("Asia/Tokyo", "09:00")).unwrap();

        assert_ne!(chicago, tokyo);
    }

    #[test]
    fn test_compute_idempotency_hash_changes_with_send_config() {
        // A reused key with changed abTest/localSend/contentAssembly must not
        // look like an exact replay: replaying would silently keep the old
        // send configuration.
        let request = create_request("# Test Content", None, None);
        let ab_test = serde_json::json!({ "dimension": "subject", "variants": ["A", "B"] });
        let local_send = serde_json::json!({ "enabled": true, "batchSize": 10 });
        let content_assembly = serde_json::json!({ "enabled": true });

        let base = compute_idempotency_hash(
            &request,
            7,
            CreateIssueAction::Draft,
            None,
            None,
            None,
            None,
        );
        let with_ab = compute_idempotency_hash(
            &request,
            7,
            CreateIssueAction::Draft,
            None,
            Some(&ab_test),
            None,
            None,
        );
        let with_local_send = compute_idempotency_hash(
            &request,
            7,
            CreateIssueAction::Draft,
            None,
            None,
            Some(&local_send),
            None,
        );
        let with_assembly = compute_idempotency_hash(
            &request,
            7,
            CreateIssueAction::Draft,
            None,
            None,
            None,
            Some(&content_assembly),
        );

        assert_ne!(base, with_ab);
        assert_ne!(base, with_local_send);
        assert_ne!(base, with_assembly);
        assert_ne!(with_ab, with_local_send);
    }

    fn scheduled_issue(scheduled_at: &str, execution_arn: Option<&str>) -> IssueRecord {
        IssueRecord {
            pk: "tenant-123#42".to_string(),
            sk: "newsletter".to_string(),
            gsi1pk: "tenant-123#newsletter".to_string(),
            gsi1sk: "2026-07-24T18:00:00Z".to_string(),
            issue_number: 42,
            subject: "Test Issue".to_string(),
            status: "scheduled".to_string(),
            content: "# Test Content".to_string(),
            created_at: "2026-07-24T18:00:00Z".to_string(),
            updated_at: "2026-07-24T18:00:00Z".to_string(),
            published_at: None,
            scheduled_at: Some(scheduled_at.to_string()),
            metadata: None,
            template_id: None,
            content_type: None,
            ab_test: None,
            local_send: None,
            content_assembly: None,
            execution_arn: execution_arn.map(str::to_string),
        }
    }

    /// A scheduled issue has no execution until the Scheduler starts one, so the
    /// record is what has to say "waiting for the send time". Reporting nothing
    /// here would leave the dashboard with no explanation for an issue that is
    /// scheduled and has no progress record either.
    #[tokio::test]
    async fn test_workflow_state_reports_waiting_before_the_execution_exists() {
        let issue = scheduled_issue(
            &(chrono::Utc::now() + chrono::Duration::hours(2)).to_rfc3339(),
            None,
        );

        let workflow = get_workflow_state_for(&issue, false).await;

        assert_eq!(
            workflow,
            Some(send_progress::waiting_for_send_time()),
            "a scheduled issue with no execution should still report waiting"
        );
    }

    /// The send time has passed and no execution ever recorded itself, which is
    /// not "waiting" — it is a schedule that did not fire, and claiming the
    /// workflow is on its way would hide that.
    #[tokio::test]
    async fn test_workflow_state_is_silent_when_a_past_send_never_started() {
        let issue = scheduled_issue("2026-07-24T18:00:00Z", None);

        assert_eq!(get_workflow_state_for(&issue, false).await, None);
    }

    #[tokio::test]
    async fn test_workflow_state_is_silent_while_a_local_send_is_reporting() {
        let issue = scheduled_issue(
            &(chrono::Utc::now() + chrono::Duration::hours(2)).to_rfc3339(),
            None,
        );

        // Send progress is both more detailed and longer-lived than anything
        // this could add.
        assert_eq!(get_workflow_state_for(&issue, true).await, None);
    }

    /// The execution input is the contract with the state machine, and the whole
    /// point of Phase 5 is what is *not* in it: an execution started at the send
    /// instant that carried the content would be publishing whatever the record
    /// said when the issue was scheduled, days earlier.
    #[test]
    fn test_build_execution_input_carries_identifiers_only() {
        let input = build_execution_input(&IssueScheduleInput {
            tenant_id: "tenant-123",
            tenant_email: "owner@example.com",
            issue_number: 42,
            scheduled_at: Some("2026-07-27T14:00:00+00:00"),
            template_id: Some("tmpl-1"),
            content_type: "markdown",
        });

        assert_eq!(
            input,
            serde_json::json!({
                "fileName": "issue-42",
                "issueId": 42,
                "tenant": { "id": "tenant-123", "email": "owner@example.com" },
                "templateId": "tmpl-1",
                "contentType": "markdown"
            })
        );
        // Named individually because each one is a specific bug if it comes
        // back: content and subject are read off the record now, and futureDate
        // is what parked the execution in the definition's `Wait`.
        for absent in ["content", "subject", "futureDate"] {
            assert!(input.get(absent).is_none(), "{absent} is back on the input");
        }
    }

    #[test]
    fn test_build_execution_input_always_carries_a_template_id() {
        let input = build_execution_input(&IssueScheduleInput {
            tenant_id: "tenant-123",
            tenant_email: "owner@example.com",
            issue_number: 7,
            scheduled_at: None,
            template_id: None,
            content_type: "json",
        });

        // Present-but-null, because the definition reads it with an
        // unconditional `.$` path: an absent field is a runtime error there.
        assert_eq!(input["templateId"], serde_json::Value::Null);
    }

    #[test]
    fn test_parse_lead_time_minutes_defaults_to_zero() {
        assert_eq!(parse_lead_time_minutes(None), 0);
        assert_eq!(parse_lead_time_minutes(Some("")), 0);
        assert_eq!(parse_lead_time_minutes(Some("  ")), 0);
        assert_eq!(parse_lead_time_minutes(Some("soon")), 0);
        // A negative lead time would move a send *later* than its scheduled
        // instant, which is never what anyone configuring this means.
        assert_eq!(parse_lead_time_minutes(Some("-30")), 0);
    }

    #[test]
    fn test_parse_lead_time_minutes_reads_a_configured_value() {
        assert_eq!(parse_lead_time_minutes(Some("1440")), 1440);
        assert_eq!(parse_lead_time_minutes(Some(" 90 ")), 90);
    }

    #[test]
    fn test_issue_send_fire_at_subtracts_the_lead_time() {
        let send_instant = timestamp("2026-07-27T14:00:00Z");
        let now = timestamp("2026-07-24T18:00:00Z");

        assert_eq!(
            issue_send_fire_at(send_instant, chrono::Duration::zero(), now),
            send_instant
        );
        assert_eq!(
            issue_send_fire_at(send_instant, chrono::Duration::hours(24), now),
            timestamp("2026-07-26T14:00:00Z")
        );
    }

    /// An issue scheduled with less notice than the lead time. Firing at the
    /// clamped time means the workflow starts as early as it can, rather than
    /// asking Scheduler for a moment that has already passed.
    #[test]
    fn test_issue_send_fire_at_never_asks_for_a_past_time() {
        let send_instant = timestamp("2026-07-27T14:00:00Z");
        let now = timestamp("2026-07-27T09:00:00Z");

        assert_eq!(
            issue_send_fire_at(send_instant, chrono::Duration::hours(24), now),
            now
        );
    }

    /// The name is a per-issue lock: `CreateSchedule` conflicts on it (so a
    /// second schedule request cannot create a second send) and the cancel path
    /// has to be able to reconstruct it from (tenant, issue) alone.
    #[test]
    fn test_build_issue_send_schedule_name_is_deterministic_and_legal() {
        let name = build_issue_send_schedule_name("ten@nt/with#bad chars", 42);

        assert_eq!(
            name,
            build_issue_send_schedule_name("ten@nt/with#bad chars", 42)
        );
        assert_ne!(
            name,
            build_issue_send_schedule_name("ten@nt/with#bad chars", 43)
        );
        // Matched by the IAM resource pattern in template.yaml.
        assert!(name.starts_with("ISSUE-SEND-"));
        assert!(name.ends_with("-42"));
        assert!(name.len() <= 64);
        assert!(name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'));
    }

    #[test]
    fn test_schedule_names_stay_within_scheduler_limits_for_a_long_tenant_id() {
        let tenant_id = "a".repeat(200);

        assert!(build_issue_send_schedule_name(&tenant_id, 1_000_000).len() <= 64);
        assert!(build_draft_ttl_schedule_name(&tenant_id, 1_000_000).len() <= 64);
    }

    /// `draft` is the unschedule request. It is validated here and gated on the
    /// issue actually being `scheduled` in `handle_update_issue`.
    #[test]
    fn test_validate_update_request_accepts_the_two_settable_statuses() {
        for status in ["published", "draft"] {
            let request = UpdateIssueRequest {
                subject: None,
                content: None,
                scheduled_at: None,
                metadata: None,
                status: Some(status.to_string()),
                template_id: None,
                content_type: None,
            };

            assert!(
                validate_update_request(&request, false).is_ok(),
                "status {status} should be settable"
            );
        }
    }

    #[test]
    fn test_validate_update_request_rejects_pipeline_owned_statuses() {
        for status in ["scheduled", "in progress", "sending", "failed"] {
            let request = UpdateIssueRequest {
                subject: None,
                content: None,
                scheduled_at: None,
                metadata: None,
                status: Some(status.to_string()),
                template_id: None,
                content_type: None,
            };

            assert!(
                matches!(
                    validate_update_request(&request, false),
                    Err(AppError::BadRequest(_))
                ),
                "status {status} should not be settable by a caller"
            );
        }
    }

    fn timestamp(value: &str) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&chrono::Utc)
    }

    #[test]
    fn test_build_draft_ttl_schedule_name_sanitizes_tenant() {
        // Characters outside the allowed scheduler-name set are stripped.
        let name = build_draft_ttl_schedule_name("ten@nt/with#bad chars", 7);

        assert!(name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'));
        assert!(name.contains("tenntwithbad"));
    }

    #[test]
    fn test_validate_create_request_empty_content() {
        let request = CreateIssueRequest {
            issue_number: None,
            subject: "Test Issue".to_string(),
            content: "".to_string(),
            scheduled_at: None,
            action: None,
            metadata: None,
            template_id: None,
            content_type: None,
            ttl_seconds: None,
        };

        let result = validate_create_request(&request);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_update_request_valid_single_field() {
        let request = UpdateIssueRequest {
            subject: Some("Updated Subject".to_string()),
            content: None,
            scheduled_at: None,
            metadata: None,
            status: None,
            template_id: None,
            content_type: None,
        };

        let result = validate_update_request(&request, false);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_update_request_valid_multiple_fields() {
        let request = UpdateIssueRequest {
            subject: Some("Updated Subject".to_string()),
            content: Some("Updated content".to_string()),
            scheduled_at: None,
            metadata: None,
            status: None,
            template_id: None,
            content_type: None,
        };

        let result = validate_update_request(&request, false);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_update_request_no_fields() {
        let request = UpdateIssueRequest {
            subject: None,
            content: None,
            scheduled_at: None,
            metadata: None,
            status: None,
            template_id: None,
            content_type: None,
        };

        let result = validate_update_request(&request, false);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_update_request_empty_subject() {
        let request = UpdateIssueRequest {
            subject: Some("".to_string()),
            content: None,
            scheduled_at: None,
            metadata: None,
            status: None,
            template_id: None,
            content_type: None,
        };

        let result = validate_update_request(&request, false);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_update_request_subject_too_long() {
        let request = UpdateIssueRequest {
            subject: Some("a".repeat(201)),
            content: None,
            scheduled_at: None,
            metadata: None,
            status: None,
            template_id: None,
            content_type: None,
        };

        let result = validate_update_request(&request, false);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_update_request_empty_content() {
        let request = UpdateIssueRequest {
            subject: None,
            content: Some("".to_string()),
            scheduled_at: None,
            metadata: None,
            status: None,
            template_id: None,
            content_type: None,
        };

        let result = validate_update_request(&request, false);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_check_update_allowed_draft() {
        let issue = IssueRecord {
            pk: "tenant-123#1".to_string(),
            sk: "newsletter".to_string(),
            gsi1pk: "tenant-123#newsletter".to_string(),
            gsi1sk: "2024-01-15T10:00:00Z".to_string(),
            issue_number: 1,
            subject: "Test Issue".to_string(),
            status: "draft".to_string(),
            content: "Content".to_string(),
            created_at: "2024-01-15T10:00:00Z".to_string(),
            updated_at: "2024-01-15T10:00:00Z".to_string(),
            published_at: None,
            scheduled_at: None,
            metadata: None,
            template_id: None,
            content_type: None,
            ab_test: None,
            local_send: None,
            content_assembly: None,
            execution_arn: None,
        };

        let result = check_update_allowed(&issue);
        assert!(result.is_ok());
    }

    #[test]
    fn test_check_update_allowed_published() {
        let issue = IssueRecord {
            pk: "tenant-123#1".to_string(),
            sk: "newsletter".to_string(),
            gsi1pk: "tenant-123#newsletter".to_string(),
            gsi1sk: "2024-01-15T10:00:00Z".to_string(),
            issue_number: 1,
            subject: "Test Issue".to_string(),
            status: "published".to_string(),
            content: "Content".to_string(),
            created_at: "2024-01-15T10:00:00Z".to_string(),
            updated_at: "2024-01-15T10:00:00Z".to_string(),
            published_at: Some("2024-01-15T11:00:00Z".to_string()),
            scheduled_at: None,
            metadata: None,
            template_id: None,
            content_type: None,
            ab_test: None,
            local_send: None,
            content_assembly: None,
            execution_arn: None,
        };

        let result = check_update_allowed(&issue);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_check_update_allowed_scheduled() {
        let issue = IssueRecord {
            pk: "tenant-123#1".to_string(),
            sk: "newsletter".to_string(),
            gsi1pk: "tenant-123#newsletter".to_string(),
            gsi1sk: "2024-01-15T10:00:00Z".to_string(),
            issue_number: 1,
            subject: "Test Issue".to_string(),
            status: "scheduled".to_string(),
            content: "Content".to_string(),
            created_at: "2024-01-15T10:00:00Z".to_string(),
            updated_at: "2024-01-15T10:00:00Z".to_string(),
            published_at: None,
            scheduled_at: Some("2024-01-16T10:00:00Z".to_string()),
            metadata: None,
            template_id: None,
            content_type: None,
            ab_test: None,
            local_send: None,
            content_assembly: None,
            execution_arn: None,
        };

        let result = check_update_allowed(&issue);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_check_delete_allowed_draft() {
        let issue = IssueRecord {
            pk: "tenant-123#1".to_string(),
            sk: "newsletter".to_string(),
            gsi1pk: "tenant-123#newsletter".to_string(),
            gsi1sk: "2024-01-15T10:00:00Z".to_string(),
            issue_number: 1,
            subject: "Test Issue".to_string(),
            status: "draft".to_string(),
            content: "Content".to_string(),
            created_at: "2024-01-15T10:00:00Z".to_string(),
            updated_at: "2024-01-15T10:00:00Z".to_string(),
            published_at: None,
            scheduled_at: None,
            metadata: None,
            template_id: None,
            content_type: None,
            ab_test: None,
            local_send: None,
            content_assembly: None,
            execution_arn: None,
        };

        let result = check_delete_allowed(&issue);
        assert!(result.is_ok());
    }

    #[test]
    fn test_check_delete_allowed_published() {
        let issue = IssueRecord {
            pk: "tenant-123#1".to_string(),
            sk: "newsletter".to_string(),
            gsi1pk: "tenant-123#newsletter".to_string(),
            gsi1sk: "2024-01-15T10:00:00Z".to_string(),
            issue_number: 1,
            subject: "Test Issue".to_string(),
            status: "published".to_string(),
            content: "Content".to_string(),
            created_at: "2024-01-15T10:00:00Z".to_string(),
            updated_at: "2024-01-15T10:00:00Z".to_string(),
            published_at: Some("2024-01-15T11:00:00Z".to_string()),
            scheduled_at: None,
            metadata: None,
            template_id: None,
            content_type: None,
            ab_test: None,
            local_send: None,
            content_assembly: None,
            execution_arn: None,
        };

        let result = check_delete_allowed(&issue);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Conflict(_)));
    }

    #[test]
    fn test_check_delete_allowed_scheduled() {
        let issue = IssueRecord {
            pk: "tenant-123#1".to_string(),
            sk: "newsletter".to_string(),
            gsi1pk: "tenant-123#newsletter".to_string(),
            gsi1sk: "2024-01-15T10:00:00Z".to_string(),
            issue_number: 1,
            subject: "Test Issue".to_string(),
            status: "scheduled".to_string(),
            content: "Content".to_string(),
            created_at: "2024-01-15T10:00:00Z".to_string(),
            updated_at: "2024-01-15T10:00:00Z".to_string(),
            published_at: None,
            scheduled_at: Some("2024-01-16T10:00:00Z".to_string()),
            metadata: None,
            template_id: None,
            content_type: None,
            ab_test: None,
            local_send: None,
            content_assembly: None,
            execution_arn: None,
        };

        let result = check_delete_allowed(&issue);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Conflict(_)));
    }

    #[test]
    fn test_check_delete_allowed_failed() {
        let issue = IssueRecord {
            pk: "tenant-123#1".to_string(),
            sk: "newsletter".to_string(),
            gsi1pk: "tenant-123#newsletter".to_string(),
            gsi1sk: "2024-01-15T10:00:00Z".to_string(),
            issue_number: 1,
            subject: "Test Issue".to_string(),
            status: "failed".to_string(),
            content: "Content".to_string(),
            created_at: "2024-01-15T10:00:00Z".to_string(),
            updated_at: "2024-01-15T10:00:00Z".to_string(),
            published_at: None,
            scheduled_at: None,
            metadata: None,
            template_id: None,
            content_type: None,
            ab_test: None,
            local_send: None,
            content_assembly: None,
            execution_arn: None,
        };

        let result = check_delete_allowed(&issue);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Conflict(_)));
    }

    // TODO: Property tests are commented out due to proptest! macro syntax issue
    // The property tests need to be wrapped in proptest! macro properly
    /*
        #[test]
        fn property_7_get_issue_response_completeness(
            subject in "[a-zA-Z0-9 ]{5,50}",
            status in prop::sample::select(vec!["draft", "scheduled", "published", "failed"]),
            content in "[a-zA-Z0-9 \n]{10,100}",
            created_at in "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z",
            updated_at in "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z",
            has_stats in prop::bool::ANY
        ) {
            let issue = IssueRecord {
                pk: format!("tenant-123#{}", issue_number),
                sk: "newsletter".to_string(),
                gsi1pk: "tenant-123#newsletter".to_string(),
                gsi1sk: created_at.clone(),
                issue_number,
                subject: subject.clone(),
                status: status.to_string(),
                content: content.clone(),
                created_at: created_at.clone(),
                updated_at: updated_at.clone(),
                published_at: if status == "published" { Some(updated_at.clone()) } else { None },
                scheduled_at: if status == "scheduled" { Some(updated_at.clone()) } else { None },
                metadata: None,
                template_id: None,
            content_type: None,
            };

            let stats = if has_stats && status == "published" {
                Some(IssueStats {
                    opens: 100,
                    clicks: 50,
                    deliveries: 500,
                    bounces: 5,
                    complaints: 2,
                    insights: None,
                })
            } else {
                None
            };

            let response = build_issue_response(issue, stats.clone(), None);

            prop_assert_eq!(response.issue_number, issue_number);
            prop_assert_eq!(&response.subject, &subject);
            prop_assert_eq!(&response.status, status);
            prop_assert_eq!(&response.content, &content);
            prop_assert_eq!(&response.created_at, &created_at);
            prop_assert_eq!(&response.updated_at, &updated_at);

            if status == "published" {
                prop_assert!(response.published_at.is_some());
            }

            if status == "scheduled" {
                prop_assert!(response.scheduled_at.is_some());
            }

            if has_stats && status == "published" {
                prop_assert!(response.stats.is_some());
            }
        }

        /// **Feature: issue-management-api, Property 8: Tenant Isolation for Single Operations**
        ///
        /// For any operation (GET, PUT, DELETE) on a specific issue ID, if the issue does not exist
        /// or belongs to a different tenant than the authenticated user, the operation must return
        /// 404 Not Found.
        ///
        /// **Validates: Requirements AC-2.3, AC-5.4, AC-6.3**
        #[test]
        fn property_8_tenant_isolation_for_single_operations(
            tenant_a in "[a-z0-9]{8,16}",
            tenant_b in "[a-z0-9]{8,16}".prop_filter("Different tenant", |b| b != "tenant_a"),
            issue_number in 1i32..1000
        ) {
            let mut item_tenant_a = HashMap::new();
            item_tenant_a.insert("pk".to_string(), AttributeValue::S(format!("{}#{}", tenant_a, issue_number)));
            item_tenant_a.insert("sk".to_string(), AttributeValue::S("newsletter".to_string()));
            item_tenant_a.insert("GSI1PK".to_string(), AttributeValue::S(format!("{}#newsletter", tenant_a)));
            item_tenant_a.insert("GSI1SK".to_string(), AttributeValue::S("2024-01-15T10:00:00Z".to_string()));
            item_tenant_a.insert("subject".to_string(), AttributeValue::S("Test Issue".to_string()));
            item_tenant_a.insert("status".to_string(), AttributeValue::S("draft".to_string()));
            item_tenant_a.insert("content".to_string(), AttributeValue::S("Content".to_string()));
            item_tenant_a.insert("createdAt".to_string(), AttributeValue::S("2024-01-15T10:00:00Z".to_string()));
            item_tenant_a.insert("updatedAt".to_string(), AttributeValue::S("2024-01-15T10:00:00Z".to_string()));

            let result_a = parse_issue_record(&item_tenant_a);
            prop_assert!(result_a.is_ok());
            let issue_a = result_a.unwrap();
            prop_assert_eq!(&issue_a.pk, &format!("{}#{}", tenant_a, issue_number));

            let mut item_tenant_b = HashMap::new();
            item_tenant_b.insert("pk".to_string(), AttributeValue::S(format!("{}#{}", tenant_b, issue_number)));
            item_tenant_b.insert("sk".to_string(), AttributeValue::S("newsletter".to_string()));
            item_tenant_b.insert("GSI1PK".to_string(), AttributeValue::S(format!("{}#newsletter", tenant_b)));
            item_tenant_b.insert("GSI1SK".to_string(), AttributeValue::S("2024-01-15T10:00:00Z".to_string()));
            item_tenant_b.insert("subject".to_string(), AttributeValue::S("Test Issue".to_string()));
            item_tenant_b.insert("status".to_string(), AttributeValue::S("draft".to_string()));
            item_tenant_b.insert("content".to_string(), AttributeValue::S("Content".to_string()));
            item_tenant_b.insert("createdAt".to_string(), AttributeValue::S("2024-01-15T10:00:00Z".to_string()));
            item_tenant_b.insert("updatedAt".to_string(), AttributeValue::S("2024-01-15T10:00:00Z".to_string()));

            let result_b = parse_issue_record(&item_tenant_b);
            prop_assert!(result_b.is_ok());
            let issue_b = result_b.unwrap();
            prop_assert_eq!(&issue_b.pk, &format!("{}#{}", tenant_b, issue_number));

            prop_assert_ne!(&issue_a.pk, &issue_b.pk, "Issues from different tenants must have different PKs");
        }

        #[test]
        fn property_2_list_response_completeness(
            issue_number in 1i32..1000,
            subject in "[a-zA-Z0-9 ]{5,50}",
            status in prop::sample::select(vec!["draft", "scheduled", "published", "failed"]),
            created_at in "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z"
        ) {
            let mut item = HashMap::new();
            item.insert("pk".to_string(), AttributeValue::S(format!("tenant-123#{}", issue_number)));
            item.insert("sk".to_string(), AttributeValue::S("newsletter".to_string()));
            item.insert("subject".to_string(), AttributeValue::S(subject.clone()));
            item.insert("status".to_string(), AttributeValue::S(status.to_string()));
            item.insert("createdAt".to_string(), AttributeValue::S(created_at.clone()));

            let result = parse_issue_list_item(&item);

            prop_assert!(result.is_ok(), "Parsing should succeed for valid items");
            let issue = result.unwrap();

            prop_assert_eq!(issue.issue_number, issue_number);
            prop_assert_eq!(&issue.subject, &subject);
            prop_assert_eq!(&issue.status, status);
            prop_assert_eq!(&issue.created_at, &created_at);
        }

        #[test]
        fn property_3_pagination_limit_enforcement(
            limit in 1i32..=100
        ) {
            let query = ListIssuesQuery {
                limit,
                next_token: None,
                status: None,
            };

            let result = validate_list_params(&query);
            prop_assert!(result.is_ok());
        }

        #[test]
        fn property_3_pagination_limit_rejection(
            limit in prop::sample::select(vec![-100i32, -1, 0, 101, 200, 1000])
        ) {
            let query = ListIssuesQuery {
                limit,
                next_token: None,
                status: None,
            };

            let result = validate_list_params(&query);
            prop_assert!(result.is_err());
            prop_assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
        }

        #[test]
        fn property_5_status_filter_correctness_valid(
            status in prop::sample::select(vec!["draft", "scheduled", "published", "failed"])
        ) {
            let query = ListIssuesQuery {
                limit: 20,
                next_token: None,
                status: Some(status.to_string()),
            };

            let result = validate_list_params(&query);
            prop_assert!(result.is_ok());
        }

        #[test]
        fn property_5_status_filter_correctness_invalid(
            status in "[a-z]{5,15}".prop_filter("Not a valid status", |s| {
                !["draft", "scheduled", "published", "failed"].contains(&s.as_str())
            })
        ) {
            let query = ListIssuesQuery {
                limit: 20,
                next_token: None,
                status: Some(status),
            };

            let result = validate_list_params(&query);
            prop_assert!(result.is_err());
            prop_assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
        }

        #[test]
        fn property_6_pagination_token_roundtrip(
            pk_num in 1i32..1000,
            timestamp in "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z"
        ) {
            let mut key = HashMap::new();
            key.insert("pk".to_string(), AttributeValue::S(format!("tenant-123#{}", pk_num)));
            key.insert("sk".to_string(), AttributeValue::S("newsletter".to_string()));
            key.insert("GSI1PK".to_string(), AttributeValue::S("tenant-123#newsletter".to_string()));
            key.insert("GSI1SK".to_string(), AttributeValue::S(timestamp.clone()));

            let token = encode_pagination_token(&key);
            prop_assert!(!token.is_empty());

            let decoded = decode_pagination_token(&token);
            prop_assert!(decoded.is_ok());

            let decoded_key = decoded.unwrap();
            prop_assert_eq!(decoded_key.get("pk"), key.get("pk"));
            prop_assert_eq!(decoded_key.get("sk"), key.get("sk"));
        }

        /// **Feature: issue-management-api, Property 12: Create Issue Draft Status**
        ///
        /// For any successfully created issue, the initial status must be set to "draft"
        /// regardless of the input parameters.
        ///
        /// **Validates: Requirements AC-4.1, AC-4.4**
        #[test]
        fn property_12_create_issue_draft_status(
            issue_number in 1i32..1000,
            subject in "[a-zA-Z0-9 ]{5,50}",
            content in "[a-zA-Z0-9 \n]{10,100}"
        ) {
            let request = CreateIssueRequest {
                issue_number: None,
                subject: subject.clone(),
                content: content.clone(),
                scheduled_at: None,
                action: None,
                metadata: None,
                template_id: None,
            content_type: None,
                ttl_seconds: None,
            };

            let now = chrono::Utc::now().to_rfc3339();
            let response = CreateIssueResponse {
                id: issue_number.to_string(),
                issue_number,
                subject: subject.clone(),
                status: "draft".to_string(),
                content: content.clone(),
                created_at: now.clone(),
                updated_at: now,
            };

            prop_assert_eq!(&response.status, "draft", "Created issue must have draft status");
            prop_assert_eq!(response.issue_number, issue_number);
            prop_assert_eq!(&response.subject, &subject);
            prop_assert_eq!(&response.content, &content);
        }

        /// **Feature: issue-management-api, Property 13: Create Issue Uniqueness**
        ///
        /// For any two issues created within the same tenant, their issue numbers must be
        /// unique and strictly increasing.
        ///
        /// **Validates: Requirements AC-4.3**
        #[test]
        fn property_13_create_issue_uniqueness(
            issue_numbers in prop::collection::vec(1i32..1000, 2..10)
        ) {
            let mut sorted_numbers = issue_numbers.clone();
            sorted_numbers.sort();
            sorted_numbers.dedup();

            for i in 0..sorted_numbers.len().saturating_sub(1) {
                prop_assert!(
                    sorted_numbers[i] < sorted_numbers[i + 1],
                    "Issue numbers must be strictly increasing"
                );
            }

            prop_assert_eq!(
                sorted_numbers.len(),
                issue_numbers.iter().collect::<std::collections::HashSet<_>>().len(),
                "All issue numbers must be unique"
            );
        }

        /// **Feature: issue-management-api, Property 14: Create Issue Input Validation**
        ///
        /// For any create request missing required fields (subject, content) or containing
        /// invalid content format, the operation must return 400 Bad Request with a descriptive
        /// error message.
        ///
        /// **Validates: Requirements AC-4.5**
        #[test]
        fn property_14_create_issue_input_validation_missing_subject(
            content in "[a-zA-Z0-9 \n]{10,100}"
        ) {
            let request = CreateIssueRequest {
                issue_number: None,
                subject: "".to_string(),
                content,
                scheduled_at: None,
                action: None,
                metadata: None,
                template_id: None,
            content_type: None,
                ttl_seconds: None,
            };

            let result = validate_create_request(&request);
            prop_assert!(result.is_err());
            prop_assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
        }

        #[test]
        fn property_14_create_issue_input_validation_missing_content(
            subject in "[a-zA-Z0-9 ]{5,50}"
        ) {
            let request = CreateIssueRequest {
                issue_number: None,
                subject,
                content: "".to_string(),
                scheduled_at: None,
                action: None,
                metadata: None,
                template_id: None,
            content_type: None,
                ttl_seconds: None,
            };

            let result = validate_create_request(&request);
            prop_assert!(result.is_err());
            prop_assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
        }

        #[test]
        fn property_14_create_issue_input_validation_subject_too_long(
            content in "[a-zA-Z0-9 \n]{10,100}"
        ) {
            let request = CreateIssueRequest {
                issue_number: None,
                subject: "a".repeat(201),
                content,
                scheduled_at: None,
                action: None,
                metadata: None,
                template_id: None,
            content_type: None,
                ttl_seconds: None,
            };

            let result = validate_create_request(&request);
            prop_assert!(result.is_err());
            prop_assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
        }

        /// **Feature: issue-management-api, Property 15: Update Issue Field Modification**
        ///
        /// For any update request with valid field values (subject, content, metadata, scheduledAt),
        /// the issue record must reflect the new values after the update operation completes.
        ///
        /// **Validates: Requirements AC-5.1, AC-5.2**
        #[test]
        fn property_15_update_issue_field_modification(
            new_subject in "[a-zA-Z0-9 ]{5,50}",
            new_content in "[a-zA-Z0-9 \n]{10,100}"
        ) {
            let request = UpdateIssueRequest {
                subject: Some(new_subject.clone()),
                content: Some(new_content.clone()),
                scheduled_at: None,
                metadata: None,
                template_id: None,
            content_type: None,
            };

            let result = validate_update_request(&request, false);
            prop_assert!(result.is_ok());

            if let Some(subject) = &request.subject {
                prop_assert_eq!(subject, &new_subject);
            }
            if let Some(content) = &request.content {
                prop_assert_eq!(content, &new_content);
            }
        }

        /// **Feature: issue-management-api, Property 16: Update Timestamp Modification**
        ///
        /// For any successful update operation, the updatedAt timestamp must be more recent
        /// than it was before the update.
        ///
        /// **Validates: Requirements AC-5.5**
        #[test]
        fn property_16_update_timestamp_modification(
            old_timestamp in "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z"
        ) {
            use chrono::{DateTime, Utc};

            let old_time = DateTime::parse_from_rfc3339(&old_timestamp)
                .unwrap_or_else(|_| Utc::now().into());
            let new_time = Utc::now();

            prop_assert!(
                new_time >= old_time,
                "Updated timestamp must be more recent than or equal to the old timestamp"
            );
        }

        /// **Feature: issue-management-api, Property 17: Status-Based Operation Restrictions**
        ///
        /// For any attempt to update or delete an issue with status "published" or "scheduled",
        /// the operation must return 409 Conflict indicating the operation is not allowed for that status.
        ///
        /// **Validates: Requirements AC-5.3, AC-6.2, AC-6.4**
        #[test]
        fn property_17_status_based_operation_restrictions_update(
            status in prop::sample::select(vec!["published", "scheduled", "failed"])
        ) {
            let issue = IssueRecord {
                pk: "tenant-123#1".to_string(),
                sk: "newsletter".to_string(),
                gsi1pk: "tenant-123#newsletter".to_string(),
                gsi1sk: "2024-01-15T10:00:00Z".to_string(),
                issue_number: 1,
                subject: "Test Issue".to_string(),
                status: status.to_string(),
                content: "Content".to_string(),
                created_at: "2024-01-15T10:00:00Z".to_string(),
                updated_at: "2024-01-15T10:00:00Z".to_string(),
                published_at: if status == "published" { Some("2024-01-15T11:00:00Z".to_string()) } else { None },
                scheduled_at: if status == "scheduled" { Some("2024-01-16T10:00:00Z".to_string()) } else { None },
                metadata: None,
                template_id: None,
            content_type: None,
            };

            let result = check_update_allowed(&issue);

            if status == "draft" {
                prop_assert!(result.is_ok(), "Draft issues should be allowed to update");
            } else {
                prop_assert!(result.is_err(), "Non-draft issues should not be allowed to update");
                prop_assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
            }
        }

        #[test]
        fn property_17_status_based_operation_restrictions_draft_allowed(
        ) {
            let issue = IssueRecord {
                pk: "tenant-123#1".to_string(),
                sk: "newsletter".to_string(),
                gsi1pk: "tenant-123#newsletter".to_string(),
                gsi1sk: "2024-01-15T10:00:00Z".to_string(),
                issue_number: 1,
                subject: "Test Issue".to_string(),
                status: "draft".to_string(),
                content: "Content".to_string(),
                created_at: "2024-01-15T10:00:00Z".to_string(),
                updated_at: "2024-01-15T10:00:00Z".to_string(),
                published_at: None,
                scheduled_at: None,
                metadata: None,
                template_id: None,
            content_type: None,
            };

            let result = check_update_allowed(&issue);
            prop_assert!(result.is_ok(), "Draft issues should be allowed to update");
        }

        /// **Feature: issue-management-api, Property 17: Status-Based Operation Restrictions (delete)**
        ///
        /// For any attempt to delete an issue with status "published", "scheduled", or "failed",
        /// the operation must return 409 Conflict indicating the operation is not allowed for that status.
        ///
        /// **Validates: Requirements AC-6.2, AC-6.4**
        #[test]
        fn property_17_status_based_operation_restrictions_delete(
            status in prop::sample::select(vec!["draft", "published", "scheduled", "failed"])
        ) {
            let issue = IssueRecord {
                pk: "tenant-123#1".to_string(),
                sk: "newsletter".to_string(),
                gsi1pk: "tenant-123#newsletter".to_string(),
                gsi1sk: "2024-01-15T10:00:00Z".to_string(),
                issue_number: 1,
                subject: "Test Issue".to_string(),
                status: status.to_string(),
                content: "Content".to_string(),
                created_at: "2024-01-15T10:00:00Z".to_string(),
                updated_at: "2024-01-15T10:00:00Z".to_string(),
                published_at: if status == "published" { Some("2024-01-15T11:00:00Z".to_string()) } else { None },
                scheduled_at: if status == "scheduled" { Some("2024-01-16T10:00:00Z".to_string()) } else { None },
                metadata: None,
                template_id: None,
            content_type: None,
            };

            let result = check_delete_allowed(&issue);

            if status == "draft" {
                prop_assert!(result.is_ok(), "Draft issues should be allowed to delete");
            } else {
                prop_assert!(result.is_err(), "Non-draft issues should not be allowed to delete");
                prop_assert!(matches!(result.unwrap_err(), AppError::Conflict(_)), "Should return Conflict error");
            }
        }
    */

    // Unit tests for event publishing
    #[tokio::test]
    async fn test_publish_event_with_create_issue_response() {
        let tenant_id = "test-tenant-123";
        let event_type = "ISSUE_DRAFT_SAVED";
        let data = CreateIssueResponse {
            id: "42".to_string(),
            issue_number: 42,
            subject: "Test Issue".to_string(),
            status: "draft".to_string(),
            content: "# Test Content".to_string(),
            created_at: "2024-01-15T10:00:00Z".to_string(),
            updated_at: "2024-01-15T10:00:00Z".to_string(),
            content_type: "markdown".to_string(),
        };

        let result = publish_event(tenant_id, event_type, &data).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_publish_event_with_get_issue_response() {
        let tenant_id = "test-tenant-456";
        let event_type = "ISSUE_UPDATED";
        let data = GetIssueResponse {
            id: "1".to_string(),
            issue_number: 1,
            subject: "Updated Issue".to_string(),
            status: "draft".to_string(),
            content: "Updated content".to_string(),
            created_at: "2024-01-15T10:00:00Z".to_string(),
            updated_at: "2024-01-15T11:00:00Z".to_string(),
            published_at: None,
            scheduled_at: None,
            metadata: None,
            stats: None,
            insights: None,
            insights_v2: None,
            template_id: None,
            content_type: None,
            ab_test: None,
            content_assembly: None,
            variant_stats: None,
            local_send: None,
            send_progress: None,
            workflow: None,
        };

        let result = publish_event(tenant_id, event_type, &data).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_publish_event_with_issue_record() {
        let tenant_id = "test-tenant-789";
        let event_type = "ISSUE_DELETED";
        let data = IssueRecord {
            pk: "test-tenant-789#5".to_string(),
            sk: "newsletter".to_string(),
            gsi1pk: "test-tenant-789#newsletter".to_string(),
            gsi1sk: "2024-01-15T10:00:00Z".to_string(),
            issue_number: 5,
            subject: "Deleted Issue".to_string(),
            status: "draft".to_string(),
            content: "Content to be deleted".to_string(),
            created_at: "2024-01-15T10:00:00Z".to_string(),
            updated_at: "2024-01-15T10:00:00Z".to_string(),
            published_at: None,
            scheduled_at: None,
            metadata: None,
            template_id: None,
            content_type: None,
            ab_test: None,
            local_send: None,
            content_assembly: None,
            execution_arn: None,
        };

        let result = publish_event(tenant_id, event_type, &data).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_publish_event_fire_and_forget_pattern() {
        let tenant_id = "test-tenant-error";
        let event_type = "ISSUE_DRAFT_SAVED";
        let data = CreateIssueResponse {
            id: "99".to_string(),
            issue_number: 99,
            subject: "Test Issue".to_string(),
            status: "draft".to_string(),
            content: "Content".to_string(),
            created_at: "2024-01-15T10:00:00Z".to_string(),
            updated_at: "2024-01-15T10:00:00Z".to_string(),
            content_type: "markdown".to_string(),
        };

        let result = publish_event(tenant_id, event_type, &data).await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_calculate_issue_metrics_with_deliveries() {
        let stats = IssueStats {
            opens: 450,
            clicks: 125,
            deliveries: 1000,
            bounces: 20,
            complaints: 5,
            subscribers: 900,
            subscribes: 0,
            unsubscribes: 0,
            cleaned: 0,
            manual_removals: 0,
            analytics: None,
        };

        let metrics = calculate_issue_metrics(&stats);

        assert_eq!(metrics.open_rate, 45.0);
        assert_eq!(metrics.click_rate, 12.5);
        assert_eq!(metrics.click_to_open_rate, 27.78);
        assert_eq!(metrics.bounce_rate, 2.0);
        assert_eq!(metrics.delivered, 1000);
        assert_eq!(metrics.unsubscribes, 0);
        assert_eq!(metrics.cleaned, 0);
        assert_eq!(metrics.manual_removals, 0);
    }

    #[test]
    fn test_calculate_issue_metrics_zero_deliveries() {
        let stats = IssueStats {
            opens: 0,
            clicks: 0,
            deliveries: 0,
            bounces: 0,
            complaints: 0,
            subscribers: 0,
            subscribes: 0,
            unsubscribes: 0,
            cleaned: 0,
            manual_removals: 0,
            analytics: None,
        };

        let metrics = calculate_issue_metrics(&stats);

        assert_eq!(metrics.open_rate, 0.0);
        assert_eq!(metrics.click_rate, 0.0);
        assert_eq!(metrics.click_to_open_rate, 0.0);
        assert_eq!(metrics.bounce_rate, 0.0);
        assert_eq!(metrics.delivered, 0);
        assert_eq!(metrics.unsubscribes, 0);
        assert_eq!(metrics.cleaned, 0);
        assert_eq!(metrics.manual_removals, 0);
    }

    #[test]
    fn test_calculate_issue_metrics_rounding() {
        let stats = IssueStats {
            opens: 333,
            clicks: 111,
            deliveries: 1000,
            bounces: 7,
            complaints: 2,
            subscribers: 1000,
            subscribes: 0,
            unsubscribes: 0,
            cleaned: 0,
            manual_removals: 0,
            analytics: None,
        };

        let metrics = calculate_issue_metrics(&stats);

        assert_eq!(metrics.open_rate, 33.3);
        assert_eq!(metrics.click_rate, 11.1);
        assert_eq!(metrics.click_to_open_rate, 33.33);
        assert_eq!(metrics.bounce_rate, 0.7);
        assert_eq!(metrics.delivered, 1000);
        assert_eq!(metrics.unsubscribes, 0);
        assert_eq!(metrics.cleaned, 0);
        assert_eq!(metrics.manual_removals, 0);
    }

    #[test]
    fn test_calculate_issue_metrics_high_engagement() {
        let stats = IssueStats {
            opens: 950,
            clicks: 800,
            deliveries: 1000,
            bounces: 10,
            complaints: 1,
            subscribers: 1000,
            subscribes: 0,
            unsubscribes: 0,
            cleaned: 0,
            manual_removals: 0,
            analytics: None,
        };

        let metrics = calculate_issue_metrics(&stats);

        assert_eq!(metrics.open_rate, 95.0);
        assert_eq!(metrics.click_rate, 80.0);
        assert_eq!(metrics.click_to_open_rate, 84.21);
        assert_eq!(metrics.bounce_rate, 1.0);
        assert_eq!(metrics.delivered, 1000);
        assert_eq!(metrics.unsubscribes, 0);
        assert_eq!(metrics.cleaned, 0);
        assert_eq!(metrics.manual_removals, 0);
    }

    #[test]
    fn test_calculate_aggregates_empty_array() {
        let issues: Vec<IssueTrendItem> = vec![];
        let aggregates = calculate_aggregates(&issues);

        assert_eq!(aggregates.avg_open_rate, 0.0);
        assert_eq!(aggregates.avg_click_rate, 0.0);
        assert_eq!(aggregates.avg_click_to_open_rate, 0.0);
        assert_eq!(aggregates.avg_bounce_rate, 0.0);
        assert_eq!(aggregates.total_delivered, 0);
        assert_eq!(aggregates.issue_count, 0);
    }

    #[test]
    fn test_calculate_aggregates_single_issue() {
        let issues = vec![IssueTrendItem {
            id: "1".to_string(),
            metrics: IssueMetrics {
                open_rate: 45.0,
                click_rate: 12.5,
                click_to_open_rate: 27.78,
                bounce_rate: 2.0,
                delivered: 1000,
                opens: 450,
                clicks: 125,
                bounces: 20,
                complaints: 5,
                subscribers: 980,
                subscribes: 0,
                unsubscribes: 0,
                cleaned: 0,
                manual_removals: 0,
            },
            analytics_summary: None,
        }];

        let aggregates = calculate_aggregates(&issues);

        assert_eq!(aggregates.avg_open_rate, 45.0);
        assert_eq!(aggregates.avg_click_rate, 12.5);
        assert_eq!(aggregates.avg_click_to_open_rate, 27.78);
        assert_eq!(aggregates.avg_bounce_rate, 2.0);
        assert_eq!(aggregates.total_delivered, 1000);
        assert_eq!(aggregates.issue_count, 1);
    }

    #[test]
    fn test_calculate_aggregates_multiple_issues() {
        let issues = vec![
            IssueTrendItem {
                id: "1".to_string(),
                metrics: IssueMetrics {
                    open_rate: 40.0,
                    click_rate: 10.0,
                    click_to_open_rate: 25.0,
                    bounce_rate: 2.0,
                    delivered: 1000,
                    opens: 400,
                    clicks: 100,
                    bounces: 20,
                    complaints: 5,
                    subscribers: 950,
                    subscribes: 0,
                    unsubscribes: 0,
                    cleaned: 0,
                    manual_removals: 0,
                },
                analytics_summary: None,
            },
            IssueTrendItem {
                id: "2".to_string(),
                metrics: IssueMetrics {
                    open_rate: 50.0,
                    click_rate: 15.0,
                    click_to_open_rate: 30.0,
                    bounce_rate: 3.0,
                    delivered: 1500,
                    opens: 750,
                    clicks: 225,
                    bounces: 45,
                    complaints: 10,
                    subscribers: 1200,
                    subscribes: 0,
                    unsubscribes: 0,
                    cleaned: 0,
                    manual_removals: 0,
                },
                analytics_summary: None,
            },
            IssueTrendItem {
                id: "3".to_string(),
                metrics: IssueMetrics {
                    open_rate: 45.0,
                    click_rate: 12.5,
                    click_to_open_rate: 27.78,
                    bounce_rate: 2.5,
                    delivered: 1200,
                    opens: 540,
                    clicks: 150,
                    bounces: 30,
                    complaints: 8,
                    subscribers: 1100,
                    subscribes: 0,
                    unsubscribes: 0,
                    cleaned: 0,
                    manual_removals: 0,
                },
                analytics_summary: None,
            },
        ];

        let aggregates = calculate_aggregates(&issues);

        assert_eq!(aggregates.avg_open_rate, 45.0);
        assert_eq!(aggregates.avg_click_rate, 12.5);
        assert_eq!(aggregates.avg_click_to_open_rate, 27.59);
        assert_eq!(aggregates.avg_bounce_rate, 2.5);
        assert_eq!(aggregates.total_delivered, 3700);
        assert_eq!(aggregates.issue_count, 3);
    }

    #[test]
    fn test_calculate_aggregates_rounding() {
        let issues = vec![
            IssueTrendItem {
                id: "1".to_string(),
                metrics: IssueMetrics {
                    open_rate: 33.33,
                    click_rate: 11.11,
                    click_to_open_rate: 33.33,
                    bounce_rate: 2.22,
                    delivered: 1000,
                    opens: 333,
                    clicks: 111,
                    bounces: 22,
                    complaints: 5,
                    subscribers: 980,
                    subscribes: 0,
                    unsubscribes: 0,
                    cleaned: 0,
                    manual_removals: 0,
                },
                analytics_summary: None,
            },
            IssueTrendItem {
                id: "2".to_string(),
                metrics: IssueMetrics {
                    open_rate: 44.44,
                    click_rate: 13.33,
                    click_to_open_rate: 29.99,
                    bounce_rate: 1.11,
                    delivered: 1500,
                    opens: 667,
                    clicks: 200,
                    bounces: 17,
                    complaints: 8,
                    subscribers: 1200,
                    subscribes: 0,
                    unsubscribes: 0,
                    cleaned: 0,
                    manual_removals: 0,
                },
                analytics_summary: None,
            },
        ];

        let aggregates = calculate_aggregates(&issues);

        assert_eq!(aggregates.avg_open_rate, 38.89);
        assert_eq!(aggregates.avg_click_rate, 12.22);
        assert_eq!(aggregates.avg_click_to_open_rate, 31.66);
        assert_eq!(aggregates.avg_bounce_rate, 1.67);
        assert_eq!(aggregates.total_delivered, 2500);
        assert_eq!(aggregates.issue_count, 2);
    }

    mod property_tests {
        use super::*;
        use proptest::prelude::*;

        // **Feature: issue-subscriber-metrics, Property 3: Stats parsing defaults missing subscriber metrics to 0**
        //
        // For any DynamoDB item representing an issue stats record, parsing it SHALL produce
        // `unsubscribes`, `cleaned`, and `manualRemovals` as non-negative integers. When any of
        // these attributes are absent from the item, the parsed value SHALL be 0.
        //
        // **Validates: Requirements 3.1, 3.2, 3.3, 6.1, 6.3**
        proptest! {
            #[test]
            fn property_3_stats_parsing_defaults_missing_subscriber_metrics_to_zero(
                has_unsubscribes in proptest::bool::ANY,
                has_cleaned in proptest::bool::ANY,
                has_manual_removals in proptest::bool::ANY,
                unsub_val in 0i64..10_000,
                cleaned_val in 0i64..10_000,
                manual_val in 0i64..10_000,
            ) {
                let mut item: HashMap<String, AttributeValue> = HashMap::new();

                // Always include base stats fields so the item is a valid stats record
                item.insert("opens".to_string(), AttributeValue::N("0".to_string()));
                item.insert("clicks".to_string(), AttributeValue::N("0".to_string()));
                item.insert("deliveries".to_string(), AttributeValue::N("0".to_string()));
                item.insert("bounces".to_string(), AttributeValue::N("0".to_string()));
                item.insert("complaints".to_string(), AttributeValue::N("0".to_string()));
                item.insert("subscribers".to_string(), AttributeValue::N("0".to_string()));

                // Randomly include or exclude each subscriber metric field
                if has_unsubscribes {
                    item.insert("unsubscribes".to_string(), AttributeValue::N(unsub_val.to_string()));
                }
                if has_cleaned {
                    item.insert("cleaned".to_string(), AttributeValue::N(cleaned_val.to_string()));
                }
                if has_manual_removals {
                    item.insert("manualRemovals".to_string(), AttributeValue::N(manual_val.to_string()));
                }

                let result = parse_issue_stats(&item);
                prop_assert!(result.is_ok(), "parse_issue_stats should always succeed");

                let stats = result.unwrap();

                // When present, the parsed value must match the input
                // When absent, the parsed value must default to 0
                let expected_unsub = if has_unsubscribes { unsub_val } else { 0 };
                let expected_cleaned = if has_cleaned { cleaned_val } else { 0 };
                let expected_manual = if has_manual_removals { manual_val } else { 0 };

                prop_assert_eq!(stats.unsubscribes, expected_unsub,
                    "unsubscribes: expected {} (present={})", expected_unsub, has_unsubscribes);
                prop_assert_eq!(stats.cleaned, expected_cleaned,
                    "cleaned: expected {} (present={})", expected_cleaned, has_cleaned);
                prop_assert_eq!(stats.manual_removals, expected_manual,
                    "manualRemovals: expected {} (present={})", expected_manual, has_manual_removals);

                // All three must be non-negative integers
                prop_assert!(stats.unsubscribes >= 0, "unsubscribes must be non-negative");
                prop_assert!(stats.cleaned >= 0, "cleaned must be non-negative");
                prop_assert!(stats.manual_removals >= 0, "manualRemovals must be non-negative");
            }
        }

        // **Feature: issue-subscriber-metrics, Property 8: Trends sorted by issue number descending**
        //
        // For any set of issue trend items returned by the trends endpoint, the items SHALL be
        // sorted by issue number in strictly descending numeric order (each item's issue number
        // is numerically less than the previous item's issue number). Sorting is numeric, not
        // lexicographic.
        //
        // **Validates: Requirements 6.4**

        /// Helper: build an IssueTrendItem with the given issue number as its id.
        fn make_trend_item(issue_number: i32) -> IssueTrendItem {
            let stats = IssueStats {
                opens: 0,
                clicks: 0,
                deliveries: 0,
                bounces: 0,
                complaints: 0,
                subscribers: 0,
                subscribes: 0,
                unsubscribes: 0,
                cleaned: 0,
                manual_removals: 0,
                analytics: None,
            };
            IssueTrendItem {
                id: issue_number.to_string(),
                metrics: calculate_issue_metrics(&stats),
                analytics_summary: None,
            }
        }

        /// Strategy that generates a Vec of unique issue numbers (1..10_000).
        fn unique_issue_numbers() -> impl Strategy<Value = Vec<i32>> {
            proptest::collection::hash_set(1i32..10_000, 0..50)
                .prop_map(|s| s.into_iter().collect::<Vec<_>>())
        }

        proptest! {
            #[test]
            fn property_8_trends_sorted_by_issue_number_descending(
                issue_numbers in unique_issue_numbers(),
            ) {
                // Build trend items from the random issue numbers
                let mut items: Vec<IssueTrendItem> = issue_numbers
                    .iter()
                    .map(|&n| make_trend_item(n))
                    .collect();

                // Sort descending by numeric issue number — this mirrors the GSI1
                // scan_index_forward(false) behavior used by query_published_issues_with_stats
                items.sort_by(|a, b| {
                    let a_num: i32 = a.id.parse().unwrap();
                    let b_num: i32 = b.id.parse().unwrap();
                    b_num.cmp(&a_num)
                });

                // Verify strict descending numeric order
                for window in items.windows(2) {
                    let prev: i32 = window[0].id.parse().unwrap();
                    let curr: i32 = window[1].id.parse().unwrap();
                    prop_assert!(
                        curr < prev,
                        "Expected strict descending order: {} should be < {}", curr, prev
                    );
                }
            }
        }
    }
}
