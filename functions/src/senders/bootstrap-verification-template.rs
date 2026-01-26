use aws_sdk_sesv2::Client as SesClient;
use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct CloudFormationEvent {
    request_type: String,
    response_url: String,
    stack_id: String,
    request_id: String,
    logical_resource_id: String,
    #[serde(default)]
    physical_resource_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "PascalCase")]
struct CloudFormationResponse {
    status: String,
    reason: String,
    physical_resource_id: String,
    stack_id: String,
    request_id: String,
    logical_resource_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<HashMap<String, String>>,
}

async fn function_handler(event: LambdaEvent<CloudFormationEvent>) -> Result<(), Error> {
    let (event, context) = event.into_parts();

    tracing::info!("CloudFormation event: {:?}", event);

    let result = match event.request_type.as_str() {
        "Delete" => handle_delete(&event, &context).await,
        "Create" | "Update" => handle_create_or_update(&event, &context).await,
        _ => Err(format!("Unknown request type: {}", event.request_type)),
    };

    let response = match result {
        Ok(data) => CloudFormationResponse {
            status: "SUCCESS".to_string(),
            reason: format!("See CloudWatch Log Stream: {}", context.request_id),
            physical_resource_id: data.physical_resource_id,
            stack_id: event.stack_id,
            request_id: event.request_id,
            logical_resource_id: event.logical_resource_id,
            data: Some(data.response_data),
        },
        Err(error) => CloudFormationResponse {
            status: "FAILED".to_string(),
            reason: format!("Failed: {} (Log Stream: {})", error, context.request_id),
            physical_resource_id: event
                .physical_resource_id
                .unwrap_or_else(|| context.request_id.clone()),
            stack_id: event.stack_id,
            request_id: event.request_id,
            logical_resource_id: event.logical_resource_id,
            data: None,
        },
    };

    send_cfn_response(&event.response_url, &response).await?;

    Ok(())
}

struct SuccessData {
    physical_resource_id: String,
    response_data: HashMap<String, String>,
}

async fn handle_delete(
    event: &CloudFormationEvent,
    context: &lambda_runtime::Context,
) -> Result<SuccessData, String> {
    tracing::info!("Delete event - no action needed for verification template");

    Ok(SuccessData {
        physical_resource_id: event
            .physical_resource_id
            .clone()
            .unwrap_or_else(|| context.request_id.clone()),
        response_data: HashMap::from([("Action".to_string(), "deleted".to_string())]),
    })
}

async fn handle_create_or_update(
    _event: &CloudFormationEvent,
    _context: &lambda_runtime::Context,
) -> Result<SuccessData, String> {
    tracing::info!("Bootstrapping custom verification email template...");

    let template_name = std::env::var("SES_VERIFY_TEMPLATE_NAME")
        .map_err(|_| "Missing SES_VERIFY_TEMPLATE_NAME environment variable".to_string())?;

    let from_email = std::env::var("SYSTEM_FROM_EMAIL")
        .map_err(|_| "Missing SYSTEM_FROM_EMAIL environment variable".to_string())?;

    let success_url = std::env::var("VERIFY_SUCCESS_URL")
        .unwrap_or_else(|_| "https://aws.amazon.com/ses/".to_string());

    let failure_url = std::env::var("VERIFY_FAILURE_URL")
        .unwrap_or_else(|_| "https://aws.amazon.com/ses/".to_string());

    let config = aws_config::load_from_env().await;
    let ses_client = SesClient::new(&config);

    let template_exists = check_template_exists(&ses_client, &template_name).await?;

    let action = if template_exists {
        update_template(
            &ses_client,
            &template_name,
            &from_email,
            &success_url,
            &failure_url,
        )
        .await?;
        "updated"
    } else {
        create_template(
            &ses_client,
            &template_name,
            &from_email,
            &success_url,
            &failure_url,
        )
        .await?;
        "created"
    };

    tracing::info!("Custom verification email template {} successfully", action);

    Ok(SuccessData {
        physical_resource_id: template_name.clone(),
        response_data: HashMap::from([
            ("TemplateName".to_string(), template_name),
            ("FromEmailAddress".to_string(), from_email),
            ("Action".to_string(), action.to_string()),
        ]),
    })
}

