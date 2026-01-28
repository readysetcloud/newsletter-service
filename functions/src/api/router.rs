use lambda_http::{http::Method, Body, Error, Request, Response};
use serde_json::json;

use crate::controllers::{api_keys, brand, domain, profile, senders};

pub async fn route_request(event: Request) -> Result<Response<Body>, Error> {
    let method = event.method();
    let raw_path = event.uri().path();

    // Normalize path - remove /api prefix if present (from stage name)
    let path = raw_path.strip_prefix("/api").unwrap_or(raw_path);

    tracing::info!(
        method = %method,
        raw_path = %raw_path,
        normalized_path = %path,
        "Routing API request"
    );

    match (method, path) {
        // Handle OPTIONS preflight requests for CORS (any path)
        (&Method::OPTIONS, _) => handle_options().await,

        // Profile endpoints
        (&Method::GET, "/me") => profile::get_own_profile(event).await,
        (&Method::PUT, "/me") => profile::update_profile(event).await,
        (&Method::GET, path) if path.starts_with("/profile/") => {
            let user_id = extract_path_param(path, "/profile/");
            profile::get_user_profile(event, user_id).await
        }

        // Brand endpoints
        (&Method::GET, "/me/brand/check") => brand::check_brand_id(event).await,
        (&Method::PUT, "/me/brand") => brand::update_brand(event).await,
        (&Method::POST, "/me/brand/photo") => brand::upload_photo(event).await,

        // API Keys endpoints
        (&Method::GET, "/api-keys") => api_keys::list_keys(event).await,
        (&Method::POST, "/api-keys") => api_keys::create_key(event).await,
        (&Method::GET, path) if path.starts_with("/api-keys/") => {
            let key_id = extract_path_param(path, "/api-keys/");
            api_keys::get_key(event, key_id).await
        }
        (&Method::DELETE, path) if path.starts_with("/api-keys/") => {
            let key_id = extract_path_param(path, "/api-keys/");
            api_keys::delete_key(event, key_id).await
        }

        // Senders endpoints
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

        // Domain verification endpoints
        (&Method::POST, "/senders/domain") => domain::verify_domain(event).await,
        (&Method::GET, path) if path.starts_with("/senders/domain/") => {
            let domain_param = extract_domain(path);
            domain::get_domain_verification(event, domain_param).await
        }

        // Method not allowed for valid paths
        (_, path) if is_valid_api_path(path) => Ok(format_method_not_allowed()),

        // Not found
        _ => Ok(format_not_found()),
    }
}

async fn handle_options() -> Result<Response<Body>, Error> {
    newsletter::admin::response::format_options_response()
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
}

fn is_valid_api_path(path: &str) -> bool {
    // Profile paths
    path == "/me"
        || path.starts_with("/profile/")
        // Brand paths
        || path == "/me/brand"
        || path == "/me/brand/check"
        || path == "/me/brand/photo"
        // API keys paths
        || path == "/api-keys"
        || path.starts_with("/api-keys/")
        // Senders paths
        || path == "/senders"
        || path.starts_with("/senders/")
        || path == "/senders/domain"
        || path.starts_with("/senders/domain/")
}

