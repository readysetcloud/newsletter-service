use thiserror::Error;

#[derive(Error, Debug)]
pub enum BedrockError {
    #[error("Bedrock API call failed: {0}")]
    ApiCall(String),

    #[error("No output from Bedrock")]
    NoOutput,

    #[error("Unexpected output format from Bedrock")]
    UnexpectedOutput,

    #[error("Failed to build message: {0}")]
    MessageBuild(String),

    #[error("Failed to build tool configuration: {0}")]
    ToolConfig(String),

    #[error("Failed to build tool result: {0}")]
    ToolResultBuild(String),

    #[error("JSON serialization error: {0}")]
    JsonSerialization(String),

    #[error("JSON deserialization error: {0}")]
    JsonDeserialization(String),
}

#[derive(Error, Debug)]
pub enum ToolError {
    #[error("Invalid tool input: {0}")]
    InvalidInput(String),

    #[error("Configuration error: {0}")]
    Configuration(String),

    #[error("DynamoDB error: {0}")]
    DynamoDb(String),
}

#[derive(Error, Debug)]
pub enum FunctionError {
    #[error("Missing required field: {0}")]
    MissingField(String),

    #[error("Bedrock error: {0}")]
    Bedrock(#[from] BedrockError),

    #[error("Tool error: {0}")]
    Tool(#[from] ToolError),

    #[error("DynamoDB error: {0}")]
    DynamoDb(String),

    #[error("JSON error: {0}")]
    Json(String),
}


