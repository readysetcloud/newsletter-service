use aws_sdk_dynamodb::types::AttributeValue;
use base64::Engine;
use chrono::{DateTime, Utc};
use lambda_http::{Body, Error, Request, RequestExt, Response};
use newsletter_lambdas::admin::{aws_clients, format_response};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env;

#[derive(Debug)]
enum ManageApiKeysError {
    Unauthorized,
    Validation(String),
    Other(String),
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CreateApiKeyRequest {
    name: Option<String>,
    description: Option<String>,
    expires_at: Option<String>,
    scopes: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiKeyListResponse {
    api_keys: Vec<serde_json::Value>,
    count: usize,
}

struct ApiKeyRecordInput<'a> {
    tenant_id: &'a str,
    user_id: &'a str,
    name: &'a str,
    description: Option<&'a str>,
    scopes: Option<Vec<String>>,
    key_id: &'a str,
    hashed_key: &'a str,
    expires_at: Option<&'a str>,
    ttl: Option<i64>,
}

pub async fn list_keys(event: Request) -> Result<Response<Body>, Error> {
    match handle_list_keys(event).await {
        Ok(response) => Ok(response),
        Err(err) => {
            tracing::error!(error = ?err, "List API keys error");
            Ok(format_error(err))
        }
    }
}

pub async fn create_key(event: Request) -> Result<Response<Body>, Error> {
    match handle_create_key(event).await {
        Ok(response) => Ok(response),
        Err(err) => {
            tracing::error!(error = ?err, "Create API key error");
            Ok(format_error(err))
        }
    }
}

pub async fn get_key(event: Request, key_id: Option<String>) -> Result<Response<Body>, Error> {
    match handle_get_key(event, key_id).await {
        Ok(response) => Ok(response),
        Err(err) => {
            tracing::error!(error = ?err, "Get API key error");
            Ok(format_error(err))
        }
    }
}

pub async fn delete_key(event: Request, key_id: Option<String>) -> Result<Response<Body>, Error> {
    match handle_delete_key(event, key_id).await {
        Ok(response) => Ok(response),
        Err(err) => {
            tracing::error!(error = ?err, "Delete API key error");
            Ok(format_error(err))
        }
    }
}

async fn handle_list_keys(event: Request) -> Result<Response<Body>, ManageApiKeysError> {
    let user_context = newsletter_lambdas::admin::get_user_context(&event)
        .map_err(|_| ManageApiKeysError::Unauthorized)?;
    let tenant_id = &user_context.tenant_id;

    list_api_keys(tenant_id).await
}

async fn handle_create_key(event: Request) -> Result<Response<Body>, ManageApiKeysError> {
    let user_context = newsletter_lambdas::admin::get_user_context(&event)
        .map_err(|_| ManageApiKeysError::Unauthorized)?;
    let tenant_id = user_context.tenant_id.clone();
    let user_id = user_context.user_id.clone();

    let body = parse_body(&event)?;
    create_api_key(&user_id, &tenant_id, body).await
}

async fn handle_get_key(
    event: Request,
    key_id: Option<String>,
) -> Result<Response<Body>, ManageApiKeysError> {
    let user_context = newsletter_lambdas::admin::get_user_context(&event)
        .map_err(|_| ManageApiKeysError::Unauthorized)?;
    let tenant_id = &user_context.tenant_id;

    let key_id = key_id
        .filter(|id| !id.is_empty())
        .ok_or_else(|| ManageApiKeysError::Other("\"keyId\" is required".to_string()))?;

    get_api_key(tenant_id, &key_id).await
}

async fn handle_delete_key(
    event: Request,
    key_id: Option<String>,
) -> Result<Response<Body>, ManageApiKeysError> {
    let user_context = newsletter_lambdas::admin::get_user_context(&event)
        .map_err(|_| ManageApiKeysError::Unauthorized)?;
    let tenant_id = &user_context.tenant_id;

    let key_id = key_id
        .filter(|id| !id.is_empty())
        .ok_or_else(|| ManageApiKeysError::Other("\"keyId\" is required".to_string()))?;

    let should_revoke = event
        .query_string_parameters()
        .first("revoke")
        .map(|value| value == "true")
        .unwrap_or(false);

    if should_revoke {
        revoke_api_key(tenant_id, &key_id).await
    } else {
        delete_api_key(tenant_id, &key_id).await
    }
}

fn format_error(err: ManageApiKeysError) -> Response<Body> {
    let (status, message) = match err {
        ManageApiKeysError::Unauthorized => (403, "Authentication required".to_string()),
        ManageApiKeysError::Validation(message) => (400, message),
        ManageApiKeysError::Other(message) => {
            tracing::error!(error = %message, "API key management internal error");
            (500, "Something went wrong".to_string())
        }
    };

    format_response(status, json!({ "message": message }))
        .unwrap_or_else(|_| Response::builder().status(500).body(Body::Empty).unwrap())
}

fn parse_body(event: &Request) -> Result<CreateApiKeyRequest, ManageApiKeysError> {
    match event.body() {
        Body::Text(text) => serde_json::from_str(text)
            .map_err(|err| ManageApiKeysError::Other(format!("Invalid JSON body: {}", err))),
        Body::Binary(bytes) => serde_json::from_slice(bytes)
            .map_err(|err| ManageApiKeysError::Other(format!("Invalid JSON body: {}", err))),
        Body::Empty => Ok(CreateApiKeyRequest::default()),
    }
}

async fn create_api_key(
    user_id: &str,
    tenant_id: &Option<String>,
    body: CreateApiKeyRequest,
) -> Result<Response<Body>, ManageApiKeysError> {
    let tenant_id = tenant_id.as_ref().ok_or_else(|| {
        ManageApiKeysError::Other("\"tenantId\" is required for API key operations".to_string())
    })?;

    let name_raw = body.name.ok_or_else(|| {
        ManageApiKeysError::Other("\"name\" is required and must be a non-empty string".to_string())
    })?;
    if name_raw.trim().is_empty() {
        return Err(ManageApiKeysError::Other(
            "\"name\" is required and must be a non-empty string".to_string(),
        ));
    }
    if name_raw.len() > 100 {
        return Err(ManageApiKeysError::Other(
            "\"name\" must be 100 characters or less".to_string(),
        ));
    }

    let description = match body.description {
        Some(value) => {
            if value.len() > 500 {
                return Err(ManageApiKeysError::Other(
                    "\"description\" must be a string with max 500 characters".to_string(),
                ));
            }
            Some(value.trim().to_string())
        }
        None => None,
    };

    let trimmed_name = name_raw.trim().to_string();

    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = env::var("TABLE_NAME")
        .map_err(|err| ManageApiKeysError::Other(format!("TABLE_NAME not set: {}", err)))?;

    let duplicate = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("pk = :pk AND begins_with(sk, :sk)")
        .filter_expression("#name = :name")
        .expression_attribute_names("#name", "name")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.to_string()))
        .expression_attribute_values(":sk", AttributeValue::S("apikey#".to_string()))
        .expression_attribute_values(":name", AttributeValue::S(trimmed_name.clone()))
        .send()
        .await
        .map_err(|err| ManageApiKeysError::Other(format!("DynamoDB query failed: {}", err)))?;

    if !duplicate.items().is_empty() {
        return Err(ManageApiKeysError::Validation(format!(
            "Validation error: API key with name \"{}\" already exists for this tenant",
            trimmed_name
        )));
    }

    let (expires_at_iso, expiration_timestamp) = parse_expiration(body.expires_at)?;

    let key_id = generate_key_id();
    let key_value = generate_api_key(tenant_id, &key_id)?;
    let hashed_key = hash_api_key(&key_value);

    let api_key_record = build_api_key_record(ApiKeyRecordInput {
        tenant_id,
        user_id,
        name: &trimmed_name,
        description: description.as_deref(),
        scopes: body.scopes,
        key_id: &key_id,
        hashed_key: &hashed_key,
        expires_at: expires_at_iso.as_deref(),
        ttl: expiration_timestamp,
    });

    ddb_client
        .put_item()
        .table_name(&table_name)
        .set_item(Some(api_key_record))
        .condition_expression("attribute_not_exists(sk)")
        .send()
        .await
        .map_err(|err| ManageApiKeysError::Other(format!("DynamoDB put failed: {}", err)))?;

    format_response(201, json!({ "id": key_id, "value": key_value }))
        .map_err(|err| ManageApiKeysError::Other(err.to_string()))
}

