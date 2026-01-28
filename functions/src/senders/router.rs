use lambda_http::{http::Method, Body, Error, Request, Response};
use newsletter_lambdas::senders::response::format_response;
use serde_json::json;

use crate::{domain, senders};

pub async fn route_request(event: Request) -> Result<Response<Body>, Error> {
    let method = event.method();
    let raw_path = event.uri().path();

    // Normalize path - remove /api prefix if present (from stage name)
    let path = raw_path.strip_prefix("/api").unwrap_or(raw_path);

    tracing::info!(
        method = %method,
        raw_path = %raw_path,
        normalized_path = %path,
        "Routing senders request"
    );

    // Handle OPTIONS preflight requests for CORS
    if method == Method::OPTIONS {
        return Ok(newsletter_lambdas::senders::response::format_options_response()?);
    }

    match (method, path) {
        (&Method::GET, "/senders") => senders::list_senders(event).await,
        (&Method::POST, "/senders") => senders::create_sender(event).await,
        (&Method::PUT, path) if path.starts_with("/senders/") && path.ends_with("/status") => {
            let sender_id = extract_sender_id(path);
            senders::get_sender_status(event, sender_id).await
        }
        (&Method::PUT, path) if path.starts_with("/senders/") => {
            let sender_id = extract_sender_id(path);
            senders::update_sender(event, sender_id).await
        }
        (&Method::DELETE, path) if path.starts_with("/senders/") => {
            let sender_id = extract_sender_id(path);
            senders::delete_sender(event, sender_id).await
        }
        (&Method::POST, "/senders/domain") => domain::verify_domain(event).await,
        (&Method::GET, path) if path.starts_with("/senders/domain/") => {
            let domain_param = extract_domain(path);
            domain::get_domain_verification(event, domain_param).await
        }
        (_, path) if is_valid_senders_path(path) => Ok(format_response(
            405,
            json!({"message": "Method not allowed"}),
        )?),
        _ => Ok(format_response(404, json!({"message": "Not found"}))?),
    }
}

fn is_valid_senders_path(path: &str) -> bool {
    path == "/senders"
        || path.starts_with("/senders/")
        || path == "/senders/domain"
        || path.starts_with("/senders/domain/")
}

pub fn extract_sender_id(path: &str) -> Option<String> {
    path.strip_prefix("/senders/")
        .and_then(|s| s.split('/').next())
        .filter(|s| !s.is_empty() && *s != "domain")
        .map(|s| s.to_string())
}

pub fn extract_domain(path: &str) -> Option<String> {
    path.strip_prefix("/senders/domain/")
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_sender_id_valid() {
        let result = extract_sender_id("/senders/abc-123");
        assert_eq!(result, Some("abc-123".to_string()));
    }

    #[test]
    fn test_extract_sender_id_with_status_suffix() {
        let result = extract_sender_id("/senders/abc-123/status");
        assert_eq!(result, Some("abc-123".to_string()));
    }

    #[test]
    fn test_extract_sender_id_empty_suffix() {
        let result = extract_sender_id("/senders/");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_sender_id_domain_path() {
        let result = extract_sender_id("/senders/domain");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_sender_id_domain_with_value() {
        let result = extract_sender_id("/senders/domain/example.com");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_domain_valid() {
        let result = extract_domain("/senders/domain/example.com");
        assert_eq!(result, Some("example.com".to_string()));
    }

    #[test]
    fn test_extract_domain_subdomain() {
        let result = extract_domain("/senders/domain/mail.example.com");
        assert_eq!(result, Some("mail.example.com".to_string()));
    }

    #[test]
    fn test_extract_domain_empty_suffix() {
        let result = extract_domain("/senders/domain/");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_domain_no_match() {
        let result = extract_domain("/senders/abc-123");
        assert_eq!(result, None);
    }

    #[test]
    fn test_is_valid_senders_path_root() {
        assert!(is_valid_senders_path("/senders"));
    }

    #[test]
    fn test_is_valid_senders_path_with_id() {
        assert!(is_valid_senders_path("/senders/abc-123"));
        assert!(is_valid_senders_path("/senders/abc-123/status"));
    }

    #[test]
    fn test_is_valid_senders_path_domain() {
        assert!(is_valid_senders_path("/senders/domain"));
        assert!(is_valid_senders_path("/senders/domain/example.com"));
    }

    #[test]
    fn test_is_valid_senders_path_invalid() {
        assert!(!is_valid_senders_path("/sender"));
        assert!(!is_valid_senders_path("/api/senders"));
        assert!(!is_valid_senders_path("/admin/senders"));
    }

    #[test]
    fn test_extract_sender_id_preserves_special_chars() {
        let result = extract_sender_id("/senders/abc-123_def");
        assert_eq!(result, Some("abc-123_def".to_string()));
    }

    #[test]
    fn test_extract_domain_preserves_hyphens() {
        let result = extract_domain("/senders/domain/my-domain.com");
        assert_eq!(result, Some("my-domain.com".to_string()));
    }

    #[test]
    fn test_extract_sender_id_uuid_format() {
        let result = extract_sender_id("/senders/550e8400-e29b-41d4-a716-446655440000");
        assert_eq!(
            result,
            Some("550e8400-e29b-41d4-a716-446655440000".to_string())
        );
    }

    #[test]
    fn test_extract_domain_with_tld() {
        let result = extract_domain("/senders/domain/example.co.uk");
        assert_eq!(result, Some("example.co.uk".to_string()));
    }
}
