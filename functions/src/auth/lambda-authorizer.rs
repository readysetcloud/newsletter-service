use aws_lambda_events::event::apigw::ApiGatewayCustomAuthorizerRequestTypeRequest;
use aws_sdk_cognitoidentityprovider::Client as CognitoClient;
use aws_sdk_dynamodb::types::AttributeValue;
use aws_sdk_dynamodb::Client as DynamoDbClient;
use base64::Engine;
use chrono::{DateTime, Utc};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tracing::{error, info, warn};

#[derive(Clone)]
struct AppState {
    ddb: DynamoDbClient,
    cognito: CognitoClient,
    table_name: String,
    user_pool_id: String,
    user_pool_client_id: String,
}

#[derive(Debug, Clone)]
struct ApiKeyContext {
    tenant_id: String,
    key_id: String,
    created_by: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedApiKey {
    pub tenant_id: String,
    pub key_id: String,
    pub timestamp: i64,
    pub secret: String,
    pub full_key: String,
}

#[derive(Debug, Deserialize)]
struct JwtClaims {
    #[serde(default)]
    sub: Option<String>,
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    token_use: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "PascalCase")]
struct PolicyDocument {
    version: String,
    statement: Vec<PolicyStatement>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "PascalCase")]
struct PolicyStatement {
    action: String,
    effect: String,
    resource: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyResponse {
    principal_id: String,
    policy_document: PolicyDocument,
    #[serde(skip_serializing_if = "Option::is_none")]
    context: Option<HashMap<String, String>>,
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    let table_name = std::env::var("TABLE_NAME")?;
    let user_pool_id = std::env::var("USER_POOL_ID")?;
    let user_pool_client_id = std::env::var("USER_POOL_CLIENT_ID")?;

    let config = aws_config::load_from_env().await;
    let state = AppState {
        ddb: DynamoDbClient::new(&config),
        cognito: CognitoClient::new(&config),
        table_name,
        user_pool_id,
        user_pool_client_id,
    };

    run(service_fn(
        |event: LambdaEvent<ApiGatewayCustomAuthorizerRequestTypeRequest>| {
            let state = state.clone();
            async move { handler(event.payload, &state).await }
        },
    ))
    .await
}

async fn handler(
    event: ApiGatewayCustomAuthorizerRequestTypeRequest,
    state: &AppState,
) -> Result<PolicyResponse, Error> {
    // Allow OPTIONS requests through without authentication for CORS preflight
    if event.http_method.as_ref().map(|m| m.as_str()) == Some("OPTIONS") {
        let api_arn = get_api_arn_pattern(event.method_arn.as_deref().unwrap_or_default());
        return Ok(generate_policy("anonymous", "Allow", &api_arn, None));
    }

    match handle_authorization(&event, state).await {
        Ok(policy) => Ok(policy),
        Err(err) => {
            error!(error = %err, "Authorization failed");
            let api_arn = get_api_arn_pattern(event.method_arn.as_deref().unwrap_or_default());
            Ok(generate_policy("user", "Deny", &api_arn, None))
        }
    }
}

async fn handle_authorization(
    event: &ApiGatewayCustomAuthorizerRequestTypeRequest,
    state: &AppState,
) -> Result<PolicyResponse, Error> {
    let auth_header = get_authorization_header(event).ok_or("No Authorization header provided")?;

    if auth_header.starts_with("Bearer ") {
        let token = auth_header.trim_start_matches("Bearer ");
        handle_jwt_auth(token, event, state).await
    } else {
        handle_api_key_auth(&auth_header, event, state).await
    }
}

fn get_authorization_header(
    event: &ApiGatewayCustomAuthorizerRequestTypeRequest,
) -> Option<String> {
    event
        .headers
        .get("authorization")
        .or_else(|| event.headers.get("Authorization"))
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
}

async fn handle_api_key_auth(
    api_key: &str,
    event: &ApiGatewayCustomAuthorizerRequestTypeRequest,
    state: &AppState,
) -> Result<PolicyResponse, Error> {
    let user_context = validate_api_key(api_key, state).await?;
    let Some(user_context) = user_context else {
        return Err("Invalid API key".into());
    };

    let tenant_email =
        fetch_tenant_email(&state.ddb, &state.table_name, &user_context.tenant_id).await?;
    if tenant_email.is_none() {
        warn!(
            tenant_id = %user_context.tenant_id,
            "Tenant email not found; continuing without email in context"
        );
    }

    let fallback_email = user_context
        .created_by
        .contains('@')
        .then(|| user_context.created_by.clone());

    let resolved_email = tenant_email.or(fallback_email);

    let api_arn = get_api_arn_pattern(event.method_arn.as_deref().unwrap_or_default());
    let context = build_context([
        ("userId", Some(user_context.created_by)),
        ("email", resolved_email),
        ("tenantId", Some(user_context.tenant_id.clone())),
        ("keyId", Some(user_context.key_id)),
        ("authType", Some("api_key".to_string())),
    ]);

    Ok(generate_policy(
        &user_context.tenant_id,
        "Allow",
        &api_arn,
        context,
    ))
}

async fn handle_jwt_auth(
    token: &str,
    event: &ApiGatewayCustomAuthorizerRequestTypeRequest,
    state: &AppState,
) -> Result<PolicyResponse, Error> {
    let claims = verify_jwt(token, &state.user_pool_id, &state.user_pool_client_id).await?;
    let user_info = get_user_attributes(token, &state.cognito).await;

    let tenant_id = user_info.get("custom:tenant_id").cloned();
    let principal_id = user_info
        .get("sub")
        .cloned()
        .or_else(|| claims.sub.clone())
        .ok_or("Missing sub claim")?;

    let tier = get_user_tier(&state.cognito, &state.user_pool_id, &principal_id).await;

    let api_arn = get_api_arn_pattern(event.method_arn.as_deref().unwrap_or_default());
    let context = build_context([
        ("userId", Some(principal_id.clone())),
        ("email", user_info.get("email").cloned()),
        ("firstName", user_info.get("given_name").cloned()),
        ("lastName", user_info.get("family_name").cloned()),
        ("timezone", user_info.get("zoneinfo").cloned()),
        ("tenantId", tenant_id),
        ("tier", tier),
        ("authType", Some("jwt".to_string())),
    ]);

    Ok(generate_policy(&principal_id, "Allow", &api_arn, context))
}

async fn get_user_attributes(
    access_token: &str,
    client: &CognitoClient,
) -> HashMap<String, String> {
    match client.get_user().access_token(access_token).send().await {
        Ok(response) => response
            .user_attributes
            .into_iter()
            .filter_map(|attr| attr.value.map(|value| (attr.name, value)))
            .collect(),
        Err(err) => {
            error!(error = %err, "Error fetching user attributes");
            HashMap::new()
        }
    }
}

async fn get_user_tier(
    client: &CognitoClient,
    user_pool_id: &str,
    username: &str,
) -> Option<String> {
    match client
        .admin_list_groups_for_user()
        .user_pool_id(user_pool_id)
        .username(username)
        .send()
        .await
    {
        Ok(response) => {
            let groups = response.groups();
            if groups.iter().any(|g| g.group_name() == Some("pro-tier")) {
                Some("pro-tier".to_string())
            } else if groups
                .iter()
                .any(|g| g.group_name() == Some("creator-tier"))
            {
                Some("creator-tier".to_string())
            } else {
                Some("free-tier".to_string())
            }
        }
        Err(err) => {
            error!(error = %err, "Error fetching user groups");
            Some("free-tier".to_string())
        }
    }
}

async fn validate_api_key(api_key: &str, state: &AppState) -> Result<Option<ApiKeyContext>, Error> {
    let decoded = decode_api_key(api_key);
    let Some(decoded) = decoded else {
        return Ok(None);
    };

    let response = state
        .ddb
        .get_item()
        .table_name(&state.table_name)
        .key("pk", AttributeValue::S(decoded.tenant_id.clone()))
        .key(
            "sk",
            AttributeValue::S(format!("apikey#{}", decoded.key_id)),
        )
        .send()
        .await?;

    let Some(item) = response.item else {
        return Ok(None);
    };

    let hashed_key = get_string_attr(&item, "hashedKey")?;
    let expected_hash = hash_api_key(api_key);
    if hashed_key != expected_hash {
        info!("API key hash mismatch - possible tampering attempt");
        return Ok(None);
    }

    let status = get_string_attr(&item, "status")?;
    if status != "active" {
        info!("API key validation failed: status is '{}'", status);
        return Ok(None);
    }

    if let Some(expires_at) = get_optional_string_attr(&item, "expiresAt") {
        if let Ok(parsed) = DateTime::parse_from_rfc3339(&expires_at) {
            if parsed.with_timezone(&Utc) <= Utc::now() {
                return Ok(None);
            }
        }
    }

    let pk = get_string_attr(&item, "pk")?;
    let sk = get_string_attr(&item, "sk")?;
    let tenant_id = get_string_attr(&item, "tenantId")?;
    let key_id = get_string_attr(&item, "keyId")?;
    let created_by = get_string_attr(&item, "createdBy")?;

    if let Err(err) = update_api_key_usage(&state.ddb, &state.table_name, &pk, &sk).await {
        error!(error = %err, "Failed to update API key usage");
    }

    Ok(Some(ApiKeyContext {
        tenant_id,
        key_id,
        created_by,
    }))
}

async fn update_api_key_usage(
    client: &DynamoDbClient,
    table_name: &str,
    pk: &str,
    sk: &str,
) -> Result<(), Error> {
    client
        .update_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(pk.to_string()))
        .key("sk", AttributeValue::S(sk.to_string()))
        .update_expression(
            "SET lastUsed = :lastUsed, usageCount = if_not_exists(usageCount, :zero) + :one",
        )
        .expression_attribute_values(":lastUsed", AttributeValue::S(Utc::now().to_rfc3339()))
        .expression_attribute_values(":zero", AttributeValue::N("0".to_string()))
        .expression_attribute_values(":one", AttributeValue::N("1".to_string()))
        .send()
        .await?;

