use aws_sdk_dynamodb::Client as DynamoDbClient;
use aws_sdk_scheduler::Client as SchedulerClient;
use aws_sdk_sesv2::Client as SesClient;
use tokio::sync::OnceCell;

static DYNAMODB_CLIENT: OnceCell<DynamoDbClient> = OnceCell::const_new();
static SES_CLIENT: OnceCell<SesClient> = OnceCell::const_new();
static SCHEDULER_CLIENT: OnceCell<SchedulerClient> = OnceCell::const_new();

pub async fn get_dynamodb_client() -> &'static DynamoDbClient {
    DYNAMODB_CLIENT
        .get_or_init(|| async {
            let config = aws_config::load_from_env().await;
            DynamoDbClient::new(&config)
        })
        .await
}

pub async fn get_ses_client() -> &'static SesClient {
    SES_CLIENT
        .get_or_init(|| async {
            let config = aws_config::load_from_env().await;
            SesClient::new(&config)
        })
        .await
}

pub async fn get_scheduler_client() -> &'static SchedulerClient {
    SCHEDULER_CLIENT
        .get_or_init(|| async {
            let config = aws_config::load_from_env().await;
            SchedulerClient::new(&config)
        })
        .await
}