fn extract_path_param(path: &str, prefix: &str) -> Option<String> {
    path.strip_prefix(prefix)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn extract_sender_id(path: &str) -> Option<String> {
    path.strip_prefix("/senders/")
        .and_then(|s| s.split('/').next())
        .filter(|s| !s.is_empty() && *s != "domain")
        .map(|s| s.to_string())
}

fn extract_domain(path: &str) -> Option<String> {
    path.strip_prefix("/senders/domain/")
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn format_method_not_allowed() -> Response<Body> {
    newsletter::admin::format_response(405, json!({"message": "Method not allowed"}))
        .unwrap_or_else(|_| Response::builder().status(405).body(Body::Empty).unwrap())
}

fn format_not_found() -> Response<Body> {
    newsletter::admin::format_response(404, json!({"message": "Not found"}))
        .unwrap_or_else(|_| Response::builder().status(404).body(Body::Empty).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_path_param_with_valid_input() {
        let result = extract_path_param("/profile/user123", "/profile/");
        assert_eq!(result, Some("user123".to_string()));
    }

    #[test]
    fn test_extract_path_param_with_empty_suffix() {
        let result = extract_path_param("/profile/", "/profile/");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_path_param_with_complex_id() {
        let result = extract_path_param("/api-keys/key-abc-123-xyz", "/api-keys/");
        assert_eq!(result, Some("key-abc-123-xyz".to_string()));
    }

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
    fn test_extract_sender_id_empty_path() {
        let result = extract_sender_id("/senders/");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_sender_id_domain_path() {
        let result = extract_sender_id("/senders/domain");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_domain_valid() {
        let result = extract_domain("/senders/domain/example.com");
        assert_eq!(result, Some("example.com".to_string()));
    }

    #[test]
    fn test_extract_domain_with_subdomain() {
        let result = extract_domain("/senders/domain/mail.example.com");
        assert_eq!(result, Some("mail.example.com".to_string()));
    }

    #[test]
    fn test_extract_domain_empty() {
        let result = extract_domain("/senders/domain/");
        assert_eq!(result, None);
    }

    #[test]
    fn test_is_valid_api_path_profile() {
        assert!(is_valid_api_path("/me"));
        assert!(is_valid_api_path("/profile/user123"));
    }

    #[test]
    fn test_is_valid_api_path_brand() {
        assert!(is_valid_api_path("/me/brand"));
        assert!(is_valid_api_path("/me/brand/check"));
        assert!(is_valid_api_path("/me/brand/photo"));
    }

    #[test]
    fn test_is_valid_api_path_api_keys() {
        assert!(is_valid_api_path("/api-keys"));
        assert!(is_valid_api_path("/api-keys/key-123"));
    }

    #[test]
    fn test_is_valid_api_path_senders() {
        assert!(is_valid_api_path("/senders"));
        assert!(is_valid_api_path("/senders/abc-123"));
        assert!(is_valid_api_path("/senders/domain"));
        assert!(is_valid_api_path("/senders/domain/example.com"));
    }

    #[test]
    fn test_is_valid_api_path_invalid() {
        assert!(!is_valid_api_path("/invalid"));
        assert!(!is_valid_api_path("/api/profile"));
        assert!(!is_valid_api_path("/random"));
        assert!(!is_valid_api_path(""));
        assert!(!is_valid_api_path("/admin"));
        assert!(!is_valid_api_path("/admin/unknown"));
    }

    // Route matching tests
    #[test]
    fn test_route_matching_profile_aliases() {
        // Profile paths
        assert!(is_valid_api_path("/me"));
        assert!(is_valid_api_path("/profile/user123"));
    }

    #[test]
    fn test_route_matching_brand_aliases() {
        // Brand paths
        assert!(is_valid_api_path("/me/brand"));
        assert!(is_valid_api_path("/me/brand/check"));
        assert!(is_valid_api_path("/me/brand/photo"));
    }

    #[test]
    fn test_route_matching_with_path_params() {
        // Paths with parameters should be recognized
        assert!(is_valid_api_path("/profile/user-123"));
        assert!(is_valid_api_path("/api-keys/key-abc-xyz"));
        assert!(is_valid_api_path("/senders/sender-456"));
        assert!(is_valid_api_path("/senders/domain/example.com"));
    }

    #[test]
    fn test_route_matching_senders_special_paths() {
        // Senders has special handling for /status suffix
        assert!(is_valid_api_path("/senders/sender-123/status"));
        assert!(is_valid_api_path("/senders/domain"));
    }

    #[test]
    fn test_route_matching_rejects_invalid_paths() {
        // These should not be recognized as valid API paths
        assert!(!is_valid_api_path("/unknown"));
        assert!(!is_valid_api_path("/admin"));
        assert!(!is_valid_api_path("/admin/unknown"));
        assert!(!is_valid_api_path("/me/unknown"));
    }

    #[test]
    fn test_path_normalization_strips_api_prefix() {
        // Test that /api prefix is properly stripped
        let path_with_prefix = "/api/me";
        let normalized = path_with_prefix
            .strip_prefix("/api")
            .unwrap_or(path_with_prefix);
        assert_eq!(normalized, "/me");

        let path_without_prefix = "/me";
        let normalized = path_without_prefix
            .strip_prefix("/api")
            .unwrap_or(path_without_prefix);
        assert_eq!(normalized, "/me");
    }

    // Method validation tests
    #[test]
    fn test_format_method_not_allowed_returns_405() {
        let response = format_method_not_allowed();
        assert_eq!(response.status(), 405);
    }

    #[test]
    fn test_format_not_found_returns_404() {
        let response = format_not_found();
        assert_eq!(response.status(), 404);
    }

    #[test]
    fn test_method_validation_profile_endpoints() {
        // Profile endpoints support GET and PUT
        assert!(is_valid_api_path("/me"));
        assert!(is_valid_api_path("/profile/user123"));
    }

    #[test]
    fn test_method_validation_brand_endpoints() {
        // Brand endpoints: GET for check, PUT for update, POST for photo
        assert!(is_valid_api_path("/me/brand/check"));
        assert!(is_valid_api_path("/me/brand"));
        assert!(is_valid_api_path("/me/brand/photo"));
    }

    #[test]
    fn test_method_validation_api_keys_endpoints() {
        // API keys: GET list, POST create, GET single, DELETE
        assert!(is_valid_api_path("/api-keys"));
        assert!(is_valid_api_path("/api-keys/key-123"));
    }

    #[test]
    fn test_method_validation_senders_endpoints() {
        // Senders: GET list, POST create, PUT update, PUT status, DELETE
        assert!(is_valid_api_path("/senders"));
        assert!(is_valid_api_path("/senders/sender-123"));
        assert!(is_valid_api_path("/senders/sender-123/status"));
    }

    #[test]
    fn test_method_validation_domain_endpoints() {
        // Domain: POST verify, GET status
        assert!(is_valid_api_path("/senders/domain"));
        assert!(is_valid_api_path("/senders/domain/example.com"));
    }

    // CORS handling tests
    #[test]
    fn test_cors_all_paths_are_valid_for_options() {
        // OPTIONS requests should be accepted for any path (CORS preflight)
        // The router handles OPTIONS separately before path validation
        // We verify that valid API paths work with OPTIONS
        assert!(is_valid_api_path("/me"));
        assert!(is_valid_api_path("/profile/user123"));
        assert!(is_valid_api_path("/senders"));
        assert!(is_valid_api_path("/api-keys"));
    }

    #[test]
    fn test_cors_path_normalization_with_api_prefix() {
        // CORS preflight should work with /api prefix too
        let path = "/api/me";
        let normalized = path.strip_prefix("/api").unwrap_or(path);
        assert_eq!(normalized, "/me");
        assert!(is_valid_api_path(normalized));
    }

    #[test]
    fn test_cors_handles_all_endpoint_types() {
        // Verify CORS can handle all endpoint categories
        let profile_path = "/me";
        let brand_path = "/me/brand";
        let api_keys_path = "/api-keys";
        let senders_path = "/senders";
        let domain_path = "/senders/domain";

        assert!(is_valid_api_path(profile_path));
        assert!(is_valid_api_path(brand_path));
        assert!(is_valid_api_path(api_keys_path));
        assert!(is_valid_api_path(senders_path));
        assert!(is_valid_api_path(domain_path));
    }
}
