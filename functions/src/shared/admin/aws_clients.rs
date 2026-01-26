use aws_sdk_cognitoidentityprovider::Client as CognitoClient;
use aws_sdk_dynamodb::Client as DynamoDbClient;
use aws_sdk_s3::Client as S3Client;
use tokio::sync::OnceCell;

static DYNAMODB_CLIENT: OnceCell<DynamoDbClient> = OnceCell::const_new();
static COGNITO_CLIENT: OnceCell<CognitoClient> = OnceCell::const_new();
static S3_CLIENT: OnceCell<S3Client> = OnceCell::const_new();

pub async fn get_dynamodb_client() -> &'static DynamoDbClient {
    DYNAMODB_CLIENT
        .get_or_init(|| async {
            let config = aws_config::load_from_env().await;
            DynamoDbClient::new(&config)
        })
        .await
}

pub async fn get_cognito_client() -> &'static CognitoClient {
    COGNITO_CLIENT
        .get_or_init(|| async {
            let config = aws_config::load_from_env().await;
            CognitoClient::new(&config)
        })
        .await
}

pub async fn get_s3_client() -> &'static S3Client {
    S3_CLIENT
        .get_or_init(|| async {
            let config = aws_config::load_from_env().await;
            S3Client::new(&config)
        })
        .await
}


