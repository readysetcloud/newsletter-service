use super::error::AppError;
use base64::Engine;
use lambda_http::RequestExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Debug, Deserialize, Clone)]
pub struct UserContext {
    pub user_id: String,
    pub email: String,
    pub tenant_id: Option<String>,
    pub username: Option<String>,
    pub role: String,
    pub is_admin: bool,
    pub is_tenant_admin: bool,
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

pub fn get_user_context(event: &lambda_http::Request) -> Result<UserContext, AppError> {
    let request_context = event
        .request_context_ref()
        .ok_or_else(|| AppError::Unauthorized("Invalid authorization context".to_string()))?;

    let authorizer = request_context
        .authorizer()
        .ok_or_else(|| AppError::Unauthorized("Invalid authorization context".to_string()))?;

    let fields = &authorizer.fields;

    let mut user_id = get_optional_string_field(fields, "userId");
    let mut email = get_optional_string_field(fields, "email");
    let username = get_optional_string_field(fields, "username");
    let mut tenant_id = get_optional_string_field(fields, "tenantId");
    let role = get_optional_string_field(fields, "role").unwrap_or_else(|| "user".to_string());
    let is_admin = get_optional_string_field(fields, "isAdmin")
        .map(|v| v == "true")
        .unwrap_or(false);
    let is_tenant_admin = get_optional_string_field(fields, "isTenantAdmin")
        .map(|v| v == "true")
        .unwrap_or(false);

    if user_id.is_none() || email.is_none() || tenant_id.is_none() {
        if let Some(claims) = fields.get("claims").and_then(|v| v.as_object()) {
            if user_id.is_none() {
                user_id = claims
                    .get("sub")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }

            if email.is_none() {
                email = claims
                    .get("email")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }

            if tenant_id.is_none() {
                tenant_id = claims
                    .get("custom:tenant_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        }
    }

    let user_id = user_id
        .ok_or_else(|| AppError::Unauthorized("Invalid authorization context".to_string()))?;
    let email =
        email.ok_or_else(|| AppError::Unauthorized("Invalid authorization context".to_string()))?;

    Ok(UserContext {
        user_id,
        email,
        tenant_id,
        username,
        role,
        is_admin,
        is_tenant_admin,
    })
}

pub fn decode_api_key(api_key: &str) -> Option<DecodedApiKey> {
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

pub fn hash_api_key(key_value: &str) -> String {
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

fn get_optional_string_field(
    fields: &std::collections::HashMap<String, serde_json::Value>,
    key: &str,
) -> Option<String> {
    fields.get(key).and_then(|v| v.as_str()).and_then(|value| {
        if value == "null" || value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use aws_lambda_events::apigw::{ApiGatewayProxyRequestContext, ApiGatewayRequestAuthorizer};
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use lambda_http::http::Method;
    use lambda_http::request::RequestContext;
    use lambda_http::{Body, Request, RequestExt};
    use proptest::prelude::*;
    use serde_json::json;
    use std::collections::HashMap;

    fn build_request_with_authorizer_fields(fields: HashMap<String, serde_json::Value>) -> Request {
        let context = ApiGatewayProxyRequestContext {
            http_method: Method::GET,
            authorizer: ApiGatewayRequestAuthorizer {
                fields,
                ..Default::default()
            },
            ..Default::default()
        };

        Request::new(Body::Empty).with_request_context(RequestContext::ApiGatewayV1(context))
    }

    fn create_test_request_with_claims(
        user_id: &str,
        email: &str,
        tenant_id: Option<&str>,
    ) -> Request {
        let mut claims = json!({
            "sub": user_id,
            "email": email
        });

        if let Some(tid) = tenant_id {
            claims["custom:tenant_id"] = json!(tid);
        }

        let mut fields = HashMap::new();
        fields.insert("claims".to_string(), claims);

        build_request_with_authorizer_fields(fields)
    }

    fn create_test_request_with_authorizer_fields(
        user_id: &str,
        email: &str,
        tenant_id: Option<&str>,
    ) -> Request {
        let mut fields = HashMap::new();
        fields.insert("userId".to_string(), json!(user_id));
        fields.insert("email".to_string(), json!(email));
        fields.insert("role".to_string(), json!("user"));
        fields.insert("isAdmin".to_string(), json!("false"));
        fields.insert("isTenantAdmin".to_string(), json!("true"));

        if let Some(tid) = tenant_id {
            fields.insert("tenantId".to_string(), json!(tid));
        }

        build_request_with_authorizer_fields(fields)
    }

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

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        // Feature: rust-lambda-migration, Property 2: JWT Context Parsing Equivalence
        #[test]
        fn test_jwt_context_parsing_equivalence(
            user_id in "[a-z0-9]{8,36}",
            email in "[a-z0-9]+@[a-z0-9]+\\.[a-z]{2,5}",
            has_tenant in prop::bool::ANY,
            tenant_id in "[a-z0-9]{8,20}"
        ) {
            let tenant_opt = if has_tenant { Some(tenant_id.as_str()) } else { None };
            let request = create_test_request_with_claims(&user_id, &email, tenant_opt);

            let result = get_user_context(&request);

            prop_assert!(result.is_ok(), "JWT context parsing should succeed for valid claims");

            let context = result.unwrap();
            prop_assert_eq!(&context.user_id, &user_id, "user_id should match");
            prop_assert_eq!(&context.email, &email, "email should match");

            if has_tenant {
                prop_assert_eq!(context.tenant_id.as_deref(), Some(tenant_id.as_str()), "tenant_id should match when present");
            } else {
                prop_assert!(context.tenant_id.is_none(), "tenant_id should be None when not present");
            }
        }

        #[test]
        fn test_missing_sub_claim_fails(
            email in "[a-z0-9]+@[a-z0-9]+\\.[a-z]{2,5}"
        ) {
            let claims = json!({
                "email": email
            });
            let mut fields = HashMap::new();
            fields.insert("claims".to_string(), claims);
            let req = build_request_with_authorizer_fields(fields);

            let result = get_user_context(&req);
            prop_assert!(result.is_err(), "Should fail when sub claim is missing");
            prop_assert!(matches!(result.unwrap_err(), AppError::Unauthorized(_)));
        }

        #[test]
        fn test_missing_email_claim_fails(
            user_id in "[a-z0-9]{8,36}"
        ) {
            let claims = json!({
                "sub": user_id
            });
            let mut fields = HashMap::new();
            fields.insert("claims".to_string(), claims);
            let req = build_request_with_authorizer_fields(fields);

            let result = get_user_context(&req);
            prop_assert!(result.is_err(), "Should fail when email claim is missing");
            prop_assert!(matches!(result.unwrap_err(), AppError::Unauthorized(_)));
        }
    }

    #[test]
    fn test_authorizer_fields_parsing() {
        let request = create_test_request_with_authorizer_fields(
            "user-123",
            "test@example.com",
            Some("tenant-456"),
        );

        let result = get_user_context(&request).expect("context");
        assert_eq!(result.user_id, "user-123");
        assert_eq!(result.email, "test@example.com");
        assert_eq!(result.tenant_id.as_deref(), Some("tenant-456"));
        assert_eq!(result.role, "user");
        assert!(!result.is_admin);
        assert!(result.is_tenant_admin);
    }

    #[test]
    fn test_authorizer_null_values_fail() {
        let mut fields = HashMap::new();
        fields.insert("userId".to_string(), json!("user-123"));
        fields.insert("email".to_string(), json!("null"));
        let req = build_request_with_authorizer_fields(fields);

        let result = get_user_context(&req);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Unauthorized(_)));
    }

    #[test]
    fn test_no_authorizer_context() {
        let body = Body::Empty;
        let req = Request::new(body);

        let result = get_user_context(&req);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Unauthorized(_)));
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
}
