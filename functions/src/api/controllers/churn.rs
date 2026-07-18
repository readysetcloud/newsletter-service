use aws_sdk_dynamodb::types::AttributeValue;
use chrono::{DateTime, Utc};
use lambda_http::{Body, Error, Request, RequestExt, Response};
use newsletter::admin::{auth, aws_clients, error::AppError, response};
use serde::Serialize;
use std::collections::HashMap;
use std::env;

// ── Churn-risk thresholds ──────────────────────────────────────────────
//
// IMPORTANT: these constants mirror the JS thresholds in
// functions/utils/churn-risk.mjs. If you change one, change the other — the
// Rust admin endpoint and the JS monthly-report computation must classify
// subscribers identically.

/// A subscriber must have engaged with at least this many distinct issues for
/// the `fading` signal to fire (real history, not a never-engaged row).
const FADING_MIN_ENGAGEMENT: i64 = 3;
/// A subscriber must have engaged with at least this many distinct issues for
/// the `streak_break` signal to fire (historically strong).
const STREAK_BREAK_MIN_ENGAGEMENT: i64 = 5;
/// Minimum interest score for a topic to count toward `interest_stale`.
const INTEREST_SCORE_THRESHOLD: f64 = 3.0;
/// A qualifying topic is "stale" once its lastScoredAt is older than this many days.
const INTEREST_STALE_DAYS: i64 = 45;
/// Lower bound of the "occasional" window: lastEngagedIssue >= latest - 9.
const OCCASIONAL_LOOKBACK: i64 = 9;
/// Upper bound of the "occasional" window / silence cutoff: lastEngagedIssue <= latest - 2.
const RECENT_LOOKBACK: i64 = 2;
/// A subscriber whose lastEngagedIssue is below latest - 10 (or null) is already
/// plain-dormant and handled by the existing sunset flow, so it is excluded here.
const DORMANT_LOOKBACK: i64 = 10;
/// Maximum number of subscribers returned in the `atRisk` list (summary counts
/// remain the full totals).
const MAX_AT_RISK: usize = 100;

// ── Response types ─────────────────────────────────────────────────────

