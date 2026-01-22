use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use serde_json::{json, Map, Value};
use uuid::Uuid;

async fn function_handler(event: LambdaEvent<Value>) -> Result<Value, Error> {
    let mut payload = event.payload;
    let correlation_id = Uuid::new_v4().to_string();

    tracing::info!(
        correlation_id = %correlation_id,
        trigger_source = %payload.get("triggerSource").and_then(|v| v.as_str()).unwrap_or("unknown"),
        user_name = %payload.get("userName").and_then(|v| v.as_str()).unwrap_or("unknown"),
        user_pool_id = %payload.get("userPoolId").and_then(|v| v.as_str()).unwrap_or("unknown"),
        "Pre Token Generation start"
    );

    if let Err(err) = process_event(&mut payload, &correlation_id).await {
        tracing::error!(
            correlation_id = %correlation_id,
            error = %err,
            "Pre Token Generation failed - continuing authentication"
        );
    }

    Ok(payload)
}

async fn process_event(payload: &mut Value, correlation_id: &str) -> Result<(), String> {
    let (user_id, _email, tenant_id, user_name) = extract_user_context(payload, correlation_id);

    enrich_claims(payload, tenant_id.as_deref(), correlation_id, &user_name);

    tracing::info!(
        correlation_id = %correlation_id,
        user_name = %user_name,
        "Pre Token Generation completed"
    );

    Ok(())
}

fn extract_user_context(
    payload: &Value,
    correlation_id: &str,
) -> (Option<String>, Option<String>, Option<String>, String) {
    let user_attributes = payload
        .get("request")
        .and_then(|value| value.get("userAttributes"))
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();

    let user_id = user_attributes
        .get("sub")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let email = user_attributes
        .get("email")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let tenant_id = user_attributes
        .get("custom:tenant_id")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    let user_name = payload
        .get("userName")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown")
        .to_string();

    tracing::info!(
        correlation_id = %correlation_id,
        user_name = %user_name,
        has_user_id = %user_id.is_some(),
        has_email = %email.is_some(),
        has_tenant_id = %tenant_id.is_some(),
        "User context extracted"
    );

    if user_id.is_none() {
        tracing::warn!(
            correlation_id = %correlation_id,
            user_name = %user_name,
            "Missing user ID in Cognito event"
        );
    }
    if email.is_none() {
        tracing::warn!(
            correlation_id = %correlation_id,
            user_name = %user_name,
            "Missing email in Cognito event"
        );
    }
    if tenant_id.is_none() {
        tracing::warn!(
            correlation_id = %correlation_id,
            user_name = %user_name,
            "Missing tenant ID in Cognito event - user will have no channel access"
        );
    }

    (user_id, email, tenant_id, user_name)
}

fn enrich_claims(
    payload: &mut Value,
    tenant_id: Option<&str>,
    correlation_id: &str,
    user_name: &str,
) {
    let claims = ensure_claims_map(payload);

    if let Some(tenant_id) = tenant_id {
        claims.insert("custom:tenant_id".to_string(), Value::String(tenant_id.to_string()));
        tracing::info!(
            correlation_id = %correlation_id,
            user_name = %user_name,
            tenant_id = %tenant_id,
            "Added tenant ID to JWT claims"
        );
    }

}

fn ensure_claims_map(payload: &mut Value) -> &mut Map<String, Value> {
    if !payload.is_object() {
        *payload = json!({});
    }

    let obj = payload.as_object_mut().unwrap();
    let response = obj
        .entry("response".to_string())
        .or_insert_with(|| json!({}));
    if !response.is_object() {
        *response = json!({});
    }
    let response_obj = response.as_object_mut().unwrap();

    let details = response_obj
        .entry("claimsOverrideDetails".to_string())
        .or_insert_with(|| json!({}));
    if !details.is_object() {
        *details = json!({});
    }
    let details_obj = details.as_object_mut().unwrap();

    let claims = details_obj
        .entry("claimsToAddOrOverride".to_string())
        .or_insert_with(|| json!({}));
    if !claims.is_object() {
        *claims = json!({});
    }
    claims.as_object_mut().unwrap()
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    run(service_fn(function_handler)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enrich_claims_sets_tenant_id() {
        let mut payload = json!({
            "request": {
                "userAttributes": {
                    "custom:tenant_id": "tenant-1"
                }
            }
        });

        enrich_claims(&mut payload, Some("tenant-1"), "corr", "user");
        let claims = payload
            .get("response")
            .and_then(|v| v.get("claimsOverrideDetails"))
            .and_then(|v| v.get("claimsToAddOrOverride"))
            .and_then(|v| v.as_object())
            .unwrap();

        assert_eq!(claims.get("custom:tenant_id").and_then(|v| v.as_str()), Some("tenant-1"));
    }
}
