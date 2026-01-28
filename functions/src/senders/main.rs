use lambda_http::{run, service_fn, Body, Error, Request, Response};
use newsletter_lambdas::senders::error::AppError;
use newsletter_lambdas::senders::response::format_error_response;

mod domain;
mod router;
mod senders;

async fn function_handler(event: Request) -> Result<Response<Body>, Error> {
    router::route_request(event).await
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    run(service_fn(|event: Request| async move {
        match function_handler(event).await {
            Ok(response) => Ok::<Response<Body>, std::convert::Infallible>(response),
            Err(e) => {
                tracing::error!(error = %e, "Request handling failed");

                if let Some(app_err) = e.downcast_ref::<AppError>() {
                    Ok(format_error_response(app_err))
                } else {
                    Ok(format_error_response(&AppError::InternalError(
                        e.to_string(),
                    )))
                }
            }
        }
    }))
    .await
}