async fn list_api_keys(tenant_id: &Option<String>) -> Result<Response<Body>, ManageApiKeysError> {
    let tenant_id = tenant_id.as_ref().ok_or_else(|| {
        ManageApiKeysError::Validation(
            "Validation error: tenantId is required for API key operations".to_string(),
        )
    })?;

    let table_name = env::var("TABLE_NAME")
        .map_err(|err| ManageApiKeysError::Other(format!("TABLE_NAME not set: {}", err)))?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let response = ddb_client
        .query()
        .table_name(&table_name)
        .key_condition_expression("pk = :pk AND begins_with(sk, :sk)")
        .expression_attribute_values(":pk", AttributeValue::S(tenant_id.to_string()))
        .expression_attribute_values(":sk", AttributeValue::S("apikey#".to_string()))
        .send()
        .await
        .map_err(|err| ManageApiKeysError::Other(format!("DynamoDB query failed: {}", err)))?;

    let mut api_keys = Vec::new();
    for item in response.items() {
        api_keys.push(api_key_to_public(item)?);
    }

    let response_body = ApiKeyListResponse {
        count: api_keys.len(),
        api_keys,
    };

    format_response(200, response_body).map_err(|err| ManageApiKeysError::Other(err.to_string()))
}

async fn get_api_key(
    tenant_id: &Option<String>,
    key_id: &str,
) -> Result<Response<Body>, ManageApiKeysError> {
    if key_id.is_empty() {
        return Err(ManageApiKeysError::Other(
            "\"keyId\" is required".to_string(),
        ));
    }

    let tenant_id = tenant_id.as_ref().ok_or_else(|| {
        ManageApiKeysError::Other("\"tenantId\" is required for API key operations".to_string())
    })?;

    let table_name = env::var("TABLE_NAME")
        .map_err(|err| ManageApiKeysError::Other(format!("TABLE_NAME not set: {}", err)))?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let response = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S(format!("apikey#{}", key_id)))
        .send()
        .await
        .map_err(|err| ManageApiKeysError::Other(format!("DynamoDB get failed: {}", err)))?;

    let item = match response.item() {
        Some(item) => item,
        None => {
            return format_response(404, json!({ "message": "API key not found" }))
                .map_err(|err| ManageApiKeysError::Other(err.to_string()));
        }
    };

    let api_key = api_key_to_detail(item)?;
    format_response(200, json!({ "apiKey": api_key }))
        .map_err(|err| ManageApiKeysError::Other(err.to_string()))
}

