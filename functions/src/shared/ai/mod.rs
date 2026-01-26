pub mod bedrock;
pub mod error;
pub mod models;
pub mod tools;

pub use bedrock::{converse, get_bedrock_client};
pub use error::{BedrockError, FunctionError, ToolError};
pub use models::{
    ErrorResponse, GenerateInsightsEvent, GenerateInsightsResponse, GenerateSocialPostEvent,
    GenerateSocialPostResponse, HistoricalAnalytics,
};
pub use tools::{
    create_insights_handler, create_social_post_handler, get_create_insights_tool,
    get_dynamodb_client, get_social_post_tool, ConverseOptions, ToolDefinition, ToolHandler,
};


