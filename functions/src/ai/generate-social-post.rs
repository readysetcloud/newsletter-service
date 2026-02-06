use aws_sdk_dynamodb::types::AttributeValue;
use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use newsletter::ai::{
    bedrock::converse,
    error::FunctionError,
    models::{ErrorResponse, GenerateSocialPostEvent, GenerateSocialPostResponse},
    tools::{get_dynamodb_client, get_social_post_tool, ConverseOptions},
};
use serde_json::Value;

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_target(false)
        .without_time()
        .init();

    run(service_fn(function_handler)).await
}

async fn function_handler(event: LambdaEvent<GenerateSocialPostEvent>) -> Result<Value, Error> {
    let payload = event.payload;

    match generate_social_post_internal(&payload).await {
        Ok(response) => Ok(serde_json::to_value(response)?),
        Err(e) => {
            tracing::error!(
                error = %e,
                tenant_id = payload.tenant_id,
                "Error generating social post"
            );
            Ok(serde_json::to_value(ErrorResponse { success: false })?)
        }
    }
}

async fn generate_social_post_internal(
    event: &GenerateSocialPostEvent,
) -> Result<GenerateSocialPostResponse, FunctionError> {
    // Validate required fields
    if event.tenant_id.is_empty() {
        return Err(FunctionError::MissingField("tenantId".to_string()));
    }
    if event.issue_id.is_empty() {
        return Err(FunctionError::MissingField("issueId".to_string()));
    }
    if event.content.is_empty() {
        return Err(FunctionError::MissingField("content".to_string()));
    }

    // Construct prompts
    let system_prompt = get_social_post_system_prompt();
    let user_prompt = format!(
        "Issue id: {},\nIssue number: {},\ncontent:\n  {}",
        event.issue_id, event.issue_id, event.content
    );

    // Get model ID from environment
    let model_id = std::env::var("MODEL_ID")
        .map_err(|_| FunctionError::MissingField("MODEL_ID".to_string()))?;

    // Invoke Bedrock with tool
    let tools = vec![get_social_post_tool()];
    let options = ConverseOptions {
        tenant_id: event.tenant_id.clone(),
        user_id: None,
    };

    converse(&model_id, &system_prompt, &user_prompt, tools, options).await?;

    // Load social post from DynamoDB
    let copy = load_social_post(&event.tenant_id, &event.issue_id).await?;

    Ok(GenerateSocialPostResponse { copy })
}

fn get_social_post_system_prompt() -> String {
    r#"## Role
You are an assistant helping write LinkedIn posts for the Ready, Set, Cloud newsletter.
You write in Allen Helton's voice:

* Thoughtful and grounded
* Calm, confident, and practical
* Curious and explanatory
* Senior-engineer energy, not influencer tone

Your job is to transform newsletter content into a single, high-signal LinkedIn post and save it via the "createSocialMediaPost" tool.

## Input
The user will provide the full content of a newsletter issue, which may include:

* Issue number or identifier
* Title
* Featured topics or links
* Community superhero
* Editorial commentary

You must extract:

* 1-2 core ideas worth leading with
* The issue identifier (issue number or unique ID)
* The community superhero
* The contributors

Do **not** summarize the entire newsletter.
Do **not** restate content verbatim.

## Steps
Follow these steps in order:

1. Identify the most interesting systems-level idea in the issue.
   Prefer misconceptions, overlooked details, or second-order effects.
2. Write an idea-first opening (2-3 sentences):
   * Lead with insight, not an announcement
   * Do **not** mention the newsletter yet
3. Introduce the newsletter by name and issue number in one clean sentence.
4. Highlight what's inside using themes, not a table of contents.
   * Focus on why the topics matter
   * Keep this section tight and scannable
5. Call out the community superhero:
   * Name them
   * Explain why they matter in one concrete way
6. Thank contributors by name in one sentence.
7. End with a neutral link CTA.
   * No urgency language
   * No emojis
8. Combine all sections into one continuous post suitable for LinkedIn.
9. Call the "createSocialMediaPost" tool with the generated copy.

## Expectations
The generated post must:

* Be written for LinkedIn
* Be between 100 and 1500 characters total
* Use short paragraphs (1-3 sentences max)
* Optimize for mobile scanning and white space
* Prefer declarative statements over questions
* Feel evergreen, not time-bound

Avoid:
* Emojis
* Hashtags
* Marketing or hype language
* Influencer-style hooks

The tone should feel like a staff-level engineer sharing signal with peers.

## Narrowing
You must call the "createSocialMediaPost" tool.

The tool call must follow this schema exactly:

  copy: string,      // The full LinkedIn post copy
  platform: "LinkedIn",
  issueId: string    // The newsletter issue identifier (e.g. "198")

Rules:

* Output only a tool call — no prose, no explanation
* "platform" must always be "LinkedIn"
* "issueId" must be derived from the newsletter content
* "copy" must contain the entire post text

## Reference Example

> Most engineers treat document formats and edge performance as implementation details.
> They're not. They quietly shape latency, cost, and failure modes long before users notice.
>
> Binary Protocols and Edge Performance | Ready, Set, Cloud Picks of the Week #198 is out.
>
> This issue looks at why binary protocols matter, how image optimization affects real performance, and what AI at the edge actually means.
>
> This week's community superhero is Subramanya Nagabhushanaraadhya, a consistently practical voice in applied AI. Subramanya's work on efficient ML models helps teams deliver real-world impact without overcomplicating systems. Thank you for all you do!
>
> Thanks to Daniel Cummins, Rick Houlihan, Nabin Debnath, Ayman Mahmoud, and Armand Ruiz for the thoughtful contributions.
>
> Full issue here: <link>
"#.to_string()
}

async fn load_social_post(tenant_id: &str, issue_id: &str) -> Result<String, FunctionError> {
    let table_name = std::env::var("TABLE_NAME")
        .map_err(|_| FunctionError::MissingField("TABLE_NAME".to_string()))?;

    let ddb_client = get_dynamodb_client().await;

    let pk = format!("{}#{}", tenant_id, issue_id);
    let sk = "SOCIAL#linkedin";

    let response = ddb_client
        .get_item()
        .table_name(table_name)
        .key("pk", AttributeValue::S(pk))
        .key("sk", AttributeValue::S(sk.to_string()))
        .send()
        .await
        .map_err(|e| FunctionError::DynamoDb(e.to_string()))?;

    let item = response
        .item()
        .ok_or_else(|| FunctionError::MissingField("Social post not created".to_string()))?;

    let copy = item
        .get("copy")
        .and_then(|v| v.as_s().ok())
        .ok_or_else(|| FunctionError::MissingField("copy".to_string()))?;

    Ok(copy.to_string())
}
