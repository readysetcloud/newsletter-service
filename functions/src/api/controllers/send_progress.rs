//! Reporting for local-send delivery progress.
//!
//! A local-send issue does not finish when its state machine finishes. The
//! `Publish` step hands off to `send-email-v2`, which fans the issue out into
//! one scheduled send per timezone (or peak-hour) group plus a catch-all sweep,
//! and returns. Deliveries then continue for hours.
//!
//! `functions/utils/send-progress.mjs` records that plan and each group's
//! completion on a `sendProgress` item. This module turns it into something an
//! operator can read at a glance, and fills the gap before fan-out (when the
//! issue is scheduled but nothing has been planned yet) by asking Step
//! Functions where the workflow actually is.
//!
//! Timestamps are returned as ISO strings and never formatted into the message:
//! the dashboard renders times in the tenant's timezone, and a pre-formatted
//! time here would be one the UI could not correct.

use aws_sdk_dynamodb::types::AttributeValue;
use newsletter::admin::aws_clients;
use serde::Serialize;
use std::collections::HashMap;

/// Sort key of the progress item written by the send path.
const SEND_PROGRESS_SK: &str = "sendProgress";

/// How far past its scheduled time a group may sit before it is called overdue.
/// A group send is minutes of work, so half an hour of silence means something
/// went wrong rather than something being slow.
const OVERDUE_GRACE_MINUTES: i64 = 30;

/// Group key for subscribers with no confirmed timezone (timezone mode).
const DEFAULT_GROUP: &str = "__default__";
/// Group key for the final catch-all sweep.
const CATCH_ALL_GROUP: &str = "__catch_all__";
/// Group key for subscribers without enough open history (peak-hour mode).
const PEAK_HOUR_DEFAULT_GROUP: &str = "default";

