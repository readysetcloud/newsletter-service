use super::error::BedrockError;
use super::tools::{ConverseOptions, ToolDefinition};
use aws_sdk_bedrockruntime::types::{
    ContentBlock, ConversationRole, Message, SystemContentBlock, Tool, ToolConfiguration,
    ToolResultBlock, ToolResultContentBlock, ToolUseBlock,
};
use aws_sdk_bedrockruntime::Client as BedrockClient;
use serde_json::Value;
use tokio::sync::OnceCell;

static BEDROCK_CLIENT: OnceCell<BedrockClient> = OnceCell::const_new();

const MAX_ITERATIONS: usize = 10;
const MAX_TOKENS: i32 = 10000;

pub async fn get_bedrock_client() -> &'static BedrockClient {
    BEDROCK_CLIENT
        .get_or_init(|| async {
            let config = aws_config::load_from_env().await;
            BedrockClient::new(&config)
        })
        .await
}

pub async fn converse(
    model_id: &str,
    system_prompt: &str,
    user_prompt: &str,
    tool_defs: Vec<ToolDefinition>,
    options: ConverseOptions,
) -> Result<String, BedrockError> {
    let client = get_bedrock_client().await;
    let mut messages: Vec<Message> = vec![Message::builder()
        .role(ConversationRole::User)
        .content(ContentBlock::Text(user_prompt.to_string()))
        .build()
        .map_err(|e| BedrockError::MessageBuild(e.to_string()))?];

    let system_blocks = vec![SystemContentBlock::Text(system_prompt.to_string())];

    let tools: Vec<Tool> = tool_defs.iter().map(|td| td.to_bedrock_tool()).collect();
    let tool_config = if !tools.is_empty() {
        Some(
            ToolConfiguration::builder()
                .set_tools(Some(tools))
                .build()
                .map_err(|e| BedrockError::ToolConfig(e.to_string()))?,
        )
    } else {
        None
    };

    let mut iteration = 0;
    let mut final_response = String::new();

    while iteration < MAX_ITERATIONS {
        iteration += 1;

        let mut request = client
            .converse()
            .model_id(model_id)
            .set_messages(Some(messages.clone()))
            .set_system(Some(system_blocks.clone()));

        if let Some(ref config) = tool_config {
            request = request.tool_config(config.clone());
        }

        request = request.inference_config(
            aws_sdk_bedrockruntime::types::InferenceConfiguration::builder()
                .max_tokens(MAX_TOKENS)
                .build(),
        );

        let response = request
            .send()
            .await
            .map_err(|e| BedrockError::ApiCall(e.to_string()))?;

        let output = response.output().ok_or(BedrockError::NoOutput)?;

        let message = match output {
            aws_sdk_bedrockruntime::types::ConverseOutput::Message(msg) => msg,
            _ => return Err(BedrockError::UnexpectedOutput),
        };

        let content = message.content();
        messages.push(
            Message::builder()
                .role(ConversationRole::Assistant)
                .set_content(Some(content.to_vec()))
                .build()
                .map_err(|e| BedrockError::MessageBuild(e.to_string()))?,
        );

        let tool_uses: Vec<&ToolUseBlock> = content
            .iter()
            .filter_map(|block| match block {
                ContentBlock::ToolUse(tu) => Some(tu),
                _ => None,
            })
            .collect();

        let text_blocks: Vec<String> = content
            .iter()
            .filter_map(|block| match block {
                ContentBlock::Text(text) => Some(text.clone()),
                _ => None,
            })
            .collect();

        if !tool_uses.is_empty() {
            let mut tool_results = Vec::new();

            for tool_use in tool_uses {
                let tool_name = tool_use.name();

                fn document_to_json(doc: &aws_smithy_types::Document) -> Value {
                    match doc {
                        aws_smithy_types::Document::Null => Value::Null,
                        aws_smithy_types::Document::Bool(b) => Value::Bool(*b),
                        aws_smithy_types::Document::Number(n) => match n {
                            aws_smithy_types::Number::PosInt(i) => {
                                serde_json::json!(*i as i64)
                            }
                            aws_smithy_types::Number::NegInt(i) => serde_json::json!(*i),
                            aws_smithy_types::Number::Float(f) => serde_json::json!(*f),
                        },
                        aws_smithy_types::Document::String(s) => Value::String(s.clone()),
                        aws_smithy_types::Document::Array(arr) => {
                            Value::Array(arr.iter().map(document_to_json).collect())
                        }
                        aws_smithy_types::Document::Object(obj) => Value::Object(
                            obj.iter()
                                .map(|(k, v)| (k.clone(), document_to_json(v)))
                                .collect(),
                        ),
                    }
                }

                let tool_input = document_to_json(tool_use.input());

                tracing::info!(
                    iteration = iteration,
                    tool_name = tool_name,
                    tool_input = ?tool_input,
                    tool_use_id = tool_use.tool_use_id(),
                    "Tool called"
                );

                let tool_result = execute_tool(&tool_defs, tool_name, tool_input, &options).await;

                tracing::info!(
                    tool_name = tool_name,
                    tool_result = ?tool_result,
                    "Tool result"
                );

                let result_content = ToolResultContentBlock::Text(
                    serde_json::to_string(&tool_result)
                        .map_err(|e| BedrockError::JsonSerialization(e.to_string()))?,
                );

                tool_results.push(ContentBlock::ToolResult(
                    ToolResultBlock::builder()
                        .tool_use_id(tool_use.tool_use_id())
                        .content(result_content)
                        .build()
                        .map_err(|e| BedrockError::ToolResultBuild(e.to_string()))?,
                ));
            }

            messages.push(
                Message::builder()
                    .role(ConversationRole::User)
                    .set_content(Some(tool_results))
                    .build()
                    .map_err(|e| BedrockError::MessageBuild(e.to_string()))?,
            );
        } else if !text_blocks.is_empty() {
            final_response = text_blocks.join("");
            break;
        } else {
            tracing::warn!(iteration = iteration, "Unexpected content structure");
            final_response = "Received unexpected response type from model".to_string();
            break;
        }
    }

    if final_response.is_empty() && iteration >= MAX_ITERATIONS {
        tracing::warn!(
            max_iterations = MAX_ITERATIONS,
            "Stopped due to iteration limit"
        );
    }

    Ok(sanitize_response(&final_response))
}

