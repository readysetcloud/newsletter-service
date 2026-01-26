use aws_sdk_dynamodb::types::AttributeValue;
use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use newsletter_lambdas::ai::{
    converse, get_create_insights_tool, get_dynamodb_client, ConverseOptions, FunctionError,
    GenerateInsightsEvent, GenerateInsightsResponse,
};
use serde_json::Value;

async fn function_handler(
    event: LambdaEvent<GenerateInsightsEvent>,
) -> Result<GenerateInsightsResponse, Error> {
    let payload = event.payload;

    // Validate required fields
    if payload.tenant_id.is_empty() {
        return Err(Box::new(FunctionError::MissingField(
            "tenantId".to_string(),
        )));
    }
    if payload.issue_id.is_empty() {
        return Err(Box::new(FunctionError::MissingField("issueId".to_string())));
    }

    // Get historical data
    let historical_data = get_historical_data(&payload.tenant_id, &payload.issue_id).await?;

    // Construct prompts
    let system_prompt = get_insights_system_prompt();
    let user_prompt = format!(
        "## Issue Id: {}\n\n## Subject Line: {}\n\n## Current Issue Data\n{}\n\n## Historical Issues\n{}",
        payload.issue_id,
        payload.subject_line.as_deref().unwrap_or("N/A"),
        serde_json::to_string_pretty(&payload.insight_data)
            .map_err(|e| FunctionError::Json(e.to_string()))?,
        serde_json::to_string_pretty(&historical_data)
            .map_err(|e| FunctionError::Json(e.to_string()))?
    );

    // Get model ID from environment
    let model_id = std::env::var("MODEL_ID")
        .map_err(|_| FunctionError::MissingField("MODEL_ID".to_string()))?;

    // Invoke Bedrock with tool
    let tools = vec![get_create_insights_tool()];
    let options = ConverseOptions {
        tenant_id: payload.tenant_id.clone(),
        user_id: None,
    };

    converse(&model_id, &system_prompt, &user_prompt, tools, options).await?;

    // Load insights from DynamoDB
    let insights = load_insights(&payload.tenant_id, &payload.issue_id).await?;

    Ok(GenerateInsightsResponse { insights })
}

async fn get_historical_data(tenant_id: &str, issue_id: &str) -> Result<Vec<Value>, FunctionError> {
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| FunctionError::MissingField("TABLE_NAME".to_string()))?;

    let ddb_client = get_dynamodb_client().await;

    let gsi1_pk = format!("{}#analytics", tenant_id);

    let response = ddb_client
        .query()
        .table_name(&table_name)
        .index_name("GSI1")
        .key_condition_expression("#pk = :pk")
        .expression_attribute_names("#pk", "GSI1PK")
        .expression_attribute_values(":pk", AttributeValue::S(gsi1_pk))
        .scan_index_forward(false)
        .limit(4)
        .send()
        .await
        .map_err(|e| FunctionError::DynamoDb(e.to_string()))?;

    let this_issue = format!("{}#{}", tenant_id, issue_id);
    let items = response.items.as_deref().unwrap_or(&[]);

    let mut historical_data = Vec::new();
    for item in items {
        let pk = item
            .get("pk")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.as_str())
            .unwrap_or("");

        if pk != this_issue.as_str() {
            // Convert DynamoDB item to JSON manually
            let mut data = attribute_map_to_json(item)?;

            // Transform data: remove internal fields and add deliveredDate
            if let Some(obj) = data.as_object_mut() {
                if let Some(gsi1sk) = obj.remove("GSI1SK") {
                    obj.insert("deliveredDate".to_string(), gsi1sk);
                }
                obj.remove("sk");
                obj.remove("GSI1PK");
                obj.remove("pk");
            }

            historical_data.push(data);

            if historical_data.len() >= 3 {
                break;
            }
        }
    }

    Ok(historical_data)
}

fn attribute_map_to_json(
    item: &std::collections::HashMap<String, AttributeValue>,
) -> Result<Value, FunctionError> {
    let mut map = serde_json::Map::new();
    for (key, value) in item {
        map.insert(key.clone(), attribute_value_to_json(value)?);
    }
    Ok(Value::Object(map))
}

fn attribute_value_to_json(value: &AttributeValue) -> Result<Value, FunctionError> {
    match value {
        AttributeValue::S(s) => Ok(Value::String(s.clone())),
        AttributeValue::N(n) => {
            // Try to parse as integer first, then as float
            if let Ok(i) = n.parse::<i64>() {
                Ok(Value::Number(i.into()))
            } else if let Ok(f) = n.parse::<f64>() {
                Ok(serde_json::Number::from_f64(f)
                    .map(Value::Number)
                    .unwrap_or(Value::String(n.clone())))
            } else {
                Ok(Value::String(n.clone()))
            }
        }
        AttributeValue::Bool(b) => Ok(Value::Bool(*b)),
        AttributeValue::Null(_) => Ok(Value::Null),
        AttributeValue::L(list) => {
            let mut arr = Vec::new();
            for item in list {
                arr.push(attribute_value_to_json(item)?);
            }
            Ok(Value::Array(arr))
        }
        AttributeValue::M(map) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in map {
                obj.insert(k.clone(), attribute_value_to_json(v)?);
            }
            Ok(Value::Object(obj))
        }
        _ => Ok(Value::Null),
    }
}