#[derive(Serialize, Debug, PartialEq)]
pub struct GroupProgress {
    /// Raw group key, as stored.
    pub label: String,
    /// Human-readable rendering of the label.
    pub name: String,
    #[serde(rename = "sendAt")]
    pub send_at: String,
    /// `pending`, `sent`, or `empty`.
    pub status: String,
    /// Subscribers planned for this group. Null for the catch-all, whose size
    /// depends on who the per-group sends missed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recipients: Option<i64>,
    #[serde(rename = "sentAt", skip_serializing_if = "Option::is_none")]
    pub sent_at: Option<String>,
    /// Still pending well past its scheduled time.
    pub overdue: bool,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct SendProgressResponse {
    /// `sending`, `complete`, or `stalled`.
    pub state: String,
    /// One-line summary, safe to show verbatim. Contains no timestamps.
    pub message: String,
    pub mode: String,
    #[serde(rename = "defaultTimeZone", skip_serializing_if = "Option::is_none")]
    pub default_time_zone: Option<String>,
    #[serde(rename = "groupsTotal")]
    pub groups_total: usize,
    #[serde(rename = "groupsDelivered")]
    pub groups_delivered: usize,
    #[serde(rename = "recipientsSent")]
    pub recipients_sent: i64,
    #[serde(rename = "totalSubscribers", skip_serializing_if = "Option::is_none")]
    pub total_subscribers: Option<i64>,
    #[serde(rename = "startedAt", skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    /// When the catch-all sweep runs — the point everything should be done by.
    #[serde(rename = "expectedCompleteAt", skip_serializing_if = "Option::is_none")]
    pub expected_complete_at: Option<String>,
    #[serde(rename = "completedAt", skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    /// Scheduled time of the earliest group still outstanding.
    #[serde(rename = "nextSendAt", skip_serializing_if = "Option::is_none")]
    pub next_send_at: Option<String>,
    pub groups: Vec<GroupProgress>,
}

/// Where the publish workflow is, for issues that have no progress record yet.
#[derive(Serialize, Debug, PartialEq)]
pub struct WorkflowState {
    /// `waiting`, `running`, `failed`, or `stopped`.
    pub state: String,
    pub message: String,
    /// Failure cause, when the execution reports one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Render `America/New_York` as `New York`, and the sentinel group keys as
/// what they mean. The raw label travels alongside, so nothing is lost.
fn friendly_group_name(label: &str) -> String {
    match label {
        DEFAULT_GROUP => "No time zone detected".to_string(),
        CATCH_ALL_GROUP => "Final sweep".to_string(),
        PEAK_HOUR_DEFAULT_GROUP => "Not enough open history".to_string(),
        _ => {
            if let Some(hour) = label.strip_prefix("hour-") {
                return match hour.parse::<u32>() {
                    Ok(value) if value < 24 => format!("{value:02}:00 UTC"),
                    _ => label.to_string(),
                };
            }
            label.rsplit('/').next().unwrap_or(label).replace('_', " ")
        }
    }
}

fn as_string(item: &HashMap<String, AttributeValue>, key: &str) -> Option<String> {
    item.get(key)
        .and_then(|value| value.as_s().ok())
        .map(|value| value.to_string())
}

fn as_number(value: Option<&AttributeValue>) -> Option<i64> {
    value
        .and_then(|value| value.as_n().ok())
        .and_then(|value| value.parse::<i64>().ok())
}

/// Build the report from a raw `sendProgress` item.
///
/// `now` is passed in rather than read so overdue detection is testable.
/// Returns None when the item carries no usable group map — a half-written
/// record should read as "no progress information", not as a stalled send.
pub fn build_progress_report(
    item: &HashMap<String, AttributeValue>,
    now: chrono::DateTime<chrono::Utc>,
) -> Option<SendProgressResponse> {
    let raw_groups = item.get("groups").and_then(|value| value.as_m().ok())?;
    if raw_groups.is_empty() {
        return None;
    }

    let completed_at = as_string(item, "completedAt");
    let overdue_cutoff = now - chrono::Duration::minutes(OVERDUE_GRACE_MINUTES);

    let mut groups: Vec<GroupProgress> = raw_groups
        .iter()
        .map(|(label, value)| {
            let fields = value.as_m().ok();
            let status = fields
                .and_then(|fields| as_string(fields, "status"))
                .unwrap_or_else(|| "pending".to_string());
            let send_at = fields
                .and_then(|fields| as_string(fields, "sendAt"))
                .unwrap_or_default();

            // Only a still-pending group can be overdue, and only once the
            // whole send has not already completed.
            let overdue = status == "pending"
                && completed_at.is_none()
                && chrono::DateTime::parse_from_rfc3339(&send_at)
                    .map(|parsed| parsed.with_timezone(&chrono::Utc) < overdue_cutoff)
                    .unwrap_or(false);

            GroupProgress {
                label: label.clone(),
                name: friendly_group_name(label),
                send_at,
                status,
                size: fields.and_then(|fields| as_number(fields.get("size"))),
                recipients: fields.and_then(|fields| as_number(fields.get("recipients"))),
                sent_at: fields.and_then(|fields| as_string(fields, "sentAt")),
                overdue,
            }
        })
        .collect();

    // Chronological: the order the subscriber base actually receives the issue.
    groups.sort_by(|a, b| a.send_at.cmp(&b.send_at).then(a.label.cmp(&b.label)));

    let groups_total = groups.len();
    let groups_delivered = groups
        .iter()
        .filter(|group| group.status != "pending")
        .count();
    let recipients_sent: i64 = groups
        .iter()
        .map(|group| group.recipients.unwrap_or(0))
        .sum();
    let overdue: Vec<&GroupProgress> = groups.iter().filter(|group| group.overdue).collect();
    let next_send_at = groups
        .iter()
        .find(|group| group.status == "pending")
        .map(|group| group.send_at.clone());

    let state = if completed_at.is_some() {
        "complete"
    } else if overdue.is_empty() {
        "sending"
    } else {
        "stalled"
    };

    let message = build_message(
        state,
        groups_total,
        groups_delivered,
        recipients_sent,
        &overdue,
    );

    Some(SendProgressResponse {
        state: state.to_string(),
        message,
        mode: as_string(item, "mode").unwrap_or_else(|| "timezone".to_string()),
        default_time_zone: as_string(item, "defaultTimeZone"),
        groups_total,
        groups_delivered,
        recipients_sent,
        total_subscribers: as_number(item.get("totalSubscribers")),
        started_at: as_string(item, "startedAt"),
        expected_complete_at: as_string(item, "catchAllAt"),
        completed_at,
        next_send_at,
        groups,
    })
}

fn build_message(
    state: &str,
    groups_total: usize,
    groups_delivered: usize,
    recipients_sent: i64,
    overdue: &[&GroupProgress],
) -> String {
    let group_word = if groups_total == 1 { "group" } else { "groups" };

    match state {
        "complete" => format!(
            "Delivered to {recipients_sent} {} across {groups_total} local send {group_word}.",
            if recipients_sent == 1 {
                "subscriber"
            } else {
                "subscribers"
            }
        ),
        "stalled" => {
            let names: Vec<&str> = overdue.iter().map(|group| group.name.as_str()).collect();
            format!(
                "Sending — {groups_delivered} of {groups_total} {group_word} delivered, but {} overdue ({}).",
                if names.len() == 1 {
                    "1 group is".to_string()
                } else {
                    format!("{} groups are", names.len())
                },
                names.join(", ")
            )
        }
        _ if groups_delivered == 0 => format!(
            "Scheduled — {groups_total} local send {group_word} planned, none delivered yet."
        ),
        _ => format!(
            "Sending — {groups_delivered} of {groups_total} {group_word} delivered, {recipients_sent} {} so far.",
            if recipients_sent == 1 {
                "subscriber"
            } else {
                "subscribers"
            }
        ),
    }
}

/// Read the issue's `sendProgress` item and render it.
///
/// Errors are swallowed: progress reporting must never fail an issue fetch.
pub async fn get_send_progress(tenant_id: &str, issue_number: i32) -> Option<SendProgressResponse> {
    let table_name = std::env::var("TABLE_NAME").ok()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key(
            "pk",
            AttributeValue::S(format!("{tenant_id}#{issue_number}")),
        )
        .key("sk", AttributeValue::S(SEND_PROGRESS_SK.to_string()))
        .send()
        .await
        .inspect_err(|error| {
            tracing::warn!("Failed to read send progress: {error}");
        })
        .ok()?;

    build_progress_report(result.item()?, chrono::Utc::now())
}

/// An issue whose send time has not arrived yet.
///
/// Two situations produce it, and they should read identically because they are
/// the same thing to an operator: an execution parked in the definition's `Wait`
/// (the old shape, still reachable for the GitHub producer), and a scheduled
/// issue whose execution has not been started yet at all — the API hands the
/// send instant to EventBridge Scheduler, so between scheduling and firing there
/// is no execution to describe.
pub fn waiting_for_send_time() -> WorkflowState {
    WorkflowState {
        state: "waiting".to_string(),
        message: "Scheduled — the publish workflow is waiting for the send time.".to_string(),
        detail: None,
    }
}

/// Translate a Step Functions execution status into an operator-facing state.
///
/// `scheduled_in_future` distinguishes the two reasons an execution is still
/// running: parked in the Wait state ahead of a future send, versus actively
/// publishing right now.
pub fn describe_execution_status(
    status: &str,
    cause: Option<&str>,
    scheduled_in_future: bool,
) -> Option<WorkflowState> {
    match status {
        "RUNNING" if scheduled_in_future => Some(waiting_for_send_time()),
        "RUNNING" => Some(WorkflowState {
            state: "running".to_string(),
            message: "Publishing now.".to_string(),
            detail: None,
        }),
        "FAILED" => Some(WorkflowState {
            state: "failed".to_string(),
            message: "The publish workflow failed. This issue was not sent.".to_string(),
            detail: cause.map(|value| value.to_string()),
        }),
        "TIMED_OUT" => Some(WorkflowState {
            state: "failed".to_string(),
            message: "The publish workflow timed out. This issue may not have been sent."
                .to_string(),
            detail: cause.map(|value| value.to_string()),
        }),
        "ABORTED" => Some(WorkflowState {
            state: "stopped".to_string(),
            message: "The publish workflow was stopped before it finished.".to_string(),
            detail: None,
        }),
        // SUCCEEDED tells the operator nothing the record's status does not
        // already say, so it is deliberately not surfaced.
        _ => None,
    }
}

/// Ask Step Functions where an issue's publish workflow is.
///
/// Errors are swallowed — including the expired-execution case, since Step
/// Functions only retains history for 90 days and an old issue's ARN will stop
/// resolving.
pub async fn get_workflow_state(
    execution_arn: &str,
    scheduled_in_future: bool,
) -> Option<WorkflowState> {
    let sfn_client = aws_clients::get_sfn_client().await;

    let result = sfn_client
        .describe_execution()
        .execution_arn(execution_arn)
        .send()
        .await
        .inspect_err(|error| {
            tracing::warn!("Failed to describe publish execution: {error}");
        })
        .ok()?;

    describe_execution_status(
        result.status().as_str(),
        result.cause(),
        scheduled_in_future,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(value: &str) -> AttributeValue {
        AttributeValue::S(value.to_string())
    }

    fn group(
        send_at: &str,
        status: &str,
        recipients: Option<i64>,
        size: Option<i64>,
    ) -> AttributeValue {
        let mut fields = HashMap::new();
        fields.insert("sendAt".to_string(), ts(send_at));
        fields.insert("status".to_string(), ts(status));
        if let Some(recipients) = recipients {
            fields.insert(
                "recipients".to_string(),
                AttributeValue::N(recipients.to_string()),
            );
        }
        if let Some(size) = size {
            fields.insert("size".to_string(), AttributeValue::N(size.to_string()));
        }
        if status != "pending" {
            fields.insert("sentAt".to_string(), ts(send_at));
        }
        AttributeValue::M(fields)
    }

    fn progress_item(groups: Vec<(&str, AttributeValue)>) -> HashMap<String, AttributeValue> {
        let mut item = HashMap::new();
        item.insert("mode".to_string(), ts("timezone"));
        item.insert("defaultTimeZone".to_string(), ts("America/Chicago"));
        item.insert("baseAt".to_string(), ts("2026-07-27T14:00:00.000Z"));
        item.insert("catchAllAt".to_string(), ts("2026-07-27T20:30:00.000Z"));
        item.insert("startedAt".to_string(), ts("2026-07-27T14:00:02.000Z"));
        item.insert(
            "totalSubscribers".to_string(),
            AttributeValue::N("152".to_string()),
        );
        item.insert(
            "groups".to_string(),
            AttributeValue::M(
                groups
                    .into_iter()
                    .map(|(label, value)| (label.to_string(), value))
                    .collect(),
            ),
        );
        item
    }

    fn now(value: &str) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&chrono::Utc)
    }