/// A single at-risk reason. Serializes as a snake_case string
/// ("fading", "interest_stale", "streak_break").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum RiskReason {
    Fading,
    InterestStale,
    StreakBreak,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AtRiskResponse {
    at_risk: Vec<AtRiskSubscriber>,
    summary: AtRiskSummary,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AtRiskSubscriber {
    email: String,
    last_engaged_issue: Option<i64>,
    engagement_count: i64,
    reasons: Vec<RiskReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_topic: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AtRiskSummary {
    total: i64,
    by_reason: ByReason,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ByReason {
    fading: i64,
    interest_stale: i64,
    streak_break: i64,
}

/// Outcome of classifying a single subscriber's risk signals.
struct Classification {
    reasons: Vec<RiskReason>,
    top_topic: Option<String>,
}

// ── Public endpoint handler ────────────────────────────────────────────

/// GET /subscribers/at-risk?latestIssueNumber=<n>
pub async fn get_at_risk_subscribers(event: Request) -> Result<Response<Body>, Error> {
    match handle_get_at_risk_subscribers(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_get_at_risk_subscribers(event: Request) -> Result<Response<Body>, AppError> {
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

    let response_body = query_at_risk_subscribers(
        ddb_client,
        &subscribers_table,
        &tenant_id,
        latest_issue_number,
        Utc::now(),
    )
    .await?;

    response::format_response(200, response_body)
}

// ── Helpers ────────────────────────────────────────────────────────────

fn get_subscribers_table_name() -> Result<String, AppError> {
    env::var("SUBSCRIBERS_TABLE_NAME")
        .map_err(|_| AppError::InternalError("SUBSCRIBERS_TABLE_NAME not set".to_string()))
}

/// Whether a table item is an actual subscriber record rather than a segments
/// infrastructure row (SEGMENT#, SEGMENT_NAME#, SEGMENT_JOB#, #MEMBER# rows that
/// share the tenant partition). Real email addresses never start with "SEGMENT".
fn is_subscriber_record(item: &HashMap<String, AttributeValue>) -> bool {
    item.get("email")
        .and_then(|v| v.as_s().ok())
        .map(|email| !email.starts_with("SEGMENT"))
        .unwrap_or(false)
}

fn parse_i64_attr(item: &HashMap<String, AttributeValue>, key: &str) -> Option<i64> {
    item.get(key)
        .and_then(|v| v.as_n().ok())
        .and_then(|n| n.parse::<i64>().ok())
}

/// A subscriber who is already plain-dormant (never engaged, or last engaged more
/// than 10 issues ago) is handled by the sunset flow, not the churn-risk report.
fn is_excluded_dormant(last_engaged_issue: Option<i64>, latest_issue_number: i64) -> bool {
    match last_engaged_issue {
        None => true,
        Some(lei) => lei < latest_issue_number - DORMANT_LOOKBACK,
    }
}

/// Find the stalest topic (oldest lastScoredAt) whose score is >= the interest
/// threshold and whose lastScoredAt is older than the staleness window. Topics
/// with an unparseable lastScoredAt are skipped. Returns the topic name and its
/// parsed lastScoredAt, or None if no qualifying topic exists.
fn stalest_stale_topic(
    item: &HashMap<String, AttributeValue>,
    now: DateTime<Utc>,
) -> Option<(String, DateTime<Utc>)> {
    let scores_map = item.get("interestScores")?.as_m().ok()?;
    let mut stalest: Option<(String, DateTime<Utc>)> = None;

    for (topic, entry_val) in scores_map {
        let entry_map = match entry_val.as_m() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let score = entry_map
            .get("score")
            .and_then(|v| v.as_n().ok())
            .and_then(|n| n.parse::<f64>().ok())
            .unwrap_or(0.0);
        if score < INTEREST_SCORE_THRESHOLD {
            continue;
        }

        let last_scored_at = match entry_map.get("lastScoredAt").and_then(|v| v.as_s().ok()) {
            Some(s) => s,
            None => continue,
        };

        let parsed = match DateTime::parse_from_rfc3339(last_scored_at) {
            Ok(dt) => dt.with_timezone(&Utc),
            Err(_) => continue, // skip unparseable
        };

        if (now - parsed).num_days() <= INTEREST_STALE_DAYS {
            continue;
        }

        // Keep the oldest (stalest) qualifying topic.
        match &stalest {
            Some((_, current)) if *current <= parsed => {}
            _ => stalest = Some((topic.clone(), parsed)),
        }
    }

    stalest
}

/// Compute the set of risk reasons (and the stalest interest topic) for a
/// subscriber record. Pure over the item map so it is unit-testable with
/// constructed items. Does not apply the plain-dormant exclusion — see
/// `classify_subscriber`.
fn classify_item(
    item: &HashMap<String, AttributeValue>,
    latest_issue_number: i64,
    now: DateTime<Utc>,
) -> Classification {
    let last_engaged = parse_i64_attr(item, "lastEngagedIssue");
    let engagement_count = parse_i64_attr(item, "engagementCount").unwrap_or(0);
    let mut reasons = Vec::new();

    // fading: was recently active (occasional window) but slipping, with a real
    // engagement history.
    if let Some(lei) = last_engaged {
        if lei >= latest_issue_number - OCCASIONAL_LOOKBACK
            && lei <= latest_issue_number - RECENT_LOOKBACK
            && engagement_count >= FADING_MIN_ENGAGEMENT
        {
            reasons.push(RiskReason::Fading);
        }
    }

    // interest_stale: a strong topic interest has gone cold.
    let stale_topic = stalest_stale_topic(item, now);
    if stale_topic.is_some() {
        reasons.push(RiskReason::InterestStale);
    }

    // streak_break: historically strong but silent for 3+ issues.
    if let Some(lei) = last_engaged {
        if engagement_count >= STREAK_BREAK_MIN_ENGAGEMENT
            && lei < latest_issue_number - RECENT_LOOKBACK
        {
            reasons.push(RiskReason::StreakBreak);
        }
    }

    Classification {
        reasons,
        top_topic: stale_topic.map(|(topic, _)| topic),
    }
}

/// Classify a subscriber into an at-risk record, or None if the subscriber is
/// not at risk (plain-dormant, or no risk reasons). Pure over the item map.
fn classify_subscriber(
    item: &HashMap<String, AttributeValue>,
    latest_issue_number: i64,
    now: DateTime<Utc>,
) -> Option<AtRiskSubscriber> {
    let last_engaged = parse_i64_attr(item, "lastEngagedIssue");

    // Already-dormant subscribers are handled by the sunset flow, not here.
    if is_excluded_dormant(last_engaged, latest_issue_number) {
        return None;
    }

    let classification = classify_item(item, latest_issue_number, now);
    if classification.reasons.is_empty() {
        return None;
    }

    let email = item.get("email").and_then(|v| v.as_s().ok())?.to_string();
    let engagement_count = parse_i64_attr(item, "engagementCount").unwrap_or(0);

    Some(AtRiskSubscriber {
        email,
        last_engaged_issue: last_engaged,
        engagement_count,
        reasons: classification.reasons,
        top_topic: classification.top_topic,
    })
}

/// Assemble the response body from all classified at-risk subscribers: full
/// summary counts, then a list sorted by number of reasons (desc) and
/// lastEngagedIssue (asc), capped at MAX_AT_RISK entries.
fn build_at_risk_response(mut at_risk: Vec<AtRiskSubscriber>) -> AtRiskResponse {
    let mut by_reason = ByReason::default();
    for subscriber in &at_risk {
        for reason in &subscriber.reasons {
            match reason {
                RiskReason::Fading => by_reason.fading += 1,
                RiskReason::InterestStale => by_reason.interest_stale += 1,
                RiskReason::StreakBreak => by_reason.streak_break += 1,
            }
        }
    }

    let total = at_risk.len() as i64;

    // Sort by reason count desc, then lastEngagedIssue asc (most silent first).
    at_risk.sort_by(|a, b| {
        b.reasons
            .len()
            .cmp(&a.reasons.len())
            .then_with(|| {
                a.last_engaged_issue
                    .unwrap_or(i64::MAX)
                    .cmp(&b.last_engaged_issue.unwrap_or(i64::MAX))
            })
            .then_with(|| a.email.cmp(&b.email))
    });

    at_risk.truncate(MAX_AT_RISK);

    AtRiskResponse {
        at_risk,
        summary: AtRiskSummary { total, by_reason },
    }
}

/// Scan the tenant partition (paginated, SEGMENT rows filtered out) and classify
/// every subscriber, returning the assembled churn-risk response.
async fn query_at_risk_subscribers(
    ddb_client: &aws_sdk_dynamodb::Client,
    table_name: &str,
    tenant_id: &str,
    latest_issue_number: i64,
    now: DateTime<Utc>,
) -> Result<AtRiskResponse, AppError> {
    let mut at_risk = Vec::new();
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
            if let Some(subscriber) = classify_subscriber(item, latest_issue_number, now) {
                at_risk.push(subscriber);
            }
        }

        match result.last_evaluated_key() {
            Some(key) if !key.is_empty() => {
                exclusive_start_key = Some(key.clone());
            }
            _ => break,
        }
    }

    Ok(build_at_risk_response(at_risk))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;

    /// Fixed "now" used across tests so staleness math is deterministic.
    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 7, 18, 0, 0, 0).unwrap()
    }

    fn interest_entry(score: f64, last_scored_at: &str) -> AttributeValue {
        let mut entry = HashMap::new();
        entry.insert("score".to_string(), AttributeValue::N(score.to_string()));
        entry.insert(
            "lastScoredAt".to_string(),
            AttributeValue::S(last_scored_at.to_string()),
        );
        AttributeValue::M(entry)
    }

    /// Build a subscriber item with the fields the classifier reads.
    fn make_item(
        email: &str,
        last_engaged_issue: Option<i64>,
        engagement_count: Option<i64>,
        interest_scores: Vec<(&str, AttributeValue)>,
    ) -> HashMap<String, AttributeValue> {
        let mut item = HashMap::new();
        item.insert("email".to_string(), AttributeValue::S(email.to_string()));
        if let Some(lei) = last_engaged_issue {
            item.insert(
                "lastEngagedIssue".to_string(),
                AttributeValue::N(lei.to_string()),
            );
        }
        if let Some(ec) = engagement_count {
            item.insert(
                "engagementCount".to_string(),
                AttributeValue::N(ec.to_string()),
            );
        }
        if !interest_scores.is_empty() {
            let mut scores = HashMap::new();
            for (topic, entry) in interest_scores {
                scores.insert(topic.to_string(), entry);
            }
            item.insert("interestScores".to_string(), AttributeValue::M(scores));
        }
        item
    }

    // ── is_excluded_dormant ────────────────────────────────────────────

    #[test]
    fn test_excluded_dormant_none() {
        assert!(is_excluded_dormant(None, 20));
    }

    #[test]
    fn test_excluded_dormant_below_cutoff() {
        // latest - 10 = 10; lei = 9 < 10 → excluded
        assert!(is_excluded_dormant(Some(9), 20));
    }

    #[test]
    fn test_not_excluded_at_cutoff() {
        // lei = 10 == latest - 10 → not excluded (boundary kept)
        assert!(!is_excluded_dormant(Some(10), 20));
    }

    #[test]
    fn test_not_excluded_recent() {
        assert!(!is_excluded_dormant(Some(19), 20));
    }

    // ── fading ─────────────────────────────────────────────────────────

    #[test]
    fn test_fading_in_window_with_history() {
        // latest 20: window [11, 18], engagementCount >= 3
        let item = make_item("a@b.com", Some(15), Some(4), vec![]);
        let c = classify_item(&item, 20, now());
        assert_eq!(c.reasons, vec![RiskReason::Fading]);
    }

    #[test]
    fn test_fading_boundaries() {
        // lei = 18 (latest - 2) upper bound → fading
        let upper = make_item("u@b.com", Some(18), Some(3), vec![]);
        assert_eq!(
            classify_item(&upper, 20, now()).reasons,
            vec![RiskReason::Fading]
        );
        // lei = 11 (latest - 9) lower bound → fading
        let lower = make_item("l@b.com", Some(11), Some(3), vec![]);
        assert_eq!(
            classify_item(&lower, 20, now()).reasons,
            vec![RiskReason::Fading]
        );
    }

    #[test]
    fn test_fading_requires_engagement_history() {
        // In window but engagementCount = 2 (< 3) → no fading
        let item = make_item("a@b.com", Some(15), Some(2), vec![]);
        assert!(classify_item(&item, 20, now()).reasons.is_empty());
    }

    #[test]
    fn test_fading_excluded_when_too_recent() {
        // lei = 19 (latest - 1) is highly engaged, above the fading window
        let item = make_item("a@b.com", Some(19), Some(5), vec![]);
        assert!(classify_item(&item, 20, now()).reasons.is_empty());
    }

    // ── streak_break ───────────────────────────────────────────────────

    #[test]
    fn test_streak_break_strong_but_silent() {
        // engagementCount >= 5 and lei < latest - 2. lei = 12, engagementCount 3
        // would only be fading; use lei = 12, ec = 6 → both fading and streak_break.
        let item = make_item("a@b.com", Some(12), Some(6), vec![]);
        let reasons = classify_item(&item, 20, now()).reasons;
        assert!(reasons.contains(&RiskReason::Fading));
        assert!(reasons.contains(&RiskReason::StreakBreak));
    }

    #[test]
    fn test_streak_break_only_below_fading_window() {
        // lei = 10 is below the fading lower bound (11) but not excluded (>= latest-10),
        // engagementCount 5 → streak_break only.
        let item = make_item("a@b.com", Some(10), Some(5), vec![]);
        assert_eq!(
            classify_item(&item, 20, now()).reasons,
            vec![RiskReason::StreakBreak]
        );
    }

    #[test]
    fn test_streak_break_requires_strong_history() {
        // lei = 10, engagementCount 4 (< 5), not in fading window → no reasons
        let item = make_item("a@b.com", Some(10), Some(4), vec![]);
        assert!(classify_item(&item, 20, now()).reasons.is_empty());
    }

    // ── interest_stale ─────────────────────────────────────────────────

    #[test]
    fn test_interest_stale_old_strong_topic() {
        // score 4 >= 3, lastScoredAt ~90 days before now → stale
        let item = make_item(
            "a@b.com",
            Some(19),
            Some(2),
            vec![("ai", interest_entry(4.0, "2026-04-01T00:00:00Z"))],
        );
        let c = classify_item(&item, 20, now());
        assert_eq!(c.reasons, vec![RiskReason::InterestStale]);
        assert_eq!(c.top_topic, Some("ai".to_string()));
    }

    #[test]
    fn test_interest_fresh_not_stale() {
        // lastScoredAt 10 days before now → not stale
        let item = make_item(
            "a@b.com",
            Some(19),
            Some(2),
            vec![("ai", interest_entry(4.0, "2026-07-08T00:00:00Z"))],
        );
        assert!(classify_item(&item, 20, now()).reasons.is_empty());
    }

    #[test]
    fn test_interest_low_score_ignored() {
        // score 2 < 3, even though old → ignored
        let item = make_item(
            "a@b.com",
            Some(19),
            Some(2),
            vec![("ai", interest_entry(2.0, "2026-01-01T00:00:00Z"))],
        );
        assert!(classify_item(&item, 20, now()).reasons.is_empty());
    }

    #[test]
    fn test_interest_stale_reports_stalest_topic() {
        // Two stale strong topics — report the one with the oldest lastScoredAt.
        let item = make_item(
            "a@b.com",
            Some(19),
            Some(2),
            vec![
                ("ai", interest_entry(4.0, "2026-04-01T00:00:00Z")),
                ("devops", interest_entry(5.0, "2026-01-15T00:00:00Z")),
            ],
        );
        let c = classify_item(&item, 20, now());
        assert_eq!(c.top_topic, Some("devops".to_string()));
    }

    #[test]
    fn test_interest_stale_skips_unparseable_date() {
        // Unparseable lastScoredAt → topic skipped, no reason.
        let item = make_item(
            "a@b.com",
            Some(19),
            Some(2),
            vec![("ai", interest_entry(4.0, "not-a-date"))],
        );
        assert!(classify_item(&item, 20, now()).reasons.is_empty());
    }

    #[test]
    fn test_interest_stale_boundary_exactly_45_days_not_stale() {
        // Exactly 45 days old → not stale (strictly older than 45 required).
        let item = make_item(
            "a@b.com",
            Some(19),
            Some(2),
            vec![("ai", interest_entry(4.0, "2026-06-03T00:00:00Z"))],
        );
        assert!(classify_item(&item, 20, now()).reasons.is_empty());
    }

    // ── classify_subscriber (exclusion + assembly) ─────────────────────

    #[test]
    fn test_classify_subscriber_excludes_dormant() {
        // lei = 5 < latest - 10 → excluded even though it has a stale interest.
        let item = make_item(
            "a@b.com",
            Some(5),
            Some(6),
            vec![("ai", interest_entry(4.0, "2026-01-01T00:00:00Z"))],
        );
        assert!(classify_subscriber(&item, 20, now()).is_none());
    }

    #[test]
    fn test_classify_subscriber_excludes_never_engaged() {
        let item = make_item(
            "a@b.com",
            None,
            Some(6),
            vec![("ai", interest_entry(4.0, "2026-01-01T00:00:00Z"))],
        );
        assert!(classify_subscriber(&item, 20, now()).is_none());
    }

    #[test]
    fn test_classify_subscriber_no_reasons_is_none() {
        // Highly engaged, fresh interest → not at risk.
        let item = make_item("a@b.com", Some(20), Some(10), vec![]);
        assert!(classify_subscriber(&item, 20, now()).is_none());
    }

    #[test]
    fn test_classify_subscriber_multiple_reasons() {
        // Fading + streak_break + interest_stale all at once.
        let item = make_item(
            "a@b.com",
            Some(12),
            Some(6),
            vec![("ai", interest_entry(4.0, "2026-01-01T00:00:00Z"))],
        );
        let subscriber = classify_subscriber(&item, 20, now()).expect("at risk");
        assert_eq!(subscriber.email, "a@b.com");
        assert_eq!(subscriber.last_engaged_issue, Some(12));
        assert_eq!(subscriber.engagement_count, 6);
        assert!(subscriber.reasons.contains(&RiskReason::Fading));
        assert!(subscriber.reasons.contains(&RiskReason::StreakBreak));
        assert!(subscriber.reasons.contains(&RiskReason::InterestStale));
        assert_eq!(subscriber.top_topic, Some("ai".to_string()));
    }

    // ── is_subscriber_record ───────────────────────────────────────────

    #[test]
    fn test_is_subscriber_record_rejects_segment_rows() {
        for sk in ["SEGMENT#01J", "SEGMENT_NAME#vip", "SEGMENT_JOB#01J"] {
            let mut item = HashMap::new();
            item.insert("email".to_string(), AttributeValue::S(sk.to_string()));
            assert!(!is_subscriber_record(&item));
        }
    }

    #[test]
    fn test_is_subscriber_record_accepts_real_email() {
        let item = make_item("person@example.com", Some(15), Some(3), vec![]);
        assert!(is_subscriber_record(&item));
    }

    // ── build_at_risk_response (summary + sort + cap) ──────────────────

    #[test]
    fn test_build_response_summary_counts_full_totals() {
        let subscribers = vec![
            AtRiskSubscriber {
                email: "one@b.com".to_string(),
                last_engaged_issue: Some(12),
                engagement_count: 6,
                reasons: vec![RiskReason::Fading, RiskReason::StreakBreak],
                top_topic: None,
            },
            AtRiskSubscriber {
                email: "two@b.com".to_string(),
                last_engaged_issue: Some(15),
                engagement_count: 4,
                reasons: vec![RiskReason::Fading],
                top_topic: None,
            },
            AtRiskSubscriber {
                email: "three@b.com".to_string(),
                last_engaged_issue: Some(18),
                engagement_count: 2,
                reasons: vec![RiskReason::InterestStale],
                top_topic: Some("ai".to_string()),
            },
        ];

        let response = build_at_risk_response(subscribers);
        assert_eq!(response.summary.total, 3);
        assert_eq!(response.summary.by_reason.fading, 2);
        assert_eq!(response.summary.by_reason.streak_break, 1);
        assert_eq!(response.summary.by_reason.interest_stale, 1);
    }

    #[test]
    fn test_build_response_sorts_by_reason_count_then_recency() {
        let subscribers = vec![
            // one reason, lei 18
            AtRiskSubscriber {
                email: "single@b.com".to_string(),
                last_engaged_issue: Some(18),
                engagement_count: 4,
                reasons: vec![RiskReason::Fading],
                top_topic: None,
            },
            // two reasons, lei 15
            AtRiskSubscriber {
                email: "double-late@b.com".to_string(),
                last_engaged_issue: Some(15),
                engagement_count: 6,
                reasons: vec![RiskReason::Fading, RiskReason::StreakBreak],
                top_topic: None,
            },
            // two reasons, lei 12 (more silent → should come first among the pair)
            AtRiskSubscriber {
                email: "double-early@b.com".to_string(),
                last_engaged_issue: Some(12),
                engagement_count: 6,
                reasons: vec![RiskReason::Fading, RiskReason::StreakBreak],
                top_topic: None,
            },
        ];

        let response = build_at_risk_response(subscribers);
        let order: Vec<&str> = response.at_risk.iter().map(|s| s.email.as_str()).collect();
        assert_eq!(
            order,
            vec!["double-early@b.com", "double-late@b.com", "single@b.com"]
        );
    }

    #[test]
    fn test_build_response_caps_list_but_not_summary() {
        let subscribers: Vec<AtRiskSubscriber> = (0..150)
            .map(|i| AtRiskSubscriber {
                email: format!("s{i:03}@b.com"),
                last_engaged_issue: Some(15),
                engagement_count: 4,
                reasons: vec![RiskReason::Fading],
                top_topic: None,
            })
            .collect();

        let response = build_at_risk_response(subscribers);
        assert_eq!(response.at_risk.len(), MAX_AT_RISK);
        // Summary reflects the full 150, not the capped 100.
        assert_eq!(response.summary.total, 150);
        assert_eq!(response.summary.by_reason.fading, 150);
    }

    // ── serialization ──────────────────────────────────────────────────

    #[test]
    fn test_response_serializes_camelcase() {
        let response = AtRiskResponse {
            at_risk: vec![AtRiskSubscriber {
                email: "a@b.com".to_string(),
                last_engaged_issue: Some(12),
                engagement_count: 6,
                reasons: vec![RiskReason::Fading, RiskReason::InterestStale],
                top_topic: Some("ai".to_string()),
            }],
            summary: AtRiskSummary {
                total: 1,
                by_reason: ByReason {
                    fading: 1,
                    interest_stale: 1,
                    streak_break: 0,
                },
            },
        };

        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["atRisk"][0]["email"], "a@b.com");
        assert_eq!(value["atRisk"][0]["lastEngagedIssue"], 12);
        assert_eq!(value["atRisk"][0]["engagementCount"], 6);
        assert_eq!(value["atRisk"][0]["reasons"][0], "fading");
        assert_eq!(value["atRisk"][0]["reasons"][1], "interest_stale");
        assert_eq!(value["atRisk"][0]["topTopic"], "ai");
        assert_eq!(value["summary"]["total"], 1);
        assert_eq!(value["summary"]["byReason"]["fading"], 1);
        assert_eq!(value["summary"]["byReason"]["interestStale"], 1);
        assert_eq!(value["summary"]["byReason"]["streakBreak"], 0);
    }

    #[test]
    fn test_response_omits_top_topic_when_absent() {
        let subscriber = AtRiskSubscriber {
            email: "a@b.com".to_string(),
            last_engaged_issue: Some(15),
            engagement_count: 4,
            reasons: vec![RiskReason::Fading],
            top_topic: None,
        };
        let value = serde_json::to_value(&subscriber).unwrap();
        assert!(value.get("topTopic").is_none());
    }

    #[test]
    fn test_reason_serializes_snake_case() {
        assert_eq!(
            serde_json::to_value(RiskReason::Fading).unwrap(),
            json!("fading")
        );
        assert_eq!(
            serde_json::to_value(RiskReason::InterestStale).unwrap(),
            json!("interest_stale")
        );
        assert_eq!(
            serde_json::to_value(RiskReason::StreakBreak).unwrap(),
            json!("streak_break")
        );
    }
}
