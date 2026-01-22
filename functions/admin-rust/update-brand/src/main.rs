use aws_sdk_cognitoidentityprovider::operation::admin_update_user_attributes::AdminUpdateUserAttributesError;
use aws_sdk_dynamodb::types::{AttributeValue, ReturnValue};
use aws_sdk_eventbridge::Client as EventBridgeClient;
use chrono::Utc;
use lambda_http::{run, service_fn, Body, Error, Request, Response};
use rand::RngCore;
use serde_json::{json, Value};
use shared::{aws_clients, format_response, get_user_context};
use std::collections::HashMap;
use std::env;
use tokio::sync::OnceCell;

static EVENTBRIDGE_CLIENT: OnceCell<EventBridgeClient> = OnceCell::const_new();

#[derive(Debug)]
enum UpdateBrandError {
    Unauthorized,
    Conflict(String),
    NotFound(String),
    Internal(String),
}

#[derive(Debug, Default)]
struct BrandData {
    fields: HashMap<String, Value>,
}

impl BrandData {
    fn has(&self, key: &str) -> bool {
        self.fields.contains_key(key)
    }

    fn get_value(&self, key: &str) -> Option<&Value> {
        self.fields.get(key)
    }

    fn get_string(&self, key: &str) -> Option<String> {
        self.fields
            .get(key)
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
    }

    fn updated_fields(&self) -> Vec<String> {
        let order = [
            "brandId",
            "brandName",
            "website",
            "industry",
            "brandDescription",
            "brandLogo",
            "tags",
        ];
        let mut keys = Vec::new();
        for key in order {
            if self.has(key) {
                keys.push(key.to_string());
            }
        }
        keys
    }
}

async fn function_handler(event: Request) -> Result<Response<Body>, Error> {
    match handle_request(event).await {
        Ok(response) => Ok(response),
        Err(err) => {
            tracing::error!(error = ?err, "Update brand error");
            Ok(format_error_response(err))
        }
    }
}

async fn handle_request(event: Request) -> Result<Response<Body>, UpdateBrandError> {
    let user_context = get_user_context(&event).map_err(|_| UpdateBrandError::Unauthorized)?;
    let user_id = user_context.user_id;
    let email = user_context.email;
    let mut tenant_id = user_context.tenant_id;

    let body = parse_body(&event)?;
    let brand_data = extract_brand_data(&body);

    let has_brand_already = tenant_id.is_some();
    let is_first_time_brand_save = !has_brand_already && brand_data.has("brandId");

    if is_first_time_brand_save {
        let brand_id = brand_data
            .get_string("brandId")
            .ok_or_else(|| UpdateBrandError::Internal("Brand ID is required".to_string()))?;

        let is_available = check_brand_id_availability(&brand_id).await;
        if !is_available {
            return Err(UpdateBrandError::Conflict(format!(
                "Brand ID '{}' is already taken",
                brand_id
            )));
        }

        tenant_id = Some(brand_id.clone());
        create_tenant_with_brand_data(&brand_id, &user_id, &brand_data).await?;
        set_user_tenant_id(&email, &brand_id).await?;
        trigger_tenant_finalization_workflows(&brand_id, &user_id).await?;
    } else if let Some(existing_tenant) = tenant_id.clone() {
        update_brand_info(&existing_tenant, &brand_data).await?;
    } else {
        return Err(UpdateBrandError::Internal(
            "Tenant ID missing for brand update".to_string(),
        ));
    }

    let final_tenant_id = tenant_id.ok_or_else(|| {
        UpdateBrandError::Internal("Tenant ID missing after update".to_string())
    })?;

    publish_brand_event(&final_tenant_id, &user_id, &brand_data, is_first_time_brand_save).await;

    format_empty_response()
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    run(service_fn(function_handler)).await
}

fn parse_body(event: &Request) -> Result<Value, UpdateBrandError> {
    match event.body() {
        Body::Text(text) => serde_json::from_str(text)
            .map_err(|err| UpdateBrandError::Internal(format!("Invalid JSON body: {}", err))),
        Body::Binary(bytes) => serde_json::from_slice(bytes)
            .map_err(|err| UpdateBrandError::Internal(format!("Invalid JSON body: {}", err))),
        Body::Empty => Ok(json!({})),
    }
}

