use aws_sdk_dynamodb::operation::transact_write_items::TransactWriteItemsError;
use aws_sdk_dynamodb::types::{
    AttributeValue, Put, ReturnValuesOnConditionCheckFailure, TransactWriteItem,
};
use base64::Engine;
use chrono::{Duration, NaiveDate, TimeZone, Utc};
use lambda_http::{Body, Error, Request, RequestExt, Response};
use newsletter::admin::{auth, aws_clients, error::AppError, response};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::settings;

const DEFAULT_LIMIT: i32 = 12;
const MAX_LIMIT: i32 = 60;

/// Sort-key prefixes. A scheduled report keeps the key it has always had, so
/// the report links already sent out in email still resolve.
const MONTHLY_PREFIX: &str = "monthly#";
const ADHOC_PREFIX: &str = "adhoc#";

/// Shortest and longest range anyone may ask about. The floor keeps a range
/// from being empty by construction; the ceiling bounds the issue scan and the
/// prompt built from it.
const MIN_SPAN_DAYS: i64 = 1;
const MAX_SPAN_DAYS: i64 = 366;

/// How many unfinished reports a tenant may have at once. Each one costs a
/// model call, so a held-down button should not queue fifty.
const MAX_PENDING: usize = 3;

/// How far back to look for unfinished reports. They are written newest-first,
/// so the newest page is where they are; anything older than this is stale
/// rather than in flight.
const PENDING_SCAN_LIMIT: i32 = 25;

const STATUS_PENDING: &str = "pending";

/// How long a reservation stays valid if nothing ever releases it. Longer
/// than any report takes, short enough that a run which vanished does not hold
/// a range for long.
///
/// This is enforced by the claim condition, not by DynamoDB's own TTL: an
/// expired item sticks around until the background sweep reaches it, which can
/// be days. The `ttl` attribute is still set so the row is eventually tidied
/// away, but nothing waits on that.
const RANGE_LOCK_TTL_SECONDS: i64 = 60 * 60;

/// How many times to race for a reservation whose holder keeps vanishing
/// mid-claim. Two requests cannot starve each other indefinitely; this only
/// bounds the pathological case.
const RESERVE_ATTEMPTS: usize = 3;

/// Free, or held by a run that has outlived its window. Named so the rule and
/// the test that describes it cannot drift apart.
const RESERVE_CONDITION: &str = "attribute_not_exists(pk) OR #ttl < :now";

/// Gone already, or still ours. Mirrored in
/// `functions/utils/report-record.mjs`, which releases the same reservations
/// from the other end of the workflow.
const RELEASE_CONDITION: &str = "attribute_not_exists(pk) OR reportId = :owner";

/// Sort key of the row that reserves a range while a report over it runs.
///
/// A conditional put on this key is what actually makes "one report per
/// double-click" true. Reading recent rows and looking for a match is a check
/// followed by a write: both requests can read before either writes, and the
/// read goes to an index that is only eventually consistent, so the second can
/// miss the first outright.
///
/// It carries no `GSI1PK`, so it never shows up in the report list — that
/// query runs on a sparse index. The same key is built in
/// `functions/utils/report-record.mjs`, which releases it.
fn range_lock_key(period_start: &str, period_end: &str) -> String {
    format!("lock#{}#{}", period_start, period_end)
}

/// Whether an API-facing report id names a scheduled monthly report.
///
/// The two id shapes are told apart without a delimiter: `YYYY-MM` is a month,
/// anything else is a ULID. The same rule lives in
/// `functions/utils/report-record.mjs`; change one and change the other.
fn is_monthly_report_id(report_id: &str) -> bool {
    let bytes = report_id.as_bytes();
    if bytes.len() != 7 || bytes[4] != b'-' {
        return false;
    }
    if !bytes[..4].iter().all(u8::is_ascii_digit) || !bytes[5..].iter().all(u8::is_ascii_digit) {
        return false;
    }
    // A ULID is 26 characters, so nothing else can collide with this shape —
    // but a month still has to be a real month.
    matches!(report_id[5..].parse::<u8>(), Ok(1..=12))
}

/// The stored sort key for an API-facing report id.
fn report_sort_key(report_id: &str) -> String {
    if is_monthly_report_id(report_id) {
        format!("{}{}", MONTHLY_PREFIX, report_id)
    } else {
        format!("{}{}", ADHOC_PREFIX, report_id)
    }
}

/// The API-facing id for a stored sort key.
fn report_id_from_sort_key(sort_key: &str) -> String {
    sort_key
        .strip_prefix(MONTHLY_PREFIX)
        .or_else(|| sort_key.strip_prefix(ADHOC_PREFIX))
        .unwrap_or(sort_key)
        .to_string()
}

fn report_partition_key(tenant_id: &str) -> String {
    format!("{}#report", tenant_id)
}

