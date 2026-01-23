use aws_sdk_cognitoidentityprovider::operation::admin_update_user_attributes::AdminUpdateUserAttributesError;
use aws_sdk_cognitoidentityprovider::types::AttributeType;
use chrono::Utc;
use lambda_http::{run, service_fn, Body, Error, Request, Response};
use serde_json::{json, Value};
use shared::{aws_clients, format_response, get_user_context};

#[derive(Debug)]
enum UpdateProfileError {
    Unauthorized,
    BadRequest(String),
    NotFound(String),
    Internal(String),
}

#[derive(Default)]
struct ProfileData {
    first_name: Option<Value>,
    last_name: Option<Value>,
    timezone: Option<Value>,
    locale: Option<Value>,
    links: Option<Value>,
    provided_fields: usize,
}

async fn function_handler(event: Request) -> Result<Response<Body>, Error> {
    match handle_request(event).await {
        Ok(response) => Ok(response),
        Err(err) => {
            tracing::error!(error = ?err, "Update profile error");
            Ok(format_error_response(err))
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    run(service_fn(function_handler)).await
}

async fn handle_request(event: Request) -> Result<Response<Body>, UpdateProfileError> {
    let user_context = get_user_context(&event).map_err(|_| UpdateProfileError::Unauthorized)?;
    let email = user_context.email;

    let body = parse_body(&event)?;
    let profile_data = extract_profile_data(&body);

    if profile_data.provided_fields == 0 {
        return Err(UpdateProfileError::BadRequest(
            "At least one field must be provided for an update".to_string(),
        ));
    }

    let updated_profile = update_personal_info(&email, &profile_data).await?;

    format_response(
        200,
        json!({
            "message": "Profile updated successfully",
            "profile": updated_profile
        }),
    )
    .map_err(|err| UpdateProfileError::Internal(err.to_string()))
}

fn parse_body(event: &Request) -> Result<Value, UpdateProfileError> {
    match event.body() {
        Body::Text(text) => serde_json::from_str(text)
            .map_err(|err| UpdateProfileError::Internal(format!("Invalid JSON body: {}", err))),
        Body::Binary(bytes) => serde_json::from_slice(bytes)
            .map_err(|err| UpdateProfileError::Internal(format!("Invalid JSON body: {}", err))),
        Body::Empty => Ok(json!({})),
    }
}

fn extract_profile_data(body: &Value) -> ProfileData {
    let mut data = ProfileData::default();
    let Value::Object(map) = body else {
        return data;
    };

    let fields = [
        ("firstName", &mut data.first_name),
        ("lastName", &mut data.last_name),
        ("timezone", &mut data.timezone),
        ("locale", &mut data.locale),
        ("links", &mut data.links),
    ];

    for (key, target) in fields {
        if map.contains_key(key) {
            *target = Some(map.get(key).cloned().unwrap_or(Value::Null));
            data.provided_fields += 1;
        }
    }

    data
}

async fn update_personal_info(
    email: &str,
    profile_data: &ProfileData,
) -> Result<Value, UpdateProfileError> {
    let mut user_attributes = Vec::new();

    if let Some(value) = profile_data.first_name.as_ref().and_then(non_empty_string) {
        user_attributes.push(build_attribute("given_name", value)?);
    }
    if let Some(value) = profile_data.last_name.as_ref().and_then(non_empty_string) {
        user_attributes.push(build_attribute("family_name", value)?);
    }
    if let Some(value) = profile_data.timezone.as_ref().and_then(non_empty_string) {
        user_attributes.push(build_attribute("zoneinfo", value)?);
    }
    if let Some(value) = profile_data.locale.as_ref().and_then(non_empty_string) {
        user_attributes.push(build_attribute("locale", value)?);
    }
    if let Some(value) = profile_data.links.as_ref() {
        if !value.is_null() {
            let links_json = serde_json::to_string(value)
                .map_err(|err| UpdateProfileError::Internal(format!("Invalid links: {}", err)))?;
            user_attributes.push(build_attribute("custom:profile_links", &links_json)?);
        }
    }

    let updated_at = Utc::now().to_rfc3339();
    user_attributes.push(build_attribute("custom:profile_updated_at", &updated_at)?);

    let user_pool_id = std::env::var("USER_POOL_ID")
        .map_err(|err| UpdateProfileError::Internal(format!("USER_POOL_ID not set: {}", err)))?;
    let cognito_client = aws_clients::get_cognito_client().await;

    let result = cognito_client
        .admin_update_user_attributes()
        .user_pool_id(user_pool_id)
        .username(email)
        .set_user_attributes(Some(user_attributes))
        .send()
        .await;

    if let Err(err) = result {
        let is_user_not_found = err
            .as_service_error()
            .map(|service_error| {
                matches!(
                    service_error,
                    AdminUpdateUserAttributesError::UserNotFoundException(_)
                )
            })
            .unwrap_or(false);

        if is_user_not_found {
            return Err(UpdateProfileError::NotFound("User not found".to_string()));
        }

        return Err(UpdateProfileError::Internal(format!(
            "Cognito update failed: {}",
            err
        )));
    }

    Ok(json!({
        "firstName": normalize_string_response(profile_data.first_name.as_ref()),
        "lastName": normalize_string_response(profile_data.last_name.as_ref()),
        "timezone": normalize_string_response(profile_data.timezone.as_ref()),
        "locale": normalize_string_response(profile_data.locale.as_ref()),
        "links": normalize_links_response(profile_data.links.as_ref()),
        "updatedAt": updated_at
    }))
}

fn build_attribute(name: &str, value: &str) -> Result<AttributeType, UpdateProfileError> {
    AttributeType::builder()
        .name(name)
        .value(value)
        .build()
        .map_err(|err| UpdateProfileError::Internal(format!("Invalid attribute: {}", err)))
}

fn non_empty_string(value: &Value) -> Option<&str> {
    match value {
        Value::String(s) if !s.trim().is_empty() => Some(s.as_str()),
        _ => None,
    }
}

fn normalize_string_response(value: Option<&Value>) -> Option<String> {
    value.and_then(|value| value.as_str()).and_then(|s| {
        if s.is_empty() {
            None
        } else {
            Some(s.to_string())
        }
    })
}

fn normalize_links_response(value: Option<&Value>) -> Option<Value> {
    match value {
        Some(Value::Null) | None => None,
        Some(other) => Some(other.clone()),
    }
}

fn format_error_response(err: UpdateProfileError) -> Response<Body> {
    let (status, message) = match err {
        UpdateProfileError::Unauthorized => (403, "Authentication required".to_string()),
        UpdateProfileError::BadRequest(message) => (400, message),
        UpdateProfileError::NotFound(message) => {
            tracing::warn!(error = %message, "Update profile not found");
            (404, "User not found".to_string())
        }
        UpdateProfileError::Internal(message) => {
            tracing::error!(error = %message, "Update profile internal error");
            (500, "Failed to update profile".to_string())
        }
    };

    format_response(status, json!({ "message": message }))
        .unwrap_or_else(|_| Response::builder().status(500).body(Body::Empty).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_profile_data_counts_fields() {
        let body = json!({
            "firstName": "Ada",
            "timezone": "UTC",
            "links": ["https://example.com"]
        });

        let data = extract_profile_data(&body);
        assert_eq!(data.provided_fields, 3);
        assert!(data.first_name.is_some());
        assert!(data.timezone.is_some());
        assert!(data.links.is_some());
    }

    #[test]
    fn extract_profile_data_handles_empty_body() {
        let body = json!({});
        let data = extract_profile_data(&body);
        assert_eq!(data.provided_fields, 0);
    }

    #[test]
    fn normalize_string_response_drops_empty() {
        let value = Value::String("".to_string());
        assert!(normalize_string_response(Some(&value)).is_none());
    }
}