async fn load_insights(tenant_id: &str, issue_id: &str) -> Result<Vec<String>, FunctionError> {
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| FunctionError::MissingField("TABLE_NAME".to_string()))?;

    let ddb_client = get_dynamodb_client().await;

    let pk = format!("{}#{}", tenant_id, issue_id);
    let sk = "analytics";

    let response = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(pk.clone()))
        .key("sk", AttributeValue::S(sk.to_string()))
        .consistent_read(true)
        .send()
        .await
        .map_err(|e| FunctionError::DynamoDb(e.to_string()))?;

    let item = match response.item() {
        Some(item) => item,
        None => {
            tracing::warn!(
                tenant_id = tenant_id,
                issue_id = issue_id,
                "Analytics were not generated for this issue"
            );
            return Ok(Vec::new());
        }
    };

    let insights_attr = match item.get("insights") {
        Some(attr) => attr,
        None => {
            tracing::warn!(
                tenant_id = tenant_id,
                issue_id = issue_id,
                "Insights were not generated for this issue"
            );
            return Ok(Vec::new());
        }
    };

    let insights = match insights_attr {
        AttributeValue::L(list) => list
            .iter()
            .filter_map(|v| v.as_s().ok().map(|s| s.to_string()))
            .collect(),
        _ => Vec::new(),
    };

    Ok(insights)
}

fn get_insights_system_prompt() -> String {
    r#"## Role
You are an analytics assistant for the Ready, Set, Cloud newsletter. Your job is to generate concise, actionable week-over-week insights from newsletter performance JSON.

## Input
You will receive:
1) "Issue Id": identifier to provide to the createInsightsTool
2) "Subject Line": the email subject line for this issue
3) "Current Issue Data": analytics JSON for the current newsletter issue including:
   - currentMetrics: core performance metrics (open rate, CTR, CTOR, bounce rate, growth rate, etc.)
   - benchmarks: 3-week rolling averages for comparison (openRateAvg3, ctrAvg3, bounceRateAvg3, growthRateAvg3)
   - healthScore: overall health assessment with score (0-100), status (Great/OK/Needs Attention), and summary
   - contentPerformance: click distribution analysis (topLinkPct, top3Pct, longTailPct, concentration level)
   - listHealth: deliverability metrics (deliverabilityRate, bounceRateStatus, cleanedPct, healthSummary)
   - engagementQuality: deeper engagement metrics (clicksPerOpener, clicksPerSubscriber, opensFirst1hPct, opensFirst6hPct)
   - trends: historical performance over last 4 issues with rolling averages and best-in-last-4 values
4) "Historical Issues": an array of prior issues in the same (or very similar) shape

Some fields may be missing. Use what is available. Do not invent exact metric values.

## Steps
1) Parse "Current Issue Data" and analyze performance using the enhanced data structure:
   - Review healthScore for overall status and key concerns
   - Compare current metrics against benchmarks (3-week averages) to identify significant deviations
   - Analyze contentPerformance to understand engagement patterns (concentrated vs broad)
   - Check listHealth for deliverability concerns or list quality issues
   - Examine engagementQuality for subscriber behavior patterns
   - Review trends data to identify patterns over the last 4 issues
   - Consider the subject line effectiveness based on open rate performance
2) Compare "Current Issue Data" against "Historical Issues" for additional context
3) Generate 2-5 insights that are:
   - specific to the metrics provided, leveraging the new benchmark and health data
   - actionable within the next issue (subject, structure, content mix, link strategy, deliverability/list hygiene)
   - phrased as a recommendation + short rationale tied to observed data
   - prioritized based on healthScore status and benchmark deviations
4) Focus on:
   - Metrics significantly above or below benchmarks (>10% deviation)
   - Health score concerns (if status is "Needs Attention" or "OK")
   - Content performance patterns (highly concentrated vs broad distribution)
   - List health issues (bounce rate elevated/high, low deliverability)
   - Engagement quality signals (low clicks per opener, slow open velocity)
   - Trend patterns (consistent decline, improvement, volatility)
   - Subject line effectiveness (if open rate is significantly different from benchmark, consider subject line impact)
5) Avoid generic advice. Each insight must reference at least one concrete metric or comparative observation (e.g., "Open rate 15% below 3-week average" or "Top link captured 60% of clicks indicating highly concentrated engagement").
6) Do not output more than 5 insights. Do not output fewer than 2 insights unless data is severely incomplete (then output 2 best-effort insights).
7) Do not mention internal IDs like pk/sk/GSI keys. Do not include raw URLs unless the topPerformingLink is directly relevant to an insight.

## Expectation
You MUST call the tool createInsights exactly once.
The tool payload must match this schema:
{
  "issueId": string,
  "insights": string[] // 2 to 5 items
}

## Narrowing / Output Rules
- Output ONLY a createInsights tool call (no prose, no markdown, no analysis).
- Keep each insight to 1-2 sentences. Prefer direct language.
- If "Historical Issues" is empty, generate insights from "Current Issue Data" using benchmarks and health score (still actionable).
- Prioritize insights based on health score status and benchmark deviations.
- When subject line is provided and open rate deviates significantly from benchmark, consider mentioning subject line effectiveness.
"#.to_string()
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    run(service_fn(function_handler)).await
}
