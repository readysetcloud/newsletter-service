use aws_sdk_cognitoidentityprovider::error::SdkError as CognitoSdkError;
use aws_sdk_cognitoidentityprovider::operation::admin_add_user_to_group::AdminAddUserToGroupError;
use aws_sdk_cognitoidentityprovider::operation::admin_get_user::AdminGetUserError;
use aws_sdk_cognitoidentityprovider::operation::admin_update_user_attributes::AdminUpdateUserAttributesError;
use aws_sdk_dynamodb::error::SdkError;
use aws_sdk_dynamodb::operation::delete_item::DeleteItemError;
use aws_sdk_dynamodb::operation::get_item::GetItemError;
use aws_sdk_dynamodb::operation::put_item::PutItemError;
use aws_sdk_dynamodb::operation::query::QueryError;
use aws_sdk_dynamodb::operation::update_item::UpdateItemError;
use aws_sdk_s3::error::SdkError as S3SdkError;
use aws_sdk_s3::operation::head_object::HeadObjectError;
use aws_sdk_s3::operation::put_object::PutObjectError;
use thiserror::Error;

#[derive(Error, Debug, Clone)]
pub enum AppError {
    #[error("Authentication required: {0}")]
    Unauthorized(String),

    #[error("Invalid input: {0}")]
    BadRequest(String),

    #[error("Resource not found: {0}")]
    NotFound(String),

    #[error("Permission denied: {0}")]
    Forbidden(String),

    #[error("AWS service error: {0}")]
    AwsError(String),

    #[error("Internal server error: {0}")]
    InternalError(String),
}

impl AppError {
    pub fn status_code(&self) -> u16 {
        match self {
            AppError::Unauthorized(_) => 401,
            AppError::BadRequest(_) => 400,
            AppError::NotFound(_) => 404,
            AppError::Forbidden(_) => 403,
            AppError::AwsError(_) => 500,
            AppError::InternalError(_) => 500,
        }
    }
}

impl<E> From<SdkError<GetItemError, E>> for AppError {
    fn from(err: SdkError<GetItemError, E>) -> Self {
        match err {
            SdkError::ServiceError(service_err) => match service_err.err() {
                GetItemError::ResourceNotFoundException(_) => {
                    AppError::NotFound("Resource not found".to_string())
                }
                _ => AppError::AwsError(format!("DynamoDB GetItem error: {}", service_err.err())),
            },
            _ => AppError::AwsError(format!("DynamoDB SDK error: {}", err)),
        }
    }
}

impl<E> From<SdkError<PutItemError, E>> for AppError {
    fn from(err: SdkError<PutItemError, E>) -> Self {
        match err {
            SdkError::ServiceError(service_err) => match service_err.err() {
                PutItemError::ConditionalCheckFailedException(_) => {
                    AppError::BadRequest("Condition check failed".to_string())
                }
                PutItemError::ResourceNotFoundException(_) => {
                    AppError::NotFound("Resource not found".to_string())
                }
                _ => AppError::AwsError(format!("DynamoDB PutItem error: {}", service_err.err())),
            },
            _ => AppError::AwsError(format!("DynamoDB SDK error: {}", err)),
        }
    }
}

impl<E> From<SdkError<UpdateItemError, E>> for AppError {
    fn from(err: SdkError<UpdateItemError, E>) -> Self {
        match err {
            SdkError::ServiceError(service_err) => match service_err.err() {
                UpdateItemError::ConditionalCheckFailedException(_) => {
                    AppError::BadRequest("Condition check failed".to_string())
                }
                UpdateItemError::ResourceNotFoundException(_) => {
                    AppError::NotFound("Resource not found".to_string())
                }
                _ => {
                    AppError::AwsError(format!("DynamoDB UpdateItem error: {}", service_err.err()))
                }
            },
            _ => AppError::AwsError(format!("DynamoDB SDK error: {}", err)),
        }
    }
}

