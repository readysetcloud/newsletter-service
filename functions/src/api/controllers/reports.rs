use aws_sdk_dynamodb::types::AttributeValue;
use base64::Engine;
use lambda_http::{Body, Error, Request, RequestExt, Response};
use newsletter::admin::{auth, aws_clients, error::AppError, response};
use serde::Serialize;
use std::collections::HashMap;

const DEFAULT_LIMIT: i32 = 12;
const MAX_LIMIT: i32 = 60;
const SK_PREFIX: &str = "monthly#";

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

#[derive(Serialize)]
pub struct ReportSummaryItem {
    id: String,
    month: String,
    #[serde(rename = "monthLabel")]
    month_label: String,
    #[serde(rename = "periodStart")]
    period_start: String,
    #[serde(rename = "periodEnd")]
    period_end: String,
    #[serde(rename = "generatedAt")]
    generated_at: String,
    #[serde(rename = "reportType")]
    report_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<serde_json::Value>,
    #[serde(rename = "subscriberGrowth", skip_serializing_if = "Option::is_none")]
    subscriber_growth: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct GetReportResponse {
    id: String,
    month: String,
    #[serde(rename = "monthLabel")]
    month_label: String,
    #[serde(rename = "periodStart")]
    period_start: String,
    #[serde(rename = "periodEnd")]
    period_end: String,
    #[serde(rename = "generatedAt")]
    generated_at: String,
    #[serde(rename = "reportType")]
    report_type: String,
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

    let report = get_report_by_month(&tenant_id, &report_id).await?;

    response::format_response(200, report)
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

    let pk = format!("{}#report", tenant_id);

    let mut query_builder = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("pk = :pk AND begins_with(sk, :skprefix)")
        .expression_attribute_values(":pk", AttributeValue::S(pk))
        .expression_attribute_values(":skprefix", AttributeValue::S(SK_PREFIX.to_string()))
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

async fn get_report_by_month(tenant_id: &str, month: &str) -> Result<GetReportResponse, AppError> {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))?;

    let pk = format!("{}#report", tenant_id);
    let sk = format!("{}{}", SK_PREFIX, month);

    let result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(pk))
        .key("sk", AttributeValue::S(sk))
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
    let month = read_string(item, "month")?;
    let month_label = read_string(item, "monthLabel")?;
    let period_start = read_string(item, "periodStart")?;
    let period_end = read_string(item, "periodEnd")?;
    let generated_at = read_string(item, "generatedAt")?;
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
        id: month.clone(),
        month,
        month_label,
        period_start,
        period_end,
        generated_at,
        report_type,
        summary,
        subscriber_growth,
    })
}

fn parse_report_record(
    item: &HashMap<String, AttributeValue>,
) -> Result<GetReportResponse, AppError> {
    let month = read_string(item, "month")?;
    let month_label = read_string(item, "monthLabel")?;
    let period_start = read_string(item, "periodStart")?;
    let period_end = read_string(item, "periodEnd")?;
    let generated_at = read_string(item, "generatedAt")?;
    let report_type = read_string(item, "reportType")?;

    let report = item
        .get("report")
        .map(attribute_value_to_json)
        .transpose()?
        .unwrap_or(serde_json::Value::Null);

    Ok(GetReportResponse {
        id: month.clone(),
        month,
        month_label,
        period_start,
        period_end,
        generated_at,
        report_type,
        report,
    })
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
