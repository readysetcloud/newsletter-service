use lambda_http::{http::Method, Body, Error, Request, Response};
use newsletter_lambdas::admin::format_response;
use serde_json::json;

use crate::brand;
use crate::profile;

pub async fn route_request(event: Request) -> Result<Response<Body>, Error> {
    let method = event.method();
    let raw_path = event.uri().path();

    // Normalize path - remove /api prefix if present (from stage name)
    let path = raw_path.strip_prefix("/api").unwrap_or(raw_path);

    tracing::info!(
        method = %method,
        raw_path = %raw_path,
        normalized_path = %path,
        "Routing admin request"
    );

    match (method, path) {
        // Handle OPTIONS preflight requests for CORS (any path)
        (&Method::OPTIONS, _) => {
            Ok(newsletter_lambdas::admin::response::format_options_response()?)
        }

        // Profile endpoints - support both /me and /admin/profile paths
        (&Method::GET, "/me") | (&Method::GET, "/admin/me") | (&Method::GET, "/admin/profile") => {
            handle_get_own_profile(event).await
        }
        (&Method::PUT, "/me")
        | (&Method::PUT, "/admin/me")
        | (&Method::PUT, "/me/profile")
        | (&Method::PUT, "/admin/profile") => handle_update_profile(event).await,
        (&Method::GET, path) if path.starts_with("/admin/profile/") => {
            handle_get_user_profile(event).await
        }
        // Brand endpoints - support both /me/brand and /admin/brand paths
        (&Method::GET, "/me/brand/check")
        | (&Method::GET, "/admin/me/brand/check")
        | (&Method::GET, "/admin/brand/check") => handle_check_brand_id(event).await,
        (&Method::PUT, "/me/brand")
        | (&Method::PUT, "/admin/me/brand")
        | (&Method::PUT, "/admin/brand") => handle_update_brand(event).await,
        (&Method::POST, "/me/brand/photo")
        | (&Method::POST, "/admin/me/brand/photo")
        | (&Method::POST, "/admin/brand/photo") => handle_upload_brand_photo(event).await,
        // API Keys endpoints
        (&Method::GET, "/admin/api-keys") => handle_list_api_keys(event).await,
        (&Method::POST, "/admin/api-keys") => handle_create_api_key(event).await,
        (&Method::GET, path) if path.starts_with("/admin/api-keys/") => {
            handle_get_api_key(event).await
        }
        (&Method::DELETE, path) if path.starts_with("/admin/api-keys/") => {
            handle_delete_api_key(event).await
        }
        (_, path) if is_valid_admin_path(path) => Ok(format_response(
            405,
            json!({"message": "Method not allowed"}),
        )?),
        _ => Ok(format_response(404, json!({"message": "Not found"}))?),
    }
}

fn is_valid_admin_path(path: &str) -> bool {
    path == "/me"
        || path == "/me/profile"
        || path == "/me/brand"
        || path == "/me/brand/check"
        || path == "/me/brand/photo"
        || path == "/admin/me"
        || path == "/admin/me/brand"
        || path == "/admin/me/brand/check"
        || path == "/admin/me/brand/photo"
        || path == "/admin/profile"
        || path.starts_with("/admin/profile/")
        || path == "/admin/brand/check"
        || path == "/admin/brand"
        || path == "/admin/brand/photo"
        || path == "/admin/api-keys"
        || path.starts_with("/admin/api-keys/")
}

pub fn extract_path_param(path: &str, prefix: &str) -> Option<String> {
    path.strip_prefix(prefix)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

async fn handle_get_own_profile(event: Request) -> Result<Response<Body>, Error> {
    profile::get_own_profile(event).await
}

async fn handle_get_user_profile(event: Request) -> Result<Response<Body>, Error> {
    let raw_path = event.uri().path();
    let path = raw_path.strip_prefix("/api").unwrap_or(raw_path);
    let user_id = extract_path_param(path, "/admin/profile/");
    profile::get_user_profile(event, user_id).await
}

async fn handle_update_profile(event: Request) -> Result<Response<Body>, Error> {
    profile::update_profile(event).await
}

async fn handle_check_brand_id(event: Request) -> Result<Response<Body>, Error> {
    brand::check_brand_id(event).await
}

async fn handle_update_brand(event: Request) -> Result<Response<Body>, Error> {
    brand::update_brand(event).await
}

async fn handle_upload_brand_photo(event: Request) -> Result<Response<Body>, Error> {
    brand::upload_photo(event).await
}

async fn handle_list_api_keys(event: Request) -> Result<Response<Body>, Error> {
    crate::api_keys::list_keys(event).await
}

async fn handle_create_api_key(event: Request) -> Result<Response<Body>, Error> {
    crate::api_keys::create_key(event).await
}

async fn handle_get_api_key(event: Request) -> Result<Response<Body>, Error> {
    let raw_path = event.uri().path();
    let path = raw_path.strip_prefix("/api").unwrap_or(raw_path);
    let key_id = extract_path_param(path, "/admin/api-keys/");
    crate::api_keys::get_key(event, key_id).await
}

async fn handle_delete_api_key(event: Request) -> Result<Response<Body>, Error> {
    let raw_path = event.uri().path();
    let path = raw_path.strip_prefix("/api").unwrap_or(raw_path);
    let key_id = extract_path_param(path, "/admin/api-keys/");
    crate::api_keys::delete_key(event, key_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_path_param_with_valid_input() {
        let result = extract_path_param("/admin/profile/user123", "/admin/profile/");
        assert_eq!(result, Some("user123".to_string()));
    }

    #[test]
    fn test_extract_path_param_with_empty_suffix() {
        let result = extract_path_param("/admin/profile/", "/admin/profile/");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_path_param_with_no_match() {
        let result = extract_path_param("/admin/brand", "/admin/profile/");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_path_param_api_key() {
        let result = extract_path_param("/admin/api-keys/key456", "/admin/api-keys/");
        assert_eq!(result, Some("key456".to_string()));
    }

    #[test]
    fn test_is_valid_admin_path_profile() {
        assert!(is_valid_admin_path("/admin/profile"));
        assert!(is_valid_admin_path("/admin/profile/user123"));
    }

    #[test]
    fn test_is_valid_admin_path_brand() {
        assert!(is_valid_admin_path("/admin/brand"));
        assert!(is_valid_admin_path("/admin/brand/check"));
        assert!(is_valid_admin_path("/admin/brand/photo"));
    }

    #[test]
    fn test_is_valid_admin_path_api_keys() {
        assert!(is_valid_admin_path("/admin/api-keys"));
        assert!(is_valid_admin_path("/admin/api-keys/key123"));
    }

    #[test]
    fn test_is_valid_admin_path_invalid() {
        assert!(!is_valid_admin_path("/admin/invalid"));
        assert!(!is_valid_admin_path("/api/profile"));
        assert!(!is_valid_admin_path("/admin"));
    }

    #[test]
    fn test_extract_path_param_preserves_special_chars() {
        let result = extract_path_param("/admin/profile/user-123_abc", "/admin/profile/");
        assert_eq!(result, Some("user-123_abc".to_string()));
    }

    #[test]
    fn test_extract_path_param_with_trailing_slash() {
        let result = extract_path_param("/admin/api-keys/key123/", "/admin/api-keys/");
        assert_eq!(result, Some("key123/".to_string()));
    }
}