fn extract_brand_data(body: &Value) -> BrandData {
    let mut data = BrandData::default();
    let Value::Object(map) = body else {
        return data;
    };

    let keys = [
        "brandId",
        "brandName",
        "website",
        "industry",
        "brandDescription",
        "brandLogo",
        "tags",
    ];

    for key in keys {
        if map.contains_key(key) {
            data.fields.insert(
                key.to_string(),
                map.get(key).cloned().unwrap_or(Value::Null),
            );
        }
    }

    data
}

async fn update_brand_info(tenant_id: &str, brand_data: &BrandData) -> Result<(), UpdateBrandError> {
    let updated_at = Utc::now().to_rfc3339();
    let mut update_data: HashMap<String, Value> = HashMap::new();
    update_data.insert("updatedAt".to_string(), Value::String(updated_at));

    let fields_to_update = [
        "brandName",
        "website",
        "industry",
        "brandDescription",
        "tags",
        "brandLogo",
    ];

    for field in fields_to_update {
        if brand_data.has(field) {
            let value = brand_data
                .get_value(field)
                .cloned()
                .unwrap_or(Value::Null);
            if field == "brandName" {
                update_data.insert("name".to_string(), value);
            } else {
                update_data.insert(field.to_string(), value);
            }
        }
    }

    let (update_expression, attribute_names, attribute_values) =
        build_update_expression(&update_data);

    let Some(update_expression) = update_expression else {
        return Ok(());
    };

    let table_name = env::var("TABLE_NAME")
        .map_err(|err| UpdateBrandError::Internal(format!("TABLE_NAME not set: {}", err)))?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let update_result = ddb_client
        .update_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S("tenant".to_string()))
        .update_expression(update_expression)
        .set_expression_attribute_names(Some(attribute_names))
        .set_expression_attribute_values(Some(attribute_values))
        .return_values(ReturnValue::AllOld)
        .send()
        .await
        .map_err(|err| UpdateBrandError::Internal(format!("DynamoDB update failed: {}", err)))?;

    if brand_data.has("brandLogo") {
        if let Some(attributes) = update_result.attributes() {
            if let Some(old_logo) = attributes
                .get("brandLogo")
                .and_then(|value| value.as_s().ok())
            {
                let new_logo = brand_data.get_string("brandLogo");
                if new_logo.as_deref() != Some(old_logo) {
                    if let Err(err) = trigger_s3_cleanup(old_logo).await {
                        tracing::error!(error = %err, "Failed to trigger S3 cleanup event");
                    }
                }
            }
        }
    }

    Ok(())
}

async fn check_brand_id_availability(brand_id: &str) -> bool {
    let table_name = match env::var("TABLE_NAME") {
        Ok(value) => value,
        Err(err) => {
            tracing::error!(error = %err, "TABLE_NAME not set");
            return false;
        }
    };

    let ddb_client = aws_clients::get_dynamodb_client().await;
    let response = ddb_client
        .get_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(brand_id.to_string()))
        .key("sk", AttributeValue::S("tenant".to_string()))
        .send()
        .await;

    match response {
        Ok(output) => output.item().is_none(),
        Err(err) => {
            tracing::error!(error = %err, "Error checking brand ID availability");
            false
        }
    }
}