    Ok(())
}

async fn fetch_tenant_email(
    client: &DynamoDbClient,
    table_name: &str,
    tenant_id: &str,
) -> Result<Option<String>, Error> {
    let response = client
        .get_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S("tenant".to_string()))
        .send()
        .await?;

    let Some(item) = response.item else {
        return Ok(None);
    };

    Ok(get_optional_string_attr(&item, "email"))
}

fn decode_api_key(api_key: &str) -> Option<DecodedApiKey> {
    if api_key.is_empty() || !api_key.starts_with("ak_") {
        return None;
    }

    let key_body = &api_key[3..];
    let mut parts = key_body.split('.');
    let encoded_payload = parts.next()?;
    let encoded_secret = parts.next()?;

    if parts.next().is_some() {
        return None;
    }

    let payload_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded_payload.as_bytes())
        .ok()?;
    let payload_json = String::from_utf8(payload_bytes).ok()?;
    let payload: Value = serde_json::from_str(&payload_json).ok()?;

    let tenant_id = payload.get("t").and_then(|v| v.as_str())?.to_string();
    let key_id = payload.get("k").and_then(|v| v.as_str())?.to_string();
    let timestamp = parse_timestamp(payload.get("ts"))?;

    Some(DecodedApiKey {
        tenant_id,
        key_id,
        timestamp,
        secret: encoded_secret.to_string(),
        full_key: api_key.to_string(),
    })
}

