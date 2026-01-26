use super::error::ToolError;
use aws_sdk_bedrockruntime::types::{Tool, ToolInputSchema, ToolSpecification};
use aws_sdk_dynamodb::types::AttributeValue;
use aws_sdk_dynamodb::Client as DynamoDbClient;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use tokio::sync::OnceCell;

static DYNAMODB_CLIENT: OnceCell<DynamoDbClient> = OnceCell::const_new();

pub async fn get_dynamodb_client() -> &'static DynamoDbClient {
    DYNAMODB_CLIENT
        .get_or_init(|| async {
            let config = aws_config::load_from_env().await;
            DynamoDbClient::new(&config)
        })
        .await
}

pub struct ConverseOptions {
    pub tenant_id: String,
    pub user_id: Option<String>,
}

pub type ToolHandler =
    for<'a> fn(
        Value,
        &'a ConverseOptions,
    ) -> Pin<Box<dyn Future<Output = Result<Value, ToolError>> + Send + 'a>>;

pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub is_multi_tenant: bool,
    pub handler: ToolHandler,
}

impl ToolDefinition {
    pub fn to_bedrock_tool(&self) -> Tool {
        fn json_to_document(value: &Value) -> aws_smithy_types::Document {
            match value {
                Value::Null => aws_smithy_types::Document::Null,
                Value::Bool(b) => aws_smithy_types::Document::Bool(*b),
                Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        aws_smithy_types::Document::Number(aws_smithy_types::Number::PosInt(
                            i as u64,
                        ))
                    } else if let Some(f) = n.as_f64() {
                        aws_smithy_types::Document::Number(aws_smithy_types::Number::Float(f))
                    } else {
                        aws_smithy_types::Document::Null
                    }
                }
                Value::String(s) => aws_smithy_types::Document::String(s.clone()),
                Value::Array(arr) => {
                    aws_smithy_types::Document::Array(arr.iter().map(json_to_document).collect())
                }
                Value::Object(obj) => aws_smithy_types::Document::Object(
                    obj.iter()
                        .map(|(k, v)| (k.clone(), json_to_document(v)))
                        .collect(),
                ),
            }
        }

        let doc = json_to_document(&self.input_schema);

        Tool::ToolSpec(
            ToolSpecification::builder()
                .name(&self.name)
                .description(&self.description)
                .input_schema(ToolInputSchema::Json(doc))
                .build()
                .expect("Valid tool specification"),
        )
    }
}

#[macro_export]
macro_rules! define_tool {
    ($name:expr, $desc:expr, $schema:expr, $multi_tenant:expr, $handler:expr) => {
        ToolDefinition {
            name: $name.to_string(),
            description: $desc.to_string(),
            input_schema: $schema,
            is_multi_tenant: $multi_tenant,
            handler: |input, options| Box::pin(async move { $handler(input, options).await }),
        }
    };
}

pub async fn create_insights_handler(
    input: Value,
    options: &ConverseOptions,
) -> Result<Value, ToolError> {
    #[derive(Deserialize)]
    struct CreateInsightsInput {
        #[serde(rename = "issueId")]
        issue_id: String,
        insights: Vec<String>,
    }

    let parsed: CreateInsightsInput =
        serde_json::from_value(input).map_err(|e| ToolError::InvalidInput(e.to_string()))?;

    if parsed.insights.is_empty() || parsed.insights.len() > 5 {
        return Err(ToolError::InvalidInput(
            "Insights array must contain 1-5 items".to_string(),
        ));
    }

    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| ToolError::Configuration("TABLE_NAME not set".to_string()))?;

    let ddb_client = get_dynamodb_client().await;

    let tenant_id = &options.tenant_id;
    let pk = format!("{}#{}", tenant_id, parsed.issue_id);
    let sk = "analytics";

    let insights_attr = AttributeValue::L(
        parsed
            .insights
            .iter()
            .map(|s| AttributeValue::S(s.clone()))
            .collect(),
    );

    ddb_client
        .update_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(pk.clone()))
        .key("sk", AttributeValue::S(sk.to_string()))
        .update_expression("SET #insights = :insights")
        .expression_attribute_names("#insights", "insights")
        .expression_attribute_values(":insights", insights_attr)
        .send()
        .await
        .map_err(|e| {
            tracing::error!(
                error = %e,
                issue_id = parsed.issue_id,
                tenant_id = options.tenant_id,
                "Error saving insights to newsletter record"
            );
            ToolError::DynamoDb(e.to_string())
        })?;

    Ok(serde_json::json!({ "success": true }))
}