async fn create_tenant_with_brand_data(
    tenant_id: &str,
    user_id: &str,
    brand_data: &BrandData,
) -> Result<(), UpdateBrandError> {
    let now = Utc::now().to_rfc3339();
    let name = brand_data
        .get_string("brandName")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Unknown".to_string());

    let mut item: HashMap<String, AttributeValue> = HashMap::new();
    item.insert("pk".to_string(), AttributeValue::S(tenant_id.to_string()));
    item.insert("sk".to_string(), AttributeValue::S("tenant".to_string()));
    item.insert("name".to_string(), AttributeValue::S(name));
    item.insert(
        "createdBy".to_string(),
        AttributeValue::S(user_id.to_string()),
    );
    item.insert("createdAt".to_string(), AttributeValue::S(now.clone()));
    item.insert("updatedAt".to_string(), AttributeValue::S(now.clone()));
    item.insert("status".to_string(), AttributeValue::S("pending".to_string()));
    item.insert("subscribers".to_string(), AttributeValue::N("0".to_string()));
    item.insert("GSI1PK".to_string(), AttributeValue::S("tenant".to_string()));
    item.insert("GSI1SK".to_string(), AttributeValue::S(tenant_id.to_string()));

    if let Some(value) = brand_data.get_string("website").filter(|v| !v.is_empty()) {
        item.insert("website".to_string(), AttributeValue::S(value));
    }
    if let Some(value) = brand_data.get_string("industry").filter(|v| !v.is_empty()) {
        item.insert("industry".to_string(), AttributeValue::S(value));
    }
    if let Some(value) = brand_data
        .get_string("brandDescription")
        .filter(|v| !v.is_empty())
    {
        item.insert("brandDescription".to_string(), AttributeValue::S(value));
    }
    if let Some(value) = brand_data.get_string("brandLogo").filter(|v| !v.is_empty()) {
        item.insert("brandLogo".to_string(), AttributeValue::S(value));
    }
    if let Some(tags_value) = brand_data.get_value("tags") {
        if !tags_value.is_null() {
            item.insert("tags".to_string(), value_to_attribute(tags_value));
        }
    }

    let table_name = env::var("TABLE_NAME")
        .map_err(|err| UpdateBrandError::Internal(format!("TABLE_NAME not set: {}", err)))?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    ddb_client
        .put_item()
        .table_name(&table_name)
        .set_item(Some(item))
        .condition_expression("attribute_not_exists(pk)")
        .send()
        .await
        .map_err(|err| UpdateBrandError::Internal(format!("DynamoDB put failed: {}", err)))?;

    tracing::info!(
        tenant_id = %tenant_id,
        user_id = %user_id,
        "Tenant created with brand data"
    );

    Ok(())
}

async fn set_user_tenant_id(email: &str, tenant_id: &str) -> Result<(), UpdateBrandError> {
    let user_pool_id = env::var("USER_POOL_ID")
        .map_err(|err| UpdateBrandError::Internal(format!("USER_POOL_ID not set: {}", err)))?;
    let cognito_client = aws_clients::get_cognito_client().await;

    let result = cognito_client
        .admin_update_user_attributes()
        .user_pool_id(user_pool_id)
        .username(email)
        .user_attributes(
            aws_sdk_cognitoidentityprovider::types::AttributeType::builder()
                .name("custom:tenant_id")
                .value(tenant_id)
                .build()
                .map_err(|err| UpdateBrandError::Internal(format!("Invalid attribute: {}", err)))?,
        )
        .send()
        .await;

    if let Err(err) = result {
        if let Some(service_err) = err.as_service_error() {
            if let AdminUpdateUserAttributesError::UserNotFoundException(_) = service_err {
                return Err(UpdateBrandError::NotFound("User not found".to_string()));
            }
        }

        return Err(UpdateBrandError::Internal(format!(
            "Cognito update failed: {}",
            err
        )));
    }

    tracing::info!(email = %email, tenant_id = %tenant_id, "User tenant ID set");
    Ok(())
}

async fn trigger_tenant_finalization_workflows(
    tenant_id: &str,
    user_id: &str,
) -> Result<(), UpdateBrandError> {
    let event_bridge = get_eventbridge_client().await;
    event_bridge
        .put_events()
        .entries(
            aws_sdk_eventbridge::types::PutEventsRequestEntry::builder()
                .source("newsletter.tenant")
                .detail_type("Tenant Finalized")
                .detail(
                    json!({
                        "tenantId": tenant_id,
                        "userId": user_id
                    })
                    .to_string(),
                )
                .build(),
        )
        .send()
        .await
        .map_err(|err| UpdateBrandError::Internal(format!("EventBridge error: {}", err)))?;

    tracing::info!(tenant_id = %tenant_id, "Tenant finalization event emitted");
    Ok(())
}

