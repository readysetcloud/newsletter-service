use aws_sdk_dynamodb::types::AttributeValue;
use base64::Engine;
use lambda_http::{Body, Error, Request, RequestExt, Response};
use newsletter::admin::{auth, aws_clients, error::AppError, response};
use serde::Serialize;
use std::collections::HashMap;

const DEFAULT_LIMIT: i32 = 20;
const MAX_LIMIT: i32 = 50;

/// How far back to look when counting unread.
///
/// The badge is a nudge, not an accounting figure. Counting every unread
/// notification a tenant has ever ignored would mean reading the whole
/// partition on every dashboard load, so the count stops here and the API says
/// it stopped by returning `unreadCountCapped`. The dashboard renders that as
/// `50+`.
const UNREAD_SCAN_LIMIT: usize = 50;

/// How many notifications one "mark all read" call will touch.
///
/// Bounded for the same reason the count is: an inbox nobody has opened in
/// months should not turn one click into an unbounded write. Anything past this
/// stays unread and the next call takes the next batch — which is why the
/// response says how many it actually marked.
const MARK_ALL_LIMIT: usize = 200;

/// Rows read per query while hunting for unread ones.
///
/// DynamoDB applies `Limit` to items *evaluated*, before `FilterExpression`
/// runs. A page of read notifications therefore comes back empty while still
/// spending the whole limit, so asking for "the next 50 unread" is not a thing
/// one query can do — see `unread_keys`.
const UNREAD_PAGE_SIZE: i32 = 100;

/// How many such pages to walk before giving up and saying there may be more.
///
/// Without this, a tenant with ten thousand read notifications and one unread
/// at the bottom would read the entire partition on every dashboard load.
const MAX_UNREAD_PAGES: usize = 5;

/// Every listable row carries this; the partition holds nothing else today, but
/// the query says so explicitly rather than trusting that to stay true.
const SK_PREFIX: &str = "notification#";

/// Mirrors `notificationPartitionKey` in
/// `functions/utils/notification-record.mjs`, which writes these rows.
fn notification_partition_key(tenant_id: &str) -> String {
    format!("{}#notification", tenant_id)
}