async fn revoke_api_key(
    tenant_id: &Option<String>,
    key_id: &str,
) -> Result<Response<Body>, ManageApiKeysError> {
    if key_id.is_empty() {
        return Err(ManageApiKeysError::Validation(
            "Validation error: \"keyId\" is required".to_string(),
        ));
    }

    let tenant_id = tenant_id.as_ref().ok_or_else(|| {
        ManageApiKeysError::Validation(
            "Validation error: \"tenantId\" is required for API key operations".to_string(),
        )
    })?;

    let table_name = env::var("TABLE_NAME")
        .map_err(|err| ManageApiKeysError::Other(format!("TABLE_NAME not set: {}", err)))?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let exists = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S(format!("apikey#{}", key_id)))
        .send()
        .await
        .map_err(|err| ManageApiKeysError::Other(format!("DynamoDB get failed: {}", err)))?;

    let item = match exists.item() {
        Some(item) => item,
        None => {
            return format_response(404, json!({ "message": "API key not found" }))
                .map_err(|err| ManageApiKeysError::Other(err.to_string()));
        }
    };

    let status = item
        .get("status")
        .and_then(|value| value.as_s().ok())
        .map_or("active", |value| value.as_str());

    if status == "revoked" {
        return format_response(400, json!({ "message": "API key is already revoked" }))
            .map_err(|err| ManageApiKeysError::Other(err.to_string()));
    }

    let revoked_at = Utc::now().to_rfc3339();
    ddb_client
        .update_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S(format!("apikey#{}", key_id)))
        .update_expression("SET #status = :status, revokedAt = :revokedAt")
        .expression_attribute_names("#status", "status")
        .expression_attribute_values(":status", AttributeValue::S("revoked".to_string()))
        .expression_attribute_values(":revokedAt", AttributeValue::S(revoked_at.clone()))
        .send()
        .await
        .map_err(|err| ManageApiKeysError::Other(format!("DynamoDB update failed: {}", err)))?;

    format_response(
        200,
        json!({
            "message": "API key revoked successfully",
            "keyId": key_id,
            "status": "revoked",
            "revokedAt": revoked_at,
        }),
    )
    .map_err(|err| ManageApiKeysError::Other(err.to_string()))
}