async fn publish_brand_event(
    tenant_id: &str,
    user_id: &str,
    brand_data: &BrandData,
    is_first_time: bool,
) {
    let event_bridge = get_eventbridge_client().await;
    let correlation_id = generate_correlation_id();
    let timestamp = Utc::now().to_rfc3339();

    let mut data = serde_json::Map::new();
    data.insert("brandId".to_string(), json!(tenant_id));
    if let Some(value) = brand_data.get_value("brandName") {
        data.insert("brandName".to_string(), value.clone());
    }
    if let Some(value) = brand_data.get_value("website") {
        data.insert("website".to_string(), value.clone());
    }
    if let Some(value) = brand_data.get_value("industry") {
        data.insert("industry".to_string(), value.clone());
    }
    if let Some(value) = brand_data.get_value("brandDescription") {
        data.insert("brandDescription".to_string(), value.clone());
    }
    if let Some(value) = brand_data.get_value("brandLogo") {
        data.insert("brandLogo".to_string(), value.clone());
    }
    if let Some(value) = brand_data.get_value("tags") {
        data.insert("tags".to_string(), value.clone());
    }
    data.insert("isFirstTime".to_string(), json!(is_first_time));
    data.insert("updatedAt".to_string(), json!(Utc::now().to_rfc3339()));
    data.insert(
        "updatedFields".to_string(),
        json!(brand_data.updated_fields()),
    );

    let detail = json!({
        "tenantId": tenant_id,
        "userId": user_id,
        "type": "BRAND_UPDATED",
        "data": Value::Object(data),
        "correlationId": correlation_id,
        "timestamp": timestamp
    });

    let result = event_bridge
        .put_events()
        .entries(
            aws_sdk_eventbridge::types::PutEventsRequestEntry::builder()
                .source("newsletter.api")
                .detail_type("Brand Updated")
                .detail(detail.to_string())
                .build(),
        )
        .send()
        .await;

    if let Err(err) = result {
        tracing::error!(error = %err, "Failed to publish brand event");
    }
}

async fn trigger_s3_cleanup(logo_url: &str) -> Result<(), String> {
    let key = extract_s3_key(logo_url)?;
    if !key.starts_with("brand-logos/") {
        tracing::warn!(key = %key, "Skipping cleanup for non-brand-logo file");
        return Ok(());
    }

    let bucket_name = env::var("HOSTING_BUCKET_NAME")
        .map_err(|err| format!("HOSTING_BUCKET_NAME not set: {}", err))?;

    let detail = json!({
        "action": "delete",
        "assetType": "brand-logo",
        "s3Url": logo_url,
        "s3Key": key,
        "bucketName": bucket_name,
        "triggeredBy": "brand-update",
        "timestamp": Utc::now().to_rfc3339()
    });

    let event_bridge = get_eventbridge_client().await;
    event_bridge
        .put_events()
        .entries(
            aws_sdk_eventbridge::types::PutEventsRequestEntry::builder()
                .source("newsletter-service")
                .detail_type("S3 Asset Cleanup")
                .detail(detail.to_string())
                .build(),
        )
        .send()
        .await
        .map_err(|err| format!("Failed to publish cleanup event: {}", err))?;

    tracing::info!(key = %key, "S3 cleanup event published");
    Ok(())
}

fn extract_s3_key(logo_url: &str) -> Result<String, String> {
    let without_scheme = match logo_url.split_once("://") {
        Some((_, rest)) => rest,
        None => logo_url,
    };

    let path_start = without_scheme
        .find('/')
        .ok_or_else(|| "Logo URL has no path".to_string())?;
    let path_with_query = &without_scheme[path_start + 1..];
    let path = path_with_query
        .split(['?', '#'])
        .next()
        .unwrap_or("");

    if path.is_empty() {
        return Err("Logo URL path is empty".to_string());
    }

    Ok(path.to_string())
}