impl<E> From<SdkError<QueryError, E>> for AppError {
    fn from(err: SdkError<QueryError, E>) -> Self {
        match err {
            SdkError::ServiceError(service_err) => match service_err.err() {
                QueryError::ResourceNotFoundException(_) => {
                    AppError::NotFound("Resource not found".to_string())
                }
                _ => AppError::AwsError(format!("DynamoDB Query error: {}", service_err.err())),
            },
            _ => AppError::AwsError(format!("DynamoDB SDK error: {}", err)),
        }
    }
}

impl<E> From<SdkError<DeleteItemError, E>> for AppError {
    fn from(err: SdkError<DeleteItemError, E>) -> Self {
        match err {
            SdkError::ServiceError(service_err) => match service_err.err() {
                DeleteItemError::ConditionalCheckFailedException(_) => {
                    AppError::BadRequest("Condition check failed".to_string())
                }
                DeleteItemError::ResourceNotFoundException(_) => {
                    AppError::NotFound("Resource not found".to_string())
                }
                _ => {
                    AppError::AwsError(format!("DynamoDB DeleteItem error: {}", service_err.err()))
                }
            },
            _ => AppError::AwsError(format!("DynamoDB SDK error: {}", err)),
        }
    }
}

impl<E> From<CognitoSdkError<AdminGetUserError, E>> for AppError {
    fn from(err: CognitoSdkError<AdminGetUserError, E>) -> Self {
        match err {
            CognitoSdkError::ServiceError(service_err) => match service_err.err() {
                AdminGetUserError::UserNotFoundException(_) => {
                    AppError::NotFound("User not found".to_string())
                }
                _ => {
                    AppError::AwsError(format!("Cognito AdminGetUser error: {}", service_err.err()))
                }
            },
            _ => AppError::AwsError(format!("Cognito SDK error: {}", err)),
        }
    }
}

impl<E> From<CognitoSdkError<AdminUpdateUserAttributesError, E>> for AppError {
    fn from(err: CognitoSdkError<AdminUpdateUserAttributesError, E>) -> Self {
        match err {
            CognitoSdkError::ServiceError(service_err) => match service_err.err() {
                AdminUpdateUserAttributesError::UserNotFoundException(_) => {
                    AppError::NotFound("User not found".to_string())
                }
                AdminUpdateUserAttributesError::InvalidParameterException(_) => {
                    AppError::BadRequest("Invalid parameter".to_string())
                }
                _ => AppError::AwsError(format!(
                    "Cognito AdminUpdateUserAttributes error: {}",
                    service_err.err()
                )),
            },
            _ => AppError::AwsError(format!("Cognito SDK error: {}", err)),
        }
    }
}

impl<E> From<CognitoSdkError<AdminAddUserToGroupError, E>> for AppError {
    fn from(err: CognitoSdkError<AdminAddUserToGroupError, E>) -> Self {
        match err {
            CognitoSdkError::ServiceError(service_err) => match service_err.err() {
                AdminAddUserToGroupError::UserNotFoundException(_) => {
                    AppError::NotFound("User not found".to_string())
                }
                AdminAddUserToGroupError::ResourceNotFoundException(_) => {
                    AppError::NotFound("Group not found".to_string())
                }
                _ => AppError::AwsError(format!(
                    "Cognito AdminAddUserToGroup error: {}",
                    service_err.err()
                )),
            },
            _ => AppError::AwsError(format!("Cognito SDK error: {}", err)),
        }
    }
}

impl<E> From<S3SdkError<HeadObjectError, E>> for AppError {
    fn from(err: S3SdkError<HeadObjectError, E>) -> Self {
        match err {
            S3SdkError::ServiceError(service_err) => match service_err.err() {
                HeadObjectError::NotFound(_) => {
                    AppError::NotFound("S3 object not found".to_string())
                }
                _ => AppError::AwsError(format!("S3 HeadObject error: {}", service_err.err())),
            },
            _ => AppError::AwsError(format!("S3 SDK error: {}", err)),
        }
    }
}

impl<E> From<S3SdkError<PutObjectError, E>> for AppError {
    fn from(err: S3SdkError<PutObjectError, E>) -> Self {
        AppError::AwsError(format!("S3 PutObject error: {}", err))
    }
}