// Request type for the list reports endpoint
pub struct ListReportsQuery {
    limit: i32,
    next_token: Option<String>,
}

#[derive(Serialize)]
pub struct ListReportsResponse {
    reports: Vec<ReportSummaryItem>,
    #[serde(rename = "nextToken", skip_serializing_if = "Option::is_none")]
    next_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReportRequest {
    /// Inclusive first day, `YYYY-MM-DD`, read in the tenant's timezone.
    period_start: String,
    /// Exclusive last day, same shape.
    period_end: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReportResponse {
    id: String,
    status: String,
    report_type: String,
    period_start: String,
    period_end: String,
    period_label: String,
}

#[derive(Serialize)]
pub struct ReportSummaryItem {
    id: String,
    /// Absent on a report covering a range somebody picked, which belongs to
    /// no single month.
    #[serde(skip_serializing_if = "Option::is_none")]
    month: Option<String>,
    #[serde(rename = "monthLabel", skip_serializing_if = "Option::is_none")]
    month_label: Option<String>,
    /// Reads for both kinds. The dashboard shows this.
    #[serde(rename = "periodLabel")]
    period_label: String,
    #[serde(rename = "periodStart")]
    period_start: String,
    #[serde(rename = "periodEnd")]
    period_end: String,
    /// Absent until the report finishes.
    #[serde(rename = "generatedAt", skip_serializing_if = "Option::is_none")]
    generated_at: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "reportType")]
    report_type: String,
    status: String,
    #[serde(rename = "failureReason", skip_serializing_if = "Option::is_none")]
    failure_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<serde_json::Value>,
    #[serde(rename = "subscriberGrowth", skip_serializing_if = "Option::is_none")]
    subscriber_growth: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct GetReportResponse {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    month: Option<String>,
    #[serde(rename = "monthLabel", skip_serializing_if = "Option::is_none")]
    month_label: Option<String>,
    #[serde(rename = "periodLabel")]
    period_label: String,
    #[serde(rename = "periodStart")]
    period_start: String,
    #[serde(rename = "periodEnd")]
    period_end: String,
    #[serde(rename = "generatedAt", skip_serializing_if = "Option::is_none")]
    generated_at: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "reportType")]
    report_type: String,
    status: String,
    #[serde(rename = "failureReason", skip_serializing_if = "Option::is_none")]
    failure_reason: Option<String>,
    /// Null while the report is still being generated.
    report: serde_json::Value,
}

