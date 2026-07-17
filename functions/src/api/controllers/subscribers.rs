use aws_sdk_dynamodb::types::AttributeValue;
use lambda_http::{Body, Error, Request, RequestExt, Response};
use newsletter::admin::{auth, aws_clients, error::AppError, response};
use percent_encoding::percent_decode_str;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env;

// ── Response types ─────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SunsetCandidatesResponse {
    dormant_subscribers: Vec<DormantSubscriber>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DormantSubscriber {
    email_hash: String,
    last_engaged_issue: Option<i64>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AudienceHealthResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    bootstrap: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cohorts: Option<CohortCounts>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct CohortCounts {
    highly_engaged: CohortDetail,
    occasional: CohortDetail,
    dormant: CohortDetail,
    total: i64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct CohortDetail {
    count: i64,
    percentage: f64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SubscriberCountResponse {
    total_subscribers: i64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SubscriberTrendsResponse {
    points: Vec<SubscriberTrendPoint>,
    summary: SubscriberTrendSummary,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SubscriberTrendPoint {
    issue_number: i64,
    subscribers: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    published_at: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SubscriberTrendSummary {
    latest_subscribers: i64,
    oldest_subscribers: i64,
    net_change: i64,
    percentage_change: f64,
    points_returned: i64,
}

/// Engagement cohort classification for a single subscriber.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EngagementCohort {
    HighlyEngaged,
    Occasional,
    Dormant,
}

struct SubscriberTrendsQuery {
    issue_count: i32,
}

fn default_issue_count() -> i32 {
    10
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubscriberListResponse {
    subscribers: Vec<SubscriberListItem>,
    total: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubscriberListItem {
    email: String,
    added_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    first_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_name: Option<String>,
    last_engaged_issue: Option<i64>,
    /// Total distinct issues this subscriber has opened/clicked. Surfaced so the
    /// dashboard can show engagement depth, not just recency.
    #[serde(skip_serializing_if = "Option::is_none")]
    engagement_count: Option<i64>,
    /// Per-topic interest scores accumulated from link clicks. Powers the
    /// interest-profile chips on the subscriber list so auto-segmentation signal
    /// is visible per subscriber, not just inside a segment's member list.
    #[serde(skip_serializing_if = "Option::is_none")]
    interest_scores: Option<HashMap<String, InterestScoreEntry>>,
    suspected_bot: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    bot_flags: Option<BotFlags>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InterestScoreEntry {
    score: f64,
    last_scored_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BotFlags {
    honeypot_triggered: bool,
    disposable_domain: bool,
    suspicious_user_agent: bool,
    fast_submission: bool,
    suspicious_email_pattern: bool,
}

// ── Public endpoint handlers ───────────────────────────────────────────

/// GET /subscribers?type=sunset
pub async fn get_sunset_candidates(event: Request) -> Result<Response<Body>, Error> {
    match handle_get_sunset_candidates(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /subscribers — returns subscriber list, or dispatches based on `type` query parameter
pub async fn list_subscribers(event: Request) -> Result<Response<Body>, Error> {
    let query_params = event.query_string_parameters();
    match query_params.first("type") {
        Some("sunset") => get_sunset_candidates(event).await,
        Some(t) => {
            let err = AppError::BadRequest(format!("Unknown subscriber type: {}", t));
            Ok(response::format_error_response(&err))
        }
        None => get_subscriber_list(event).await,
    }
}

/// GET /subscribers (no type param) — returns full subscriber list
pub async fn get_subscriber_list(event: Request) -> Result<Response<Body>, Error> {
    match handle_get_subscriber_list(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /subscribers/audience-health
pub async fn get_audience_health(event: Request) -> Result<Response<Body>, Error> {
    match handle_get_audience_health(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /subscribers/count
pub async fn get_subscriber_count(event: Request) -> Result<Response<Body>, Error> {
    match handle_get_subscriber_count(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /subscribers/trends
pub async fn get_subscriber_trends(event: Request) -> Result<Response<Body>, Error> {
    match handle_get_subscriber_trends(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

// ── Internal handlers ──────────────────────────────────────────────────

async fn handle_get_audience_health(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let query_params = event.query_string_parameters();

    let latest_issue_number: i64 = match query_params.first("latestIssueNumber") {
        Some(v) => v.parse::<i64>().map_err(|_| {
            AppError::BadRequest("latestIssueNumber must be a valid integer".to_string())
        })?,
        None => {
            return Err(AppError::BadRequest(
                "latestIssueNumber is required".to_string(),
            ));
        }
    };

    let subscribers_table = get_subscribers_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let health = query_audience_health(
        ddb_client,
        &subscribers_table,
        &tenant_id,
        latest_issue_number,
    )
    .await?;

    response::format_response(200, health)
}

async fn handle_get_subscriber_count(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_newsletter_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let total_subscribers =
        query_current_subscriber_count(ddb_client, &table_name, &tenant_id).await?;

    response::format_response(200, SubscriberCountResponse { total_subscribers })
}

async fn handle_get_subscriber_trends(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let query = parse_subscriber_trends_query_params(&event)?;
    let table_name = get_newsletter_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let points =
        query_subscriber_trend_points(ddb_client, &table_name, &tenant_id, query.issue_count)
            .await?;
    let summary = calculate_trend_summary(&points);

    response::format_response(200, SubscriberTrendsResponse { points, summary })
}

async fn handle_get_sunset_candidates(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let query_params = event.query_string_parameters();

    let threshold: i64 = query_params
        .first("threshold")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(10);

    let latest_issue_number: i64 = match query_params.first("latestIssueNumber") {
        Some(v) => v.parse::<i64>().map_err(|_| {
            AppError::BadRequest("latestIssueNumber must be a valid integer".to_string())
        })?,
        None => {
            return Err(AppError::BadRequest(
                "latestIssueNumber is required".to_string(),
            ));
        }
    };

    let subscribers_table = get_subscribers_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let dormant_subscribers = query_sunset_candidates(
        ddb_client,
        &subscribers_table,
        &tenant_id,
        threshold,
        latest_issue_number,
    )
    .await?;

    response::format_response(
        200,
        SunsetCandidatesResponse {
            dormant_subscribers,
        },
    )
}

async fn handle_get_subscriber_list(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let subscribers_table = get_subscribers_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let subscribers = query_all_subscribers(ddb_client, &subscribers_table, &tenant_id).await?;
    let total = subscribers.len() as i64;

    response::format_response(200, SubscriberListResponse { subscribers, total })
}

/// DELETE /subscribers/:email — remove a subscriber
pub async fn delete_subscriber(
    event: Request,
    email: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_delete_subscriber(event, email).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_delete_subscriber(
    event: Request,
    email: Option<String>,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let email = email.ok_or_else(|| AppError::BadRequest("Email is required".to_string()))?;

    let decoded_email = percent_decode_str(&email)
        .decode_utf8()
        .map_err(|e| AppError::BadRequest(format!("Invalid email encoding: {}", e)))?
        .to_lowercase();

    let subscribers_table = get_subscribers_table_name()?;
    let newsletter_table = get_newsletter_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    // Delete subscriber, return old item to check if it existed
    let delete_result = ddb_client
        .delete_item()
        .table_name(&subscribers_table)
        .key("tenantId", AttributeValue::S(tenant_id.clone()))
        .key("email", AttributeValue::S(decoded_email.clone()))
        .return_values(aws_sdk_dynamodb::types::ReturnValue::AllOld)
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("DynamoDB DeleteItem failed: {}", e)))?;

    if delete_result.attributes().is_none() || delete_result.attributes().unwrap().is_empty() {
        return Err(AppError::NotFound("Subscriber not found".to_string()));
    }

    // Decrement subscriber count
    ddb_client
        .update_item()
        .table_name(&newsletter_table)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S("tenant".to_string()))
        .update_expression("SET subscribers = if_not_exists(subscribers, :zero) - :dec")
        .expression_attribute_values(":dec", AttributeValue::N("1".to_string()))
        .expression_attribute_values(":zero", AttributeValue::N("0".to_string()))
        .condition_expression("if_not_exists(subscribers, :zero) >= :dec")
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to decrement subscriber count: {}", e)))?;

    // Increment manualRemovals counter on the most recently published issue (fire-and-forget)
    match get_most_recent_published_issue(ddb_client, &newsletter_table, &tenant_id).await {
        Ok(Some(issue_pk)) => {
            if let Err(e) =
                increment_issue_counter(ddb_client, &newsletter_table, &issue_pk, "manualRemovals")
                    .await
            {
                tracing::warn!(
                    error = ?e,
                    tenant_id = %tenant_id,
                    issue_pk = %issue_pk,
                    "Failed to increment manualRemovals counter"
                );
            }
        }
        Ok(None) => {
            tracing::warn!(
                tenant_id = %tenant_id,
                "No published issue found for manualRemovals attribution"
            );
        }
        Err(e) => {
            tracing::warn!(
                error = ?e,
                tenant_id = %tenant_id,
                "Failed to look up most recent published issue for manualRemovals attribution"
            );
        }
    }

    response::format_response(200, serde_json::json!({ "message": "Subscriber removed" }))
}

// ── Helper functions ───────────────────────────────────────────────────

/// Build the GSI1PK value used for issue attribution lookups.
fn build_issue_gsi1pk(tenant_id: &str) -> String {
    format!("{}#issue", tenant_id)
}

/// Extract the `pk` from the first item in a page that has a `publishedAt` attribute.
/// Returns `Some(pk)` if a published issue is found, `None` otherwise.
fn find_published_issue_pk(
    items: &[std::collections::HashMap<String, AttributeValue>],
) -> Option<String> {
    for item in items {
        if item.contains_key("publishedAt") {
            if let Some(pk_attr) = item.get("pk") {
                if let Ok(pk) = pk_attr.as_s() {
                    return Some(pk.to_string());
                }
            }
        }
    }
    None
}

/// Query GSI1 for the most recently published issue for a tenant.
/// Paginates in pages of 10 until a published issue (with `publishedAt`) is found
/// or items are exhausted. Returns Some(issue_pk) or None if no published issues exist.
async fn get_most_recent_published_issue(
    ddb_client: &aws_sdk_dynamodb::Client,
    table_name: &str,
    tenant_id: &str,
) -> Result<Option<String>, AppError> {
    let gsi1pk = build_issue_gsi1pk(tenant_id);
    let page_size = 10;
    let mut exclusive_start_key = None;

    loop {
        let mut query = ddb_client
            .query()
            .table_name(table_name)
            .index_name("GSI1")
            .key_condition_expression("GSI1PK = :gsi1pk")
            .expression_attribute_values(":gsi1pk", AttributeValue::S(gsi1pk.clone()))
            .scan_index_forward(false)
            .limit(page_size);

        if let Some(start_key) = exclusive_start_key.take() {
            query = query.set_exclusive_start_key(Some(start_key));
        }

        let result = query.send().await?;

        if let Some(pk) = find_published_issue_pk(result.items()) {
            return Ok(Some(pk));
        }

        match result.last_evaluated_key() {
            Some(key) if !key.is_empty() => {
                exclusive_start_key = Some(key.clone());
            }
            _ => break,
        }
    }

    Ok(None)
}

/// Atomically increment a counter on an issue stats record using DynamoDB ADD.
/// No read-modify-write — a single atomic operation.
async fn increment_issue_counter(
    ddb_client: &aws_sdk_dynamodb::Client,
    table_name: &str,
    issue_pk: &str,
    counter_name: &str,
) -> Result<(), AppError> {
    ddb_client
        .update_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(issue_pk.to_string()))
        .key("sk", AttributeValue::S("stats".to_string()))
        .update_expression("ADD #counter :val")
        .expression_attribute_names("#counter", counter_name)
        .expression_attribute_values(":val", AttributeValue::N("1".to_string()))
        .send()
        .await?;

    Ok(())
}

fn get_subscribers_table_name() -> Result<String, AppError> {
    env::var("SUBSCRIBERS_TABLE_NAME")
        .map_err(|_| AppError::InternalError("SUBSCRIBERS_TABLE_NAME not set".to_string()))
}

fn get_newsletter_table_name() -> Result<String, AppError> {
    env::var("TABLE_NAME").map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))
}

fn parse_subscriber_trends_query_params(
    event: &Request,
) -> Result<SubscriberTrendsQuery, AppError> {
    let query_params = event.query_string_parameters();
    let issue_count = query_params
        .first("issueCount")
        .map(|s| {
            s.parse::<i32>()
                .map_err(|_| AppError::BadRequest("issueCount must be a valid integer".to_string()))
        })
        .transpose()?
        .unwrap_or_else(default_issue_count);

    if !(1..=50).contains(&issue_count) {
        return Err(AppError::BadRequest(
            "issueCount must be between 1 and 50".to_string(),
        ));
    }

    Ok(SubscriberTrendsQuery { issue_count })
}

fn hash_email(email: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(email.as_bytes());
    hex::encode(hasher.finalize())
}

/// Whether a table item is an actual subscriber record rather than a segments
/// infrastructure row. The segments feature overloads the `email` sort key with
/// `SEGMENT#...`, `SEGMENT_NAME#...`, `SEGMENT_JOB#...`, and `...#MEMBER#...`
/// records stored under the same tenant partition; those must never be counted
/// or listed as subscribers. Real email addresses never start with "SEGMENT".
fn is_subscriber_record(item: &HashMap<String, AttributeValue>) -> bool {
    item.get("email")
        .and_then(|v| v.as_s().ok())
        .map(|email| !email.starts_with("SEGMENT"))
        .unwrap_or(false)
}

/// Parse the `interestScores` map (topic -> { score, lastScoredAt }) off a
/// subscriber record. Returns None when the attribute is absent or malformed.
fn parse_interest_scores(
    item: &HashMap<String, AttributeValue>,
) -> Option<HashMap<String, InterestScoreEntry>> {
    let scores_map = item.get("interestScores")?.as_m().ok()?;
    let mut result = HashMap::new();
    for (topic, entry_val) in scores_map {
        if let Ok(entry_map) = entry_val.as_m() {
            let score = entry_map
                .get("score")
                .and_then(|v| v.as_n().ok())
                .and_then(|n| n.parse::<f64>().ok())
                .unwrap_or(0.0);
            let last_scored_at = entry_map
                .get("lastScoredAt")
                .and_then(|v| v.as_s().ok())
                .cloned()
                .unwrap_or_default();
            result.insert(
                topic.clone(),
                InterestScoreEntry {
                    score,
                    last_scored_at,
                },
            );
        }
    }
    Some(result)
}

async fn query_current_subscriber_count(
    ddb_client: &aws_sdk_dynamodb::Client,
    table_name: &str,
    tenant_id: &str,
) -> Result<i64, AppError> {
    let result = ddb_client
        .get_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S("tenant".to_string()))
        .send()
        .await?;

    let item = result
        .item()
        .ok_or_else(|| AppError::NotFound("Tenant not found".to_string()))?;

    Ok(item
        .get("subscribers")
        .and_then(|v| v.as_n().ok())
        .and_then(|n| n.parse::<i64>().ok())
        .unwrap_or(0))
}

async fn query_subscriber_trend_points(
    ddb_client: &aws_sdk_dynamodb::Client,
    table_name: &str,
    tenant_id: &str,
    issue_count: i32,
) -> Result<Vec<SubscriberTrendPoint>, AppError> {
    let gsi1pk = format!("{}#issue", tenant_id);

    let result = ddb_client
        .query()
        .table_name(table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :gsi1pk")
        .expression_attribute_values(":gsi1pk", AttributeValue::S(gsi1pk))
        .scan_index_forward(false)
        .limit(issue_count)
        .send()
        .await?;

    Ok(result
        .items()
        .iter()
        .filter_map(parse_subscriber_trend_point)
        .collect())
}

fn parse_subscriber_trend_point(
    item: &std::collections::HashMap<String, AttributeValue>,
) -> Option<SubscriberTrendPoint> {
    let issue_number = item
        .get("GSI1SK")
        .and_then(|v| v.as_s().ok())
        .and_then(|s| s.parse::<i64>().ok())?;

    let subscribers = item
        .get("subscribers")
        .and_then(|v| v.as_n().ok())
        .and_then(|n| n.parse::<i64>().ok())?;

    let published_at = item
        .get("publishedAt")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string());

    Some(SubscriberTrendPoint {
        issue_number,
        subscribers,
        published_at,
    })
}

fn calculate_trend_summary(points: &[SubscriberTrendPoint]) -> SubscriberTrendSummary {
    let latest_subscribers = points.first().map(|point| point.subscribers).unwrap_or(0);
    let oldest_subscribers = points.last().map(|point| point.subscribers).unwrap_or(0);
    let net_change = latest_subscribers - oldest_subscribers;
    let percentage_change = if oldest_subscribers > 0 {
        ((net_change as f64 / oldest_subscribers as f64) * 1000.0).round() / 10.0
    } else {
        0.0
    };

    SubscriberTrendSummary {
        latest_subscribers,
        oldest_subscribers,
        net_change,
        percentage_change,
        points_returned: points.len() as i64,
    }
}

/// Query all subscribers for a tenant and return their list details.
async fn query_all_subscribers(
    ddb_client: &aws_sdk_dynamodb::Client,
    table_name: &str,
    tenant_id: &str,
) -> Result<Vec<SubscriberListItem>, AppError> {
    let mut subscribers = Vec::new();
    let mut exclusive_start_key = None;

    loop {
        let mut query = ddb_client
            .query()
            .table_name(table_name)
            .key_condition_expression("tenantId = :tid")
            .expression_attribute_values(":tid", AttributeValue::S(tenant_id.to_string()));

        if let Some(start_key) = exclusive_start_key.take() {
            query = query.set_exclusive_start_key(Some(start_key));
        }

        let result = query.send().await?;

        for item in result.items() {
            // The segments feature stores its records (SEGMENT#, SEGMENT_NAME#,
            // SEGMENT_JOB#, and #MEMBER# rows) in this same table under the
            // tenant partition. Skip them so they don't show up as bogus
            // subscribers in the list.
            if !is_subscriber_record(item) {
                continue;
            }

            let email = item
                .get("email")
                .and_then(|v| v.as_s().ok())
                .map(|s| s.to_string())
                .unwrap_or_default();

            let added_at = item
                .get("addedAt")
                .and_then(|v| v.as_s().ok())
                .map(|s| s.to_string());

            let first_name = item
                .get("firstName")
                .and_then(|v| v.as_s().ok())
                .map(|s| s.to_string());

            let last_name = item
                .get("lastName")
                .and_then(|v| v.as_s().ok())
                .map(|s| s.to_string());

            let last_engaged_issue = item
                .get("lastEngagedIssue")
                .and_then(|v| v.as_n().ok())
                .and_then(|n| n.parse::<i64>().ok());

            let engagement_count = item
                .get("engagementCount")
                .and_then(|v| v.as_n().ok())
                .and_then(|n| n.parse::<i64>().ok());

            let interest_scores = parse_interest_scores(item).filter(|m| !m.is_empty());

            let get_bool_flag = |key: &str| -> bool {
                item.get(key)
                    .and_then(|v| v.as_bool().ok())
                    .copied()
                    .unwrap_or(false)
            };

            let honeypot_triggered = get_bool_flag("honeypotTriggered");
            let disposable_domain = get_bool_flag("disposableDomain");
            let suspicious_user_agent = get_bool_flag("suspiciousUserAgent");
            let fast_submission = get_bool_flag("fastSubmission");
            let suspicious_email_pattern = get_bool_flag("suspiciousEmailPattern");

            let suspected_bot = honeypot_triggered
                || disposable_domain
                || suspicious_user_agent
                || fast_submission
                || suspicious_email_pattern;

            let bot_flags = if suspected_bot {
                Some(BotFlags {
                    honeypot_triggered,
                    disposable_domain,
                    suspicious_user_agent,
                    fast_submission,
                    suspicious_email_pattern,
                })
            } else {
                None
            };

            subscribers.push(SubscriberListItem {
                email,
                added_at,
                first_name,
                last_name,
                last_engaged_issue,
                engagement_count,
                interest_scores,
                suspected_bot,
                bot_flags,
            });
        }

        match result.last_evaluated_key() {
            Some(key) if !key.is_empty() => {
                exclusive_start_key = Some(key.clone());
            }
            _ => break,
        }
    }

    Ok(subscribers)
}

/// Query all subscribers for a tenant and filter for sunset candidates.
///
/// A subscriber is considered dormant if their lastEngagedIssue is below the cutoff:
/// latestIssueNumber - threshold — if a subscriber was created when the latest
/// issue was <= threshold issues ago, they're too new.
async fn query_sunset_candidates(
    ddb_client: &aws_sdk_dynamodb::Client,
    table_name: &str,
    tenant_id: &str,
    threshold: i64,
    latest_issue_number: i64,
) -> Result<Vec<DormantSubscriber>, AppError> {
    let mut dormant = Vec::new();
    let mut exclusive_start_key = None;
    let cutoff_issue = latest_issue_number - threshold;

    loop {
        let mut query = ddb_client
            .query()
            .table_name(table_name)
            .key_condition_expression("tenantId = :tid")
            .expression_attribute_values(":tid", AttributeValue::S(tenant_id.to_string()));

        if let Some(start_key) = exclusive_start_key.take() {
            query = query.set_exclusive_start_key(Some(start_key));
        }

        let result = query.send().await?;

        for item in result.items() {
            if !is_subscriber_record(item) {
                continue;
            }
            if let Some(subscriber) =
                evaluate_subscriber(item, cutoff_issue, threshold, latest_issue_number)
            {
                dormant.push(subscriber);
            }
        }

        match result.last_evaluated_key() {
            Some(key) if !key.is_empty() => {
                exclusive_start_key = Some(key.clone());
            }
            _ => break,
        }
    }

    Ok(dormant)
}

/// Evaluate a single subscriber record against sunset criteria.
///
/// Returns Some(DormantSubscriber) if the subscriber should be flagged, None otherwise.
fn evaluate_subscriber(
    item: &std::collections::HashMap<String, AttributeValue>,
    cutoff_issue: i64,
    threshold: i64,
    latest_issue_number: i64,
) -> Option<DormantSubscriber> {
    let email = item.get("email").and_then(|v| v.as_s().ok())?;

    let last_engaged_issue = item
        .get("lastEngagedIssue")
        .and_then(|v| v.as_n().ok())
        .and_then(|n| n.parse::<i64>().ok());

    let created_at = item
        .get("createdAt")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string());

    // Exclude subscribers whose subscription is too recent
    if is_subscription_too_recent(
        last_engaged_issue,
        &created_at,
        threshold,
        latest_issue_number,
    ) {
        return None;
    }

    match last_engaged_issue {
        Some(lei) if lei < cutoff_issue => Some(DormantSubscriber {
            email_hash: hash_email(email),
            last_engaged_issue: Some(lei),
        }),
        None => {
            // No lastEngagedIssue — check if createdAt predates the threshold window
            if created_at.is_some() {
                Some(DormantSubscriber {
                    email_hash: hash_email(email),
                    last_engaged_issue: None,
                })
            } else {
                // No createdAt either — treat as dormant (no engagement data at all)
                Some(DormantSubscriber {
                    email_hash: hash_email(email),
                    last_engaged_issue: None,
                })
            }
        }
        // lastEngagedIssue >= cutoff_issue — not dormant
        _ => None,
    }
}

/// Determine if a subscriber's subscription is too recent to be flagged for sunset.
///
/// A subscriber is "too recent" if the number of issues published since their
/// subscription is <= threshold. Without an exact issueNumberAtCreation field,
/// we use createdAt as a proxy:
///
/// - If the subscriber has no createdAt, we cannot determine recency, so we
///   do NOT exclude them (they may be flagged if otherwise dormant).
/// - If the subscriber has a createdAt, we parse it and check if it's within
///   the threshold window. The threshold window is approximated by checking
///   if createdAt is after a cutoff date. Since we don't know the exact
///   issue-to-date mapping, we use a simple heuristic: if the subscriber
///   was created recently enough that latestIssueNumber - threshold issues
///   haven't passed, they're too new.
///
/// For the purpose of this implementation, we check if the subscriber could
/// have been present for more than `threshold` issues. If they have a
/// lastEngagedIssue, we know they were subscribed at least by that issue.
/// If latestIssueNumber - firstKnownIssue <= threshold, they're too new.
fn is_subscription_too_recent(
    _last_engaged_issue: Option<i64>,
    created_at: &Option<String>,
    threshold: i64,
    _latest_issue_number: i64,
) -> bool {
    // Without issueNumberAtCreation, we approximate "issues since subscription"
    // using createdAt and assuming ~1 issue per week. If weeks since creation
    // <= threshold, the subscriber hasn't had enough issues to demonstrate engagement.
    if let Some(created_at_str) = created_at {
        if let Ok(created_date) = chrono::DateTime::parse_from_rfc3339(created_at_str) {
            let now = chrono::Utc::now();
            let weeks_since_creation = (now - created_date.with_timezone(&chrono::Utc)).num_weeks();

            if weeks_since_creation <= threshold {
                return true;
            }
        }
    }

    false
}

/// Query all subscribers for a tenant and classify into engagement cohorts.
///
/// Returns a bootstrap response if zero subscribers have any `lastEngagedIssue`,
/// otherwise returns cohort counts and percentages.
async fn query_audience_health(
    ddb_client: &aws_sdk_dynamodb::Client,
    table_name: &str,
    tenant_id: &str,
    latest_issue_number: i64,
) -> Result<AudienceHealthResponse, AppError> {
    let mut highly_engaged: i64 = 0;
    let mut occasional: i64 = 0;
    let mut dormant: i64 = 0;
    let mut total: i64 = 0;
    let mut any_has_engagement = false;
    let mut exclusive_start_key = None;

    loop {
        let mut query = ddb_client
            .query()
            .table_name(table_name)
            .key_condition_expression("tenantId = :tid")
            .expression_attribute_values(":tid", AttributeValue::S(tenant_id.to_string()));

        if let Some(start_key) = exclusive_start_key.take() {
            query = query.set_exclusive_start_key(Some(start_key));
        }

        let result = query.send().await?;

        for item in result.items() {
            if !is_subscriber_record(item) {
                continue;
            }
            total += 1;

            let last_engaged_issue = item
                .get("lastEngagedIssue")
                .and_then(|v| v.as_n().ok())
                .and_then(|n| n.parse::<i64>().ok());

            if last_engaged_issue.is_some() {
                any_has_engagement = true;
            }

            match classify_cohort(last_engaged_issue, latest_issue_number) {
                EngagementCohort::HighlyEngaged => highly_engaged += 1,
                EngagementCohort::Occasional => occasional += 1,
                EngagementCohort::Dormant => dormant += 1,
            }
        }

        match result.last_evaluated_key() {
            Some(key) if !key.is_empty() => {
                exclusive_start_key = Some(key.clone());
            }
            _ => break,
        }
    }

    // Bootstrap detection: if zero subscribers have any lastEngagedIssue
    if !any_has_engagement {
        return Ok(AudienceHealthResponse {
            bootstrap: Some(true),
            cohorts: None,
        });
    }

    let percentage = |count: i64| -> f64 {
        if total == 0 {
            0.0
        } else {
            ((count as f64 / total as f64) * 1000.0).round() / 10.0
        }
    };

    Ok(AudienceHealthResponse {
        bootstrap: None,
        cohorts: Some(CohortCounts {
            highly_engaged: CohortDetail {
                count: highly_engaged,
                percentage: percentage(highly_engaged),
            },
            occasional: CohortDetail {
                count: occasional,
                percentage: percentage(occasional),
            },
            dormant: CohortDetail {
                count: dormant,
                percentage: percentage(dormant),
            },
            total,
        }),
    })
}

/// Classify a subscriber into an engagement cohort based on their lastEngagedIssue
/// relative to the latestIssueNumber.
///
/// - Highly Engaged: lastEngagedIssue >= latestIssueNumber - 1 (within last 2 issues)
/// - Occasional: lastEngagedIssue >= latestIssueNumber - 9 AND < latestIssueNumber - 1 (3–10 issues behind)
/// - Dormant: lastEngagedIssue < latestIssueNumber - 9 OR no lastEngagedIssue
fn classify_cohort(last_engaged_issue: Option<i64>, latest_issue_number: i64) -> EngagementCohort {
    match last_engaged_issue {
        Some(lei) if lei >= latest_issue_number - 1 => EngagementCohort::HighlyEngaged,
        Some(lei) if lei >= latest_issue_number - 9 => EngagementCohort::Occasional,
        _ => EngagementCohort::Dormant,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    fn make_subscriber_item(
        email: &str,
        last_engaged_issue: Option<i64>,
        created_at: Option<&str>,
    ) -> HashMap<String, AttributeValue> {
        let mut item = HashMap::new();
        item.insert("email".to_string(), AttributeValue::S(email.to_string()));
        if let Some(lei) = last_engaged_issue {
            item.insert(
                "lastEngagedIssue".to_string(),
                AttributeValue::N(lei.to_string()),
            );
        }
        if let Some(ca) = created_at {
            item.insert("createdAt".to_string(), AttributeValue::S(ca.to_string()));
        }
        item
    }

    fn make_trend_item(issue_number: i64, subscribers: i64) -> HashMap<String, AttributeValue> {
        let mut item = HashMap::new();
        item.insert(
            "GSI1SK".to_string(),
            AttributeValue::S(issue_number.to_string()),
        );
        item.insert(
            "subscribers".to_string(),
            AttributeValue::N(subscribers.to_string()),
        );
        item
    }

    #[test]
    fn test_subscriber_with_old_engagement_is_flagged() {
        // lastEngagedIssue = 5, latestIssueNumber = 20, threshold = 10
        // cutoff = 20 - 10 = 10, 5 < 10 → dormant
        // createdAt is old enough (2020) so not too recent
        let item = make_subscriber_item("test@example.com", Some(5), Some("2020-01-01T00:00:00Z"));
        let result = evaluate_subscriber(&item, 10, 10, 20);
        assert!(result.is_some());
        let dormant = result.unwrap();
        assert_eq!(dormant.last_engaged_issue, Some(5));
        assert_eq!(dormant.email_hash, hash_email("test@example.com"));
    }

    #[test]
    fn test_subscriber_with_recent_engagement_not_flagged() {
        // lastEngagedIssue = 15, latestIssueNumber = 20, threshold = 10
        // cutoff = 10, 15 >= 10 → not dormant
        let item =
            make_subscriber_item("active@example.com", Some(15), Some("2020-01-01T00:00:00Z"));
        let result = evaluate_subscriber(&item, 10, 10, 20);
        assert!(result.is_none());
    }

    #[test]
    fn test_subscriber_no_engagement_old_created_at_is_flagged() {
        // No lastEngagedIssue, createdAt is old → dormant
        let item = make_subscriber_item("never@example.com", None, Some("2020-01-01T00:00:00Z"));
        let result = evaluate_subscriber(&item, 10, 10, 20);
        assert!(result.is_some());
        let dormant = result.unwrap();
        assert_eq!(dormant.last_engaged_issue, None);
    }

    #[test]
    fn test_new_subscriber_excluded_even_without_engagement() {
        // No lastEngagedIssue, createdAt is very recent → too new, excluded
        let now = chrono::Utc::now();
        let recent = now.to_rfc3339();
        let item = make_subscriber_item("new@example.com", None, Some(&recent));
        let result = evaluate_subscriber(&item, 10, 10, 20);
        assert!(result.is_none());
    }

    #[test]
    fn test_default_threshold_of_10() {
        // Verify the default threshold logic: cutoff = 20 - 10 = 10
        let item = make_subscriber_item("edge@example.com", Some(10), Some("2020-01-01T00:00:00Z"));
        // lastEngagedIssue = 10, cutoff = 10 → 10 < 10 is false → not dormant
        let result = evaluate_subscriber(&item, 10, 10, 20);
        assert!(result.is_none());

        // lastEngagedIssue = 9, cutoff = 10 → 9 < 10 → dormant
        let item2 =
            make_subscriber_item("edge2@example.com", Some(9), Some("2020-01-01T00:00:00Z"));
        let result2 = evaluate_subscriber(&item2, 10, 10, 20);
        assert!(result2.is_some());
    }

    #[test]
    fn test_empty_result_when_no_match() {
        // All subscribers are active
        let item =
            make_subscriber_item("active@example.com", Some(19), Some("2020-01-01T00:00:00Z"));
        let result = evaluate_subscriber(&item, 10, 10, 20);
        assert!(result.is_none());
    }

    #[test]
    fn test_is_subscriber_record_accepts_real_email() {
        let item = make_subscriber_item("person@example.com", Some(3), None);
        assert!(is_subscriber_record(&item));
    }

    #[test]
    fn test_is_subscriber_record_rejects_segment_rows() {
        for sk in [
            "SEGMENT#01JABC",
            "SEGMENT_NAME#vip subscribers",
            "SEGMENT_JOB#01JXYZ",
            "SEGMENT#01JABC#MEMBER#person@example.com",
            "SEGMENT_NAME#auto: ai",
        ] {
            let mut item = HashMap::new();
            item.insert("email".to_string(), AttributeValue::S(sk.to_string()));
            assert!(
                !is_subscriber_record(&item),
                "expected {sk} to be excluded from the subscriber list"
            );
        }
    }

    #[test]
    fn test_is_subscriber_record_rejects_item_without_email() {
        let item = HashMap::new();
        assert!(!is_subscriber_record(&item));
    }

    #[test]
    fn test_parse_interest_scores_reads_topic_map() {
        let mut ai_entry = HashMap::new();
        ai_entry.insert("score".to_string(), AttributeValue::N("3.5".to_string()));
        ai_entry.insert(
            "lastScoredAt".to_string(),
            AttributeValue::S("2026-01-01T00:00:00Z".to_string()),
        );

        let mut scores = HashMap::new();
        scores.insert("ai".to_string(), AttributeValue::M(ai_entry));

        let mut item = HashMap::new();
        item.insert(
            "email".to_string(),
            AttributeValue::S("a@b.com".to_string()),
        );
        item.insert("interestScores".to_string(), AttributeValue::M(scores));

        let parsed = parse_interest_scores(&item).expect("should parse");
        let ai = parsed.get("ai").expect("ai topic present");
        assert_eq!(ai.score, 3.5);
        assert_eq!(ai.last_scored_at, "2026-01-01T00:00:00Z");
    }

    #[test]
    fn test_parse_interest_scores_absent_returns_none() {
        let item = make_subscriber_item("a@b.com", Some(1), None);
        assert!(parse_interest_scores(&item).is_none());
    }

    #[test]
    fn test_hash_email_produces_sha256() {
        let hash = hash_email("test@example.com");
        // SHA-256 hash should be 64 hex characters
        assert_eq!(hash.len(), 64);
        // Should be deterministic
        assert_eq!(hash, hash_email("test@example.com"));
        // Different emails should produce different hashes
        assert_ne!(hash, hash_email("other@example.com"));
    }

    #[test]
    fn test_is_subscription_too_recent_with_old_date() {
        let old_date = Some("2020-01-01T00:00:00Z".to_string());
        assert!(!is_subscription_too_recent(None, &old_date, 10, 20));
    }

    #[test]
    fn test_is_subscription_too_recent_with_recent_date() {
        let now = chrono::Utc::now().to_rfc3339();
        let recent_date = Some(now);
        assert!(is_subscription_too_recent(None, &recent_date, 10, 20));
    }

    #[test]
    fn test_is_subscription_too_recent_with_no_created_at() {
        // No createdAt → cannot determine recency → don't exclude
        assert!(!is_subscription_too_recent(None, &None, 10, 20));
    }

    // ── Audience health / cohort classification tests ──────────────────

    #[test]
    fn test_classify_cohort_highly_engaged_same_issue() {
        // lastEngagedIssue == latestIssueNumber → highly engaged
        assert_eq!(
            classify_cohort(Some(20), 20),
            EngagementCohort::HighlyEngaged
        );
    }

    #[test]
    fn test_classify_cohort_highly_engaged_one_behind() {
        // lastEngagedIssue == latestIssueNumber - 1 → highly engaged
        assert_eq!(
            classify_cohort(Some(19), 20),
            EngagementCohort::HighlyEngaged
        );
    }

    #[test]
    fn test_classify_cohort_occasional_two_behind() {
        // lastEngagedIssue == latestIssueNumber - 2 → occasional (3–10 issues behind)
        assert_eq!(classify_cohort(Some(18), 20), EngagementCohort::Occasional);
    }

    #[test]
    fn test_classify_cohort_occasional_nine_behind() {
        // lastEngagedIssue == latestIssueNumber - 9 → occasional (boundary)
        assert_eq!(classify_cohort(Some(11), 20), EngagementCohort::Occasional);
    }

    #[test]
    fn test_classify_cohort_dormant_ten_behind() {
        // lastEngagedIssue == latestIssueNumber - 10 → dormant
        assert_eq!(classify_cohort(Some(10), 20), EngagementCohort::Dormant);
    }

    #[test]
    fn test_classify_cohort_dormant_very_old() {
        // lastEngagedIssue far behind → dormant
        assert_eq!(classify_cohort(Some(1), 20), EngagementCohort::Dormant);
    }

    #[test]
    fn test_classify_cohort_dormant_no_engagement() {
        // No lastEngagedIssue → dormant
        assert_eq!(classify_cohort(None, 20), EngagementCohort::Dormant);
    }

    #[test]
    fn test_classify_cohort_highly_engaged_future_issue() {
        // lastEngagedIssue > latestIssueNumber → still highly engaged
        assert_eq!(
            classify_cohort(Some(25), 20),
            EngagementCohort::HighlyEngaged
        );
    }

    #[test]
    fn test_audience_health_response_bootstrap_serialization() {
        let resp = AudienceHealthResponse {
            bootstrap: Some(true),
            cohorts: None,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json, json!({"bootstrap": true}));
    }

    #[test]
    fn test_audience_health_response_cohorts_serialization() {
        let resp = AudienceHealthResponse {
            bootstrap: None,
            cohorts: Some(CohortCounts {
                highly_engaged: CohortDetail {
                    count: 5,
                    percentage: 50.0,
                },
                occasional: CohortDetail {
                    count: 3,
                    percentage: 30.0,
                },
                dormant: CohortDetail {
                    count: 2,
                    percentage: 20.0,
                },
                total: 10,
            }),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert!(json.get("bootstrap").is_none());
        assert_eq!(json["cohorts"]["total"], 10);
        assert_eq!(json["cohorts"]["highlyEngaged"]["count"], 5);
        assert_eq!(json["cohorts"]["highlyEngaged"]["percentage"], 50.0);
        assert_eq!(json["cohorts"]["occasional"]["count"], 3);
        assert_eq!(json["cohorts"]["dormant"]["count"], 2);
    }

    #[test]
    fn test_cohort_boundaries_exhaustive() {
        // For latestIssueNumber = 20:
        // Highly engaged: lei >= 19 (i.e., 19, 20, 21, ...)
        // Occasional: lei >= 11 AND lei < 19 (i.e., 11, 12, ..., 18)
        // Dormant: lei < 11 OR None

        let latest = 20;

        // Highly engaged boundary
        assert_eq!(
            classify_cohort(Some(19), latest),
            EngagementCohort::HighlyEngaged
        );
        assert_eq!(
            classify_cohort(Some(20), latest),
            EngagementCohort::HighlyEngaged
        );

        // Occasional boundaries
        assert_eq!(
            classify_cohort(Some(18), latest),
            EngagementCohort::Occasional
        );
        assert_eq!(
            classify_cohort(Some(11), latest),
            EngagementCohort::Occasional
        );

        // Dormant boundaries
        assert_eq!(classify_cohort(Some(10), latest), EngagementCohort::Dormant);
        assert_eq!(classify_cohort(Some(0), latest), EngagementCohort::Dormant);
        assert_eq!(classify_cohort(None, latest), EngagementCohort::Dormant);
    }

    #[test]
    fn test_cohort_percentage_calculation() {
        // Simulate what query_audience_health does for percentage calculation
        let total = 10i64;
        let percentage = |count: i64| -> f64 {
            if total == 0 {
                0.0
            } else {
                ((count as f64 / total as f64) * 1000.0).round() / 10.0
            }
        };

        assert_eq!(percentage(5), 50.0);
        assert_eq!(percentage(3), 30.0);
        assert_eq!(percentage(2), 20.0);
        assert_eq!(percentage(1), 10.0);
        assert_eq!(percentage(0), 0.0);

        // Verify percentages sum to 100
        let p1 = percentage(5);
        let p2 = percentage(3);
        let p3 = percentage(2);
        assert!((p1 + p2 + p3 - 100.0).abs() < 0.01);
    }

    #[test]
    fn test_cohort_percentage_rounding() {
        // 1/3 should round to 33.3
        let total = 3i64;
        let percentage =
            |count: i64| -> f64 { ((count as f64 / total as f64) * 1000.0).round() / 10.0 };
        assert_eq!(percentage(1), 33.3);
    }

    // ── Attribution helper tests ──────────────────────────────────────

    fn make_issue_item(pk: &str, published_at: Option<&str>) -> HashMap<String, AttributeValue> {
        let mut item = HashMap::new();
        item.insert("pk".to_string(), AttributeValue::S(pk.to_string()));
        if let Some(pa) = published_at {
            item.insert("publishedAt".to_string(), AttributeValue::S(pa.to_string()));
        }
        item
    }

    #[test]
    fn test_build_issue_gsi1pk_format() {
        assert_eq!(build_issue_gsi1pk("tenant-abc"), "tenant-abc#issue");
        assert_eq!(build_issue_gsi1pk("t1"), "t1#issue");
    }

    #[test]
    fn test_find_published_issue_pk_single_published() {
        let items = vec![make_issue_item("tenant-1#42", Some("2024-06-01T00:00:00Z"))];
        assert_eq!(
            find_published_issue_pk(&items),
            Some("tenant-1#42".to_string())
        );
    }

    #[test]
    fn test_find_published_issue_pk_no_items() {
        let items: Vec<HashMap<String, AttributeValue>> = vec![];
        assert_eq!(find_published_issue_pk(&items), None);
    }

    #[test]
    fn test_find_published_issue_pk_only_drafts() {
        let items = vec![
            make_issue_item("tenant-1#3", None),
            make_issue_item("tenant-1#2", None),
        ];
        assert_eq!(find_published_issue_pk(&items), None);
    }

    #[test]
    fn test_find_published_issue_pk_drafts_then_published() {
        // Simulates GSI1 descending: drafts at top, published further down
        let items = vec![
            make_issue_item("tenant-1#5", None),
            make_issue_item("tenant-1#4", None),
            make_issue_item("tenant-1#3", Some("2024-05-01T00:00:00Z")),
            make_issue_item("tenant-1#2", Some("2024-04-01T00:00:00Z")),
        ];
        // Should return the first published item encountered (issue #3)
        assert_eq!(
            find_published_issue_pk(&items),
            Some("tenant-1#3".to_string())
        );
    }

    #[test]
    fn test_find_published_issue_pk_published_item_missing_pk() {
        // Edge case: item has publishedAt but no pk attribute
        let mut item = HashMap::new();
        item.insert(
            "publishedAt".to_string(),
            AttributeValue::S("2024-06-01T00:00:00Z".to_string()),
        );
        let items = vec![item];
        assert_eq!(find_published_issue_pk(&items), None);
    }

    #[test]
    fn test_find_published_issue_pk_returns_first_match() {
        // Multiple published items — should return the first one (highest issue number
        // since GSI1 is queried descending)
        let items = vec![
            make_issue_item("tenant-1#10", Some("2024-06-01T00:00:00Z")),
            make_issue_item("tenant-1#8", Some("2024-05-01T00:00:00Z")),
        ];
        assert_eq!(
            find_published_issue_pk(&items),
            Some("tenant-1#10".to_string())
        );
    }

    #[test]
    fn test_parse_subscriber_trend_point() {
        let item = make_trend_item(12, 1450);
        let point = parse_subscriber_trend_point(&item).unwrap();

        assert_eq!(point.issue_number, 12);
        assert_eq!(point.subscribers, 1450);
        assert_eq!(point.published_at, None);
    }

    #[test]
    fn test_calculate_trend_summary_multiple_points() {
        let points = vec![
            SubscriberTrendPoint {
                issue_number: 12,
                subscribers: 1450,
                published_at: None,
            },
            SubscriberTrendPoint {
                issue_number: 11,
                subscribers: 1300,
                published_at: None,
            },
            SubscriberTrendPoint {
                issue_number: 10,
                subscribers: 1200,
                published_at: None,
            },
        ];

        let summary = calculate_trend_summary(&points);
        assert_eq!(summary.latest_subscribers, 1450);
        assert_eq!(summary.oldest_subscribers, 1200);
        assert_eq!(summary.net_change, 250);
        assert_eq!(summary.percentage_change, 20.8);
        assert_eq!(summary.points_returned, 3);
    }

    #[test]
    fn test_calculate_trend_summary_empty_points() {
        let summary = calculate_trend_summary(&[]);
        assert_eq!(summary.latest_subscribers, 0);
        assert_eq!(summary.oldest_subscribers, 0);
        assert_eq!(summary.net_change, 0);
        assert_eq!(summary.percentage_change, 0.0);
        assert_eq!(summary.points_returned, 0);
    }
}
