use crate::error::AppError;
use lambda_http::RequestExt;
use serde_json::Value;

#[derive(Debug)]
pub struct UserContext {
    pub sub: String,
    pub tenant_id: Option<String>,
    pub tier: Option<String>,
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
    let mut tenant_id = get_optional_string_field(fields, "tenantId");
    let mut tier = get_optional_string_field(fields, "tier");

    if user_id.is_none() || tenant_id.is_none() || tier.is_none() {
        if let Some(claims) = fields.get("claims").and_then(|v| v.as_object()) {
            if user_id.is_none() {
                user_id = claims
                    .get("userId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }

            if tenant_id.is_none() {
                tenant_id = claims
                    .get("tenantId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }

            if tier.is_none() {
                tier = claims
                    .get("tier")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        }
    }

    let user_id = user_id.ok_or_else(|| AppError::Unauthorized("Missing userId".to_string()))?;

    Ok(UserContext {
        sub: user_id,
        tenant_id,
        tier,
    })
}

fn get_optional_string_field(
    fields: &std::collections::HashMap<String, Value>,
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
