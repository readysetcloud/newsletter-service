use aws_sdk_sesv2::Client as SesClient;
use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct CloudFormationEvent {
    request_type: String,
    #[serde(rename = "ResponseURL")]
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
        // Debug formatting surfaces the underlying SES service message
        // (e.g. "Disallowed tags / attributes"); Display alone just says
        // "service error".
        .map_err(|e| format!("Failed to create template: {:?}", e))?;

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
        // Debug formatting surfaces the underlying SES service message
        // (e.g. "Disallowed tags / attributes"); Display alone just says
        // "service error".
        .map_err(|e| format!("Failed to update template: {:?}", e))?;

    Ok(())
}

fn generate_template_content() -> String {
    // Notes on SES custom verification email templates:
    // - SES automatically appends the verification link and a standard
    //   "If you didn't request this" disclaimer beneath this content, so the
    //   template focuses on branding and clear instructions.
    // - SES rejects certain tags/attributes. Confirmed disallowed and avoided
    //   here: <meta>, <title> (and therefore <head>); and the attributes
    //   role, cellpadding, cellspacing, align. All styling must be inline CSS.
    r#"<!DOCTYPE html>
<html lang="en">
  <body style="margin:0; padding:0; background-color:#f4f5f7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#1f2933;">
    <table style="width:100%; border-collapse:collapse; background-color:#f4f5f7;">
      <tr>
        <td style="padding:32px 16px; text-align:center;">
          <table style="width:100%; max-width:560px; margin:0 auto; border-collapse:collapse; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08); text-align:left;">
            <tr>
              <td style="background-color:#4f46e5; padding:24px 32px;">
                <span style="color:#ffffff; font-size:18px; font-weight:600; letter-spacing:0.2px;">Newsletter Service</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px; font-size:22px; font-weight:600; color:#111827;">Verify your sender email</h1>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6; color:#374151;">Hi there,</p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6; color:#374151;">
                  You're adding a new sender address to your account. To finish setup and start sending newsletters from this address, confirm that you own it by clicking the verification link below.
                </p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6; color:#374151;">
                  After verifying, head back to your dashboard &mdash; your sender will show as <strong>verified</strong> and ready to use.
                </p>
                <p style="margin:0; font-size:13px; line-height:1.6; color:#6b7280;">
                  This step confirms you own the address and helps keep your newsletters out of spam folders.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px;">
                <hr style="border:none; border-top:1px solid #e5e7eb; margin:0 0 16px;" />
                <p style="margin:0; font-size:12px; line-height:1.6; color:#9ca3af;">
                  You're receiving this email because someone added this address as a sender in Newsletter Service.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
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
        assert!(content.contains("Verify your sender email"));
        assert!(content.contains("verification link"));
    }

    #[test]
    fn test_template_content_structure() {
        let content = generate_template_content();
        assert!(content.starts_with("<!DOCTYPE html>"));
        // Tags carry inline styles, so match on the opening tag prefix.
        assert!(content.contains("<html"));
        assert!(content.contains("<body"));
        assert!(content.contains("<h1"));
        assert!(content.contains("<p"));
        assert!(content.contains("</html>"));
    }

    #[test]
    fn test_template_content_has_required_elements() {
        let content = generate_template_content();
        // Verify key messaging elements
        assert!(content.contains("adding a new sender address"));
        assert!(content.contains("confirm that you own"));
        assert!(content.contains("dashboard"));
        // Verify HTML structure is valid (single, balanced html/body wrappers)
        assert_eq!(content.matches("<html").count(), 1);
        assert_eq!(content.matches("</html>").count(), 1);
        assert_eq!(content.matches("<body").count(), 1);
        assert_eq!(content.matches("</body>").count(), 1);
    }

    #[test]
    fn test_template_content_is_not_empty() {
        let content = generate_template_content();
        assert!(!content.is_empty());
        assert!(content.len() > 100); // Should be substantial HTML
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

    #[test]
    fn test_cfn_response_success_format() {
        let mut data = HashMap::new();
        data.insert("TemplateName".to_string(), "test-template".to_string());
        data.insert("Action".to_string(), "created".to_string());

        let response = CloudFormationResponse {
            status: "SUCCESS".to_string(),
            reason: "Template created successfully".to_string(),
            physical_resource_id: "test-template".to_string(),
            stack_id: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc".to_string(),
            request_id: "req-123".to_string(),
            logical_resource_id: "VerificationTemplate".to_string(),
            data: Some(data),
        };

        let json = serde_json::to_string(&response).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["Status"], "SUCCESS");
        assert_eq!(parsed["PhysicalResourceId"], "test-template");
        assert_eq!(parsed["Data"]["TemplateName"], "test-template");
        assert_eq!(parsed["Data"]["Action"], "created");
    }

    #[test]
    fn test_cfn_response_failure_format() {
        let response = CloudFormationResponse {
            status: "FAILED".to_string(),
            reason: "Template creation failed: Invalid email".to_string(),
            physical_resource_id: "fallback-id".to_string(),
            stack_id: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc".to_string(),
            request_id: "req-456".to_string(),
            logical_resource_id: "VerificationTemplate".to_string(),
            data: None,
        };

        let json = serde_json::to_string(&response).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["Status"], "FAILED");
        assert_eq!(parsed["Reason"], "Template creation failed: Invalid email");
        assert!(parsed.get("Data").is_none() || parsed["Data"].is_null());
    }

    #[test]
    fn test_cfn_event_deserialization() {
        let json = r#"{
            "RequestType": "Create",
            "ResponseURL": "https://example.com/response",
            "StackId": "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
            "RequestId": "req-123",
            "LogicalResourceId": "VerificationTemplate"
        }"#;

        let event: CloudFormationEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.request_type, "Create");
        assert_eq!(event.response_url, "https://example.com/response");
        assert_eq!(event.logical_resource_id, "VerificationTemplate");
        assert!(event.physical_resource_id.is_none());
    }

    #[test]
    fn test_cfn_event_with_physical_resource_id() {
        let json = r#"{
            "RequestType": "Update",
            "ResponseURL": "https://example.com/response",
            "StackId": "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
            "RequestId": "req-456",
            "LogicalResourceId": "VerificationTemplate",
            "PhysicalResourceId": "existing-template"
        }"#;

        let event: CloudFormationEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.request_type, "Update");
        assert_eq!(
            event.physical_resource_id,
            Some("existing-template".to_string())
        );
    }
}
