use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use newsletter::admin::{aws_clients, AppError};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct EventBridgeEnvelope<T> {
    detail: T,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddUserToGroupDetail {
    user_pool_id: String,
    username: String,
    group_name: String,
}

async fn function_handler(event: LambdaEvent<Value>) -> Result<Value, Error> {
    let detail = parse_detail(event.payload)?;
    let cognito_client = aws_clients::get_cognito_client().await;

    cognito_client
        .admin_add_user_to_group()
        .user_pool_id(detail.user_pool_id)
        .username(&detail.username)
        .group_name(&detail.group_name)
        .send()
        .await?;

    tracing::info!(
        username = %detail.username,
        group_name = %detail.group_name,
        "Added user to group"
    );

    Ok(serde_json::json!(null))
}

fn parse_detail(payload: Value) -> Result<AddUserToGroupDetail, AppError> {
    let payload: EventBridgeEnvelope<AddUserToGroupDetail> = serde_json::from_value(payload)
        .map_err(|err| AppError::BadRequest(format!("Invalid event payload: {}", err)))?;
    Ok(payload.detail)
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
    fn parse_detail_accepts_valid_payload() {
        let payload = json!({
            "detail": {
                "userPoolId": "us-east-1_abc123",
                "username": "user@example.com",
                "groupName": "admins"
            }
        });

        let detail = parse_detail(payload).expect("valid payload should parse");
        assert_eq!(detail.user_pool_id, "us-east-1_abc123");
        assert_eq!(detail.username, "user@example.com");
        assert_eq!(detail.group_name, "admins");
    }

    #[test]
    fn parse_detail_rejects_missing_detail() {
        let payload = json!({
            "source": "test"
        });

        let err = parse_detail(payload).expect_err("missing detail should error");
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn parse_detail_rejects_missing_fields() {
        let payload = json!({
            "detail": {
                "userPoolId": "us-east-1_abc123",
                "username": "user@example.com"
            }
        });

        let err = parse_detail(payload).expect_err("missing groupName should error");
        assert!(matches!(err, AppError::BadRequest(_)));
    }
}
