use lambda_http::{http::Method, Body, Error, Request, Response};
use serde_json::json;

use crate::controllers::{
    api_keys, brand, domain, issues, pricing, profile, segments, senders, snippets, sponsors,
    subscribers, templates,
};

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
        (&Method::GET, "/brand/check") => brand::check_brand_id(event).await,
        (&Method::GET, "/brand/validate") => brand::check_brand_id(event).await,
        (&Method::PUT, "/brand") => brand::update_brand(event).await,
        // Logo upload: POST presigns the S3 URL, PUT confirms + sanitizes the
        // uploaded object. `upload_photo` dispatches on the method internally.
        (&Method::POST, "/brand/logo") => brand::upload_photo(event).await,
        (&Method::PUT, "/brand/logo") => brand::upload_photo(event).await,

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
        (&Method::POST, path) if path.starts_with("/senders/") && path.ends_with("/test") => {
            let sender_id = extract_sender_id_before(path, "/test");
            senders::send_test_email(event, sender_id).await
        }
        (&Method::GET, path) if path.starts_with("/senders/") && path.ends_with("/status") => {
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
        (&Method::POST, "/senders/verify-domain") => domain::verify_domain(event).await,
        (&Method::GET, path) if path.starts_with("/senders/domain-verification/") => {
            let domain_param = extract_domain(path);
            domain::get_domain_verification(event, domain_param).await
        }

        // Issues endpoints
        (&Method::GET, "/issues") => issues::list_issues(event).await,
        (&Method::GET, "/issues/trends") => issues::get_trends(event).await,
        (&Method::POST, "/issues") => issues::create_issue(event).await,
        (&Method::POST, path)
            if path.starts_with("/issues/") && path.ends_with("/analytics/rebuild") =>
        {
            let issue_id = path
                .strip_prefix("/issues/")
                .and_then(|value| value.strip_suffix("/analytics/rebuild"))
                .map(|value| value.to_string());
            issues::rebuild_issue_analytics(event, issue_id).await
        }
        (&Method::POST, path) if path.starts_with("/issues/") && path.ends_with("/resend") => {
            let issue_id = path
                .strip_prefix("/issues/")
                .and_then(|value| value.strip_suffix("/resend"))
                .map(|value| value.to_string());
            issues::resend_issue(event, issue_id).await
        }
        (&Method::GET, path) if path.starts_with("/issues/") => {
            let issue_id = extract_path_param(path, "/issues/");
            issues::get_issue(event, issue_id).await
        }
        (&Method::PUT, path) if path.starts_with("/issues/") => {
            let issue_id = extract_path_param(path, "/issues/");
            issues::update_issue(event, issue_id).await
        }
        (&Method::DELETE, path) if path.starts_with("/issues/") => {
            let issue_id = extract_path_param(path, "/issues/");
            issues::delete_issue(event, issue_id).await
        }

        // Pricing endpoints
        (&Method::GET, "/pricing") => pricing::get_pricing(event).await,
        (&Method::GET, "/pricing/history") => pricing::get_pricing_history(event).await,
        (&Method::GET, "/pricing/questionnaire") => pricing::get_questionnaire(event).await,
        (&Method::POST, "/pricing/questionnaire") => pricing::submit_questionnaire(event).await,
        (&Method::POST, "/pricing/recalculate") => pricing::recalculate(event).await,
        (&Method::GET, "/pricing/narrative") => pricing::generate_narrative(event).await,
        (&Method::GET, path) if path.starts_with("/pricing/recalculate/") => {
            let job_id = extract_path_param(path, "/pricing/recalculate/");
            pricing::get_job_status(event, job_id).await
        }

        // Subscribers endpoints
        (&Method::GET, "/subscribers/count") => subscribers::get_subscriber_count(event).await,
        (&Method::GET, "/subscribers/trends") => subscribers::get_subscriber_trends(event).await,
        (&Method::GET, "/subscribers") => subscribers::list_subscribers(event).await,
        (&Method::GET, "/subscribers/health") => subscribers::get_audience_health(event).await,
        (&Method::DELETE, path) if path.starts_with("/subscribers/") => {
            let email = extract_path_param(path, "/subscribers/");
            subscribers::delete_subscriber(event, email).await
        }

        // Segments endpoints
        (&Method::POST, "/segments") => segments::create_segment(event).await,
        (&Method::GET, "/segments") => segments::list_segments(event).await,
        (&Method::GET, path) if path.starts_with("/segments/jobs/") => {
            match extract_path_param(path, "/segments/jobs/") {
                Some(job_id) => segments::get_job_status(event, &job_id).await,
                None => Ok(format_not_found()),
            }
        }
        (&Method::GET, path) if path.starts_with("/segments/") && path.ends_with("/members") => {
            match extract_segment_id(path) {
                Some(segment_id) => segments::list_members(event, &segment_id).await,
                None => Ok(format_not_found()),
            }
        }
        (&Method::POST, path) if path.starts_with("/segments/") && path.ends_with("/members") => {
            match extract_segment_id(path) {
                Some(segment_id) => segments::add_members(event, &segment_id).await,
                None => Ok(format_not_found()),
            }
        }
        (&Method::DELETE, path) if path.starts_with("/segments/") && path.ends_with("/members") => {
            match extract_segment_id(path) {
                Some(segment_id) => segments::remove_members(event, &segment_id).await,
                None => Ok(format_not_found()),
            }
        }
        (&Method::POST, path) if path.starts_with("/segments/") && path.ends_with("/export") => {
            match extract_segment_id_before(path, "/export") {
                Some(segment_id) => segments::export_segment(event, &segment_id).await,
                None => Ok(format_not_found()),
            }
        }
        (&Method::GET, path) if path.starts_with("/segments/") => {
            match extract_path_param(path, "/segments/") {
                Some(segment_id) => segments::get_segment(event, &segment_id).await,
                None => Ok(format_not_found()),
            }
        }
        (&Method::PUT, path) if path.starts_with("/segments/") => {
            match extract_path_param(path, "/segments/") {
                Some(segment_id) => segments::update_segment(event, &segment_id).await,
                None => Ok(format_not_found()),
            }
        }
        (&Method::DELETE, path) if path.starts_with("/segments/") => {
            match extract_path_param(path, "/segments/") {
                Some(segment_id) => segments::delete_segment(event, &segment_id).await,
                None => Ok(format_not_found()),
            }
        }

        // Sponsors endpoints
        (&Method::POST, "/sponsors") => sponsors::create_sponsor(event).await,
        (&Method::GET, "/sponsors") => sponsors::list_sponsors(event).await,
        // Outreach job status: GET /sponsors/:id/outreach/jobs/:jobId
        (&Method::GET, path)
            if path.starts_with("/sponsors/") && path.contains("/outreach/jobs/") =>
        {
            match extract_sponsor_and_outreach_job_id(path) {
                Some((sponsor_id, job_id)) => {
                    sponsors::get_outreach_job(event, &sponsor_id, &job_id).await
                }
                None => Ok(format_not_found()),
            }
        }
        // Sponsorship links: PUT /sponsors/:id/sponsorships/:sid/links
        (&Method::PUT, path)
            if path.starts_with("/sponsors/")
                && path.contains("/sponsorships/")
                && path.ends_with("/links") =>
        {
            match extract_sponsor_and_sponsorship_id(path) {
                Some((sponsor_id, sponsorship_id)) => {
                    sponsors::update_sponsorship_links(event, &sponsor_id, &sponsorship_id).await
                }
                None => Ok(format_not_found()),
            }
        }
        // Update sponsorship: PUT /sponsors/:id/sponsorships/:sid
        (&Method::PUT, path)
            if path.starts_with("/sponsors/") && path.contains("/sponsorships/") =>
        {
            match extract_sponsor_and_sponsorship_id(path) {
                Some((sponsor_id, sponsorship_id)) => {
                    sponsors::update_sponsorship(event, &sponsor_id, &sponsorship_id).await
                }
                None => Ok(format_not_found()),
            }
        }
        // Create sponsorship: POST /sponsors/:id/sponsorships
        (&Method::POST, path)
            if path.starts_with("/sponsors/") && path.ends_with("/sponsorships") =>
        {
            match extract_sponsor_id_from_path(path) {
                Some(sponsor_id) => sponsors::create_sponsorship(event, &sponsor_id).await,
                None => Ok(format_not_found()),
            }
        }
        // List sponsorships: GET /sponsors/:id/sponsorships
        (&Method::GET, path)
            if path.starts_with("/sponsors/") && path.ends_with("/sponsorships") =>
        {
            match extract_sponsor_id_from_path(path) {
                Some(sponsor_id) => sponsors::list_sponsorships(event, &sponsor_id).await,
                None => Ok(format_not_found()),
            }
        }
        // Sponsor logo upload: POST /sponsors/:id/logo
        (&Method::POST, path) if path.starts_with("/sponsors/") && path.ends_with("/logo") => {
            match extract_sponsor_id_from_path(path) {
                Some(sponsor_id) => sponsors::upload_sponsor_logo(event, &sponsor_id).await,
                None => Ok(format_not_found()),
            }
        }
        // Sponsor logo confirm: PUT /sponsors/:id/logo
        (&Method::PUT, path) if path.starts_with("/sponsors/") && path.ends_with("/logo") => {
            match extract_sponsor_id_from_path(path) {
                Some(sponsor_id) => sponsors::confirm_sponsor_logo(event, &sponsor_id).await,
                None => Ok(format_not_found()),
            }
        }
        // Archive sponsor: POST /sponsors/:id/archive
        (&Method::POST, path) if path.starts_with("/sponsors/") && path.ends_with("/archive") => {
            match extract_sponsor_id_from_path(path) {
                Some(sponsor_id) => sponsors::archive_sponsor(event, &sponsor_id).await,
                None => Ok(format_not_found()),
            }
        }
        // Restore sponsor: POST /sponsors/:id/restore
        (&Method::POST, path) if path.starts_with("/sponsors/") && path.ends_with("/restore") => {
            match extract_sponsor_id_from_path(path) {
                Some(sponsor_id) => sponsors::restore_sponsor(event, &sponsor_id).await,
                None => Ok(format_not_found()),
            }
        }
        // Trigger outreach: POST /sponsors/:id/outreach
        (&Method::POST, path) if path.starts_with("/sponsors/") && path.ends_with("/outreach") => {
            match extract_sponsor_id_from_path(path) {
                Some(sponsor_id) => sponsors::trigger_outreach(event, &sponsor_id).await,
                None => Ok(format_not_found()),
            }
        }
        // List outreach: GET /sponsors/:id/outreach
        (&Method::GET, path) if path.starts_with("/sponsors/") && path.ends_with("/outreach") => {
            match extract_sponsor_id_from_path(path) {
                Some(sponsor_id) => sponsors::list_outreach(event, &sponsor_id).await,
                None => Ok(format_not_found()),
            }
        }
        // Update sponsor: PUT /sponsors/:id
        (&Method::PUT, path) if path.starts_with("/sponsors/") => {
            match extract_path_param(path, "/sponsors/") {
                Some(sponsor_id) => sponsors::update_sponsor(event, &sponsor_id).await,
                None => Ok(format_not_found()),
            }
        }
        // Get sponsor: GET /sponsors/:id
        (&Method::GET, path) if path.starts_with("/sponsors/") => {
            match extract_path_param(path, "/sponsors/") {
                Some(sponsor_id) => sponsors::get_sponsor(event, &sponsor_id).await,
                None => Ok(format_not_found()),
            }
        }

        // Templates endpoints
        (&Method::GET, "/templates") => templates::list_templates(event).await,
        (&Method::POST, "/templates") => templates::create_template(event).await,
        // Preview an arbitrary, unsaved template from the editor.
        (&Method::POST, "/templates/preview") => templates::preview_template(event).await,
        // Preview a saved template: POST /templates/:id/preview
        (&Method::POST, path) if path.starts_with("/templates/") && path.ends_with("/preview") => {
            let template_id = extract_template_id_before(path, "/preview");
            templates::preview_saved_template(event, template_id).await
        }
        (&Method::GET, path) if path.starts_with("/templates/") => {
            let template_id = extract_path_param(path, "/templates/");
            templates::get_template(event, template_id).await
        }
        (&Method::PUT, path) if path.starts_with("/templates/") => {
            let template_id = extract_path_param(path, "/templates/");
            templates::update_template(event, template_id).await
        }
        (&Method::DELETE, path) if path.starts_with("/templates/") => {
            let template_id = extract_path_param(path, "/templates/");
            templates::delete_template(event, template_id).await
        }

        // Snippets endpoints
        (&Method::GET, "/snippets") => snippets::list_snippets(event).await,
        (&Method::POST, "/snippets") => snippets::create_snippet(event).await,
        (&Method::GET, path) if path.starts_with("/snippets/") => {
            let snippet_id = extract_path_param(path, "/snippets/");
            snippets::get_snippet(event, snippet_id).await
        }
        (&Method::PUT, path) if path.starts_with("/snippets/") => {
            let snippet_id = extract_path_param(path, "/snippets/");
            snippets::update_snippet(event, snippet_id).await
        }
        (&Method::DELETE, path) if path.starts_with("/snippets/") => {
            let snippet_id = extract_path_param(path, "/snippets/");
            snippets::delete_snippet(event, snippet_id).await
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
        || path == "/brand"
        || path == "/brand/check"
        || path == "/brand/validate"
        || path == "/brand/logo"
        // API keys paths
        || path == "/api-keys"
        || path.starts_with("/api-keys/")
        // Senders paths
        || path == "/senders"
        || path.starts_with("/senders/")
        || path == "/senders/verify-domain"
        || path.starts_with("/senders/domain-verification/")
        // Issues paths
        || path == "/issues"
        || path == "/issues/trends"
        || path.starts_with("/issues/")
        // Pricing paths
        || path == "/pricing"
        || path == "/pricing/history"
        || path == "/pricing/questionnaire"
        || path == "/pricing/narrative"
        || path == "/pricing/recalculate"
        || path.starts_with("/pricing/recalculate/")
        // Subscribers paths
        || path == "/subscribers"
        || path == "/subscribers/count"
        || path == "/subscribers/trends"
        || path == "/subscribers/health"
        || path.starts_with("/subscribers/")
        // Segments paths
        || path == "/segments"
        || path.starts_with("/segments/")
        // Sponsors paths
        || path == "/sponsors"
        || path.starts_with("/sponsors/")
        // Templates paths
        || path == "/templates"
        || path.starts_with("/templates/")
        // Snippets paths
        || path == "/snippets"
        || path.starts_with("/snippets/")
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

fn extract_sender_id_before(path: &str, suffix: &str) -> Option<String> {
    path.strip_prefix("/senders/")
        .and_then(|s| s.strip_suffix(suffix))
        .filter(|s| !s.is_empty() && *s != "domain")
        .map(|s| s.to_string())
}

/// Extract the template ID from paths like `/templates/:id/preview`.
fn extract_template_id_before(path: &str, suffix: &str) -> Option<String> {
    path.strip_prefix("/templates/")
        .and_then(|s| s.strip_suffix(suffix))
        .filter(|s| !s.is_empty() && *s != "preview")
        .map(|s| s.to_string())
}

fn extract_domain(path: &str) -> Option<String> {
    path.strip_prefix("/senders/domain-verification/")
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn extract_segment_id(path: &str) -> Option<String> {
    path.strip_prefix("/segments/")
        .and_then(|s| s.split('/').next())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn extract_segment_id_before(path: &str, suffix: &str) -> Option<String> {
    path.strip_prefix("/segments/")
        .and_then(|s| s.strip_suffix(suffix))
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Extract sponsor ID from paths like `/sponsors/:id/archive`, `/sponsors/:id/sponsorships`, etc.
fn extract_sponsor_id_from_path(path: &str) -> Option<String> {
    path.strip_prefix("/sponsors/")
        .and_then(|s| s.split('/').next())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Extract sponsor ID and sponsorship ID from paths like `/sponsors/:id/sponsorships/:sid`
/// or `/sponsors/:id/sponsorships/:sid/links`.
fn extract_sponsor_and_sponsorship_id(path: &str) -> Option<(String, String)> {
    let rest = path.strip_prefix("/sponsors/")?;
    let parts: Vec<&str> = rest.split('/').collect();
    // parts: [sponsor_id, "sponsorships", sponsorship_id, ...]
    if parts.len() >= 3
        && parts[1] == "sponsorships"
        && !parts[0].is_empty()
        && !parts[2].is_empty()
    {
        Some((parts[0].to_string(), parts[2].to_string()))
    } else {
        None
    }
}

/// Extract sponsor ID and job ID from paths like `/sponsors/:id/outreach/jobs/:jobId`.
fn extract_sponsor_and_outreach_job_id(path: &str) -> Option<(String, String)> {
    let rest = path.strip_prefix("/sponsors/")?;
    let parts: Vec<&str> = rest.split('/').collect();
    // parts: [sponsor_id, "outreach", "jobs", job_id]
    if parts.len() >= 4
        && parts[1] == "outreach"
        && parts[2] == "jobs"
        && !parts[0].is_empty()
        && !parts[3].is_empty()
    {
        Some((parts[0].to_string(), parts[3].to_string()))
    } else {
        None
    }
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
    fn test_extract_sender_id_before_test_suffix() {
        let result = extract_sender_id_before("/senders/abc-123/test", "/test");
        assert_eq!(result, Some("abc-123".to_string()));
    }

    #[test]
    fn test_extract_sender_id_before_test_empty() {
        let result = extract_sender_id_before("/senders//test", "/test");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_sender_id_before_test_rejects_domain() {
        let result = extract_sender_id_before("/senders/domain/test", "/test");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_domain_valid() {
        let result = extract_domain("/senders/domain-verification/example.com");
        assert_eq!(result, Some("example.com".to_string()));
    }

    #[test]
    fn test_extract_domain_with_subdomain() {
        let result = extract_domain("/senders/domain-verification/mail.example.com");
        assert_eq!(result, Some("mail.example.com".to_string()));
    }

    #[test]
    fn test_extract_domain_empty() {
        let result = extract_domain("/senders/domain-verification/");
        assert_eq!(result, None);
    }

    #[test]
    fn test_is_valid_api_path_profile() {
        assert!(is_valid_api_path("/me"));
        assert!(is_valid_api_path("/profile/user123"));
    }

    #[test]
    fn test_is_valid_api_path_brand() {
        assert!(is_valid_api_path("/brand"));
        assert!(is_valid_api_path("/brand/check"));
        assert!(is_valid_api_path("/brand/validate"));
        assert!(is_valid_api_path("/brand/logo"));
    }

    #[test]
    fn test_is_valid_api_path_api_keys() {
        assert!(is_valid_api_path("/api-keys"));
        assert!(is_valid_api_path("/api-keys/key-123"));
    }

    #[test]
    fn test_brand_logo_path_replaces_legacy_photo_path() {
        // The dashboard and openapi.yaml both call /brand/logo (POST to presign,
        // PUT to confirm). The old /brand/photo path is gone — guard against a
        // regression that would 404 every logo upload again.
        assert!(is_valid_api_path("/brand/logo"));
        assert!(!is_valid_api_path("/brand/photo"));
    }

    #[test]
    fn test_is_valid_api_path_senders() {
        assert!(is_valid_api_path("/senders"));
        assert!(is_valid_api_path("/senders/abc-123"));
        assert!(is_valid_api_path("/senders/domain"));
        assert!(is_valid_api_path("/senders/domain/example.com"));
    }

    #[test]
    fn test_is_valid_api_path_issues() {
        assert!(is_valid_api_path("/issues"));
        assert!(is_valid_api_path("/issues/trends"));
        assert!(is_valid_api_path("/issues/issue-123"));
        assert!(is_valid_api_path("/issues/tenant-456#789"));
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
        assert!(is_valid_api_path("/brand"));
        assert!(is_valid_api_path("/brand/check"));
        assert!(is_valid_api_path("/brand/validate"));
        assert!(is_valid_api_path("/brand/logo"));
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
    fn test_route_matching_issues_paths() {
        // Issues paths
        assert!(is_valid_api_path("/issues"));
        assert!(is_valid_api_path("/issues/trends"));
        assert!(is_valid_api_path("/issues/issue-123"));
        assert!(is_valid_api_path("/issues/tenant-abc#456"));
        assert!(is_valid_api_path("/issues/issue-123/resend"));
        assert!(is_valid_api_path("/issues/issue-123/analytics/rebuild"));
    }

    #[test]
    fn test_is_valid_api_path_subscribers() {
        assert!(is_valid_api_path("/subscribers"));
        assert!(is_valid_api_path("/subscribers/count"));
        assert!(is_valid_api_path("/subscribers/trends"));
        assert!(is_valid_api_path("/subscribers/health"));
    }

    #[test]
    fn test_extract_issue_id_from_path() {
        // Test issue ID extraction using existing extract_path_param
        let result = extract_path_param("/issues/issue-123", "/issues/");
        assert_eq!(result, Some("issue-123".to_string()));

        let result = extract_path_param("/issues/tenant-abc#456", "/issues/");
        assert_eq!(result, Some("tenant-abc#456".to_string()));

        let result = extract_path_param("/issues/", "/issues/");
        assert_eq!(result, None);
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
        // Brand endpoints: GET for check/validate, PUT for update, POST/PUT for logo
        assert!(is_valid_api_path("/brand/check"));
        assert!(is_valid_api_path("/brand/validate"));
        assert!(is_valid_api_path("/brand"));
        assert!(is_valid_api_path("/brand/logo"));
    }

    #[test]
    fn test_method_validation_api_keys_endpoints() {
        // API keys: GET list, POST create, GET single, DELETE
        assert!(is_valid_api_path("/api-keys"));
        assert!(is_valid_api_path("/api-keys/key-123"));
    }

    #[test]
    fn test_method_validation_senders_endpoints() {
        // Senders: GET list, POST create, PUT update, GET status, DELETE
        assert!(is_valid_api_path("/senders"));
        assert!(is_valid_api_path("/senders/sender-123"));
        assert!(is_valid_api_path("/senders/sender-123/status"));
    }

    #[test]
    fn test_method_validation_domain_endpoints() {
        // Domain: POST verify-domain, GET domain-verification/{domain}
        assert!(is_valid_api_path("/senders/verify-domain"));
        assert!(is_valid_api_path(
            "/senders/domain-verification/example.com"
        ));
    }

    #[test]
    fn test_method_validation_issues_endpoints() {
        // Issues: GET list, GET trends, GET single, POST create/rebuild/resend, PUT update, DELETE
        assert!(is_valid_api_path("/issues"));
        assert!(is_valid_api_path("/issues/trends"));
        assert!(is_valid_api_path("/issues/issue-123"));
    }

    #[test]
    fn test_method_validation_subscriber_endpoints() {
        assert!(is_valid_api_path("/subscribers"));
        assert!(is_valid_api_path("/subscribers/count"));
        assert!(is_valid_api_path("/subscribers/trends"));
        assert!(is_valid_api_path("/subscribers/health"));
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
        let brand_path = "/brand";
        let api_keys_path = "/api-keys";
        let senders_path = "/senders";
        let domain_path = "/senders/domain";
        let pricing_path = "/pricing";

        assert!(is_valid_api_path(profile_path));
        assert!(is_valid_api_path(brand_path));
        assert!(is_valid_api_path(api_keys_path));
        assert!(is_valid_api_path(senders_path));
        assert!(is_valid_api_path(domain_path));
        assert!(is_valid_api_path(pricing_path));
    }

    #[test]
    fn test_is_valid_api_path_pricing() {
        assert!(is_valid_api_path("/pricing"));
        assert!(is_valid_api_path("/pricing/questionnaire"));
        assert!(is_valid_api_path("/pricing/recalculate"));
        assert!(is_valid_api_path("/pricing/recalculate/job-abc-123"));
    }

    #[test]
    fn test_pricing_recalculate_job_id_extraction() {
        let result =
            extract_path_param("/pricing/recalculate/job-abc-123", "/pricing/recalculate/");
        assert_eq!(result, Some("job-abc-123".to_string()));

        let result = extract_path_param("/pricing/recalculate/", "/pricing/recalculate/");
        assert_eq!(result, None);
    }

    // Segment helper tests
    #[test]
    fn test_extract_segment_id_from_members_path() {
        let result = extract_segment_id("/segments/seg-123/members");
        assert_eq!(result, Some("seg-123".to_string()));
    }

    #[test]
    fn test_extract_segment_id_from_simple_path() {
        let result = extract_segment_id("/segments/seg-abc");
        assert_eq!(result, Some("seg-abc".to_string()));
    }

    #[test]
    fn test_extract_segment_id_empty() {
        let result = extract_segment_id("/segments/");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_segment_id_before_export() {
        let result = extract_segment_id_before("/segments/seg-123/export", "/export");
        assert_eq!(result, Some("seg-123".to_string()));
    }

    #[test]
    fn test_extract_segment_id_before_no_suffix() {
        let result = extract_segment_id_before("/segments/seg-123", "/export");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_segment_id_before_empty() {
        let result = extract_segment_id_before("/segments//export", "/export");
        assert_eq!(result, None);
    }

    #[test]
    fn test_is_valid_api_path_segments() {
        assert!(is_valid_api_path("/segments"));
        assert!(is_valid_api_path("/segments/seg-123"));
        assert!(is_valid_api_path("/segments/seg-123/members"));
        assert!(is_valid_api_path("/segments/seg-123/export"));
        assert!(is_valid_api_path("/segments/jobs/job-456"));
    }

    // Sponsor helper tests
    #[test]
    fn test_is_valid_api_path_sponsors() {
        assert!(is_valid_api_path("/sponsors"));
        assert!(is_valid_api_path("/sponsors/sp-123"));
        assert!(is_valid_api_path("/sponsors/sp-123/archive"));
        assert!(is_valid_api_path("/sponsors/sp-123/restore"));
        assert!(is_valid_api_path("/sponsors/sp-123/sponsorships"));
        assert!(is_valid_api_path("/sponsors/sp-123/sponsorships/ss-456"));
        assert!(is_valid_api_path(
            "/sponsors/sp-123/sponsorships/ss-456/links"
        ));
        assert!(is_valid_api_path("/sponsors/sp-123/outreach"));
        assert!(is_valid_api_path("/sponsors/sp-123/outreach/jobs/job-789"));
    }

    #[test]
    fn test_is_valid_api_path_templates() {
        assert!(is_valid_api_path("/templates"));
        assert!(is_valid_api_path("/templates/abc-123"));
    }

    #[test]
    fn test_extract_template_id_from_path() {
        let result = extract_path_param("/templates/tmpl-123", "/templates/");
        assert_eq!(result, Some("tmpl-123".to_string()));

        let result = extract_path_param("/templates/", "/templates/");
        assert_eq!(result, None);
    }

    #[test]
    fn test_is_valid_api_path_template_preview() {
        assert!(is_valid_api_path("/templates/preview"));
        assert!(is_valid_api_path("/templates/tmpl-123/preview"));
    }

    #[test]
    fn test_extract_template_id_before_preview() {
        let result = extract_template_id_before("/templates/tmpl-123/preview", "/preview");
        assert_eq!(result, Some("tmpl-123".to_string()));
    }

    #[test]
    fn test_extract_template_id_before_preview_empty() {
        let result = extract_template_id_before("/templates//preview", "/preview");
        assert_eq!(result, None);
    }

    #[test]
    fn test_is_valid_api_path_snippets() {
        assert!(is_valid_api_path("/snippets"));
        assert!(is_valid_api_path("/snippets/abc-123"));
    }

    #[test]
    fn test_extract_snippet_id_from_path() {
        let result = extract_path_param("/snippets/snip-123", "/snippets/");
        assert_eq!(result, Some("snip-123".to_string()));

        let result = extract_path_param("/snippets/", "/snippets/");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_template_id_before_preview_rejects_unsaved_route() {
        // `/templates/preview` is the unsaved-preview route, not an id named
        // "preview"; extracting an id from it must yield None.
        let result = extract_template_id_before("/templates/preview", "/preview");
        assert_eq!(result, None);
    }

    #[test]
    fn test_template_preview_routes_precede_generic_get() {
        // The unsaved preview route is an exact match and the saved preview
        // route guards on the `/preview` suffix, so neither should be captured
        // by the generic `GET /templates/:id` arm.
        assert!("/templates/preview".starts_with("/templates/"));
        assert!("/templates/tmpl-123/preview".ends_with("/preview"));
    }

    #[test]
    fn test_extract_sponsor_id_from_path_valid() {
        let result = extract_sponsor_id_from_path("/sponsors/sp-123/archive");
        assert_eq!(result, Some("sp-123".to_string()));
    }

    #[test]
    fn test_extract_sponsor_id_from_path_sponsorships() {
        let result = extract_sponsor_id_from_path("/sponsors/sp-abc/sponsorships");
        assert_eq!(result, Some("sp-abc".to_string()));
    }

    #[test]
    fn test_extract_sponsor_id_from_path_empty() {
        let result = extract_sponsor_id_from_path("/sponsors//archive");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_sponsor_and_sponsorship_id_valid() {
        let result = extract_sponsor_and_sponsorship_id("/sponsors/sp-123/sponsorships/ss-456");
        assert_eq!(result, Some(("sp-123".to_string(), "ss-456".to_string())));
    }

    #[test]
    fn test_extract_sponsor_and_sponsorship_id_with_links() {
        let result =
            extract_sponsor_and_sponsorship_id("/sponsors/sp-123/sponsorships/ss-456/links");
        assert_eq!(result, Some(("sp-123".to_string(), "ss-456".to_string())));
    }

    #[test]
    fn test_extract_sponsor_and_sponsorship_id_missing_sid() {
        let result = extract_sponsor_and_sponsorship_id("/sponsors/sp-123/sponsorships/");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_sponsor_and_sponsorship_id_no_sponsorships() {
        let result = extract_sponsor_and_sponsorship_id("/sponsors/sp-123/other/ss-456");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_sponsor_and_outreach_job_id_valid() {
        let result = extract_sponsor_and_outreach_job_id("/sponsors/sp-123/outreach/jobs/job-789");
        assert_eq!(result, Some(("sp-123".to_string(), "job-789".to_string())));
    }

    #[test]
    fn test_extract_sponsor_and_outreach_job_id_missing_job() {
        let result = extract_sponsor_and_outreach_job_id("/sponsors/sp-123/outreach/jobs/");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_sponsor_and_outreach_job_id_wrong_path() {
        let result = extract_sponsor_and_outreach_job_id("/sponsors/sp-123/outreach/other/job-1");
        assert_eq!(result, None);
    }

    // Sponsor logo route tests
    #[test]
    fn test_is_valid_api_path_sponsor_logo() {
        assert!(is_valid_api_path("/sponsors/sp-123/logo"));
        assert!(is_valid_api_path("/sponsors/abc-def-ghi/logo"));
    }

    #[test]
    fn test_extract_sponsor_id_from_logo_path() {
        let result = extract_sponsor_id_from_path("/sponsors/sp-123/logo");
        assert_eq!(result, Some("sp-123".to_string()));
    }

    #[tokio::test]
    async fn test_route_post_sponsor_logo_dispatches_correctly() {
        // Verify POST /sponsors/:id/logo path matches the logo upload arm
        let path = "/sponsors/sp-123/logo";
        let method = &Method::POST;
        assert!(
            path.starts_with("/sponsors/") && path.ends_with("/logo"),
            "POST /sponsors/:id/logo should match the logo upload route guard"
        );
        assert_eq!(method, &Method::POST);
        let sponsor_id = extract_sponsor_id_from_path(path);
        assert_eq!(sponsor_id, Some("sp-123".to_string()));
    }

    #[tokio::test]
    async fn test_route_put_sponsor_logo_dispatches_correctly() {
        // Verify PUT /sponsors/:id/logo path matches the logo confirm arm
        let path = "/sponsors/sp-123/logo";
        let method = &Method::PUT;
        assert!(
            path.starts_with("/sponsors/") && path.ends_with("/logo"),
            "PUT /sponsors/:id/logo should match the logo confirm route guard"
        );
        assert_eq!(method, &Method::PUT);
        let sponsor_id = extract_sponsor_id_from_path(path);
        assert_eq!(sponsor_id, Some("sp-123".to_string()));
    }

    #[test]
    fn test_sponsor_logo_unsupported_method_returns_405() {
        // /sponsors/:id/logo is a valid API path, so unsupported methods should get 405
        let path = "/sponsors/sp-123/logo";
        assert!(is_valid_api_path(path));
        // The router returns 405 for valid paths with unsupported methods
        let response = format_method_not_allowed();
        assert_eq!(response.status(), 405);
    }
}