// Public handler functions (called by router)
pub async fn list_reports(event: Request) -> Result<Response<Body>, Error> {
    match handle_list_reports(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn get_report(
    event: Request,
    report_id: Option<String>,
) -> Result<Response<Body>, Error> {
    match handle_get_report(event, report_id).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

pub async fn create_report(event: Request) -> Result<Response<Body>, Error> {
    match handle_create_report(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

// Private implementation functions (business logic)
async fn handle_list_reports(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let query = parse_query_params(&event)?;
    validate_list_params(&query)?;

    let reports = query_reports_by_tenant(&tenant_id, &query).await?;

    response::format_response(200, reports)
}

async fn handle_get_report(
    event: Request,
    report_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let report_id =
        report_id.ok_or_else(|| AppError::BadRequest("Report ID is required".to_string()))?;

    let report = get_report_by_id(&tenant_id, &report_id).await?;

    response::format_response(200, report)
}

/// Starts a report over a range the tenant picked.
///
/// The row is written before the workflow starts, so the id handed back
/// resolves immediately rather than a moment later. That row *is* the job: an
/// unfinished report is a report with `status: pending`, which is why there is
/// no separate job store and nothing to reconcile between the two.
async fn handle_create_report(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .clone()
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))?;

    let request: CreateReportRequest = match event.body() {
        Body::Text(body) => serde_json::from_str(body)
            .map_err(|e| AppError::BadRequest(format!("Invalid request body: {}", e)))?,
        Body::Binary(bytes) => serde_json::from_slice(bytes)
            .map_err(|e| AppError::BadRequest(format!("Invalid request body: {}", e)))?,
        Body::Empty => return Err(AppError::BadRequest("Request body is required".to_string())),
    };

    // The dates mean days in the tenant's own zone, so "June" is their June.
    // With no zone configured this resolves to UTC rather than to whichever
    // machine happened to ask — a report's boundaries should not depend on the
    // browser that requested it.
    let tenant_settings = settings::get_tenant_settings(&tenant_id).await;
    let zone = tenant_settings.timezone();

    let start_date = parse_day(&request.period_start, "periodStart")?;
    let end_date = parse_day(&request.period_end, "periodEnd")?;
    validate_range(start_date, end_date, zone)?;

    let period_start = start_of_day(start_date, zone)?;
    let period_end = start_of_day(end_date, zone)?;
    let period_label = format_period_label(start_date, end_date);

    let report_id = ulid::Ulid::new().to_string();
    let created_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // 200 rather than 202: nothing was started, the caller is being handed
    // the report that already covers these dates.
    let already_running = |id: String| {
        response::format_response(
            200,
            CreateReportResponse {
                id,
                status: STATUS_PENDING.to_string(),
                report_type: "adhoc".to_string(),
                period_start: period_start.clone(),
                period_end: period_end.clone(),
                period_label: period_label.clone(),
            },
        )
    };

    // Counted before anything is written, so a refusal never has to undo a
    // claim. Rolling one back was how a second request could be handed an id
    // that then stopped existing.
    //
    // The count stays advisory: it reads an eventually consistent index, so a
    // burst can slip one past it. It bounds queueing rather than acting as a
    // ledger.
    let in_flight = count_reports_in_flight(&tenant_id).await?;
    if in_flight >= MAX_PENDING {
        // Still answer a repeat of something already running. Read-only, so
        // being at the limit changes what this request is told and never what
        // is stored.
        if let Some(holder) = current_range_holder(&tenant_id, &period_start, &period_end).await? {
            return already_running(holder);
        }

        return Err(AppError::Conflict(format!(
            "{} reports are already being generated. Wait for one to finish and try again.",
            in_flight
        )));
    }

    // The reservation and the report row are written together or not at all.
    // Two separate writes left a window where the range was held by a report
    // that did not exist yet: a second request losing the claim was handed
    // that id, and if the first then failed it had an id naming nothing.
    if let Some(existing_id) = claim_range_for_new_report(
        &tenant_id,
        &report_id,
        &created_at,
        &period_start,
        &period_end,
        &period_label,
        &user_context.user_id,
    )
    .await?
    {
        return already_running(existing_id);
    }

    // A `pending` row with no workflow behind it is one nothing can ever
    // resolve. It is marked failed rather than deleted: another request may
    // already have been handed this id, and an id that resolves to a report
    // saying it could not be generated is a far better answer than one that
    // resolves to nothing at all. The range is given back either way.
    if let Err(error) = start_report_execution(
        &tenant_id,
        &report_id,
        &period_start,
        &period_end,
        &period_label,
    )
    .await
    {
        abandon_report(&tenant_id, &report_id, &period_start, &period_end, &error).await;
        return Err(error);
    }

    response::format_response(
        202,
        CreateReportResponse {
            id: report_id,
            status: STATUS_PENDING.to_string(),
            report_type: "adhoc".to_string(),
            period_start,
            period_end,
            period_label,
        },
    )
}

/// A day as the tenant typed it, before it means an instant.
///
/// The length check is not redundant: chrono reads `2026-6-1` happily, and
/// accepting shapes the documented contract does not name makes the contract
/// mean less than it says.
fn parse_day(value: &str, field: &str) -> Result<NaiveDate, AppError> {
    let malformed = || AppError::BadRequest(format!("{} must be a date in YYYY-MM-DD form", field));

    if value.len() != 10 {
        return Err(malformed());
    }

    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| malformed())
}

/// Midnight on that day in the tenant's zone, as an instant.
fn start_of_day(date: NaiveDate, zone: chrono_tz::Tz) -> Result<String, AppError> {
    zone.from_local_datetime(&date.and_hms_opt(0, 0, 0).expect("midnight is a valid time"))
        .earliest()
        .map(|dt| {
            dt.with_timezone(&Utc)
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        })
        .ok_or_else(|| {
            // A clocks-forward transition can delete local midnight.
            AppError::BadRequest(format!(
                "{} does not exist in this newsletter's timezone",
                date
            ))
        })
}

fn validate_range(start: NaiveDate, end: NaiveDate, zone: chrono_tz::Tz) -> Result<(), AppError> {
    let span = (end - start).num_days();

    if span < MIN_SPAN_DAYS {
        return Err(AppError::BadRequest(
            "periodEnd must be at least one day after periodStart".to_string(),
        ));
    }

    if span > MAX_SPAN_DAYS {
        return Err(AppError::BadRequest(format!(
            "A report can cover at most {} days; this range covers {}",
            MAX_SPAN_DAYS, span
        )));
    }

    // `end` is exclusive, so ending tomorrow means "up to and including
    // today". Anything past that is a range that has not happened.
    let today = Utc::now().with_timezone(&zone).date_naive();
    if end > today + Duration::days(1) {
        return Err(AppError::BadRequest(
            "periodEnd cannot be in the future".to_string(),
        ));
    }

    Ok(())
}

/// How the range reads to a person. `end` is exclusive, so the label names the
/// last day actually covered.
fn format_period_label(start: NaiveDate, end: NaiveDate) -> String {
    let last = end - Duration::days(1);
    let day = |d: NaiveDate| d.format("%-d").to_string();
    let month = |d: NaiveDate| d.format("%b").to_string();

    if start == last {
        format!("{} {} {}", day(start), month(start), start.format("%Y"))
    } else if start.format("%Y-%m").to_string() == last.format("%Y-%m").to_string() {
        format!(
            "{}–{} {} {}",
            day(start),
            day(last),
            month(last),
            last.format("%Y")
        )
    } else if start.format("%Y").to_string() == last.format("%Y").to_string() {
        format!(
            "{} {} – {} {} {}",
            day(start),
            month(start),
            day(last),
            month(last),
            last.format("%Y")
        )
    } else {
        format!(
            "{} {} {} – {} {} {}",
            day(start),
            month(start),
            start.format("%Y"),
            day(last),
            month(last),
            last.format("%Y")
        )
    }
}

fn parse_query_params(event: &Request) -> Result<ListReportsQuery, AppError> {
    let query_params = event.query_string_parameters();

    let limit = query_params
        .first("limit")
        .and_then(|s: &str| s.parse::<i32>().ok())
        .unwrap_or(DEFAULT_LIMIT);

    let next_token = query_params.first("nextToken").map(|s: &str| s.to_string());

    Ok(ListReportsQuery { limit, next_token })
}

fn validate_list_params(query: &ListReportsQuery) -> Result<(), AppError> {
    if query.limit < 1 || query.limit > MAX_LIMIT {
        return Err(AppError::BadRequest(format!(
            "Limit must be between 1 and {}",
            MAX_LIMIT
        )));
    }

    Ok(())
}

async fn query_reports_by_tenant(
    tenant_id: &str,
    query: &ListReportsQuery,
) -> Result<ListReportsResponse, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    // Over the index rather than the table: the base-table sort key groups by
    // kind, which would list every on-demand report before every scheduled one
    // regardless of date. GSI1 is sorted by `createdAt`, so one descending read
    // gives both kinds newest-first.
    let mut query_builder = ddb_client
        .query()
        .table_name(&table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :pk")
        .expression_attribute_values(":pk", AttributeValue::S(report_partition_key(tenant_id)))
        .scan_index_forward(false)
        .limit(query.limit);

    if let Some(token) = &query.next_token {
        if let Ok(decoded_token) = decode_pagination_token(token) {
            query_builder = query_builder.set_exclusive_start_key(Some(decoded_token));
        } else {
            return Err(AppError::BadRequest("Invalid pagination token".to_string()));
        }
    }

    let result = query_builder.send().await?;

    let reports: Vec<ReportSummaryItem> = result
        .items()
        .iter()
        .filter_map(|item| parse_report_summary_item(item).ok())
        .collect();

    let next_token = result.last_evaluated_key().map(encode_pagination_token);

    Ok(ListReportsResponse {
        reports,
        next_token,
    })
}

async fn get_report_by_id(tenant_id: &str, report_id: &str) -> Result<GetReportResponse, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(report_partition_key(tenant_id)))
        .key("sk", AttributeValue::S(report_sort_key(report_id)))
        .send()
        .await?;

    let item = result
        .item()
        .ok_or_else(|| AppError::NotFound("Report not found".to_string()))?;

    parse_report_record(item)
}