    #[test]
    fn renders_group_names_a_human_can_read() {
        assert_eq!(friendly_group_name("America/New_York"), "New York");
        assert_eq!(friendly_group_name("Europe/London"), "London");
        assert_eq!(
            friendly_group_name("America/Indiana/Indianapolis"),
            "Indianapolis"
        );
        assert_eq!(friendly_group_name("__default__"), "No time zone detected");
        assert_eq!(friendly_group_name("__catch_all__"), "Final sweep");
        assert_eq!(friendly_group_name("default"), "Not enough open history");
        assert_eq!(friendly_group_name("hour-9"), "09:00 UTC");
        assert_eq!(friendly_group_name("hour-23"), "23:00 UTC");
    }

    #[test]
    fn unparseable_hour_group_falls_back_to_the_raw_label() {
        assert_eq!(friendly_group_name("hour-99"), "hour-99");
        assert_eq!(friendly_group_name("hour-x"), "hour-x");
    }

    #[test]
    fn reports_a_send_in_flight() {
        let item = progress_item(vec![
            (
                "America/Chicago",
                group("2026-07-27T14:00:00.000Z", "sent", Some(38), Some(40)),
            ),
            (
                "America/Los_Angeles",
                group("2026-07-27T16:00:00.000Z", "pending", None, Some(12)),
            ),
            (
                "__catch_all__",
                group("2026-07-27T20:30:00.000Z", "pending", None, None),
            ),
        ]);

        let report = build_progress_report(&item, now("2026-07-27T14:10:00Z")).unwrap();

        assert_eq!(report.state, "sending");
        assert_eq!(report.groups_total, 3);
        assert_eq!(report.groups_delivered, 1);
        assert_eq!(report.recipients_sent, 38);
        assert_eq!(report.total_subscribers, Some(152));
        assert_eq!(
            report.message,
            "Sending — 1 of 3 groups delivered, 38 subscribers so far."
        );
        // The next outstanding group, not merely the next group.
        assert_eq!(
            report.next_send_at.as_deref(),
            Some("2026-07-27T16:00:00.000Z")
        );
        assert_eq!(
            report.expected_complete_at.as_deref(),
            Some("2026-07-27T20:30:00.000Z")
        );
    }

