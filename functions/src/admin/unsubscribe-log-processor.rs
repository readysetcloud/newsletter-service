use aws_sdk_cloudwatchlogs::types::{QueryStatus, ResultField};
use aws_sdk_cloudwatchlogs::Client as CloudWatchLogsClient;
use aws_sdk_dynamodb::types::AttributeValue;
use aws_sdk_sesv2::Client as SesClient;
use chrono::{Duration, Utc};
use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use newsletter::admin::aws_clients;
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::env;
use tokio::sync::OnceCell;
use tokio::task::JoinSet;
use tokio::time::{sleep, Duration as TokioDuration};

static LOGS_CLIENT: OnceCell<CloudWatchLogsClient> = OnceCell::const_new();
static SES_CLIENT: OnceCell<SesClient> = OnceCell::const_new();

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TimeRange {
    start_time: i64,
    end_time: i64,
    start_time_iso: String,
    end_time_iso: String,
}

#[derive(Clone, Debug)]
struct UnsubscribeEvent {
    email: String,
    tenant_id: String,
}

#[derive(Default)]
struct ProcessingResults {
    successful: Vec<ProcessResult>,
    failed: Vec<ProcessResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessResult {
    #[serde(rename = "type")]
    result_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tenant_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    removed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl ProcessResult {
    fn success(email: String, tenant_id: String, removed_at: String) -> Self {
        Self {
            result_type: "successful".to_string(),
            email: Some(email),
            tenant_id: Some(tenant_id),
            removed_at: Some(removed_at),
            error: None,
        }
    }

    fn failed(email: Option<String>, tenant_id: Option<String>, error: String) -> Self {
        Self {
            result_type: "failed".to_string(),
            email,
            tenant_id,
            removed_at: None,
            error: Some(error),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    processed_at: String,
    time_range: TimeRange,
    total_log_events: usize,
    unique_unsubscribe_attempts: usize,
    successful: usize,
    failed: usize,
}

async fn function_handler(_event: LambdaEvent<Value>) -> Result<Value, Error> {
    match process_unsubscribe_logs().await {
        Ok(report) => {
            let body = serde_json::to_string(&report)?;
            Ok(json!({
                "statusCode": 200,
                "body": body
            }))
        }
        Err(err) => {
            tracing::error!(error = %err, "Processing failed");
            let body = json!({
                "error": "Failed to process unsubscribe logs",
                "message": err
            })
            .to_string();
            Ok(json!({
                "statusCode": 500,
                "body": body
            }))
        }
    }
}

async fn process_unsubscribe_logs() -> Result<Report, String> {
    let time_range = create_time_range();
    let log_group_name = env::var("UNSUBSCRIBE_LOG_GROUP_NAME")
        .map_err(|err| format!("UNSUBSCRIBE_LOG_GROUP_NAME not set: {}", err))?;

    tracing::info!(
        start = %time_range.start_time_iso,
        end = %time_range.end_time_iso,
        "Processing unsubscribe logs"
    );

    let log_events =
        query_unsubscribe_logs(&log_group_name, time_range.start_time, time_range.end_time).await?;
    let unsubscribe_events = parse_unsubscribe_events(&log_events);
    let processing_results = process_unsubscribe_events(unsubscribe_events.clone()).await;

    Ok(Report {
        processed_at: Utc::now().to_rfc3339(),
        time_range,
        total_log_events: log_events.len(),
        unique_unsubscribe_attempts: unsubscribe_events.len(),
        successful: processing_results.successful.len(),
        failed: processing_results.failed.len(),
    })
}

fn create_time_range() -> TimeRange {
    let end = Utc::now();
    let start = end - Duration::days(7);

    TimeRange {
        start_time: start.timestamp(),
        end_time: end.timestamp(),
        start_time_iso: start.to_rfc3339(),
        end_time_iso: end.to_rfc3339(),
    }
}

async fn query_unsubscribe_logs(
    log_group_name: &str,
    start_time: i64,
    end_time: i64,
) -> Result<Vec<Vec<ResultField>>, String> {
    let query = r#"
        fields @timestamp, @message
        | filter @message like /tenantId/ and @message like /emailAddress/
        | sort @timestamp desc
        | limit 10000
    "#;

    let client = get_logs_client().await;
    let start_response = client
        .start_query()
        .log_group_name(log_group_name)
        .start_time(start_time)
        .end_time(end_time)
        .query_string(query)
        .limit(10000)
        .send()
        .await
        .map_err(|err| format!("Failed to start CloudWatch Logs query: {}", err))?;

    let query_id = start_response
        .query_id()
        .ok_or_else(|| "CloudWatch Logs queryId missing".to_string())?
        .to_string();

    let mut all_results: Vec<Vec<ResultField>> = Vec::new();
    let _next_token: Option<String> = None;
    let mut poll_attempts = 0;
    let max_poll_attempts = 60;

    loop {
        if poll_attempts >= max_poll_attempts {
            return Err("CloudWatch Logs query timed out after 60 seconds".to_string());
        }

        sleep(TokioDuration::from_secs(1)).await;
        poll_attempts += 1;

        let response = client
            .get_query_results()
            .query_id(&query_id)
            .send()
            .await
            .map_err(|err| format!("Failed to get CloudWatch Logs query results: {}", err))?;

        let status = response.status().unwrap_or(&QueryStatus::Running);
        match status {
            QueryStatus::Complete => {
                all_results.extend_from_slice(response.results());
                break;
            }
            QueryStatus::Failed | QueryStatus::Cancelled => {
                return Err(format!(
                    "CloudWatch Logs query {}",
                    status.as_str().to_lowercase()
                ));
            }
            _ => {}
        }
    }

    tracing::info!("Found {} log events", all_results.len());
    Ok(all_results)
}

fn parse_unsubscribe_events(log_events: &[Vec<ResultField>]) -> Vec<UnsubscribeEvent> {
    let email_regex =
        Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").unwrap_or_else(|_| Regex::new(r".*").unwrap());
    let mut unsubscribe_events = Vec::new();
    let mut seen = HashSet::new();

    for log_event in log_events {
        let message = extract_field_value(log_event, "@message");

        let message = match message {
            Some(value) => value,
            None => continue,
        };

        let json_start = match message.find('{') {
            Some(index) => index,
            None => continue,
        };

        let json_part = &message[json_start..];
        let log_data: Value = match serde_json::from_str(json_part) {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!(error = %err, "Failed to parse log entry");
                continue;
            }
        };

        let email_address = log_data
            .get("emailAddress")
            .and_then(|value| value.as_str())
            .map(|value| value.to_lowercase());
        let tenant_id = log_data
            .get("tenantId")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());

        let (email_address, tenant_id) = match (email_address, tenant_id) {
            (Some(email), Some(tenant)) => (email, tenant),
            _ => continue,
        };

        if !email_regex.is_match(&email_address) {
            continue;
        }

        let email_key = format!("{}:{}", tenant_id, email_address);
        if seen.contains(&email_key) {
            continue;
        }
        seen.insert(email_key);

        unsubscribe_events.push(UnsubscribeEvent {
            email: email_address,
            tenant_id,
        });
    }

    unsubscribe_events
}

fn extract_field_value(fields: &[ResultField], name: &str) -> Option<String> {
    fields
        .iter()
        .find(|field| field.field().unwrap_or_default() == name)
        .and_then(|field| field.value().map(|value| value.to_string()))
}

async fn process_unsubscribe_events(
    unsubscribe_events: Vec<UnsubscribeEvent>,
) -> ProcessingResults {
    let mut results = ProcessingResults::default();

    let mut events_by_tenant: HashMap<String, Vec<UnsubscribeEvent>> = HashMap::new();
    for event in unsubscribe_events {
        events_by_tenant
            .entry(event.tenant_id.clone())
            .or_default()
            .push(event);
    }

    for (tenant_id, events) in events_by_tenant {
        let tenant_results = process_tenant_unsubscribes(&tenant_id, &events).await;
        results.successful.extend(tenant_results.successful);
        results.failed.extend(tenant_results.failed);
    }

    results
}

async fn process_tenant_unsubscribes(
    tenant_id: &str,
    events: &[UnsubscribeEvent],
) -> ProcessingResults {
    let mut results = ProcessingResults::default();
    tracing::info!(
        "Processing {} events for tenant {}",
        events.len(),
        tenant_id
    );

    let batch_size = 10;
    let mut index = 0;

    while index < events.len() {
        let batch = &events[index..usize::min(index + batch_size, events.len())];
        let mut join_set = JoinSet::new();

        for event in batch.iter().cloned() {
            let tenant = tenant_id.to_string();
            join_set.spawn(async move {
                match process_individual_unsubscribe(&tenant, &event).await {
                    Ok(result) => result,
                    Err(err) => ProcessResult::failed(Some(event.email.clone()), Some(tenant), err),
                }
            });
        }

        while let Some(join_result) = join_set.join_next().await {
            match join_result {
                Ok(result) => {
                    if result.result_type == "successful" {
                        results.successful.push(result);
                    } else {
                        results.failed.push(result);
                    }
                }
                Err(err) => {
                    results
                        .failed
                        .push(ProcessResult::failed(None, None, err.to_string()));
                }
            }
        }

        if index + batch_size < events.len() {
            sleep(TokioDuration::from_millis(100)).await;
        }

        index += batch_size;
    }

    tracing::info!(
        "Tenant {}: {} processed, {} failed",
        tenant_id,
        results.successful.len(),
        results.failed.len()
    );

    results
}

async fn process_individual_unsubscribe(
    tenant_id: &str,
    event: &UnsubscribeEvent,
) -> Result<ProcessResult, String> {
    let success = unsubscribe_user(tenant_id, &event.email, "log-processor").await;

    if success {
        Ok(ProcessResult::success(
            event.email.clone(),
            tenant_id.to_string(),
            Utc::now().to_rfc3339(),
        ))
    } else {
        Err("Processing failed: Unsubscribe failed".to_string())
    }
}

async fn unsubscribe_user(tenant_id: &str, email_address: &str, method: &str) -> bool {
    let tenant_list = match get_tenant_list(tenant_id).await {
        Some(list) => list,
        None => {
            tracing::error!("Tenant not found: {}", tenant_id);
            return false;
        }
    };

    let table_name = match env::var("TABLE_NAME") {
        Ok(value) => value,
        Err(err) => {
            tracing::error!(error = %err, "TABLE_NAME not set");
            return false;
        }
    };

    let now = Utc::now();
    let ttl = (now + Duration::days(30)).timestamp();

    let mut item = HashMap::new();
    item.insert(
        "pk".to_string(),
        AttributeValue::S(format!("{}#recent-unsubscribes", tenant_id)),
    );
    item.insert(
        "sk".to_string(),
        AttributeValue::S(email_address.to_lowercase()),
    );
    item.insert(
        "email".to_string(),
        AttributeValue::S(email_address.to_string()),
    );
    item.insert(
        "unsubscribedAt".to_string(),
        AttributeValue::S(now.to_rfc3339()),
    );
    item.insert("ttl".to_string(), AttributeValue::N(ttl.to_string()));
    item.insert("method".to_string(), AttributeValue::S(method.to_string()));

    let ddb_client = aws_clients::get_dynamodb_client().await;
    let put_result = ddb_client
        .put_item()
        .table_name(&table_name)
        .set_item(Some(item))
        .send()
        .await;

    if let Err(err) = put_result {
        let is_conditional = err
            .as_service_error()
            .map(|service_error| {
                matches!(
                    service_error,
                    aws_sdk_dynamodb::operation::put_item::PutItemError::ConditionalCheckFailedException(_)
                )
            })
            .unwrap_or(false);

        if is_conditional {
            tracing::info!(
                tenant_id = %tenant_id,
                email = "[REDACTED]",
                "Email already unsubscribed"
            );
            return true;
        }

        tracing::error!(error = %err, "Unsubscribe failed");
        return false;
    }

    let ses_client = get_ses_client().await;
    let delete_result = ses_client
        .delete_contact()
        .contact_list_name(&tenant_list)
        .email_address(email_address)
        .send()
        .await;

    match delete_result {
        Ok(_) => {
            tracing::info!(
                tenant_id = %tenant_id,
                email_address = %email_address,
                ses_removed = true,
                "Unsubscribe successful"
            );
        }
        Err(err) => {
            let is_not_found = err
                .as_service_error()
                .map(|service_error| {
                    matches!(
                        service_error,
                        aws_sdk_sesv2::operation::delete_contact::DeleteContactError::NotFoundException(_)
                    )
                })
                .unwrap_or(false);

            if is_not_found {
                tracing::info!(
                    tenant_id = %tenant_id,
                    email_address = %email_address,
                    ses_removed = "already_removed",
                    "Unsubscribe successful"
                );
            } else {
                tracing::error!(
                    tenant_id = %tenant_id,
                    email_address = %email_address,
                    error = %err,
                    "SES removal failed but unsubscribe protected"
                );
            }
        }
    }

    true
}

async fn get_tenant_list(tenant_id: &str) -> Option<String> {
    let table_name = env::var("TABLE_NAME").ok()?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let response = ddb_client
        .get_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S("tenant".to_string()))
        .send()
        .await
        .ok()?;

    let item = response.item()?;
    item.get("list")
        .and_then(|value| value.as_s().ok())
        .map(|value| value.to_string())
}

async fn get_logs_client() -> &'static CloudWatchLogsClient {
    LOGS_CLIENT
        .get_or_init(|| async {
            let config = aws_config::load_from_env().await;
            CloudWatchLogsClient::new(&config)
        })
        .await
}

async fn get_ses_client() -> &'static SesClient {
    SES_CLIENT
        .get_or_init(|| async {
            let config = aws_config::load_from_env().await;
            SesClient::new(&config)
        })
        .await
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    run(service_fn(function_handler)).await
}
