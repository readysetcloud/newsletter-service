use super::error::AppError;
use regex::Regex;
use std::sync::OnceLock;

static EMAIL_REGEX: OnceLock<Regex> = OnceLock::new();
static DOMAIN_REGEX: OnceLock<Regex> = OnceLock::new();

fn get_email_regex() -> &'static Regex {
    EMAIL_REGEX.get_or_init(|| {
        Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").expect("Failed to compile email regex")
    })
}

fn get_domain_regex() -> &'static Regex {
    DOMAIN_REGEX.get_or_init(|| {
        Regex::new(r"^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$")
            .expect("Failed to compile domain regex")
    })
}

pub fn validate_email(email: &str) -> Result<(), AppError> {
    let email_regex = get_email_regex();

    if !email_regex.is_match(email) {
        return Err(AppError::BadRequest(
            "Invalid email address format".to_string(),
        ));
    }

    Ok(())
}

pub fn validate_domain(domain: &str) -> Result<(), AppError> {
    if domain.contains("://") || domain.contains('/') {
        return Err(AppError::BadRequest(
            "Domain should not include protocol or path".to_string(),
        ));
    }

    let domain_regex = get_domain_regex();

    if !domain_regex.is_match(domain) {
        return Err(AppError::BadRequest("Invalid domain format".to_string()));
    }

    Ok(())
}

pub fn extract_domain(email: &str) -> String {
    email.split('@').nth(1).unwrap_or("").to_string()
}

pub fn validate_content_type(content_type: &str) -> Result<(), AppError> {
    const ALLOWED_TYPES: &[&str] = &[
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "image/webp",
    ];

    if !ALLOWED_TYPES.contains(&content_type.to_lowercase().as_str()) {
        return Err(AppError::BadRequest(
            "Only image files are allowed (JPEG, PNG, GIF, WebP)".to_string(),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_email_valid() {
        assert!(validate_email("user@example.com").is_ok());
        assert!(validate_email("test.user@example.co.uk").is_ok());
        assert!(validate_email("user+tag@example.com").is_ok());
    }

    #[test]
    fn test_validate_email_missing_at() {
        let result = validate_email("userexample.com");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_email_missing_domain() {
        let result = validate_email("user@");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_email_missing_tld() {
        let result = validate_email("user@example");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_email_with_spaces() {
        let result = validate_email("user @example.com");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_domain_valid() {
        assert!(validate_domain("example.com").is_ok());
        assert!(validate_domain("sub.example.com").is_ok());
        assert!(validate_domain("example.co.uk").is_ok());
    }

    #[test]
    fn test_validate_domain_with_protocol() {
        let result = validate_domain("https://example.com");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_domain_with_path() {
        let result = validate_domain("example.com/path");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_domain_invalid_format() {
        let result = validate_domain("example..com");
        assert!(result.is_err());
    }

    #[test]
    fn test_extract_domain() {
        assert_eq!(extract_domain("user@example.com"), "example.com");
        assert_eq!(extract_domain("test@sub.example.com"), "sub.example.com");
    }

    #[test]
    fn test_extract_domain_no_at() {
        assert_eq!(extract_domain("example.com"), "");
    }

    #[test]
    fn test_validate_content_type_valid() {
        assert!(validate_content_type("image/jpeg").is_ok());
        assert!(validate_content_type("image/jpg").is_ok());
        assert!(validate_content_type("image/png").is_ok());
        assert!(validate_content_type("image/gif").is_ok());
        assert!(validate_content_type("image/webp").is_ok());
    }

    #[test]
    fn test_validate_content_type_case_insensitive() {
        assert!(validate_content_type("IMAGE/JPEG").is_ok());
        assert!(validate_content_type("Image/Png").is_ok());
    }

    #[test]
    fn test_validate_content_type_invalid() {
        let result = validate_content_type("application/pdf");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::BadRequest(_)));
    }

    #[test]
    fn test_validate_content_type_text() {
        let result = validate_content_type("text/plain");
        assert!(result.is_err());
    }
}
