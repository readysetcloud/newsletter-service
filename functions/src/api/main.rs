use lambda_http::{run, service_fn, Body, Error, Request, Response};
use newsletter::admin::error::AppError as AdminError;
use newsletter::admin::format_error_response;
use newsletter::senders::error::AppError as SendersError;

mod controllers;
mod router;

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

                // Try to downcast to known error types
                if let Some(admin_err) = e.downcast_ref::<AdminError>() {
                    Ok(format_error_response(admin_err))
                } else if let Some(senders_err) = e.downcast_ref::<SendersError>() {
                    Ok(newsletter::senders::response::format_error_response(
                        senders_err,
                    ))
                } else {
                    Ok(format_error_response(&AdminError::InternalError(
                        e.to_string(),
                    )))
                }
            }
        }
    }))
    .await
}
