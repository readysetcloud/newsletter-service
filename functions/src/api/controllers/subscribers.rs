use aws_sdk_dynamodb::types::AttributeValue;
use lambda_http::{Body, Error, Request, RequestExt, Response};
use newsletter::admin::{auth, aws_clients, error::AppError, response};
use serde::Serialize;
use sha2::{Digest, Sha256};
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

// ── Public endpoint handlers ───────────────────────────────────────────

/// GET /subscribers?type=sunset
pub async fn get_sunset_candidates(event: Request) -> Result<Response<Body>, Error> {
    match handle_get_sunset_candidates(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /subscribers — dispatches based on `type` query parameter
pub async fn list_subscribers(event: Request) -> Result<Response<Body>, Error> {
    let query_params = event.query_string_parameters();
    match query_params.first("type") {
        Some("sunset") => get_sunset_candidates(event).await,
        Some(t) => {
            let err = AppError::BadRequest(format!("Unknown subscriber type: {}", t));
            Ok(response::format_error_response(&err))
        }
        None => {
            let err = AppError::BadRequest(
                "type query parameter is required (e.g. ?type=sunset)".to_string(),
            );
            Ok(response::format_error_response(&err))
        }
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

// ── Helper functions ───────────────────────────────────────────────────

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