async fn delete_api_key(
    tenant_id: &Option<String>,
    key_id: &str,
) -> Result<Response<Body>, ManageApiKeysError> {
    if key_id.is_empty() {
        return Err(ManageApiKeysError::Other(
            "\"keyId\" is required".to_string(),
        ));
    }

    let tenant_id = tenant_id.as_ref().ok_or_else(|| {
        ManageApiKeysError::Other("\"tenantId\" is required for API key operations".to_string())
    })?;

    let table_name = env::var("TABLE_NAME")
        .map_err(|err| ManageApiKeysError::Other(format!("TABLE_NAME not set: {}", err)))?;
    let ddb_client = aws_clients::get_dynamodb_client().await;

    let exists = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S(format!("apikey#{}", key_id)))
        .send()
        .await
        .map_err(|err| ManageApiKeysError::Other(format!("DynamoDB get failed: {}", err)))?;

    if exists.item().is_none() {
        return format_response(404, json!({ "message": "API key not found" }))
            .map_err(|err| ManageApiKeysError::Other(err.to_string()));
    }

    ddb_client
        .delete_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S(format!("apikey#{}", key_id)))
        .send()
        .await
        .map_err(|err| ManageApiKeysError::Other(format!("DynamoDB delete failed: {}", err)))?;

    Response::builder()
        .status(204)
        .body(Body::Empty)
        .map_err(|err| ManageApiKeysError::Other(format!("Response build failed: {}", err)))
}

fn parse_expiration(
    expires_at: Option<String>,
) -> Result<(Option<String>, Option<i64>), ManageApiKeysError> {
    if let Some(expires_at) = expires_at {
        let parsed: DateTime<Utc> = DateTime::parse_from_rfc3339(&expires_at)
            .map_err(|_| {
                ManageApiKeysError::Other(
                    "\"expiresAt\" must be a valid ISO date string".to_string(),
                )
            })?
            .with_timezone(&Utc);

        if parsed <= Utc::now() {
            return Err(ManageApiKeysError::Other(
                "\"expiresAt\" must be in the future".to_string(),
            ));
        }

        let timestamp = parsed.timestamp();
        return Ok((Some(parsed.to_rfc3339()), Some(timestamp)));
    }

    Ok((None, None))
}

fn generate_api_key(tenant_id: &str, key_id: &str) -> Result<String, ManageApiKeysError> {
    let payload = json!({
        "t": tenant_id,
        "k": key_id,
        "ts": Utc::now().timestamp_millis(),
    });
    let payload_json = serde_json::to_string(&payload).map_err(|err| {
        ManageApiKeysError::Other(format!("Failed to serialize payload: {}", err))
    })?;

    let encoded_payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload_json);

    let mut secret = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut secret);
    let encoded_secret = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(secret);

    Ok(format!("ak_{}.{}", encoded_payload, encoded_secret))
}

fn generate_key_id() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn hash_api_key(key_value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key_value.as_bytes());
    hex::encode(hasher.finalize())
}

fn build_api_key_record(input: ApiKeyRecordInput<'_>) -> HashMap<String, AttributeValue> {
    let ApiKeyRecordInput {
        tenant_id,
        user_id,
        name,
        description,
        scopes,
        key_id,
        hashed_key,
        expires_at,
        ttl,
    } = input;
    let now = Utc::now().to_rfc3339();
    let scopes = scopes.unwrap_or_else(|| vec!["default".to_string()]);

    let mut item = HashMap::new();
    item.insert("pk".to_string(), AttributeValue::S(tenant_id.to_string()));
    item.insert(
        "sk".to_string(),
        AttributeValue::S(format!("apikey#{}", key_id)),
    );
    item.insert("keyId".to_string(), AttributeValue::S(key_id.to_string()));
    item.insert("name".to_string(), AttributeValue::S(name.to_string()));
    item.insert(
        "description".to_string(),
        description
            .map(|value| AttributeValue::S(value.to_string()))
            .unwrap_or_else(|| AttributeValue::Null(true)),
    );
    item.insert(
        "scopes".to_string(),
        AttributeValue::L(scopes.into_iter().map(AttributeValue::S).collect()),
    );
    item.insert(
        "hashedKey".to_string(),
        AttributeValue::S(hashed_key.to_string()),
    );
    item.insert(
        "tenantId".to_string(),
        AttributeValue::S(tenant_id.to_string()),
    );
    item.insert(
        "createdBy".to_string(),
        AttributeValue::S(user_id.to_string()),
    );
    item.insert("createdAt".to_string(), AttributeValue::S(now));
    item.insert("lastUsed".to_string(), AttributeValue::Null(true));
    item.insert("usageCount".to_string(), AttributeValue::N("0".to_string()));
    item.insert(
        "status".to_string(),
        AttributeValue::S("active".to_string()),
    );

    if let Some(expires_at) = expires_at {
        item.insert(
            "expiresAt".to_string(),
            AttributeValue::S(expires_at.to_string()),
        );
    }
    if let Some(ttl) = ttl {
        item.insert("ttl".to_string(), AttributeValue::N(ttl.to_string()));
    }

    item
}