fn notification_sort_key(id: &str) -> String {
    format!("{}{}", SK_PREFIX, id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationItem {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    severity: String,
    title: String,
    message: String,
    /// Where in the dashboard this is about. Absent when nowhere in particular.
    #[serde(skip_serializing_if = "Option::is_none")]
    link: Option<String>,
    created_at: String,
    /// Absent while unread, which is what the dashboard keys the badge off.
    #[serde(skip_serializing_if = "Option::is_none")]
    read_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListNotificationsResponse {
    notifications: Vec<NotificationItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_token: Option<String>,
    /// Unread within the most recent `UNREAD_SCAN_LIMIT`.
    unread_count: usize,
    /// True when there may be more unread than `unreadCount` says.
    unread_count_capped: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkReadResponse {
    /// How many this call actually marked, which is not always how many were
    /// unread — see `MARK_ALL_LIMIT`.
    marked: usize,
    /// True when unread ones were left behind and another call would take more.
    more_remaining: bool,
}

struct ListQuery {
    limit: i32,
    next_token: Option<String>,
    unread_only: bool,
}

// Public handler functions (called by router)
pub async fn list_notifications(event: Request) -> Result<Response<Body>, Error> {
    match handle_list_notifications(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn mark_notification_read(
    event: Request,
    notification_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_mark_notification_read(event, notification_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn mark_all_notifications_read(event: Request) -> Result<Response<Body>, Error> {
    match handle_mark_all_read(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

fn tenant_of(event: &Request) -> Result<String, AppError> {
    auth::get_user_context(event)?
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))
}

fn parse_list_query(event: &Request) -> Result<ListQuery, AppError> {
    let params = event.query_string_parameters();

    let limit = params
        .first("limit")
        .and_then(|s: &str| s.parse::<i32>().ok())
        .unwrap_or(DEFAULT_LIMIT);

    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(AppError::BadRequest(format!(
            "Limit must be between 1 and {}",
            MAX_LIMIT
        )));
    }

    Ok(ListQuery {
        limit,
        next_token: params.first("nextToken").map(|s: &str| s.to_string()),
        unread_only: matches!(params.first("unreadOnly"), Some("true")),
    })
}

async fn handle_list_notifications(event: Request) -> Result<Response<Body>, AppError> {
    let tenant_id = tenant_of(&event)?;
    let query = parse_list_query(&event)?;

    let ddb = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    // Straight off the base table: the sort key is `notification#<millis>-<key>`
    // and milliseconds are fixed width for the next two centuries, so reading
    // the partition backwards is reading it newest-first. No index needed.
    let mut builder = ddb
        .query()
        .table_name(&table_name)
        .key_condition_expression("pk = :pk AND begins_with(sk, :prefix)")
        .expression_attribute_values(
            ":pk",
            AttributeValue::S(notification_partition_key(&tenant_id)),
        )
        .expression_attribute_values(":prefix", AttributeValue::S(SK_PREFIX.to_string()))
        .scan_index_forward(false)
        .limit(query.limit);

    if query.unread_only {
        builder = builder.filter_expression("attribute_not_exists(readAt)");
    }

    if let Some(token) = &query.next_token {
        for (k, v) in decode_pagination_token(token)? {
            builder = builder.exclusive_start_key(k, v);
        }
    }

    let result = builder
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to list notifications: {}", e)))?;

    let notifications: Vec<NotificationItem> = result
        .items()
        .iter()
        .filter_map(to_notification_item)
        .collect();

    let next_token = result.last_evaluated_key().map(encode_pagination_token);
    let (unread, unread_count_capped) = unread_keys(&tenant_id, UNREAD_SCAN_LIMIT).await?;
    let unread_count = unread.len();

    response::format_response(
        200,
        ListNotificationsResponse {
            notifications,
            next_token,
            unread_count,
            unread_count_capped,
        },
    )
}

/// Sort keys of unread notifications, newest first, up to `want` of them.
///
/// Returns the keys and whether the hunt stopped early — because it found
/// `want`, or because it ran out of pages — which is not the same as knowing
/// more unread exist, only that this cannot say they do not.
///
/// This pages rather than issuing one big query because of how `Limit` and
/// `FilterExpression` interact: the limit is spent on rows *read*, and the
/// filter is applied after. One query with `limit(200)` over a partition whose
/// newest 200 rows are all read returns nothing at all, while older unread rows
/// sit just past the cursor. That is the difference between a badge that says 0
/// and a badge that is right.
async fn unread_keys(tenant_id: &str, want: usize) -> Result<(Vec<String>, bool), AppError> {
    let ddb = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let mut keys: Vec<String> = Vec::new();
    let mut start_key: Option<HashMap<String, AttributeValue>> = None;

    for _ in 0..MAX_UNREAD_PAGES {
        let mut builder = ddb
            .query()
            .table_name(&table_name)
            .key_condition_expression("pk = :pk AND begins_with(sk, :prefix)")
            .expression_attribute_values(
                ":pk",
                AttributeValue::S(notification_partition_key(tenant_id)),
            )
            .expression_attribute_values(":prefix", AttributeValue::S(SK_PREFIX.to_string()))
            .filter_expression("attribute_not_exists(readAt)")
            .projection_expression("sk")
            .scan_index_forward(false)
            .limit(UNREAD_PAGE_SIZE);

        if let Some(key) = start_key.take() {
            for (k, v) in key {
                builder = builder.exclusive_start_key(k, v);
            }
        }

        let result = builder
            .send()
            .await
            .map_err(|e| AppError::InternalError(format!("Failed to read notifications: {}", e)))?;

        for item in result.items() {
            if let Some(AttributeValue::S(sort_key)) = item.get("sk") {
                keys.push(sort_key.clone());

                if keys.len() >= want {
                    // Stopped on the caller's bound, not on the data.
                    return Ok((keys, true));
                }
            }
        }

        match result.last_evaluated_key() {
            // The partition is exhausted: what was found is all there is.
            None => return Ok((keys, false)),
            Some(key) => start_key = Some(key.clone()),
        }
    }

    // Ran out of pages with the cursor still live.
    Ok((keys, true))
}

async fn handle_mark_notification_read(
    event: Request,
    notification_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let tenant_id = tenant_of(&event)?;
    let notification_id = notification_id
        .ok_or_else(|| AppError::BadRequest("Notification ID is required".to_string()))?;

    let ddb = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let now = chrono::Utc::now().to_rfc3339();

    let result = ddb
        .update_item()
        .table_name(&table_name)
        .key(
            "pk",
            AttributeValue::S(notification_partition_key(&tenant_id)),
        )
        .key(
            "sk",
            AttributeValue::S(notification_sort_key(&notification_id)),
        )
        // Only if it is really there. Without this an unknown id would create a
        // row that is a read marker and nothing else, and the list would then
        // carry a notification with no title.
        .condition_expression("attribute_exists(pk) AND attribute_exists(sk)")
        // `if_not_exists` keeps the first read the one that counts, so marking
        // twice does not move the timestamp.
        .update_expression("SET readAt = if_not_exists(readAt, :now)")
        .expression_attribute_values(":now", AttributeValue::S(now))
        .send()
        .await;

    match result {
        Ok(_) => response::format_response(
            200,
            MarkReadResponse {
                marked: 1,
                more_remaining: false,
            },
        ),
        Err(e) => {
            let service_error = e.into_service_error();
            if service_error.is_conditional_check_failed_exception() {
                Err(AppError::NotFound("Notification not found".to_string()))
            } else {
                Err(AppError::InternalError(format!(
                    "Failed to mark notification read: {}",
                    service_error
                )))
            }
        }
    }
}

async fn handle_mark_all_read(event: Request) -> Result<Response<Body>, AppError> {
    let tenant_id = tenant_of(&event)?;

    let ddb = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let (unread, more_remaining) = unread_keys(&tenant_id, MARK_ALL_LIMIT).await?;

    let now = chrono::Utc::now().to_rfc3339();
    let mut marked = 0usize;

    // One update each rather than a transaction. These are independent rows and
    // the operation is idempotent, so a partial pass is not a broken state — it
    // is simply fewer marked, which the response already reports.
    for sort_key in &unread {
        let updated = ddb
            .update_item()
            .table_name(&table_name)
            .key(
                "pk",
                AttributeValue::S(notification_partition_key(&tenant_id)),
            )
            .key("sk", AttributeValue::S(sort_key.clone()))
            .condition_expression("attribute_exists(pk) AND attribute_exists(sk)")
            .update_expression("SET readAt = if_not_exists(readAt, :now)")
            .expression_attribute_values(":now", AttributeValue::S(now.clone()))
            .send()
            .await;

        match updated {
            Ok(_) => marked += 1,
            Err(e) => {
                let service_error = e.into_service_error();
                // Expired out from under us between the query and the write.
                // Not a failure: it is gone, which is at least as read as read.
                if !service_error.is_conditional_check_failed_exception() {
                    tracing::warn!("Failed to mark {} read: {}", sort_key, service_error);
                }
            }
        }
    }

    response::format_response(
        200,
        MarkReadResponse {
            marked,
            more_remaining,
        },
    )
}

fn string_field(item: &HashMap<String, AttributeValue>, key: &str) -> Option<String> {
    match item.get(key) {
        Some(AttributeValue::S(value)) => Some(value.clone()),
        _ => None,
    }
}

/// A stored row as the API presents it, or `None` if it is missing anything the
/// dashboard needs to render it at all.
fn to_notification_item(item: &HashMap<String, AttributeValue>) -> Option<NotificationItem> {
    Some(NotificationItem {
        id: string_field(item, "id")?,
        kind: string_field(item, "type")?,
        severity: string_field(item, "severity").unwrap_or_else(|| "info".to_string()),
        title: string_field(item, "title")?,
        message: string_field(item, "message").unwrap_or_default(),
        link: string_field(item, "link"),
        created_at: string_field(item, "createdAt")?,
        read_at: string_field(item, "readAt"),
    })
}

fn encode_pagination_token(key: &HashMap<String, AttributeValue>) -> String {
    let item_map: HashMap<String, serde_json::Value> = key
        .iter()
        .filter_map(|(k, v)| match v {
            AttributeValue::S(s) => Some((k.clone(), serde_json::Value::String(s.clone()))),
            AttributeValue::N(n) => Some((k.clone(), serde_json::Value::String(n.clone()))),
            _ => None,
        })
        .collect();

    let json = serde_json::to_string(&item_map).unwrap_or_default();
    base64::engine::general_purpose::STANDARD.encode(json.as_bytes())
}

fn decode_pagination_token(token: &str) -> Result<HashMap<String, AttributeValue>, AppError> {
    let invalid = || AppError::BadRequest("Invalid pagination token".to_string());

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(token.as_bytes())
        .map_err(|_| invalid())?;

    let json_str = String::from_utf8(decoded).map_err(|_| invalid())?;

    let item_map: HashMap<String, serde_json::Value> =
        serde_json::from_str(&json_str).map_err(|_| invalid())?;

    Ok(item_map
        .into_iter()
        .filter_map(|(k, v)| v.as_str().map(|s| (k, AttributeValue::S(s.to_string()))))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partition_key_matches_the_writer() {
        // Mirrored in functions/utils/notification-record.mjs. If these drift,
        // the API reads an empty partition and nobody sees anything.
        assert_eq!(
            notification_partition_key("readysetcloud"),
            "readysetcloud#notification"
        );
    }

    #[test]
    fn sort_key_matches_the_writer() {
        assert_eq!(
            notification_sort_key("1757684400000-report:2026-08:ready"),
            "notification#1757684400000-report:2026-08:ready"
        );
    }

    #[test]
    fn a_row_missing_its_title_is_skipped_rather_than_rendered_blank() {
        let mut item = HashMap::new();
        item.insert("id".to_string(), AttributeValue::S("1-x".to_string()));
        item.insert(
            "type".to_string(),
            AttributeValue::S("report.ready".to_string()),
        );
        item.insert(
            "createdAt".to_string(),
            AttributeValue::S("2026-09-12T00:00:00Z".to_string()),
        );

        assert!(to_notification_item(&item).is_none());
    }

    #[test]
    fn an_unread_row_has_no_read_at() {
        let mut item = HashMap::new();
        item.insert("id".to_string(), AttributeValue::S("1-x".to_string()));
        item.insert(
            "type".to_string(),
            AttributeValue::S("report.ready".to_string()),
        );
        item.insert(
            "title".to_string(),
            AttributeValue::S("Report ready".to_string()),
        );
        item.insert(
            "createdAt".to_string(),
            AttributeValue::S("2026-09-12T00:00:00Z".to_string()),
        );

        let rendered = to_notification_item(&item).expect("renders");

        assert!(rendered.read_at.is_none());
        assert_eq!(
            rendered.severity, "info",
            "severity falls back rather than dropping the row"
        );
        assert_eq!(
            rendered.message, "",
            "a missing message is empty, not a reason to hide it"
        );
    }

    #[test]
    fn pagination_tokens_round_trip() {
        let mut key = HashMap::new();
        key.insert(
            "pk".to_string(),
            AttributeValue::S("t#notification".to_string()),
        );
        key.insert(
            "sk".to_string(),
            AttributeValue::S("notification#1-x".to_string()),
        );

        let decoded = decode_pagination_token(&encode_pagination_token(&key)).expect("decodes");

        assert_eq!(decoded, key);
    }

    #[test]
    fn a_token_that_is_not_ours_is_a_bad_request_not_a_panic() {
        assert!(matches!(
            decode_pagination_token("not base64 at all!"),
            Err(AppError::BadRequest(_))
        ));
    }
}