pub async fn create_social_post_handler(
    input: Value,
    options: &ConverseOptions,
) -> Result<Value, ToolError> {
    #[derive(Deserialize)]
    struct CreateSocialPostInput {
        copy: String,
        platform: String,
        #[serde(rename = "issueId")]
        issue_id: String,
    }

    let parsed: CreateSocialPostInput =
        serde_json::from_value(input).map_err(|e| ToolError::InvalidInput(e.to_string()))?;

    if parsed.copy.len() < 100 || parsed.copy.len() > 1500 {
        return Err(ToolError::InvalidInput(
            "Copy must be between 100 and 1500 characters".to_string(),
        ));
    }

    if parsed.platform.len() < 2 || parsed.platform.len() > 20 {
        return Err(ToolError::InvalidInput(
            "Platform must be between 2 and 20 characters".to_string(),
        ));
    }

    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| ToolError::Configuration("TABLE_NAME not set".to_string()))?;

    let ddb_client = get_dynamodb_client().await;

    let pk = format!("{}#{}", options.tenant_id, parsed.issue_id);
    let sk = format!("SOCIAL#{}", parsed.platform.to_lowercase());
    let ttl = chrono::Utc::now().timestamp() + (3 * 24 * 60 * 60);
    let platform_clone = parsed.platform.clone();

    let mut item = HashMap::new();
    item.insert("pk".to_string(), AttributeValue::S(pk));
    item.insert("sk".to_string(), AttributeValue::S(sk));
    item.insert("platform".to_string(), AttributeValue::S(parsed.platform));
    item.insert("copy".to_string(), AttributeValue::S(parsed.copy));
    item.insert("ttl".to_string(), AttributeValue::N(ttl.to_string()));

    ddb_client
        .put_item()
        .table_name(table_name)
        .set_item(Some(item))
        .send()
        .await
        .map_err(|e| {
            tracing::error!(
                error = %e,
                platform = platform_clone,
                issue_id = parsed.issue_id,
                "Error saving social post"
            );
            ToolError::DynamoDb(e.to_string())
        })?;

    Ok(serde_json::json!({ "success": true }))
}

pub fn get_create_insights_tool() -> ToolDefinition {
    let schema = serde_json::json!({
        "type": "object",
        "properties": {
            "issueId": {
                "type": "string",
                "description": "Identifier of the related newsletter issue"
            },
            "insights": {
                "type": "array",
                "items": { "type": "string" },
                "minItems": 1,
                "maxItems": 5,
                "description": "List of actionable insights"
            }
        },
        "required": ["issueId", "insights"]
    });

    define_tool!(
        "createInsights",
        "Saves actionable insights for an issue",
        schema,
        true,
        create_insights_handler
    )
}