fn parse_report_summary_item(
    item: &HashMap<String, AttributeValue>,
) -> Result<ReportSummaryItem, AppError> {
    let id = report_id_from_sort_key(&read_string(item, "sk")?);
    let period_start = read_string(item, "periodStart")?;
    let period_end = read_string(item, "periodEnd")?;
    let report_type = read_string(item, "reportType")?;

    let report = item
        .get("report")
        .and_then(|v| attribute_value_to_json(v).ok());

    let summary = report.as_ref().and_then(|r| r.get("summary")).cloned();
    let subscriber_growth = report
        .as_ref()
        .and_then(|r| r.get("subscriberGrowth"))
        .cloned();

    Ok(ReportSummaryItem {
        month: read_optional_string(item, "month"),
        month_label: read_optional_string(item, "monthLabel"),
        period_label: read_period_label(item),
        period_start,
        period_end,
        generated_at: read_optional_string(item, "generatedAt"),
        created_at: read_created_at(item),
        report_type,
        status: read_status(item),
        failure_reason: read_optional_string(item, "failureReason"),
        summary,
        subscriber_growth,
        id,
    })
}

fn parse_report_record(
    item: &HashMap<String, AttributeValue>,
) -> Result<GetReportResponse, AppError> {
    let id = report_id_from_sort_key(&read_string(item, "sk")?);
    let period_start = read_string(item, "periodStart")?;
    let period_end = read_string(item, "periodEnd")?;
    let report_type = read_string(item, "reportType")?;

    // Null while the report is still being generated; the dashboard reads
    // `status` rather than inferring anything from its absence.
    let report = item
        .get("report")
        .map(attribute_value_to_json)
        .transpose()?
        .unwrap_or(serde_json::Value::Null);

    Ok(GetReportResponse {
        month: read_optional_string(item, "month"),
        month_label: read_optional_string(item, "monthLabel"),
        period_label: read_period_label(item),
        period_start,
        period_end,
        generated_at: read_optional_string(item, "generatedAt"),
        created_at: read_created_at(item),
        report_type,
        status: read_status(item),
        failure_reason: read_optional_string(item, "failureReason"),
        report,
        id,
    })
}