fn build_update_expression(
    data: &HashMap<String, Value>,
) -> (
    Option<String>,
    HashMap<String, String>,
    HashMap<String, AttributeValue>,
) {
    let mut set_expressions = Vec::new();
    let mut remove_expressions = Vec::new();
    let mut expression_attribute_names = HashMap::new();
    let mut expression_attribute_values = HashMap::new();

    for (key, value) in data {
        let attribute_name = format!("#{}", key);
        let attribute_value = format!(":{}", key);
        expression_attribute_names.insert(attribute_name.clone(), key.clone());

        let should_remove = match value {
            Value::Null => true,
            Value::String(s) => s.trim().is_empty(),
            Value::Array(arr) => arr.is_empty(),
            _ => false,
        };

        if should_remove {
            remove_expressions.push(attribute_name);
        } else {
            set_expressions.push(format!("{} = {}", attribute_name, attribute_value));
            expression_attribute_values.insert(attribute_value, value_to_attribute(value));
        }
    }

    let mut expressions = Vec::new();
    if !set_expressions.is_empty() {
        expressions.push(format!("SET {}", set_expressions.join(", ")));
    }
    if !remove_expressions.is_empty() {
        expressions.push(format!("REMOVE {}", remove_expressions.join(", ")));
    }

    let update_expression = if expressions.is_empty() {
        None
    } else {
        Some(expressions.join(" "))
    };

    (
        update_expression,
        expression_attribute_names,
        expression_attribute_values,
    )
}

fn value_to_attribute(value: &Value) -> AttributeValue {
    match value {
        Value::Null => AttributeValue::Null(true),
        Value::Bool(b) => AttributeValue::Bool(*b),
        Value::Number(num) => AttributeValue::N(num.to_string()),
        Value::String(s) => AttributeValue::S(s.to_string()),
        Value::Array(items) => AttributeValue::L(items.iter().map(value_to_attribute).collect()),
        Value::Object(map) => AttributeValue::M(
            map.iter()
                .map(|(k, v)| (k.clone(), value_to_attribute(v)))
                .collect(),
        ),
    }
}

fn format_empty_response() -> Result<Response<Body>, UpdateBrandError> {
    let mut builder = Response::builder().status(204);
    if let Ok(origin) = env::var("ORIGIN") {
        builder = builder.header("Access-Control-Allow-Origin", origin);
    }

    builder
        .body(Body::Empty)
        .map_err(|err| UpdateBrandError::Internal(format!("Response build failed: {}", err)))
}

fn format_error_response(err: UpdateBrandError) -> Response<Body> {
    let (status, message) = match err {
        UpdateBrandError::Unauthorized => (403, "Authentication required".to_string()),
        UpdateBrandError::Conflict(message) => (409, message),
        UpdateBrandError::NotFound(_) => (404, "User not found".to_string()),
        UpdateBrandError::Internal(_) => (500, "Failed to update brand details".to_string()),
    };

    format_response(status, json!({ "message": message }))
        .unwrap_or_else(|_| Response::builder().status(500).body(Body::Empty).unwrap())
}

fn generate_correlation_id() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

async fn get_eventbridge_client() -> &'static EventBridgeClient {
    EVENTBRIDGE_CLIENT
        .get_or_init(|| async {
            let config = aws_config::load_from_env().await;
            EventBridgeClient::new(&config)
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_brand_data_tracks_fields() {
        let body = json!({
            "brandName": "Acme",
            "website": "https://acme.test",
            "tags": ["a", "b"]
        });

        let data = extract_brand_data(&body);
        assert!(data.has("brandName"));
        assert!(data.has("website"));
        assert!(data.has("tags"));
        assert_eq!(data.updated_fields(), vec!["brandName", "website", "tags"]);
    }

    #[test]
    fn build_update_expression_sets_and_removes() {
        let mut data = HashMap::new();
        data.insert("name".to_string(), Value::String("Brand".to_string()));
        data.insert("website".to_string(), Value::String("".to_string()));
        data.insert("tags".to_string(), Value::Array(vec![]));

        let (expr, names, values) = build_update_expression(&data);
        let expr = expr.expect("expression");
        assert!(expr.contains("SET"));
        assert!(expr.contains("REMOVE"));
        assert!(names.contains_key("#name"));
        assert!(names.contains_key("#website"));
        assert!(names.contains_key("#tags"));
        assert!(values.contains_key(":name"));
        assert!(!values.contains_key(":website"));
        assert!(!values.contains_key(":tags"));
    }

    #[test]
    fn extract_s3_key_handles_query() {
        let url = "https://bucket.s3.amazonaws.com/brand-logos/tenant/logo.png?versionId=1";
        let key = extract_s3_key(url).expect("key");
        assert_eq!(key, "brand-logos/tenant/logo.png");
    }
}