    #[test]
    fn orders_groups_by_when_subscribers_receive_them() {
        let item = progress_item(vec![
            (
                "__catch_all__",
                group("2026-07-27T20:30:00.000Z", "pending", None, None),
            ),
            (
                "America/Los_Angeles",
                group("2026-07-27T16:00:00.000Z", "pending", None, Some(12)),
            ),
            (
                "America/Chicago",
                group("2026-07-27T14:00:00.000Z", "sent", Some(38), Some(40)),
            ),
        ]);

        let report = build_progress_report(&item, now("2026-07-27T14:10:00Z")).unwrap();

        let labels: Vec<&str> = report.groups.iter().map(|g| g.label.as_str()).collect();
        assert_eq!(
            labels,
            vec!["America/Chicago", "America/Los_Angeles", "__catch_all__"]
        );
    }

    #[test]
    fn reports_nothing_delivered_yet_distinctly() {
        let item = progress_item(vec![
            (
                "America/Chicago",
                group("2026-07-27T14:00:00.000Z", "pending", None, Some(40)),
            ),
            (
                "__catch_all__",
                group("2026-07-27T20:30:00.000Z", "pending", None, None),
            ),
        ]);

        let report = build_progress_report(&item, now("2026-07-27T13:59:00Z")).unwrap();

        assert_eq!(report.state, "sending");
        assert_eq!(
            report.message,
            "Scheduled — 2 local send groups planned, none delivered yet."
        );
    }

