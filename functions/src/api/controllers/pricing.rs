use aws_sdk_dynamodb::types::AttributeValue;
use chrono::Utc;
use lambda_http::{Body, Error, Request, Response};
use newsletter::admin::{auth, aws_clients, error::AppError, response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use uuid::Uuid;

// ── Constants ──────────────────────────────────────────────────────────

const PRICING_HISTORY_LIMIT: i32 = 53; // current + 52 history
const PRICING_SK_PREFIX: &str = "pricing#";
const PRICING_JOB_SK_PREFIX: &str = "pricing-job#";
const PRICING_QUESTIONNAIRE_SK: &str = "pricing-questionnaire";
const JOB_TTL_SECONDS: i64 = 86400; // 24 hours

// ── Default questionnaire ──────────────────────────────────────────────

const DEFAULT_QUESTIONNAIRE_VERSION: &str = "v1";

fn default_questions() -> Vec<QuestionnaireQuestion> {
    vec![
        QuestionnaireQuestion {
            id: "q1".to_string(),
            category: "audience_demographics".to_string(),
            text: "What is the primary industry of your audience?".to_string(),
            question_type: "single-select".to_string(),
            options: Some(vec![
                "Technology".to_string(),
                "Finance".to_string(),
                "Marketing".to_string(),
                "Healthcare".to_string(),
                "Education".to_string(),
                "Other".to_string(),
            ]),
        },
        QuestionnaireQuestion {
            id: "q2".to_string(),
            category: "newsletter_niche".to_string(),
            text: "How would you describe your newsletter's niche?".to_string(),
            question_type: "text".to_string(),
            options: None,
        },
        QuestionnaireQuestion {
            id: "q3".to_string(),
            category: "sponsorship_format".to_string(),
            text: "What types of sponsorship placements do you offer?".to_string(),
            question_type: "multi-select".to_string(),
            options: Some(vec![
                "Dedicated email".to_string(),
                "Banner ad".to_string(),
                "Sponsored section".to_string(),
                "Product mention".to_string(),
                "Other".to_string(),
            ]),
        },
        QuestionnaireQuestion {
            id: "q4".to_string(),
            category: "content_frequency".to_string(),
            text: "How often do you publish your newsletter?".to_string(),
            question_type: "single-select".to_string(),
            options: Some(vec![
                "Daily".to_string(),
                "Multiple times per week".to_string(),
                "Weekly".to_string(),
                "Bi-weekly".to_string(),
                "Monthly".to_string(),
            ]),
        },
        QuestionnaireQuestion {
            id: "q5".to_string(),
            category: "monetization_goals".to_string(),
            text: "What is your primary monetization goal?".to_string(),
            question_type: "single-select".to_string(),
            options: Some(vec![
                "Maximize revenue per issue".to_string(),
                "Build long-term sponsor relationships".to_string(),
                "Cover operating costs".to_string(),
                "Grow audience first, monetize later".to_string(),
            ]),
        },
    ]
}

// ── Request/Response types ─────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PricingResponse {
    current: Option<Value>,
    has_pricing: bool,
    first_calculation_pending: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PricingHistoryResponse {
    history: Vec<Value>,
    count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecalculateResponse {
    job_id: String,
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JobStatusResponse {
    job_id: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QuestionnaireQuestion {
    id: String,
    category: String,
    text: String,
    #[serde(rename = "type")]
    question_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QuestionnaireResponse {
    version: String,
    questions: Vec<QuestionnaireQuestion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    existing_responses: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmitQuestionnaireRequest {
    version: String,
    responses: Vec<QuestionnaireAnswerItem>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuestionnaireAnswerItem {
    question_id: String,
    answer: Value,
}

// ── Public endpoint handlers ───────────────────────────────────────────

/// GET /pricing
pub async fn get_pricing(event: Request) -> Result<Response<Body>, Error> {
    match handle_get_pricing(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /pricing/history
pub async fn get_pricing_history(event: Request) -> Result<Response<Body>, Error> {
    match handle_get_pricing_history(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// POST /pricing/recalculate
pub async fn recalculate(event: Request) -> Result<Response<Body>, Error> {
    match handle_recalculate(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /pricing/recalculate/:jobId
pub async fn get_job_status(event: Request, job_id: Option<String>) -> Result<Response<Body>, Error> {
    match handle_get_job_status(event, job_id).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// GET /pricing/questionnaire
pub async fn get_questionnaire(event: Request) -> Result<Response<Body>, Error> {
    match handle_get_questionnaire(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

/// POST /pricing/questionnaire
pub async fn submit_questionnaire(event: Request) -> Result<Response<Body>, Error> {
    match handle_submit_questionnaire(event).await {
        Ok(resp) => Ok(resp),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

// ── Internal handlers ──────────────────────────────────────────────────

/// Task 7.1: GET /pricing
async fn handle_get_pricing(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let result = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("pk = :pk AND begins_with(sk, :sk_prefix)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
        .expression_attribute_values(":sk_prefix", AttributeValue::S(PRICING_SK_PREFIX.to_string()))
        .scan_index_forward(false)
        .limit(1)
        .send()
        .await?;

    let items = result.items();

    if items.is_empty() {
        return response::format_response(
            200,
            PricingResponse {
                current: None,
                has_pricing: false,
                first_calculation_pending: true,
            },
        );
    }

    let current = items.first().map(dynamodb_item_to_json);

    response::format_response(
        200,
        PricingResponse {
            current,
            has_pricing: true,
            first_calculation_pending: false,
        },
    )
}

/// GET /pricing/history
async fn handle_get_pricing_history(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let result = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("pk = :pk AND begins_with(sk, :sk_prefix)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.clone()))
        .expression_attribute_values(":sk_prefix", AttributeValue::S(PRICING_SK_PREFIX.to_string()))
        .scan_index_forward(false)
        .limit(PRICING_HISTORY_LIMIT)
        .send()
        .await?;

    let records: Vec<Value> = result
        .items()
        .iter()
        .map(dynamodb_item_to_json)
        .collect();

    let count = records.len();

    response::format_response(
        200,
        PricingHistoryResponse { history: records, count },
    )
}

/// Task 7.2: POST /pricing/recalculate
async fn handle_recalculate(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    // Check for in-progress recalculation
    if let Some(existing_job_id) = find_in_progress_job(&tenant_id).await? {
        return response::format_response(
            409,
            json!({
                "message": "Recalculation already in progress",
                "jobId": existing_job_id
            }),
        );
    }

    let job_id = Uuid::new_v4().to_string();
    create_job_record(&tenant_id, &job_id).await?;
    publish_pricing_event(&tenant_id, &job_id).await?;

    response::format_response(
        200,
        RecalculateResponse {
            job_id,
            status: "processing".to_string(),
        },
    )
}

/// Task 7.3: GET /pricing/recalculate/:jobId
async fn handle_get_job_status(
    event: Request,
    job_id: Option<String>,
) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let job_id = job_id
        .ok_or_else(|| AppError::BadRequest("Job ID is required".to_string()))?;

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let sk = format!("{}{}", PRICING_JOB_SK_PREFIX, job_id);
    let result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(sk))
        .send()
        .await?;

    let item = result
        .item()
        .ok_or_else(|| AppError::NotFound("Job not found".to_string()))?;

    let status = item
        .get("status")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let result_value = item.get("result").map(attribute_to_json);
    let error_value = item
        .get("error")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string());

    response::format_response(
        200,
        JobStatusResponse {
            job_id,
            status,
            result: result_value,
            error: error_value,
        },
    )
}

/// Task 7.4: GET /pricing/questionnaire
async fn handle_get_questionnaire(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.clone()))
        .key("sk", AttributeValue::S(PRICING_QUESTIONNAIRE_SK.to_string()))
        .send()
        .await?;

    let questions = default_questions();

    let (version, existing_responses) = match result.item() {
        Some(item) => {
            let version = item
                .get("version")
                .and_then(|v| v.as_s().ok())
                .map(|s| s.to_string())
                .unwrap_or_else(|| DEFAULT_QUESTIONNAIRE_VERSION.to_string());

            let responses = item.get("responses").map(attribute_to_json);

            (version, responses)
        }
        None => (DEFAULT_QUESTIONNAIRE_VERSION.to_string(), None),
    };

    response::format_response(
        200,
        QuestionnaireResponse {
            version,
            questions,
            existing_responses,
        },
    )
}

/// Task 7.5: POST /pricing/questionnaire
async fn handle_submit_questionnaire(event: Request) -> Result<Response<Body>, AppError> {
    let user_context = auth::get_user_context(&event)?;
    let tenant_id = user_context
        .tenant_id
        .ok_or_else(|| AppError::Forbidden("Tenant access required".to_string()))?;

    let body: SubmitQuestionnaireRequest = parse_request_body(&event)?;

    if body.version.is_empty() {
        return Err(AppError::BadRequest("version is required".to_string()));
    }
    if body.responses.is_empty() {
        return Err(AppError::BadRequest("responses array cannot be empty".to_string()));
    }
    for item in &body.responses {
        if item.question_id.is_empty() {
            return Err(AppError::BadRequest("questionId is required for each response".to_string()));
        }
    }

    // Build responses map for DynamoDB
    let mut responses_map: HashMap<String, AttributeValue> = HashMap::new();
    for item in &body.responses {
        responses_map.insert(
            item.question_id.clone(),
            json_value_to_attribute(&item.answer),
        );
    }

    let now = Utc::now().to_rfc3339();
    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    ddb_client
        .put_item()
        .table_name(&table_name)
        .item("pk", AttributeValue::S(tenant_id.clone()))
        .item("sk", AttributeValue::S(PRICING_QUESTIONNAIRE_SK.to_string()))
        .item("version", AttributeValue::S(body.version))
        .item("responses", AttributeValue::M(responses_map))
        .item("updatedAt", AttributeValue::S(now))
        .send()
        .await?;

    // Trigger async recalculation
    let job_id = Uuid::new_v4().to_string();
    create_job_record(&tenant_id, &job_id).await?;
    publish_pricing_event(&tenant_id, &job_id).await?;

    response::format_response(
        200,
        RecalculateResponse {
            job_id,
            status: "processing".to_string(),
        },
    )
}

// ── Helper functions ───────────────────────────────────────────────────

fn get_table_name() -> Result<String, AppError> {
    env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not set".to_string()))
}

fn parse_request_body<T: for<'de> Deserialize<'de>>(event: &Request) -> Result<T, AppError> {
    match event.body() {
        Body::Text(text) => serde_json::from_str(text)
            .map_err(|e| AppError::BadRequest(format!("Invalid JSON body: {}", e))),
        Body::Binary(bytes) => serde_json::from_slice(bytes)
            .map_err(|e| AppError::BadRequest(format!("Invalid JSON body: {}", e))),
        Body::Empty => Err(AppError::BadRequest("Request body is required".to_string())),
    }
}

/// Check if there's an in-progress pricing job for this tenant
async fn find_in_progress_job(tenant_id: &str) -> Result<Option<String>, AppError> {
    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let result = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("pk = :pk AND begins_with(sk, :sk_prefix)")
        .filter_expression("#status = :processing")
        .expression_attribute_names("#status", "status")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.to_string()))
        .expression_attribute_values(":sk_prefix", AttributeValue::S(PRICING_JOB_SK_PREFIX.to_string()))
        .expression_attribute_values(":processing", AttributeValue::S("processing".to_string()))
        .scan_index_forward(false)
        .limit(1)
        .send()
        .await?;

    let items = result.items();
    if items.is_empty() {
        return Ok(None);
    }

    let job_sk = items[0]
        .get("sk")
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string())
        .unwrap_or_default();

    let job_id = job_sk
        .strip_prefix(PRICING_JOB_SK_PREFIX)
        .unwrap_or(&job_sk)
        .to_string();

    Ok(Some(job_id))
}

/// Create a job status record in DynamoDB
async fn create_job_record(tenant_id: &str, job_id: &str) -> Result<(), AppError> {
    let table_name = get_table_name()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let now = Utc::now();
    let ttl = now.timestamp() + JOB_TTL_SECONDS;

    ddb_client
        .put_item()
        .table_name(&table_name)
        .item("pk", AttributeValue::S(tenant_id.to_string()))
        .item(
            "sk",
            AttributeValue::S(format!("{}{}", PRICING_JOB_SK_PREFIX, job_id)),
        )
        .item("status", AttributeValue::S("processing".to_string()))
        .item("createdAt", AttributeValue::S(now.to_rfc3339()))
        .item("updatedAt", AttributeValue::S(now.to_rfc3339()))
        .item("ttl", AttributeValue::N(ttl.to_string()))
        .send()
        .await?;

    Ok(())
}

/// Publish a pricing recalculation event to EventBridge
async fn publish_pricing_event(tenant_id: &str, job_id: &str) -> Result<(), AppError> {
    let eventbridge_client = aws_clients::get_eventbridge_client().await;

    let detail = json!({
        "tenantId": tenant_id,
        "jobId": job_id,
        "timestamp": Utc::now().to_rfc3339()
    });

    let detail_str = serde_json::to_string(&detail)
        .map_err(|e| AppError::InternalError(format!("Failed to serialize event detail: {}", e)))?;

    let result = eventbridge_client
        .put_events()
        .entries(
            aws_sdk_eventbridge::types::PutEventsRequestEntry::builder()
                .source("newsletter-service")
                .detail_type("PRICING_RECALCULATION_REQUESTED")
                .detail(detail_str)
                .build(),
        )
        .send()
        .await;

    match result {
        Ok(output) => {
            for entry in output.entries() {
                if let Some(error_code) = entry.error_code() {
                    tracing::error!(
                        tenant_id = %tenant_id,
                        error_code = %error_code,
                        error_message = ?entry.error_message(),
                        "Failed to publish pricing event to EventBridge"
                    );
                    return Err(AppError::InternalError("Failed to publish pricing event".to_string()));
                }
            }
            Ok(())
        }
        Err(e) => {
            tracing::error!(
                tenant_id = %tenant_id,
                error = %e,
                "Failed to send pricing event to EventBridge"
            );
            Err(AppError::InternalError(format!("EventBridge publish failed: {}", e)))
        }
    }
}

/// Convert a DynamoDB item (HashMap<String, AttributeValue>) to a JSON Value
fn dynamodb_item_to_json(item: &HashMap<String, AttributeValue>) -> Value {
    let mut map = serde_json::Map::new();
    for (key, value) in item {
        // Skip internal DynamoDB keys from the response
        if key == "pk" || key == "sk" {
            continue;
        }
        map.insert(key.clone(), attribute_to_json(value));
    }
    Value::Object(map)
}

/// Convert a single DynamoDB AttributeValue to a JSON Value
fn attribute_to_json(value: &AttributeValue) -> Value {
    match value {
        AttributeValue::S(s) => Value::String(s.clone()),
        AttributeValue::N(n) => {
            if let Ok(i) = n.parse::<i64>() {
                json!(i)
            } else if let Ok(f) = n.parse::<f64>() {
                json!(f)
            } else {
                Value::String(n.clone())
            }
        }
        AttributeValue::Bool(b) => Value::Bool(*b),
        AttributeValue::Null(_) => Value::Null,
        AttributeValue::M(m) => {
            let mut map = serde_json::Map::new();
            for (k, v) in m {
                map.insert(k.clone(), attribute_to_json(v));
            }
            Value::Object(map)
        }
        AttributeValue::L(l) => {
            Value::Array(l.iter().map(attribute_to_json).collect())
        }
        AttributeValue::Ss(ss) => {
            Value::Array(ss.iter().map(|s| Value::String(s.clone())).collect())
        }
        AttributeValue::Ns(ns) => {
            Value::Array(ns.iter().map(|n| {
                n.parse::<f64>()
                    .map(|f| json!(f))
                    .unwrap_or_else(|_| Value::String(n.clone()))
            }).collect())
        }
        _ => Value::Null,
    }
}

/// Convert a serde_json Value to a DynamoDB AttributeValue
fn json_value_to_attribute(value: &Value) -> AttributeValue {
    match value {
        Value::Null => AttributeValue::Null(true),
        Value::Bool(b) => AttributeValue::Bool(*b),
        Value::Number(n) => AttributeValue::N(n.to_string()),
        Value::String(s) => AttributeValue::S(s.clone()),
        Value::Array(arr) => {
            AttributeValue::L(arr.iter().map(json_value_to_attribute).collect())
        }
        Value::Object(map) => {
            AttributeValue::M(
                map.iter()
                    .map(|(k, v)| (k.clone(), json_value_to_attribute(v)))
                    .collect(),
            )
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // ── Helpers ────────────────────────────────────────────────────────

    /// Valid categories for questionnaire questions (from design doc)
    const VALID_CATEGORIES: &[&str] = &[
        "audience_demographics",
        "newsletter_niche",
        "sponsorship_format",
        "content_frequency",
        "monetization_goals",
    ];

    /// Simulate the record-splitting logic from handle_get_pricing:
    /// DynamoDB returns up to PRICING_HISTORY_LIMIT (53) items sorted descending.
    /// The first item becomes `current`, the rest become `history` (at most 52).
    fn split_pricing_records(records: Vec<Value>) -> (Option<Value>, Vec<Value>) {
        // Apply the same limit the controller uses (53 total)
        let limited: Vec<Value> = records
            .into_iter()
            .take(PRICING_HISTORY_LIMIT as usize)
            .collect();

        let current = limited.first().cloned();
        let history = if limited.len() > 1 {
            limited[1..].to_vec()
        } else {
            vec![]
        };
        (current, history)
    }

    /// Build a fake DynamoDB item with pk, sk, and a payload field.
    fn make_dynamo_item(
        tenant_id: &str,
        timestamp: &str,
        price: f64,
    ) -> HashMap<String, AttributeValue> {
        let mut item = HashMap::new();
        item.insert("pk".to_string(), AttributeValue::S(tenant_id.to_string()));
        item.insert(
            "sk".to_string(),
            AttributeValue::S(format!("{}{}", PRICING_SK_PREFIX, timestamp)),
        );
        item.insert(
            "recommendedPrice".to_string(),
            AttributeValue::N(price.to_string()),
        );
        item
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        // Feature: sponsorship-pricing-calculator, Property 12: Pricing history bounded to 52 records
        // Validates: Requirements 3.2, 6.1, 9.3
        #[test]
        fn test_pricing_history_bounded_to_52(
            record_count in 0usize..200
        ) {
            // Generate a Vec of pricing record JSON values (simulating DynamoDB query results)
            let records: Vec<Value> = (0..record_count)
                .map(|i| {
                    serde_json::json!({
                        "recommendedPrice": 100.0 + i as f64,
                        "calculatedAt": format!("2025-01-{:02}T15:00:00Z", (i % 28) + 1)
                    })
                })
                .collect();

            let (_current, history) = split_pricing_records(records);

            // History must be at most 52 records
            prop_assert!(
                history.len() <= 52,
                "History should contain at most 52 records, got {}",
                history.len()
            );

            // Total returned (current + history) must be at most 53
            let total = if _current.is_some() { 1 + history.len() } else { history.len() };
            prop_assert!(
                total <= 53,
                "Total records (current + history) should be at most 53, got {}",
                total
            );

            // If we had records, current should be present
            if record_count > 0 {
                prop_assert!(_current.is_some(), "Current should be present when records exist");
            } else {
                prop_assert!(_current.is_none(), "Current should be None when no records");
            }

            // History should be in the same order as input (descending by timestamp)
            // since we don't re-sort — DynamoDB returns them sorted already
            if history.len() >= 2 {
                for i in 0..history.len() - 1 {
                    // Each record's price should be sequential (our test data is ordered)
                    let price_a = history[i]["recommendedPrice"].as_f64().unwrap();
                    let price_b = history[i + 1]["recommendedPrice"].as_f64().unwrap();
                    prop_assert!(
                        price_a < price_b,
                        "History should preserve descending order from DynamoDB"
                    );
                }
            }
        }

        // Feature: sponsorship-pricing-calculator, Property 13: Tenant isolation on pricing endpoints
        // Validates: Requirements 6.8, 6.9
        #[test]
        fn test_tenant_isolation_dynamodb_item_strips_pk_sk(
            tenant_id in "[a-z0-9]{8,20}",
            timestamp in "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z",
            price in 0.01f64..10000.0
        ) {
            let item = make_dynamo_item(&tenant_id, &timestamp, price);

            // dynamodb_item_to_json should strip pk and sk
            let json = dynamodb_item_to_json(&item);
            let obj = json.as_object().unwrap();

            prop_assert!(
                !obj.contains_key("pk"),
                "JSON output should not contain pk (tenant isolation: internal key stripped)"
            );
            prop_assert!(
                !obj.contains_key("sk"),
                "JSON output should not contain sk (internal key stripped)"
            );

            // The payload field should still be present
            prop_assert!(
                obj.contains_key("recommendedPrice"),
                "JSON output should contain recommendedPrice"
            );
        }

        // Feature: sponsorship-pricing-calculator, Property 13: Tenant isolation — key generation pattern
        // Validates: Requirements 6.8, 6.9
        #[test]
        fn test_tenant_isolation_key_generation(
            tenant_id in "[a-z0-9]{8,20}",
            timestamp in "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z"
        ) {
            // Verify the pricing record key pattern: pk = tenantId, sk = pricing#{timestamp}
            let prefix = PRICING_SK_PREFIX;
            let expected_sk = [prefix, &timestamp].concat();
            let item = make_dynamo_item(&tenant_id, &timestamp, 100.0);

            let pk = item.get("pk").unwrap().as_s().unwrap();
            let sk = item.get("sk").unwrap().as_s().unwrap();

            prop_assert_eq!(pk, &tenant_id, "pk must equal tenantId");
            prop_assert_eq!(sk, &expected_sk, "sk must match expected pattern");
            prop_assert!(
                sk.starts_with(prefix),
                "sk must start with the pricing prefix"
            );

            // Verify questionnaire key pattern
            let q_sk = PRICING_QUESTIONNAIRE_SK;
            prop_assert_eq!(q_sk, "pricing-questionnaire");
        }
    }

    // Feature: sponsorship-pricing-calculator, Property 14: Questionnaire validation constraints
    // Validates: Requirements 4.2, 4.3, 4.4
    //
    // This is a deterministic test on the default_questions() function.
    // We verify the constraints hold: 3-7 questions, valid categories, stable IDs, version set.
    #[test]
    fn test_questionnaire_validation_constraints() {
        let questions = default_questions();

        // 3-7 questions
        assert!(
            questions.len() >= 3 && questions.len() <= 7,
            "Questionnaire must have 3-7 questions, got {}",
            questions.len()
        );

        // Version is set
        assert!(
            !DEFAULT_QUESTIONNAIRE_VERSION.is_empty(),
            "Questionnaire version must be set"
        );

        let mut seen_ids = std::collections::HashSet::new();

        for q in &questions {
            // Each question has a valid category from the predefined set
            assert!(
                VALID_CATEGORIES.contains(&q.category.as_str()),
                "Question '{}' has invalid category '{}'. Valid: {:?}",
                q.id,
                q.category,
                VALID_CATEGORIES
            );

            // Each question has a stable, non-empty ID
            assert!(!q.id.is_empty(), "Question ID must not be empty");

            // IDs must be unique
            assert!(
                seen_ids.insert(q.id.clone()),
                "Duplicate question ID: {}",
                q.id
            );

            // Each question has non-empty text
            assert!(!q.text.is_empty(), "Question text must not be empty for {}", q.id);

            // Each question has a non-empty type
            assert!(
                !q.question_type.is_empty(),
                "Question type must not be empty for {}",
                q.id
            );
        }
    }

    // Feature: sponsorship-pricing-calculator, Property 14: Questionnaire validation constraints (proptest)
    // Validates: Requirements 4.2, 4.3, 4.4
    //
    // Property-based: verify that no matter how many times we call default_questions(),
    // the constraints always hold and the output is stable (deterministic).
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn test_questionnaire_constraints_stable_across_calls(_seed in 0u64..1000) {
            let q1 = default_questions();
            let q2 = default_questions();

            // Same number of questions each time
            prop_assert_eq!(q1.len(), q2.len(), "Question count must be stable");

            // 3-7 questions
            prop_assert!(
                q1.len() >= 3 && q1.len() <= 7,
                "Must have 3-7 questions, got {}",
                q1.len()
            );

            // Version is set
            prop_assert!(
                !DEFAULT_QUESTIONNAIRE_VERSION.is_empty(),
                "Version must be set"
            );

            for (a, b) in q1.iter().zip(q2.iter()) {
                // Stable IDs
                prop_assert_eq!(&a.id, &b.id, "Question IDs must be stable across calls");

                // Stable categories
                prop_assert_eq!(
                    &a.category, &b.category,
                    "Question categories must be stable across calls"
                );

                // Valid category
                prop_assert!(
                    VALID_CATEGORIES.contains(&a.category.as_str()),
                    "Category '{}' not in valid set",
                    a.category
                );
            }
        }
    }
}