fn read_optional_string(item: &HashMap<String, AttributeValue>, key: &str) -> Option<String> {
    item.get(key)
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string())
}

/// Reports written before this feature carry no status. They are all finished
/// ones, so reading their absence as complete is what keeps them rendering.
fn read_status(item: &HashMap<String, AttributeValue>) -> String {
    read_optional_string(item, "status").unwrap_or_else(|| "complete".to_string())
}

/// Same story for the label and the ordering key: fall back to what those
/// older records do have rather than refusing to return them.
fn read_period_label(item: &HashMap<String, AttributeValue>) -> String {
    read_optional_string(item, "periodLabel")
        .or_else(|| read_optional_string(item, "monthLabel"))
        .unwrap_or_default()
}

fn read_created_at(item: &HashMap<String, AttributeValue>) -> String {
    read_optional_string(item, "createdAt")
        .or_else(|| read_optional_string(item, "generatedAt"))
        .unwrap_or_default()
}

/// How many of a tenant's recent reports have not finished.
///
/// Only a count: telling a duplicate range from a new one used to happen here
/// too, and now happens through a conditional write that cannot be raced.
async fn count_reports_in_flight(tenant_id: &str) -> Result<usize, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let result = ddb_client
        .query()
        .table_name(&table_name)
        .index_name("GSI1")
        .key_condition_expression("GSI1PK = :pk")
        .filter_expression("#status = :pending")
        .expression_attribute_names("#status", "status")
        .expression_attribute_values(":pk", AttributeValue::S(report_partition_key(tenant_id)))
        .expression_attribute_values(":pending", AttributeValue::S(STATUS_PENDING.to_string()))
        .scan_index_forward(false)
        .limit(PENDING_SCAN_LIMIT)
        .send()
        .await?;

    Ok(result.items().len())
}

/// Claims a range and creates the report in one commit.
///
/// Returns `None` when the claim succeeded, and `Some(report_id)` when another
/// request already holds the range — that report is the answer to this request
/// too.
///
/// Three things here are less obvious than they look.
///
/// The reservation and the report row are written together. Apart, there was a
/// window where the range was held by a report that did not exist yet: a
/// second request losing the claim was handed that id, and if the first then
/// failed, the id named nothing. A transaction means a holder always has a
/// row.
///
/// The condition takes over an expired reservation rather than waiting for it
/// to disappear. DynamoDB deletes an expired item whenever it gets round to
/// it, which can be days, and until then `attribute_not_exists` is false — so
/// a TTL alone would not free anything, it would only promise to.
///
/// And the holder comes back from the rejected write itself, not from a read
/// afterwards. The winner can finish and release the range in the gap between
/// the two, and a read landing there finds nothing — which would look exactly
/// like having won.
#[allow(clippy::too_many_arguments)]
async fn claim_range_for_new_report(
    tenant_id: &str,
    report_id: &str,
    created_at: &str,
    period_start: &str,
    period_end: &str,
    period_label: &str,
    requested_by: &str,
) -> Result<Option<String>, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let partition = report_partition_key(tenant_id);
    let lock_key = range_lock_key(period_start, period_end);

    for _ in 0..RESERVE_ATTEMPTS {
        let now = Utc::now().timestamp();

        let reservation = Put::builder()
            .table_name(&table_name)
            .item("pk", AttributeValue::S(partition.clone()))
            .item("sk", AttributeValue::S(lock_key.clone()))
            .item("reportId", AttributeValue::S(report_id.to_string()))
            .item(
                "ttl",
                AttributeValue::N((now + RANGE_LOCK_TTL_SECONDS).to_string()),
            )
            .condition_expression(RESERVE_CONDITION)
            .expression_attribute_names("#ttl", "ttl")
            .expression_attribute_values(":now", AttributeValue::N(now.to_string()))
            .return_values_on_condition_check_failure(ReturnValuesOnConditionCheckFailure::AllOld)
            .build()
            .map_err(|e| AppError::InternalError(format!("Could not build reservation: {}", e)))?;

        // `createdAt` is the ordering key, set once here and left alone by
        // everything downstream.
        let report_row = Put::builder()
            .table_name(&table_name)
            .item("pk", AttributeValue::S(partition.clone()))
            .item("sk", AttributeValue::S(report_sort_key(report_id)))
            .item("GSI1PK", AttributeValue::S(partition.clone()))
            .item("GSI1SK", AttributeValue::S(created_at.to_string()))
            .item("createdAt", AttributeValue::S(created_at.to_string()))
            .item("status", AttributeValue::S(STATUS_PENDING.to_string()))
            .item("reportType", AttributeValue::S("adhoc".to_string()))
            .item("periodStart", AttributeValue::S(period_start.to_string()))
            .item("periodEnd", AttributeValue::S(period_end.to_string()))
            .item("periodLabel", AttributeValue::S(period_label.to_string()))
            .item("requestedBy", AttributeValue::S(requested_by.to_string()))
            .build()
            .map_err(|e| AppError::InternalError(format!("Could not build report row: {}", e)))?;

        let committed = ddb_client
            .transact_write_items()
            .transact_items(TransactWriteItem::builder().put(reservation).build())
            .transact_items(TransactWriteItem::builder().put(report_row).build())
            .send()
            .await;

        match committed {
            Ok(_) => return Ok(None),
            Err(error) => {
                let Some(TransactWriteItemsError::TransactionCanceledException(cancelled)) =
                    error.as_service_error()
                else {
                    return Err(AppError::AwsError(format!(
                        "Could not reserve the range: {}",
                        error
                    )));
                };

                // The reservation is the first item, so its reason is the one
                // carrying whoever holds the range.
                let holder = cancelled
                    .cancellation_reasons()
                    .first()
                    .and_then(|reason| reason.item())
                    .and_then(|item| read_optional_string(item, "reportId"));

                if let Some(holder) = holder {
                    return Ok(Some(holder));
                }

                // Held, but by nobody nameable — the holder released it as we
                // looked. Try to claim it outright.
            }
        }
    }

    Err(AppError::Conflict(
        "Another report over these dates is starting. Try again in a moment.".to_string(),
    ))
}