fn sanitize_response(text: &str) -> String {
    let re = regex::Regex::new(r"<thinking>[\s\S]*?</thinking>\s*").unwrap();
    re.replace_all(text, "").trim().to_string()
}

async fn execute_tool(
    tool_defs: &[ToolDefinition],
    tool_name: &str,
    tool_input: Value,
    options: &ConverseOptions,
) -> Value {
    let tool = match tool_defs.iter().find(|t| t.name == tool_name) {
        Some(t) => t,
        None => {
            return serde_json::json!({
                "error": format!("Unknown tool: {}", tool_name)
            });
        }
    };

    match (tool.handler)(tool_input, options).await {
        Ok(result) => result,
        Err(e) => {
            serde_json::json!({
                "error": e.to_string()
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_max_iterations_constant() {
        assert_eq!(MAX_ITERATIONS, 10);
    }

    #[test]
    fn test_sanitize_response_removes_thinking_tags() {
        let input = "<thinking>This is internal reasoning</thinking>Final response";
        let result = sanitize_response(input);
        assert_eq!(result, "Final response");

        let input_with_multiple = "<thinking>First thought</thinking>Some text<thinking>Second thought</thinking>More text";
        let result = sanitize_response(input_with_multiple);
        assert_eq!(result, "Some textMore text");

        let input_no_tags = "Just a normal response";
        let result = sanitize_response(input_no_tags);
        assert_eq!(result, "Just a normal response");
    }
}
