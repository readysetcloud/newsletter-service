use aws_sdk_eventbridge::Client as EventBridgeClient;
use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::OnceCell;

static EVENTBRIDGE_CLIENT: OnceCell<EventBridgeClient> = OnceCell::const_new();

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CognitoPostConfirmationEvent {
    user_pool_id: String,
    user_name: String,
    request: CognitoRequest,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CognitoRequest {
    user_attributes: Value,
}

async fn function_handler(event: LambdaEvent<Value>) -> Result<Value, Error> {
    let payload = event.payload;
    let parsed: CognitoPostConfirmationEvent = serde_json::from_value(payload.clone())?;

    let detail = json!({
        "userPoolId": parsed.user_pool_id,
        "username": parsed.user_name,
        "userAttributes": parsed.request.user_attributes,
        "groupName": "free-tier"
    });

    let event_bridge = get_eventbridge_client().await;
    event_bridge
        .put_events()
        .entries(
            aws_sdk_eventbridge::types::PutEventsRequestEntry::builder()
                .source("newsletter-service")
                .detail_type("Add User to Group")
                .detail(detail.to_string())
                .build(),
        )
        .send()
        .await?;

    Ok(payload)
}

async fn get_eventbridge_client() -> &'static EventBridgeClient {
    EVENTBRIDGE_CLIENT
        .get_or_init(|| async {
            let config = aws_config::load_from_env().await;
            EventBridgeClient::new(&config)
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_cognito_post_confirmation_payload() {
        let payload = json!({
            "userPoolId": "us-east-1_abc123",
            "userName": "user@example.com",
            "request": {
                "userAttributes": {
                    "email": "user@example.com"
                }
            }
        });

        let parsed: CognitoPostConfirmationEvent =
            serde_json::from_value(payload).expect("payload should parse");

        assert_eq!(parsed.user_pool_id, "us-east-1_abc123");
        assert_eq!(parsed.user_name, "user@example.com");
        assert_eq!(
            parsed
                .request
                .user_attributes
                .get("email")
                .and_then(|value| value.as_str()),
            Some("user@example.com")
        );
    }
}