/// Who holds a range right now, if anybody, without touching it.
///
/// Strongly consistent, and ignores a reservation whose window has passed —
/// the same rule the claim applies, so the two cannot disagree about whether a
/// range is free.
async fn current_range_holder(
    tenant_id: &str,
    period_start: &str,
    period_end: &str,
) -> Result<Option<String>, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let held = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(report_partition_key(tenant_id)))
        .key(
            "sk",
            AttributeValue::S(range_lock_key(period_start, period_end)),
        )
        .consistent_read(true)
        .send()
        .await?;

    let Some(item) = held.item() else {
        return Ok(None);
    };

    let expired = item
        .get("ttl")
        .and_then(|v| v.as_n().ok())
        .and_then(|n| n.parse::<i64>().ok())
        .is_some_and(|expires_at| expires_at < Utc::now().timestamp());

    if expired {
        return Ok(None);
    }

    Ok(read_optional_string(item, "reportId"))
}

/// Marks a report failed and gives its range back, for a report that was
/// created but never started.
///
/// The row is kept rather than deleted. Another request may already have been
/// handed this id, and an id resolving to a report that says it could not be
/// generated beats one resolving to nothing.
///
/// Best effort throughout: the caller is already returning an error, and
/// failing to tidy up must not replace that error with a less useful one.
async fn abandon_report(
    tenant_id: &str,
    report_id: &str,
    period_start: &str,
    period_end: &str,
    cause: &AppError,
) {
    let Ok(table_name) = std::env::var("TABLE_NAME") else {
        return;
    };
    let ddb_client = aws_clients::get_dynamodb_client().await;

    if let Err(error) = ddb_client
        .update_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(report_partition_key(tenant_id)))
        .key("sk", AttributeValue::S(report_sort_key(report_id)))
        .update_expression("SET #status = :failed, failureReason = :reason")
        .expression_attribute_names("#status", "status")
        .expression_attribute_values(":failed", AttributeValue::S("failed".to_string()))
        .expression_attribute_values(
            ":reason",
            AttributeValue::S(format!("Could not start the report: {}", cause)),
        )
        .send()
        .await
    {
        tracing::warn!(report_id, error = %error, "could not mark an unstarted report failed");
    }

    release_range(tenant_id, report_id, period_start, period_end).await;
}

/// Gives a range back, but only if this report still holds it.
///
/// The ownership check is not decoration. A reservation can be taken over once
/// its window passes, so a run that overran its lease and then finished would
/// otherwise delete a reservation belonging to somebody else, and a third
/// request could start over the same range while both were still going.
async fn release_range(tenant_id: &str, report_id: &str, period_start: &str, period_end: &str) {
    let Ok(table_name) = std::env::var("TABLE_NAME") else {
        return;
    };
    let ddb_client = aws_clients::get_dynamodb_client().await;

    if let Err(error) = ddb_client
        .delete_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(report_partition_key(tenant_id)))
        .key(
            "sk",
            AttributeValue::S(range_lock_key(period_start, period_end)),
        )
        .condition_expression(RELEASE_CONDITION)
        .expression_attribute_values(":owner", AttributeValue::S(report_id.to_string()))
        .send()
        .await
    {
        // Losing the condition means somebody else owns it now, which is the
        // check doing its job rather than a problem.
        tracing::debug!(
            report_id,
            error = %error,
            "range reservation not released; it is held by a later report or already gone"
        );
    }
}