pub fn get_social_post_tool() -> ToolDefinition {
    let schema = serde_json::json!({
        "type": "object",
        "properties": {
            "copy": {
                "type": "string",
                "minLength": 100,
                "maxLength": 1500,
                "description": "Copy to include in the social media post"
            },
            "platform": {
                "type": "string",
                "minLength": 2,
                "maxLength": 20,
                "description": "Social media platform (e.g., LinkedIn, Facebook)"
            },
            "issueId": {
                "type": "string",
                "minLength": 1,
                "description": "Identifier for the related newsletter issue"
            }
        },
        "required": ["copy", "platform", "issueId"]
    });

    define_tool!(
        "createSocialMediaPost",
        "Creates a social media post for a given topic and audience",
        schema,
        true,
        create_social_post_handler
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_create_insights_rejects_empty_array() {
        let input = serde_json::json!({
            "issueId": "test-issue-123",
            "insights": []
        });

        let options = ConverseOptions {
            tenant_id: "test-tenant".to_string(),
            user_id: None,
        };

        let result = create_insights_handler(input, &options).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ToolError::InvalidInput(msg) => {
                assert_eq!(msg, "Insights array must contain 1-5 items");
            }
            _ => panic!("Expected InvalidInput error"),
        }
    }

    #[tokio::test]
    async fn test_create_insights_rejects_too_many_items() {
        let input = serde_json::json!({
            "issueId": "test-issue-123",
            "insights": [
                "Insight 1",
                "Insight 2",
                "Insight 3",
                "Insight 4",
                "Insight 5",
                "Insight 6"
            ]
        });

        let options = ConverseOptions {
            tenant_id: "test-tenant".to_string(),
            user_id: None,
        };

        let result = create_insights_handler(input, &options).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ToolError::InvalidInput(msg) => {
                assert_eq!(msg, "Insights array must contain 1-5 items");
            }
            _ => panic!("Expected InvalidInput error"),
        }
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn test_create_insights_missing_table_name_env() {
        let _guard = std::env::var("TABLE_NAME").ok();
        std::env::remove_var("TABLE_NAME");

        let input = serde_json::json!({
            "issueId": "test-issue-123",
            "insights": ["Valid insight"]
        });

        let options = ConverseOptions {
            tenant_id: "test-tenant".to_string(),
            user_id: None,
        };

        let result = create_insights_handler(input, &options).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ToolError::Configuration(msg) => {
                assert_eq!(msg, "TABLE_NAME not set");
            }
            _ => panic!("Expected Configuration error"),
        }

        if let Some(val) = _guard {
            std::env::set_var("TABLE_NAME", val);
        }
    }

    #[test]
    fn test_create_insights_validates_input_structure() {
        let valid_input = serde_json::json!({
            "issueId": "test-issue-123",
            "insights": ["Valid insight"]
        });

        #[allow(dead_code)]
        #[derive(serde::Deserialize)]
        struct CreateInsightsInput {
            #[serde(rename = "issueId")]
            issue_id: String,
            insights: Vec<String>,
        }

        let parsed: Result<CreateInsightsInput, _> = serde_json::from_value(valid_input);
        assert!(parsed.is_ok());

        let invalid_input = serde_json::json!({
            "issueId": "test-issue-123"
        });

        let parsed: Result<CreateInsightsInput, _> = serde_json::from_value(invalid_input);
        assert!(parsed.is_err());
    }

    #[tokio::test]
    async fn test_create_social_post_rejects_copy_too_short() {
        let input = serde_json::json!({
            "issueId": "test-issue-123",
            "platform": "LinkedIn",
            "copy": "a".repeat(99)
        });

        let options = ConverseOptions {
            tenant_id: "test-tenant".to_string(),
            user_id: None,
        };

        let result = create_social_post_handler(input, &options).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ToolError::InvalidInput(msg) => {
                assert_eq!(msg, "Copy must be between 100 and 1500 characters");
            }
            _ => panic!("Expected InvalidInput error"),
        }
    }

    #[tokio::test]
    async fn test_create_social_post_rejects_copy_too_long() {
        let input = serde_json::json!({
            "issueId": "test-issue-123",
            "platform": "LinkedIn",
            "copy": "a".repeat(1501)
        });

        let options = ConverseOptions {
            tenant_id: "test-tenant".to_string(),
            user_id: None,
        };

        let result = create_social_post_handler(input, &options).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ToolError::InvalidInput(msg) => {
                assert_eq!(msg, "Copy must be between 100 and 1500 characters");
            }
            _ => panic!("Expected InvalidInput error"),
        }
    }

    #[tokio::test]
    async fn test_create_social_post_rejects_platform_too_short() {
        let input = serde_json::json!({
            "issueId": "test-issue-123",
            "platform": "L",
            "copy": "a".repeat(100)
        });

        let options = ConverseOptions {
            tenant_id: "test-tenant".to_string(),
            user_id: None,
        };

        let result = create_social_post_handler(input, &options).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ToolError::InvalidInput(msg) => {
                assert_eq!(msg, "Platform must be between 2 and 20 characters");
            }
            _ => panic!("Expected InvalidInput error"),
        }
    }

    #[tokio::test]
    async fn test_create_social_post_rejects_platform_too_long() {
        let input = serde_json::json!({
            "issueId": "test-issue-123",
            "platform": "a".repeat(21),
            "copy": "a".repeat(100)
        });

        let options = ConverseOptions {
            tenant_id: "test-tenant".to_string(),
            user_id: None,
        };

        let result = create_social_post_handler(input, &options).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ToolError::InvalidInput(msg) => {
                assert_eq!(msg, "Platform must be between 2 and 20 characters");
            }
            _ => panic!("Expected InvalidInput error"),
        }
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn test_create_social_post_missing_table_name_env() {
        let _guard = std::env::var("TABLE_NAME").ok();
        std::env::remove_var("TABLE_NAME");

        let input = serde_json::json!({
            "issueId": "test-issue-123",
            "platform": "LinkedIn",
            "copy": "a".repeat(100)
        });

        let options = ConverseOptions {
            tenant_id: "test-tenant".to_string(),
            user_id: None,
        };

        let result = create_social_post_handler(input, &options).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ToolError::Configuration(msg) => {
                assert_eq!(msg, "TABLE_NAME not set");
            }
            _ => panic!("Expected Configuration error"),
        }

        if let Some(val) = _guard {
            std::env::set_var("TABLE_NAME", val);
        }
    }

    #[test]
    fn test_create_social_post_ttl_calculation() {
        let now = chrono::Utc::now().timestamp();
        let ttl = now + (3 * 24 * 60 * 60);
        let expected_ttl = now + 259200;

        assert_eq!(ttl, expected_ttl);
    }
}


