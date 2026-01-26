use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("AWS service error: {0}")]
    AwsError(String),

    #[error("Internal error: {0}")]
    InternalError(String),
}

impl AppError {
    pub fn status_code(&self) -> u16 {
        match self {
            AppError::BadRequest(_) => 400,
            AppError::Unauthorized(_) => 401,
            AppError::NotFound(_) => 404,
            AppError::Conflict(_) => 409,
            AppError::AwsError(_) => 500,
            AppError::InternalError(_) => 500,
        }
    }

    pub fn message(&self) -> String {
        match self {
            AppError::BadRequest(msg) => msg.clone(),
            AppError::Unauthorized(msg) => msg.clone(),
            AppError::NotFound(msg) => msg.clone(),
            AppError::Conflict(msg) => msg.clone(),
            AppError::AwsError(_) => "An error occurred processing your request".to_string(),
            AppError::InternalError(_) => "An internal error occurred".to_string(),
        }
    }
}