async fn start_report_execution(
    tenant_id: &str,
    report_id: &str,
    period_start: &str,
    period_end: &str,
    period_label: &str,
) -> Result<(), AppError> {
    let sfn_client = aws_clients::get_sfn_client().await;
    let state_machine_arn = std::env::var("REPORT_STATE_MACHINE_ARN")
        .map_err(|_| AppError::InternalError("REPORT_STATE_MACHINE_ARN not set".to_string()))?;

    // Every field the state machine reads is sent, including the ones that are
    // null here: a `.$` path to a key that is absent fails the execution,
    // where a null is simply a null.
    let input = serde_json::json!({
        "tenant": { "id": tenant_id, "email": serde_json::Value::Null },
        "reportId": report_id,
        "reportType": "adhoc",
        "deliverEmail": false,
        "month": serde_json::Value::Null,
        "monthLabel": serde_json::Value::Null,
        "periodLabel": period_label,
        "periodStart": period_start,
        "periodEnd": period_end,
    });

    sfn_client
        .start_execution()
        .state_machine_arn(state_machine_arn)
        // Named after the report, so a retry of the same request joins the
        // execution already running rather than starting a second one over
        // the same range.
        .name(report_id)
        .input(input.to_string())
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to start report workflow: {}", e)))?;

    Ok(())
}

