//! The recorded lifecycle of an issue.
//!
//! Every transition an operator would want to see when asking "what actually
//! happened to this issue" lands here as one item under the issue's partition,
//! sorted chronologically by its sort key. The JS half of the writer lives in
//! `functions/utils/issue-timeline.mjs` and writes the same shape from the send
//! path; this half covers everything the API itself does.
//!
//! Two events are deliberately *not* stored: `published` and `failed`. The
//! issue record already states both authoritatively, in `publishedAt` and
//! `failureReason`, and storing a second copy invites the two to disagree about
//! an issue's most important fact. [`derive_entries`] reads them off the record
//! at request time instead and marks what it produced, so the timeline is
//! complete without being duplicated — and so issues that predate this feature
//! still have one.

use aws_sdk_dynamodb::types::AttributeValue;
use newsletter::admin::aws_clients;
use serde::Serialize;
use std::collections::HashMap;

/// Sort-key prefix of a timeline item. Kept in step with `TIMELINE_SK_PREFIX`
/// in `functions/utils/issue-timeline.mjs`.
pub const TIMELINE_SK_PREFIX: &str = "event#";

/// How long a timeline outlives its issue.
const TIMELINE_TTL_DAYS: i64 = 400;

/// Event type names. Kept in step with `ISSUE_EVENTS` in
/// `functions/utils/issue-timeline.mjs` — the two halves write into one stream,
/// so a name that only one of them knows is a hole in the timeline.
pub mod events {
    pub const CREATED: &str = "created";
    pub const UPDATED: &str = "updated";
    pub const SCHEDULED: &str = "scheduled";
    pub const RESCHEDULED: &str = "rescheduled";
    pub const UNSCHEDULED: &str = "unscheduled";
    pub const RESEND_REQUESTED: &str = "resend_requested";

    // Derived at read time from the issue record rather than recorded.
    pub const PUBLISHED: &str = "published";
    pub const FAILED: &str = "failed";
}

/// One entry in an issue's timeline, as the dashboard receives it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct TimelineEntry {
    /// One of [`events`].
    #[serde(rename = "type")]
    pub event_type: String,
    /// ISO-8601 instant the event happened.
    pub at: String,
    /// Who caused it: an email address, or `system`.
    pub actor: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<serde_json::Value>,
    /// True when this entry was reconstructed from the issue record rather than
    /// recorded as it happened. Surfaced so the dashboard can say so: a derived
    /// entry carries the record's timestamp, which for `failed` is the last
    /// write of any kind rather than the moment of failure.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub derived: bool,
}

/// Appends one event to an issue's timeline.
///
/// **Never fails the caller.** Every call site is a transition that has already
/// happened by the time this runs, so a failed write is logged and swallowed —
/// refusing an operator's reschedule because its own audit note could not be
/// stored would be the wrong trade. A dropped entry shows up as a gap, which is
/// the same shape as the incidents this exists to surface.
pub async fn record_event(
    tenant_id: &str,
    issue_number: i32,
    event_type: &str,
    actor: &str,
    detail: Option<serde_json::Value>,
) {
    if let Err(err) = try_record_event(tenant_id, issue_number, event_type, actor, detail).await {
        tracing::error!(
            "Failed to record timeline event {event_type} for issue {issue_number}: {err}"
        );
    }
}

async fn try_record_event(
    tenant_id: &str,
    issue_number: i32,
    event_type: &str,
    actor: &str,
    detail: Option<serde_json::Value>,
) -> Result<(), Box<dyn std::error::Error>> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")?;

    let now = chrono::Utc::now();
    let at = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let mut request = ddb_client
        .put_item()
        .table_name(&table_name)
        .item(
            "pk",
            AttributeValue::S(format!("{tenant_id}#{issue_number}")),
        )
        // The random suffix is a tiebreaker, not an identifier: two events can
        // share a millisecond, and without it the second would overwrite the
        // first.
        .item(
            "sk",
            AttributeValue::S(format!(
                "{TIMELINE_SK_PREFIX}{at}#{}",
                &uuid::Uuid::new_v4().simple().to_string()[..8]
            )),
        )
        .item("type", AttributeValue::S(event_type.to_string()))
        .item("at", AttributeValue::S(at))
        .item("actor", AttributeValue::S(actor.to_string()))
        .item(
            "ttl",
            AttributeValue::N((now.timestamp() + TIMELINE_TTL_DAYS * 24 * 60 * 60).to_string()),
        );

    if let Some(detail) = detail {
        request = request.item("detail", AttributeValue::S(detail.to_string()));
    }

    request.send().await?;
    Ok(())
}