fn api_key_to_public(
    item: &HashMap<String, AttributeValue>,
) -> Result<serde_json::Value, ManageApiKeysError> {
    let key_id = item
        .get("keyId")
        .and_then(|value| value.as_s().ok())
        .ok_or_else(|| ManageApiKeysError::Other("Missing keyId".to_string()))?;
    let name = item
        .get("name")
        .and_then(|value| value.as_s().ok())
        .ok_or_else(|| ManageApiKeysError::Other("Missing name".to_string()))?;

    let description = item
        .get("description")
        .and_then(|value| value.as_s().ok())
        .map(|value| value.to_string());
    let tenant_id = item
        .get("tenantId")
        .and_then(|value| value.as_s().ok())
        .map(|value| value.to_string());
    let created_at = item
        .get("createdAt")
        .and_then(|value| value.as_s().ok())
        .map(|value| value.to_string());
    let last_used = item
        .get("lastUsed")
        .and_then(|value| value.as_s().ok())
        .map(|value| value.to_string());
    let usage_count = item
        .get("usageCount")
        .and_then(|value| value.as_n().ok())
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    let expires_at = item
        .get("expiresAt")
        .and_then(|value| value.as_s().ok())
        .map(|value| value.to_string());
    let status = item
        .get("status")
        .and_then(|value| value.as_s().ok())
        .map(|value| value.to_string());
    let revoked_at = item
        .get("revokedAt")
        .and_then(|value| value.as_s().ok())
        .map(|value| value.to_string());

    let mut response = json!({
        "keyId": key_id,
        "name": name,
        "description": description,
        "keyValue": "***hidden***",
        "tenantId": tenant_id,
        "createdAt": created_at,
        "lastUsed": last_used,
        "usageCount": usage_count,
        "expiresAt": expires_at,
        "status": status,
    });

    if let Some(revoked_at) = revoked_at {
        response["revokedAt"] = json!(revoked_at);
    }

    Ok(response)
}

fn api_key_to_detail(
    item: &HashMap<String, AttributeValue>,
) -> Result<serde_json::Value, ManageApiKeysError> {
    let mut response = api_key_to_public(item)?;
    let created_by = item
        .get("createdBy")
        .and_then(|value| value.as_s().ok())
        .map(|value| value.to_string());

    response["createdBy"] = json!(created_by);
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_expiration_rejects_invalid() {
        let result = parse_expiration(Some("not-a-date".to_string()));
        assert!(matches!(result, Err(ManageApiKeysError::Other(_))));
    }

    #[test]
    fn parse_expiration_rejects_past() {
        let past = (Utc::now() - chrono::Duration::days(1)).to_rfc3339();
        let result = parse_expiration(Some(past));
        assert!(matches!(result, Err(ManageApiKeysError::Other(_))));
    }

    #[test]
    fn parse_expiration_accepts_future() {
        let future = (Utc::now() + chrono::Duration::days(1)).to_rfc3339();
        let result = parse_expiration(Some(future.clone())).expect("future date should parse");
        assert_eq!(result.0.as_deref(), Some(future.as_str()));
        assert!(result.1.is_some());
    }

    #[test]
    fn generate_api_key_format_contains_payload_and_secret() {
        let key = generate_api_key("tenant-1", "key-1").expect("key generation");
        assert!(key.starts_with("ak_"));

        let without_prefix = key.strip_prefix("ak_").unwrap();
        let parts: Vec<&str> = without_prefix.split('.').collect();
        assert_eq!(parts.len(), 2);

        let payload_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts[0])
            .expect("payload base64url decode");
        let payload_json: serde_json::Value =
            serde_json::from_slice(&payload_bytes).expect("payload json");
        assert_eq!(payload_json["t"], "tenant-1");
        assert_eq!(payload_json["k"], "key-1");
        assert!(payload_json["ts"].is_number());
    }

    #[test]
    fn hash_api_key_matches_sha256_hex() {
        let hash = hash_api_key("test-api-key");
        assert_eq!(
            hash,
            "4c806362b613f7496abf284146efd31da90e4b16169fe001841ca17290f427c4"
        );
    }
}