    #[test]
    fn flags_a_group_that_never_reported_back() {
        let item = progress_item(vec![
            (
                "America/Chicago",
                group("2026-07-27T14:00:00.000Z", "sent", Some(38), Some(40)),
            ),
            (
                "Europe/London",
                group("2026-07-27T08:00:00.000Z", "pending", None, Some(9)),
            ),
            (
                "__catch_all__",
                group("2026-07-27T20:30:00.000Z", "pending", None, None),
            ),
        ]);

        // London's slot passed hours ago; the catch-all is still in the future.
        let report = build_progress_report(&item, now("2026-07-27T14:10:00Z")).unwrap();

        assert_eq!(report.state, "stalled");
        assert_eq!(
            report.message,
            "Sending — 1 of 3 groups delivered, but 1 group is overdue (London)."
        );
        let london = report
            .groups
            .iter()
            .find(|g| g.label == "Europe/London")
            .unwrap();
        assert!(london.overdue);
        let catch_all = report
            .groups
            .iter()
            .find(|g| g.label == "__catch_all__")
            .unwrap();
        assert!(!catch_all.overdue);
    }

    #[test]
    fn names_every_overdue_group() {
        let item = progress_item(vec![
            (
                "Europe/London",
                group("2026-07-27T08:00:00.000Z", "pending", None, Some(9)),
            ),
            (
                "Asia/Tokyo",
                group("2026-07-27T00:00:00.000Z", "pending", None, Some(4)),
            ),
            (
                "__catch_all__",
                group("2026-07-27T20:30:00.000Z", "pending", None, None),
            ),
        ]);

        let report = build_progress_report(&item, now("2026-07-27T14:10:00Z")).unwrap();

        assert_eq!(report.state, "stalled");
        assert!(
            report.message.contains("2 groups are overdue"),
            "message was: {}",
            report.message
        );
        assert!(report.message.contains("London"));
        assert!(report.message.contains("Tokyo"));
    }

    #[test]
    fn a_group_inside_the_grace_period_is_not_overdue() {
        let item = progress_item(vec![
            (
                "America/Chicago",
                group("2026-07-27T14:00:00.000Z", "pending", None, Some(40)),
            ),
            (
                "__catch_all__",
                group("2026-07-27T20:30:00.000Z", "pending", None, None),
            ),
        ]);

        // 29 minutes late: a slow send, not a lost one.
        let report = build_progress_report(&item, now("2026-07-27T14:29:00Z")).unwrap();

        assert_eq!(report.state, "sending");
        assert!(report.groups.iter().all(|group| !group.overdue));
    }