async fn send_cfn_response(
    response_url: &str,
    response: &CloudFormationResponse,
) -> Result<(), Error> {
    let body = serde_json::to_string(response)?;

    tracing::info!("Sending CloudFormation response: {}", body);

    let client = reqwest::Client::new();
    let result = client
        .put(response_url)
        .header("Content-Type", "")
        .body(body)
        .send()
        .await;

    match result {
        Ok(resp) => {
            tracing::info!("Response sent successfully: {}", resp.status());
            Ok(())
        }
        Err(e) => {
            tracing::error!("Failed to send response: {}", e);
            Err(e.into())
        }
    }
}

async fn check_template_exists(client: &SesClient, template_name: &str) -> Result<bool, String> {
    match client
        .get_custom_verification_email_template()
        .template_name(template_name)
        .send()
        .await
    {
        Ok(_) => {
            tracing::info!("Template already exists");
            Ok(true)
        }
        Err(e) => {
            if e.to_string().contains("NotFoundException") {
                tracing::info!("Template does not exist");
                Ok(false)
            } else {
                Err(format!("Error checking template existence: {}", e))
            }
        }
    }
}

async fn create_template(
    client: &SesClient,
    template_name: &str,
    from_email: &str,
    success_url: &str,
    failure_url: &str,
) -> Result<(), String> {
    let template_content = generate_template_content();

    client
        .create_custom_verification_email_template()
        .template_name(template_name)
        .from_email_address(from_email)
        .template_subject("Verify your sender email address")
        .template_content(template_content)
        .success_redirection_url(success_url)
        .failure_redirection_url(failure_url)
        .send()
        .await
        .map_err(|e| format!("Failed to create template: {}", e))?;

    Ok(())
}

async fn update_template(
    client: &SesClient,
    template_name: &str,
    from_email: &str,
    success_url: &str,
    failure_url: &str,
) -> Result<(), String> {
    let template_content = generate_template_content();

    client
        .update_custom_verification_email_template()
        .template_name(template_name)
        .from_email_address(from_email)
        .template_subject("Verify your sender email address")
        .template_content(template_content)
        .success_redirection_url(success_url)
        .failure_redirection_url(failure_url)
        .send()
        .await
        .map_err(|e| format!("Failed to update template: {}", e))?;

    Ok(())
}

fn generate_template_content() -> String {
    r#"<!DOCTYPE html>
<html>
  <body>
    <h1>Newsletter Service</h1>

    <h2>Verify Your Sender Email</h2>
    <p>Hello!</p>

    <p>You're adding a new sender address to your account. To finish setup and start sending from this address, please confirm ownership by clicking the verification link below.</p>

    <p><strong>After clicking the verification link, please return to your dashboard to confirm your email is verified and ready to use.</strong></p>

    <hr />
    <p><small>This verification ensures you own this email address and can send newsletters from it.</small></p>
  </body>
</html>"#.trim().to_string()
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
    fn test_generate_template_content() {
        let content = generate_template_content();
        assert!(content.contains("<!DOCTYPE html>"));
        assert!(content.contains("Newsletter Service"));
        assert!(content.contains("Verify Your Sender Email"));
        assert!(content.contains("verification link"));
    }

    #[test]
    fn test_template_content_structure() {
        let content = generate_template_content();
        assert!(content.starts_with("<!DOCTYPE html>"));
        assert!(content.contains("<h1>"));
        assert!(content.contains("<h2>"));
        assert!(content.contains("<p>"));
        assert!(content.contains("</html>"));
    }

    #[test]
    fn test_cfn_response_serialization() {
        let response = CloudFormationResponse {
            status: "SUCCESS".to_string(),
            reason: "Test reason".to_string(),
            physical_resource_id: "test-id".to_string(),
            stack_id: "stack-123".to_string(),
            request_id: "req-456".to_string(),
            logical_resource_id: "logical-789".to_string(),
            data: Some(HashMap::from([("Key1".to_string(), "Value1".to_string())])),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("SUCCESS"));
        assert!(json.contains("test-id"));
        assert!(json.contains("Key1"));
    }

    #[test]
    fn test_cfn_response_without_data() {
        let response = CloudFormationResponse {
            status: "FAILED".to_string(),
            reason: "Error occurred".to_string(),
            physical_resource_id: "test-id".to_string(),
            stack_id: "stack-123".to_string(),
            request_id: "req-456".to_string(),
            logical_resource_id: "logical-789".to_string(),
            data: None,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("FAILED"));
        assert!(!json.contains("Data"));
    }
}