fn read_string(item: &HashMap<String, AttributeValue>, key: &str) -> Result<String, AppError> {
    item.get(key)
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::InternalError(format!("Missing {}", key)))
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
        AttributeValue::M(m) => {
            let mut json_map = serde_json::Map::new();
            for (key, value) in m {
                json_map.insert(key.clone(), attribute_value_to_json(value)?);
            }
            Ok(serde_json::Value::Object(json_map))
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn day(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("test date")
    }

    mod report_ids {
        use super::*;

        #[test]
        fn a_month_maps_to_the_key_scheduled_reports_have_always_used() {
            // Report links already went out in email pointing at this shape.
            assert_eq!(report_sort_key("2026-05"), "monthly#2026-05");
        }

        #[test]
        fn anything_else_is_treated_as_an_on_demand_id() {
            assert_eq!(
                report_sort_key("01JBQ7ZS4C8N2WK9X3F0PDTM5H"),
                "adhoc#01JBQ7ZS4C8N2WK9X3F0PDTM5H"
            );
        }

        #[test]
        fn round_trips_through_the_sort_key() {
            for id in ["2026-05", "01JBQ7ZS4C8N2WK9X3F0PDTM5H"] {
                assert_eq!(report_id_from_sort_key(&report_sort_key(id)), id);
            }
        }

        #[test]
        fn a_month_shaped_string_that_is_not_a_month_is_not_one() {
            // Month 13 and month 00 would otherwise key a report nobody can
            // reach, since no scheduled run would ever write there.
            assert!(!is_monthly_report_id("2026-13"));
            assert!(!is_monthly_report_id("2026-00"));
            assert!(!is_monthly_report_id("2026-5"));
            assert!(!is_monthly_report_id("202605"));
        }
    }

    mod range_reservation {
        use super::*;

        #[test]
        fn the_key_is_the_range_itself() {
            // Two requests for the same range build the same key, which is the
            // whole mechanism: the second one loses the conditional put.
            let a = range_lock_key("2026-06-01T00:00:00.000Z", "2026-06-15T00:00:00.000Z");
            let b = range_lock_key("2026-06-01T00:00:00.000Z", "2026-06-15T00:00:00.000Z");

            assert_eq!(a, b);
        }

        #[test]
        fn a_different_range_is_a_different_key() {
            let june = range_lock_key("2026-06-01T00:00:00.000Z", "2026-06-15T00:00:00.000Z");
            let july = range_lock_key("2026-07-01T00:00:00.000Z", "2026-07-15T00:00:00.000Z");

            assert_ne!(june, july);
        }

        #[test]
        fn an_expired_reservation_can_be_taken_over() {
            // DynamoDB removes an expired item whenever it gets round to it,
            // which can be days. If the claim waited for that, a range whose
            // run vanished would stay locked long past the hour it advertises.
            // The condition has to say so itself.
            assert!(RESERVE_CONDITION.contains("attribute_not_exists(pk)"));
            assert!(RESERVE_CONDITION.contains("#ttl < :now"));
        }

        #[test]
        fn a_live_reservation_still_blocks() {
            // The takeover is on expiry alone. Anything else would hand the
            // range to whoever asked most recently.
            assert!(!RESERVE_CONDITION.contains("#ttl >"));
            assert!(!RESERVE_CONDITION.contains("attribute_exists"));
        }

        #[test]
        fn releasing_checks_who_owns_it() {
            // A run that overran its lease can finish after a later report
            // took the range over. Releasing unconditionally would delete the
            // newer reservation and let a third request start concurrently.
            assert!(RELEASE_CONDITION.contains("reportId = :owner"));
        }

        #[test]
        fn it_cannot_collide_with_a_report() {
            // Both live in the same partition, so the prefixes have to stay
            // distinct or a lock would shadow a report.
            let lock = range_lock_key("2026-06-01T00:00:00.000Z", "2026-06-15T00:00:00.000Z");

            assert!(lock.starts_with("lock#"));
            assert!(!lock.starts_with(MONTHLY_PREFIX));
            assert!(!lock.starts_with(ADHOC_PREFIX));
        }
    }

    mod range_validation {
        use super::*;

        const UTC: chrono_tz::Tz = chrono_tz::UTC;

        fn past(days_back: i64) -> NaiveDate {
            Utc::now().date_naive() - Duration::days(days_back)
        }

        #[test]
        fn accepts_an_ordinary_range() {
            assert!(validate_range(past(30), past(1), UTC).is_ok());
        }

        #[test]
        fn accepts_a_single_day() {
            // End is exclusive, so one day apart is the shortest real range.
            assert!(validate_range(past(2), past(1), UTC).is_ok());
        }

        #[test]
        fn rejects_an_empty_range() {
            let same = past(5);
            assert!(validate_range(same, same, UTC).is_err());
        }

        #[test]
        fn rejects_an_inverted_range() {
            assert!(validate_range(past(1), past(30), UTC).is_err());
        }

        #[test]
        fn allows_a_range_ending_today() {
            // Ending tomorrow means "up to and including today", which is the
            // range someone asking about this week actually wants.
            let tomorrow = Utc::now().date_naive() + Duration::days(1);
            assert!(validate_range(past(7), tomorrow, UTC).is_ok());
        }

        #[test]
        fn rejects_a_range_that_has_not_happened() {
            let later = Utc::now().date_naive() + Duration::days(9);
            assert!(validate_range(past(7), later, UTC).is_err());
        }

        #[test]
        fn rejects_a_range_longer_than_a_year() {
            assert!(validate_range(past(400), past(1), UTC).is_err());
        }

        #[test]
        fn the_ceiling_is_inclusive() {
            assert!(validate_range(past(MAX_SPAN_DAYS + 1), past(1), UTC).is_ok());
            assert!(validate_range(past(MAX_SPAN_DAYS + 2), past(1), UTC).is_err());
        }
    }

    mod period_labels {
        use super::*;

        // Every label names the last day *covered*, not the exclusive end.
        #[test]
        fn a_single_day() {
            assert_eq!(
                format_period_label(day("2026-06-03"), day("2026-06-04")),
                "3 Jun 2026"
            );
        }

        #[test]
        fn a_range_inside_one_month() {
            assert_eq!(
                format_period_label(day("2026-06-01"), day("2026-06-15")),
                "1–14 Jun 2026"
            );
        }

        #[test]
        fn a_range_across_months() {
            assert_eq!(
                format_period_label(day("2026-06-01"), day("2026-07-15")),
                "1 Jun – 14 Jul 2026"
            );
        }

        #[test]
        fn a_range_across_years() {
            assert_eq!(
                format_period_label(day("2026-12-20"), day("2027-01-05")),
                "20 Dec 2026 – 4 Jan 2027"
            );
        }

        #[test]
        fn a_whole_month_reads_as_that_month() {
            assert_eq!(
                format_period_label(day("2026-06-01"), day("2026-07-01")),
                "1–30 Jun 2026"
            );
        }
    }

    mod day_parsing {
        use super::*;

        #[test]
        fn rejects_anything_that_is_not_a_plain_date() {
            for bad in [
                "2026-6-1",
                "06/01/2026",
                "2026-06-01T00:00:00Z",
                "yesterday",
            ] {
                assert!(parse_day(bad, "periodStart").is_err(), "accepted {}", bad);
            }
        }

        #[test]
        fn resolves_midnight_in_the_tenants_zone() {
            // Chicago is UTC-5 in June, so their 1 June starts at 05:00Z.
            let resolved = start_of_day(day("2026-06-01"), chrono_tz::America::Chicago).unwrap();
            assert_eq!(resolved, "2026-06-01T05:00:00.000Z");
        }

        #[test]
        fn falls_back_to_utc_when_no_zone_is_configured() {
            // `TenantSettings::timezone` already answers UTC for an unset
            // zone; this pins what that means for a range boundary.
            let resolved = start_of_day(day("2026-06-01"), chrono_tz::UTC).unwrap();
            assert_eq!(resolved, "2026-06-01T00:00:00.000Z");
        }
    }
}