/// Reads an issue's recorded timeline, oldest first.
///
/// Returns an empty timeline rather than an error when the read fails: the
/// timeline is a troubleshooting aid attached to the issue response, and losing
/// the whole issue detail page because its history could not be read would be a
/// worse outcome than showing the page without it.
pub async fn get_recorded_entries(tenant_id: &str, issue_number: i32) -> Vec<TimelineEntry> {
    let Ok(table_name) = std::env::var("TABLE_NAME") else {
        return Vec::new();
    };
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let result = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("pk = :pk AND begins_with(sk, :prefix)")
        .expression_attribute_values(
            ":pk",
            AttributeValue::S(format!("{tenant_id}#{issue_number}")),
        )
        .expression_attribute_values(":prefix", AttributeValue::S(TIMELINE_SK_PREFIX.to_string()))
        .send()
        .await;

    match result {
        Ok(output) => output
            .items()
            .iter()
            .filter_map(parse_entry)
            .collect::<Vec<_>>(),
        Err(err) => {
            tracing::error!("Failed to read the timeline for issue {issue_number}: {err}");
            Vec::new()
        }
    }
}

fn parse_entry(item: &HashMap<String, AttributeValue>) -> Option<TimelineEntry> {
    let text = |key: &str| -> Option<String> {
        item.get(key)
            .and_then(|value| value.as_s().ok())
            .map(|value| value.to_string())
    };

    Some(TimelineEntry {
        event_type: text("type")?,
        at: text("at")?,
        actor: text("actor").unwrap_or_else(|| "system".to_string()),
        // Stored as a JSON string so the writer does not have to model every
        // shape a detail can take; a value that will not parse is dropped
        // rather than failing the entry it belongs to.
        detail: text("detail").and_then(|raw| serde_json::from_str(&raw).ok()),
        derived: false,
    })
}

/// Facts the issue record already holds, rendered as timeline entries.
///
/// This is not a backfill and does not write anything: `publishedAt` and
/// `failureReason` *are* the record of those two events, so reading them here
/// is cheaper and more truthful than storing a second copy that could drift.
/// It also means an issue that predates the recorded timeline still shows the
/// milestones the record knows about, which is what makes the feature useful on
/// the issues you already have rather than only on the next one.
///
/// Anything already recorded wins: a real `created` entry from the API is
/// better than one reconstructed from `createdAt`, because it carries the
/// actor.
pub fn derive_entries(
    created_at: Option<&str>,
    scheduled_at: Option<&str>,
    published_at: Option<&str>,
    failure_reason: Option<&str>,
    updated_at: Option<&str>,
    status: &str,
) -> Vec<TimelineEntry> {
    let mut derived = Vec::new();

    let entry = |event_type: &str, at: &str, detail: Option<serde_json::Value>| TimelineEntry {
        event_type: event_type.to_string(),
        at: at.to_string(),
        actor: "system".to_string(),
        detail,
        derived: true,
    };

    if let Some(at) = created_at.filter(|value| !value.is_empty()) {
        derived.push(entry(events::CREATED, at, None));
    }

    // Only meaningful while the issue is still waiting: once it has published,
    // `scheduledAt` describes a send that already happened, and the recorded
    // `scheduled` event (if any) is the better account of when it was booked.
    if status == "scheduled" {
        if let Some(at) = scheduled_at.filter(|value| !value.is_empty()) {
            derived.push(entry(
                events::SCHEDULED,
                at,
                Some(serde_json::json!({ "sendAt": at })),
            ));
        }
    }

    if let Some(at) = published_at.filter(|value| !value.is_empty()) {
        derived.push(entry(events::PUBLISHED, at, None));
    }

    // `updatedAt` is the last write of any kind, not the instant of failure —
    // close enough to place the event, and flagged `derived` so the dashboard
    // does not present it as precise.
    if let Some(reason) = failure_reason.filter(|value| !value.is_empty()) {
        if let Some(at) = updated_at.filter(|value| !value.is_empty()) {
            derived.push(entry(
                events::FAILED,
                at,
                Some(serde_json::json!({ "reason": reason })),
            ));
        }
    }

    derived
}