fn hash_api_key(key_value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key_value.as_bytes());
    hex::encode(hasher.finalize())
}

fn parse_timestamp(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(num)) => num.as_i64().filter(|v| *v != 0),
        Some(Value::String(s)) => s.parse::<i64>().ok().filter(|v| *v != 0),
        _ => None,
    }
}

fn get_string_attr(item: &HashMap<String, AttributeValue>, key: &str) -> Result<String, Error> {
    item.get(key)
        .and_then(|value| value.as_s().ok())
        .map(|value| value.to_string())
        .ok_or_else(|| format!("Missing or invalid attribute: {key}").into())
}

fn get_optional_string_attr(item: &HashMap<String, AttributeValue>, key: &str) -> Option<String> {
    item.get(key)
        .and_then(|value| value.as_s().ok())
        .map(|value| value.to_string())
}

async fn verify_jwt(token: &str, user_pool_id: &str, client_id: &str) -> Result<JwtClaims, Error> {
    let jwks = fetch_jwks(user_pool_id).await?;
    let header = decode_header(token)?;
    let kid = header.kid.ok_or("Missing kid")?;

    let jwk = jwks
        .keys
        .into_iter()
        .find(|key| key.common.key_id.as_deref() == Some(&kid))
        .ok_or("Matching JWK not found")?;

    let decoding_key = DecodingKey::from_jwk(&jwk)?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.validate_exp = true;
    validation.set_issuer(&[issuer_for_pool(user_pool_id)?]);

    let token_data = decode::<JwtClaims>(token, &decoding_key, &validation)?;

    if token_data
        .claims
        .token_use
        .as_deref()
        .filter(|value| *value == "access")
        .is_none()
    {
        return Err("Invalid token_use claim".into());
    }

    if token_data
        .claims
        .client_id
        .as_deref()
        .filter(|value| *value == client_id)
        .is_none()
    {
        return Err("Invalid client_id claim".into());
    }

    Ok(token_data.claims)
}