    #[test]
    fn reports_a_finished_send() {
        let mut item = progress_item(vec![
            (
                "America/Chicago",
                group("2026-07-27T14:00:00.000Z", "sent", Some(38), Some(40)),
            ),
            (
                "America/Los_Angeles",
                group("2026-07-27T16:00:00.000Z", "sent", Some(12), Some(12)),
            ),
            (
                "__catch_all__",
                group("2026-07-27T20:30:00.000Z", "empty", Some(0), None),
            ),
        ]);
        item.insert("completedAt".to_string(), ts("2026-07-27T20:31:00.000Z"));

        let report = build_progress_report(&item, now("2026-07-28T09:00:00Z")).unwrap();

        assert_eq!(report.state, "complete");
        assert_eq!(report.groups_delivered, 3);
        assert_eq!(report.recipients_sent, 50);
        assert_eq!(
            report.message,
            "Delivered to 50 subscribers across 3 local send groups."
        );
        assert!(report.next_send_at.is_none());
    }

    #[test]
    fn a_completed_send_never_reports_stalled() {
        // A group that failed to report is moot once the send completed;
        // resurfacing it as stalled days later would be noise.
        let mut item = progress_item(vec![
            (
                "Europe/London",
                group("2026-07-27T08:00:00.000Z", "pending", None, Some(9)),
            ),
            (
                "__catch_all__",
                group("2026-07-27T20:30:00.000Z", "sent", Some(9), None),
            ),
        ]);
        item.insert("completedAt".to_string(), ts("2026-07-27T20:31:00.000Z"));

        let report = build_progress_report(&item, now("2026-07-30T09:00:00Z")).unwrap();

        assert_eq!(report.state, "complete");
        assert!(report.groups.iter().all(|group| !group.overdue));
    }

    #[test]
    fn singular_wording_for_a_single_group_and_subscriber() {
        let mut item = progress_item(vec![(
            "America/Chicago",
            group("2026-07-27T14:00:00.000Z", "sent", Some(1), Some(1)),
        )]);
        item.insert("completedAt".to_string(), ts("2026-07-27T14:01:00.000Z"));

        let report = build_progress_report(&item, now("2026-07-27T15:00:00Z")).unwrap();

        assert_eq!(
            report.message,
            "Delivered to 1 subscriber across 1 local send group."
        );
    }

    #[test]
    fn a_record_without_groups_reports_nothing() {
        assert!(build_progress_report(&HashMap::new(), now("2026-07-27T14:00:00Z")).is_none());
        assert!(
            build_progress_report(&progress_item(vec![]), now("2026-07-27T14:00:00Z")).is_none()
        );
    }

    #[test]
    fn peak_hour_mode_is_reported_in_its_own_terms() {
        let mut item = progress_item(vec![
            (
                "hour-13",
                group("2026-07-27T13:00:00.000Z", "sent", Some(7), Some(7)),
            ),
            (
                "default",
                group("2026-07-27T14:00:00.000Z", "pending", None, Some(120)),
            ),
        ]);
        item.insert("mode".to_string(), ts("peak-hour"));
        item.remove("defaultTimeZone");

        let report = build_progress_report(&item, now("2026-07-27T14:05:00Z")).unwrap();

        assert_eq!(report.mode, "peak-hour");
        assert_eq!(report.default_time_zone, None);
        assert_eq!(report.groups[0].name, "13:00 UTC");
        assert_eq!(report.groups[1].name, "Not enough open history");
    }

    #[test]
    fn translates_execution_status_for_an_operator() {
        let waiting = describe_execution_status("RUNNING", None, true).unwrap();
        assert_eq!(waiting.state, "waiting");
        assert!(waiting.message.contains("waiting for the send time"));
        // An execution parked in the Wait and a scheduled issue whose execution
        // has not started yet are the same thing to read, so they share one
        // rendering rather than two that can drift apart.
        assert_eq!(waiting, waiting_for_send_time());

        let running = describe_execution_status("RUNNING", None, false).unwrap();
        assert_eq!(running.state, "running");

        let failed = describe_execution_status("FAILED", Some("States.Runtime"), false).unwrap();
        assert_eq!(failed.state, "failed");
        assert!(failed.message.contains("was not sent"));
        assert_eq!(failed.detail.as_deref(), Some("States.Runtime"));

        let timed_out = describe_execution_status("TIMED_OUT", None, false).unwrap();
        assert_eq!(timed_out.state, "failed");

        let aborted = describe_execution_status("ABORTED", None, false).unwrap();
        assert_eq!(aborted.state, "stopped");
    }

    #[test]
    fn a_succeeded_execution_adds_nothing_to_the_record() {
        assert!(describe_execution_status("SUCCEEDED", None, false).is_none());
    }
}