/// The timeline as the dashboard receives it: everything recorded, plus the
/// record-derived milestones for event types nothing recorded, oldest first.
pub fn merge_entries(
    recorded: Vec<TimelineEntry>,
    derived: Vec<TimelineEntry>,
) -> Vec<TimelineEntry> {
    let recorded_types: std::collections::HashSet<&str> = recorded
        .iter()
        .map(|entry| entry.event_type.as_str())
        .collect();

    let mut merged = recorded.clone();
    merged.extend(
        derived
            .into_iter()
            .filter(|entry| !recorded_types.contains(entry.event_type.as_str())),
    );

    // Lexicographic ordering is chronological for RFC3339 instants in the same
    // offset, which every writer here emits (both halves stamp UTC). Falling
    // back to a string compare rather than parsing keeps an unparseable
    // timestamp in the timeline instead of dropping it.
    merged.sort_by(|a, b| a.at.cmp(&b.at));
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_entries_reads_the_record_milestones() {
        let derived = derive_entries(
            Some("2026-08-01T10:00:00Z"),
            None,
            Some("2026-08-03T14:00:00Z"),
            None,
            Some("2026-08-03T14:00:01Z"),
            "published",
        );

        let types: Vec<&str> = derived.iter().map(|e| e.event_type.as_str()).collect();
        assert_eq!(types, vec![events::CREATED, events::PUBLISHED]);
        assert!(derived.iter().all(|entry| entry.derived));
    }

    /// After a send, `scheduledAt` describes something that already happened;
    /// showing it as a pending booking alongside `published` reads as though
    /// the issue were scheduled again afterwards.
    #[test]
    fn test_derive_entries_omits_the_schedule_once_published() {
        let derived = derive_entries(
            Some("2026-08-01T10:00:00Z"),
            Some("2026-08-03T14:00:00Z"),
            Some("2026-08-03T14:00:00Z"),
            None,
            None,
            "published",
        );

        assert!(!derived
            .iter()
            .any(|entry| entry.event_type == events::SCHEDULED));
    }

    #[test]
    fn test_derive_entries_shows_a_pending_schedule() {
        let derived = derive_entries(
            Some("2026-08-01T10:00:00Z"),
            Some("2026-08-10T14:00:00Z"),
            None,
            None,
            None,
            "scheduled",
        );

        let scheduled = derived
            .iter()
            .find(|entry| entry.event_type == events::SCHEDULED)
            .expect("a scheduled issue should show its booking");
        assert_eq!(
            scheduled.detail,
            Some(serde_json::json!({ "sendAt": "2026-08-10T14:00:00Z" }))
        );
    }

    #[test]
    fn test_derive_entries_reports_a_failure_with_its_cause() {
        let derived = derive_entries(
            None,
            None,
            None,
            Some("PublishUnsuccessful"),
            Some("2026-08-03T14:05:00Z"),
            "failed",
        );

        let failed = derived
            .iter()
            .find(|entry| entry.event_type == events::FAILED)
            .expect("a failed issue should say so");
        assert_eq!(
            failed.detail,
            Some(serde_json::json!({ "reason": "PublishUnsuccessful" }))
        );
    }

    /// A failure with no timestamp to place it is left out rather than guessed
    /// at — an entry at the wrong point in the order is worse than a missing
    /// one on a page whose whole job is sequence.
    #[test]
    fn test_derive_entries_needs_a_timestamp_to_place_a_failure() {
        let derived = derive_entries(
            None,
            None,
            None,
            Some("PublishUnsuccessful"),
            None,
            "failed",
        );

        assert!(derived.is_empty());
    }

    #[test]
    fn test_merge_orders_everything_chronologically() {
        let recorded = vec![
            TimelineEntry {
                event_type: events::SCHEDULED.to_string(),
                at: "2026-08-02T09:00:00.000Z".to_string(),
                actor: "owner@example.com".to_string(),
                detail: None,
                derived: false,
            },
            TimelineEntry {
                event_type: "send_handed_off".to_string(),
                at: "2026-08-02T12:00:00.000Z".to_string(),
                actor: "system".to_string(),
                detail: None,
                derived: false,
            },
        ];
        let derived = derive_entries(
            Some("2026-08-01T10:00:00Z"),
            None,
            Some("2026-08-02T12:00:01Z"),
            None,
            None,
            "published",
        );

        let merged = merge_entries(recorded, derived);
        let types: Vec<&str> = merged.iter().map(|e| e.event_type.as_str()).collect();

        assert_eq!(
            types,
            vec![
                events::CREATED,
                events::SCHEDULED,
                "send_handed_off",
                events::PUBLISHED
            ]
        );
    }

    /// A recorded event carries an actor and an exact instant; the derived one
    /// is a reconstruction of the same fact. Keeping both would show the issue
    /// being created twice.
    #[test]
    fn test_merge_prefers_a_recorded_event_over_its_derived_twin() {
        let recorded = vec![TimelineEntry {
            event_type: events::CREATED.to_string(),
            at: "2026-08-01T10:00:00.000Z".to_string(),
            actor: "owner@example.com".to_string(),
            detail: None,
            derived: false,
        }];
        let derived = derive_entries(
            Some("2026-08-01T10:00:00Z"),
            None,
            None,
            None,
            None,
            "draft",
        );

        let merged = merge_entries(recorded, derived);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].actor, "owner@example.com");
        assert!(!merged[0].derived);
    }
}