fn issuer_for_pool(user_pool_id: &str) -> Result<String, Error> {
    let region = user_pool_id
        .split('_')
        .next()
        .ok_or("Invalid USER_POOL_ID")?;
    Ok(format!(
        "https://cognito-idp.{region}.amazonaws.com/{user_pool_id}"
    ))
}

#[derive(Debug, Deserialize)]
struct JwkSet {
    keys: Vec<jsonwebtoken::jwk::Jwk>,
}

async fn fetch_jwks(user_pool_id: &str) -> Result<JwkSet, Error> {
    let region = user_pool_id
        .split('_')
        .next()
        .ok_or("Invalid USER_POOL_ID")?;
    let url =
        format!("https://cognito-idp.{region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json");
    let response = reqwest::get(url).await?.error_for_status()?;
    let jwks = response.json::<JwkSet>().await?;
    Ok(jwks)
}

fn build_context<const N: usize>(
    entries: [(&'static str, Option<String>); N],
) -> Option<HashMap<String, String>> {
    let mut context = HashMap::new();
    for (key, value) in entries {
        if let Some(value) = value {
            context.insert(key.to_string(), value);
        }
    }

    if context.is_empty() {
        None
    } else {
        Some(context)
    }
}

fn generate_policy(
    principal_id: &str,
    effect: &str,
    resource: &str,
    context: Option<HashMap<String, String>>,
) -> PolicyResponse {
    PolicyResponse {
        principal_id: principal_id.to_string(),
        policy_document: PolicyDocument {
            version: "2012-10-17".to_string(),
            statement: vec![PolicyStatement {
                action: "execute-api:Invoke".to_string(),
                effect: effect.to_string(),
                resource: resource.to_string(),
            }],
        },
        context: if effect == "Allow" { context } else { None },
    }
}

fn get_api_arn_pattern(method_arn: &str) -> String {
    let mut parts = method_arn.split('/');
    let first = parts.next();
    let second = parts.next();
    match (first, second) {
        (Some(part1), Some(part2)) => format!("{part1}/{part2}/*/*"),
        _ => method_arn.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;

    fn build_key(tenant: &str, key_id: &str, ts: i64) -> String {
        let payload = serde_json::json!({
            "t": tenant,
            "k": key_id,
            "ts": ts
        });
        let payload_json = payload.to_string();
        let encoded = URL_SAFE_NO_PAD.encode(payload_json);
        format!("ak_{}.{}", encoded, "secret")
    }

    #[test]
    fn decode_api_key_parses_valid() {
        let key = build_key("tenant-1", "key-1", 123);
        let decoded = decode_api_key(&key).expect("decoded");
        assert_eq!(decoded.tenant_id, "tenant-1");
        assert_eq!(decoded.key_id, "key-1");
        assert_eq!(decoded.timestamp, 123);
        assert_eq!(decoded.secret, "secret");
        assert_eq!(decoded.full_key, key);
    }

    #[test]
    fn decode_api_key_rejects_invalid_prefix() {
        assert!(decode_api_key("bad.key").is_none());
    }

    #[test]
    fn decode_api_key_rejects_missing_fields() {
        let payload = serde_json::json!({
            "t": "tenant-1",
            "k": "key-1"
        });
        let encoded = URL_SAFE_NO_PAD.encode(payload.to_string());
        let key = format!("ak_{}.secret", encoded);
        assert!(decode_api_key(&key).is_none());
    }

    #[test]
    fn hash_api_key_matches_sha256_hex() {
        let hash = hash_api_key("test-api-key");
        assert_eq!(
            hash,
            "4c806362b613f7496abf284146efd31da90e4b16169fe001841ca17290f427c4"
        );
    }

    #[test]
    fn get_api_arn_pattern_expands_resource() {
        let arn = "arn:aws:execute-api:us-east-1:123456789012:apiId/prod/GET/resource";
        assert_eq!(
            get_api_arn_pattern(arn),
            "arn:aws:execute-api:us-east-1:123456789012:apiId/prod/*/*"
        );
    }

    #[test]
    fn get_api_arn_pattern_returns_input_when_short() {
        let arn = "invalid";
        assert_eq!(get_api_arn_pattern(arn), arn);
    }
}
