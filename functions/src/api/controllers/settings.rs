//! Tenant-level settings: the defaults the platform falls back to when a
//! request doesn't spell a value out.
//!
//! The settings that live here today:
//!
//! - `timezone` — the tenant's wall-clock zone. It is what the dashboard
//!   formats dates in, and the zone a date-only send is read against.
//! - `defaultSendTime` — the time of day (in `timezone`) a send lands on when
//!   the caller supplied a date but no time.
//! - `subjectTemplate` — how an email subject is built when the request that
//!   staged the issue didn't supply one (the markdown/GitHub path never does).
//! - `issueUrlPattern` — where an issue lives on the tenant's own site, used
//!   for the "view online" link in the email.
//!
//! The first two have system defaults; the last two do not. An unset
//! `subjectTemplate` means "use the issue title", and an unset
//! `issueUrlPattern` means "there is no public URL, omit the link" — for both,
//! guessing a value would put the wrong words or the wrong domain in front of
//! somebody's subscribers.
//!
//! Both are stored on a single `pk = {tenantId}`, `sk = "settings"` record.
//! An absent record — or an absent attribute on it — means "use the system
//! default", so a tenant that never opens the settings page still gets
//! well-defined behavior ([`TenantSettings::default`]).

use aws_sdk_dynamodb::types::AttributeValue;
use chrono::{DateTime, LocalResult, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use lambda_http::{Body, Error, Request, Response};
use newsletter::admin::{auth, aws_clients, error::AppError, response};
use serde::Serialize;
use serde_json::Value;
use std::env;

// ── Constants ──────────────────────────────────────────────────────────

const SETTINGS_SK: &str = "settings";

/// Used for both display formatting and date-only send resolution until the
/// tenant picks a zone. UTC keeps the pre-settings behavior (bare ISO strings
/// were already read as UTC) intact for tenants that never configure one.
pub(crate) const DEFAULT_TIMEZONE: &str = "UTC";

/// Where a date-only send lands when the tenant hasn't chosen a time. Morning
/// local time is the common newsletter slot, and it is far enough from
/// midnight that a small zone mistake doesn't move the send to another day.
pub(crate) const DEFAULT_SEND_TIME: &str = "09:00";

/// Subject lines are capped by the create API at 200 characters; the template
/// gets headroom for the tokens it expands.
const SUBJECT_TEMPLATE_MAX_LEN: usize = 300;

const URL_PATTERN_MAX_LEN: usize = 500;

/// Tokens `subjectTemplate` may reference. Validated on write so a typo is
/// caught in the settings form rather than shipping literally in a subject
/// line. Kept in step with `buildSubject` in `functions/utils/tenant-settings.mjs`.
const SUBJECT_TOKENS: [&str; 3] = ["title", "number", "date"];

/// Tokens `issueUrlPattern` may reference.
const URL_TOKENS: [&str; 1] = ["number"];

// ── Data types ─────────────────────────────────────────────────────────

/// The effective settings for a tenant: stored values where present, system
/// defaults everywhere else. Callers never have to deal with `None`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TenantSettings {
    pub timezone: String,
    pub default_send_time: String,
    /// Absent when the tenant hasn't chosen one — there is no sensible system
    /// default for somebody else's subject line.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject_template: Option<String>,
    /// Absent when the tenant hasn't chosen one, in which case the email omits
    /// its "view online" link rather than pointing at the wrong site.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue_url_pattern: Option<String>,
}

impl Default for TenantSettings {
    fn default() -> Self {
        Self {
            timezone: DEFAULT_TIMEZONE.to_string(),
            default_send_time: DEFAULT_SEND_TIME.to_string(),
            subject_template: None,
            issue_url_pattern: None,
        }
    }
}

impl TenantSettings {
    /// The tenant's zone, falling back to UTC if a stored value is somehow
    /// unparseable. Resolution must not fail on data that was already
    /// validated on the way in.
    pub(crate) fn timezone(&self) -> Tz {
        self.timezone.parse().unwrap_or(chrono_tz::UTC)
    }

    /// The tenant's default send time, falling back to the system default for
    /// the same reason as [`Self::timezone`].
    pub(crate) fn send_time(&self) -> NaiveTime {
        parse_send_time(&self.default_send_time)
            .unwrap_or_else(|_| parse_send_time(DEFAULT_SEND_TIME).expect("valid default"))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsResponse {
    /// Effective settings — what the platform will actually use.
    settings: TenantSettings,
    /// The system defaults, so the dashboard can mark which effective values
    /// are inherited rather than chosen.
    defaults: TenantSettings,
    /// Which settings the tenant has explicitly chosen. `settings` alone can't
    /// answer that — a stored `UTC` and an unset timezone look identical — and
    /// the dashboard needs the difference to offer a better suggestion than the
    /// system default (e.g. the viewer's own timezone).
    configured: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
}

/// Every setting name this endpoint recognizes, in display order.
const SETTING_NAMES: [&str; 4] = [
    "timezone",
    "defaultSendTime",
    "subjectTemplate",
    "issueUrlPattern",
];

/// One update to one settings attribute. `None` is an explicit reset back to
/// the system default (`"timezone": null` in the request body).
struct SettingChange {
    attribute: &'static str,
    value: Option<String>,
}

// ── Handlers ───────────────────────────────────────────────────────────

pub async fn get_settings(event: Request) -> Result<Response<Body>, Error> {
    match handle_get_settings(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_get_settings(event: Request) -> Result<Response<Body>, AppError> {
    let tenant_id = require_tenant(&event)?;
    let record = get_settings_item(&tenant_id).await?;

    response::format_response(200, build_response(record))
}

pub async fn update_settings(event: Request) -> Result<Response<Body>, Error> {
    match handle_update_settings(event).await {
        Ok(response) => Ok(response),
        Err(e) => Ok(response::format_error_response(&e)),
    }
}

async fn handle_update_settings(event: Request) -> Result<Response<Body>, AppError> {
    let tenant_id = require_tenant(&event)?;

    let body: Value = if event.body().is_empty() {
        Value::Object(Default::default())
    } else {
        serde_json::from_slice(event.body())
            .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?
    };

    let changes = extract_changes(&body)?;
    if changes.is_empty() {
        return Err(AppError::BadRequest(
            "At least one setting must be provided".to_string(),
        ));
    }

    let updated_at = Utc::now().to_rfc3339();
    write_settings(&tenant_id, &changes, &updated_at).await?;

    let record = get_settings_item(&tenant_id).await?;
    response::format_response(200, build_response(record))
}

// ── Validation ─────────────────────────────────────────────────────────

/// Pulls the recognized settings out of a request body. A key that is present
/// with a `null` value is a reset; a key that is absent is left alone.
fn extract_changes(body: &Value) -> Result<Vec<SettingChange>, AppError> {
    let Value::Object(map) = body else {
        return Err(AppError::BadRequest(
            "Request body must be a JSON object".to_string(),
        ));
    };

    let mut changes = Vec::new();

    if let Some(value) = map.get("timezone") {
        changes.push(SettingChange {
            attribute: "timezone",
            value: optional_string("timezone", value)?
                .map(|tz| validate_timezone(&tz))
                .transpose()?,
        });
    }

    if let Some(value) = map.get("defaultSendTime") {
        changes.push(SettingChange {
            attribute: "defaultSendTime",
            value: optional_string("defaultSendTime", value)?
                .map(|time| validate_send_time(&time))
                .transpose()?,
        });
    }

    if let Some(value) = map.get("subjectTemplate") {
        changes.push(SettingChange {
            attribute: "subjectTemplate",
            value: optional_string("subjectTemplate", value)?
                .map(|template| validate_subject_template(&template))
                .transpose()?,
        });
    }

    if let Some(value) = map.get("issueUrlPattern") {
        changes.push(SettingChange {
            attribute: "issueUrlPattern",
            value: optional_string("issueUrlPattern", value)?
                .map(|pattern| validate_issue_url_pattern(&pattern))
                .transpose()?,
        });
    }

    Ok(changes)
}

/// Accepts a string, `null`, or an empty string. The latter two both mean
/// "clear this setting" — an empty select in the dashboard shouldn't be stored
/// as an empty timezone.
fn optional_string(field: &str, value: &Value) -> Result<Option<String>, AppError> {
    match value {
        Value::Null => Ok(None),
        Value::String(s) if s.trim().is_empty() => Ok(None),
        Value::String(s) => Ok(Some(s.trim().to_string())),
        _ => Err(AppError::BadRequest(format!(
            "{} must be a string or null",
            field
        ))),
    }
}

/// Validates an IANA zone name against the bundled tz database and returns it
/// in its canonical form, so `utc` and `UTC` don't produce two spellings of
/// the same zone in storage.
fn validate_timezone(value: &str) -> Result<String, AppError> {
    let tz: Tz = value.parse().map_err(|_| {
        AppError::BadRequest(format!(
            "timezone must be a valid IANA timezone name (e.g. America/Chicago), got '{}'",
            value
        ))
    })?;

    Ok(tz.name().to_string())
}

/// Validates a 24-hour `HH:MM` time of day and returns it zero-padded, so
/// `9:05` and `09:05` don't produce two spellings of the same time.
fn validate_send_time(value: &str) -> Result<String, AppError> {
    let time = parse_send_time(value)?;
    Ok(time.format("%H:%M").to_string())
}

fn parse_send_time(value: &str) -> Result<NaiveTime, AppError> {
    let invalid = || {
        AppError::BadRequest(format!(
            "defaultSendTime must be a 24-hour HH:MM time, got '{}'",
            value
        ))
    };

    let (hours, minutes) = value.split_once(':').ok_or_else(invalid)?;
    // `%H:%M` alone would accept "9:5"; requiring digit-only components of the
    // right length keeps the stored form unambiguous.
    if hours.len() > 2 || hours.is_empty() || minutes.len() != 2 {
        return Err(invalid());
    }

    let hours: u32 = hours.parse().map_err(|_| invalid())?;
    let minutes: u32 = minutes.parse().map_err(|_| invalid())?;

    NaiveTime::from_hms_opt(hours, minutes, 0).ok_or_else(invalid)
}

/// Validates a subject template. The hard rule is no CR/LF: a subject line is
/// an email header, and a newline in one is header injection. Everything else
/// is a guard against a template that would obviously misbehave at send time.
fn validate_subject_template(value: &str) -> Result<String, AppError> {
    if value.len() > SUBJECT_TEMPLATE_MAX_LEN {
        return Err(AppError::BadRequest(format!(
            "subjectTemplate must be {} characters or fewer",
            SUBJECT_TEMPLATE_MAX_LEN
        )));
    }

    if value.chars().any(|c| c.is_control()) {
        return Err(AppError::BadRequest(
            "subjectTemplate must not contain line breaks or control characters".to_string(),
        ));
    }

    validate_tokens("subjectTemplate", value, &SUBJECT_TOKENS)?;

    Ok(value.to_string())
}

/// Validates the public issue URL pattern. It ends up as an `href` in every
/// subscriber's inbox, so it must be an absolute http(s) URL, and it must vary
/// per issue or every issue would link to the same page.
fn validate_issue_url_pattern(value: &str) -> Result<String, AppError> {
    if value.len() > URL_PATTERN_MAX_LEN {
        return Err(AppError::BadRequest(format!(
            "issueUrlPattern must be {} characters or fewer",
            URL_PATTERN_MAX_LEN
        )));
    }

    if !value.starts_with("https://") && !value.starts_with("http://") {
        return Err(AppError::BadRequest(
            "issueUrlPattern must be an absolute http:// or https:// URL".to_string(),
        ));
    }

    if value.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(AppError::BadRequest(
            "issueUrlPattern must not contain whitespace or control characters".to_string(),
        ));
    }

    validate_tokens("issueUrlPattern", value, &URL_TOKENS)?;

    if !value.contains("{{number}}") {
        return Err(AppError::BadRequest(
            "issueUrlPattern must include {{number}} so each issue links to its own page"
                .to_string(),
        ));
    }

    Ok(value.to_string())
}

/// Rejects `{{token}}` placeholders the renderer doesn't know about. An
/// unknown token would otherwise reach subscribers verbatim, braces and all.
fn validate_tokens(field: &str, value: &str, allowed: &[&str]) -> Result<(), AppError> {
    let mut rest = value;

    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            return Err(AppError::BadRequest(format!(
                "{} has an unclosed {{{{ placeholder",
                field
            )));
        };

        let token = after[..end].trim();
        if !allowed.contains(&token) {
            return Err(AppError::BadRequest(format!(
                "{} does not support the placeholder {{{{{}}}}} — available: {}",
                field,
                token,
                allowed
                    .iter()
                    .map(|t| format!("{{{{{}}}}}", t))
                    .collect::<Vec<_>>()
                    .join(", ")
            )));
        }

        rest = &after[end + 2..];
    }

    Ok(())
}

// ── Date-only resolution ───────────────────────────────────────────────

/// True when a schedule value carries a date but no time (`YYYY-MM-DD`) and so
/// needs the tenant's default send time to become an instant.
pub(crate) fn is_date_only(value: &str) -> bool {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

/// Turns a bare `YYYY-MM-DD` into an instant: the tenant's default send time
/// on that date, read as a wall-clock time in the tenant's timezone.
///
/// Daylight-saving transitions make that wall-clock time either ambiguous
/// (it happens twice) or nonexistent (it is skipped). Both are resolved
/// forward — the earlier of two candidates, or the first valid minute after a
/// gap — so a scheduled send always lands on the requested day and never
/// before the time the tenant asked for.
pub(crate) fn resolve_date_only(
    value: &str,
    settings: &TenantSettings,
) -> Result<DateTime<Utc>, AppError> {
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest(format!("'{}' is not a valid date", value)))?;

    let tz = settings.timezone();
    let naive = date.and_time(settings.send_time());

    let local = match tz.from_local_datetime(&naive) {
        LocalResult::Single(dt) => dt,
        LocalResult::Ambiguous(earlier, _) => earlier,
        LocalResult::None => {
            // Spring-forward gap: walk forward a minute at a time to the first
            // wall-clock time that exists. Gaps are at most a couple of hours.
            let mut candidate = naive;
            loop {
                candidate += chrono::Duration::minutes(1);
                if candidate.date() != naive.date() {
                    return Err(AppError::InternalError(format!(
                        "Could not resolve {} in timezone {}",
                        naive,
                        tz.name()
                    )));
                }
                if let Some(resolved) = tz.from_local_datetime(&candidate).earliest() {
                    break resolved;
                }
            }
        }
    };

    Ok(local.with_timezone(&Utc))
}

// ── Persistence ────────────────────────────────────────────────────────

fn require_tenant(event: &Request) -> Result<String, AppError> {
    let user_context = auth::get_user_context(event)?;
    user_context
        .tenant_id
        .ok_or_else(|| AppError::Unauthorized("Tenant access required".to_string()))
}

fn table_name() -> Result<String, AppError> {
    env::var("TABLE_NAME")
        .map_err(|_| AppError::InternalError("TABLE_NAME not configured".to_string()))
}

/// Reads the raw settings record. `None` means the tenant has never saved
/// settings, which is not an error — it just means every value is inherited.
async fn get_settings_item(
    tenant_id: &str,
) -> Result<Option<std::collections::HashMap<String, AttributeValue>>, AppError> {
    let client = aws_clients::get_dynamodb_client().await;

    let result = client
        .get_item()
        .table_name(table_name()?)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S(SETTINGS_SK.to_string()))
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to load settings: {}", e)))?;

    Ok(result.item)
}

/// The canonical settings read used by anything that needs a tenant default
/// (see [`super::issues`]). Never fails the caller: a settings read that errors
/// falls back to the system defaults rather than blocking the operation the
/// tenant actually asked for.
pub(crate) async fn get_tenant_settings(tenant_id: &str) -> TenantSettings {
    match get_settings_item(tenant_id).await {
        Ok(item) => settings_from_item(item.as_ref()),
        Err(e) => {
            tracing::warn!(error = %e, tenant_id = %tenant_id, "Falling back to default settings");
            TenantSettings::default()
        }
    }
}

fn settings_from_item(
    item: Option<&std::collections::HashMap<String, AttributeValue>>,
) -> TenantSettings {
    let defaults = TenantSettings::default();
    let Some(item) = item else {
        return defaults;
    };

    let read = |key: &str| {
        item.get(key)
            .and_then(|value| value.as_s().ok())
            .map(|value| value.to_string())
            .filter(|value| !value.trim().is_empty())
    };

    TenantSettings {
        timezone: read("timezone").unwrap_or(defaults.timezone),
        default_send_time: read("defaultSendTime").unwrap_or(defaults.default_send_time),
        subject_template: read("subjectTemplate"),
        issue_url_pattern: read("issueUrlPattern"),
    }
}

fn build_response(
    item: Option<std::collections::HashMap<String, AttributeValue>>,
) -> SettingsResponse {
    let updated_at = item.as_ref().and_then(|item| {
        item.get("updatedAt")
            .and_then(|value| value.as_s().ok())
            .map(|value| value.to_string())
    });

    SettingsResponse {
        settings: settings_from_item(item.as_ref()),
        defaults: TenantSettings::default(),
        configured: configured_settings(item.as_ref()),
        updated_at,
    }
}

/// The settings actually present on the record, so a value the tenant chose is
/// distinguishable from one that happens to equal the system default.
fn configured_settings(
    item: Option<&std::collections::HashMap<String, AttributeValue>>,
) -> Vec<String> {
    let Some(item) = item else {
        return Vec::new();
    };

    SETTING_NAMES
        .iter()
        .filter(|name| {
            item.get(**name)
                .and_then(|value| value.as_s().ok())
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false)
        })
        .map(|name| name.to_string())
        .collect()
}

/// Applies the changes with a single UpdateItem so settings the request didn't
/// mention are left untouched, and a reset removes the attribute entirely
/// (rather than storing the system default, which would freeze the tenant on
/// today's default if it ever changes).
async fn write_settings(
    tenant_id: &str,
    changes: &[SettingChange],
    updated_at: &str,
) -> Result<(), AppError> {
    let client = aws_clients::get_dynamodb_client().await;

    let mut sets = vec!["#updatedAt = :updatedAt".to_string()];
    let mut removes = Vec::new();
    let mut names = vec![("#updatedAt".to_string(), "updatedAt".to_string())];
    let mut values = vec![(
        ":updatedAt".to_string(),
        AttributeValue::S(updated_at.to_string()),
    )];

    for change in changes {
        let placeholder = format!("#{}", change.attribute);
        names.push((placeholder.clone(), change.attribute.to_string()));

        match &change.value {
            Some(value) => {
                let value_placeholder = format!(":{}", change.attribute);
                sets.push(format!("{} = {}", placeholder, value_placeholder));
                values.push((value_placeholder, AttributeValue::S(value.clone())));
            }
            None => removes.push(placeholder),
        }
    }

    let mut expression = format!("SET {}", sets.join(", "));
    if !removes.is_empty() {
        expression.push_str(&format!(" REMOVE {}", removes.join(", ")));
    }

    let mut request = client
        .update_item()
        .table_name(table_name()?)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S(SETTINGS_SK.to_string()))
        .update_expression(expression);

    for (placeholder, name) in names {
        request = request.expression_attribute_names(placeholder, name);
    }
    for (placeholder, value) in values {
        request = request.expression_attribute_values(placeholder, value);
    }

    request
        .send()
        .await
        .map_err(|e| AppError::AwsError(format!("Failed to save settings: {}", e)))?;

    Ok(())
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn settings(timezone: &str, send_time: &str) -> TenantSettings {
        TenantSettings {
            timezone: timezone.to_string(),
            default_send_time: send_time.to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn defaults_are_utc_at_nine() {
        let defaults = TenantSettings::default();
        assert_eq!(defaults.timezone, "UTC");
        assert_eq!(defaults.default_send_time, "09:00");
    }

    #[test]
    fn validate_timezone_accepts_iana_names() {
        assert_eq!(
            validate_timezone("America/Chicago").unwrap(),
            "America/Chicago"
        );
        assert_eq!(validate_timezone("UTC").unwrap(), "UTC");
    }

    #[test]
    fn validate_timezone_rejects_offsets_and_abbreviations() {
        // Offsets drift with DST and abbreviations are ambiguous, so neither is
        // a usable basis for "9am local time on this date".
        assert!(validate_timezone("-05:00").is_err());
        assert!(validate_timezone("CST").is_err());
        assert!(validate_timezone("Not/AZone").is_err());
    }

    #[test]
    fn validate_send_time_zero_pads() {
        assert_eq!(validate_send_time("9:05").unwrap(), "09:05");
        assert_eq!(validate_send_time("09:05").unwrap(), "09:05");
        assert_eq!(validate_send_time("23:59").unwrap(), "23:59");
        assert_eq!(validate_send_time("00:00").unwrap(), "00:00");
    }

    #[test]
    fn validate_send_time_rejects_malformed_values() {
        assert!(validate_send_time("24:00").is_err());
        assert!(validate_send_time("09:60").is_err());
        assert!(validate_send_time("9").is_err());
        assert!(validate_send_time("9:5").is_err());
        assert!(validate_send_time("09:00:00").is_err());
        assert!(validate_send_time("9am").is_err());
    }

    #[test]
    fn extract_changes_ignores_absent_keys() {
        let changes = extract_changes(&json!({ "timezone": "UTC" })).unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].attribute, "timezone");
        assert_eq!(changes[0].value.as_deref(), Some("UTC"));
    }

    #[test]
    fn extract_changes_treats_null_and_empty_as_reset() {
        for body in [
            json!({ "timezone": null }),
            json!({ "timezone": "" }),
            json!({ "timezone": "   " }),
        ] {
            let changes = extract_changes(&body).unwrap();
            assert_eq!(changes.len(), 1);
            assert!(
                changes[0].value.is_none(),
                "{} should clear the value",
                body
            );
        }
    }

    #[test]
    fn extract_changes_rejects_non_string_values() {
        assert!(extract_changes(&json!({ "timezone": 5 })).is_err());
        assert!(extract_changes(&json!({ "defaultSendTime": true })).is_err());
        assert!(extract_changes(&json!(["timezone"])).is_err());
    }

    #[test]
    fn extract_changes_returns_empty_for_unknown_keys_only() {
        // The handler turns this into a 400 rather than a no-op write.
        let changes = extract_changes(&json!({ "somethingElse": "x" })).unwrap();
        assert!(changes.is_empty());
    }

    #[test]
    fn validate_subject_template_accepts_supported_tokens() {
        assert_eq!(
            validate_subject_template("{{title}} | Weekly #{{number}}").unwrap(),
            "{{title}} | Weekly #{{number}}"
        );
        assert_eq!(
            validate_subject_template("{{ title }} — {{ date }}").unwrap(),
            "{{ title }} — {{ date }}"
        );
        // A template with no tokens at all is a fixed subject line, which is
        // odd but not wrong.
        assert_eq!(
            validate_subject_template("This week's issue").unwrap(),
            "This week's issue"
        );
    }

    #[test]
    fn validate_subject_template_rejects_header_injection() {
        // A newline in a subject is a second email header. This is the one
        // rule here that is a security boundary, not a nicety.
        assert!(validate_subject_template("Hi\r\nBcc: someone@example.com").is_err());
        assert!(validate_subject_template("Hi\nX-Spoof: yes").is_err());
        assert!(validate_subject_template("Hi\u{0}there").is_err());
    }

    #[test]
    fn validate_subject_template_rejects_unknown_and_unclosed_tokens() {
        // {{brand}} would otherwise reach subscribers with the braces intact.
        assert!(validate_subject_template("{{title}} from {{brand}}").is_err());
        assert!(validate_subject_template("{{title").is_err());
    }

    #[test]
    fn validate_subject_template_rejects_overlong_values() {
        assert!(validate_subject_template(&"x".repeat(SUBJECT_TEMPLATE_MAX_LEN + 1)).is_err());
    }

    #[test]
    fn validate_issue_url_pattern_accepts_an_absolute_per_issue_url() {
        assert_eq!(
            validate_issue_url_pattern("https://example.com/newsletter/{{number}}").unwrap(),
            "https://example.com/newsletter/{{number}}"
        );
        assert_eq!(
            validate_issue_url_pattern("http://localhost:3000/issues/{{number}}").unwrap(),
            "http://localhost:3000/issues/{{number}}"
        );
    }

    #[test]
    fn validate_issue_url_pattern_requires_an_absolute_http_url() {
        // This value becomes an href in every subscriber's inbox, so a
        // relative path or a javascript: scheme is not acceptable.
        assert!(validate_issue_url_pattern("/newsletter/{{number}}").is_err());
        assert!(validate_issue_url_pattern("example.com/{{number}}").is_err());
        assert!(validate_issue_url_pattern("javascript:alert(1){{number}}").is_err());
    }

    #[test]
    fn validate_issue_url_pattern_requires_the_number_token() {
        // Without it every issue would link to the same page.
        assert!(validate_issue_url_pattern("https://example.com/newsletter").is_err());
    }

    #[test]
    fn validate_issue_url_pattern_rejects_whitespace_and_unknown_tokens() {
        assert!(validate_issue_url_pattern("https://example.com/a b/{{number}}").is_err());
        assert!(validate_issue_url_pattern("https://example.com/{{slug}}/{{number}}").is_err());
    }

    #[test]
    fn extract_changes_covers_every_recognized_setting() {
        let changes = extract_changes(&json!({
            "timezone": "UTC",
            "defaultSendTime": "09:00",
            "subjectTemplate": "{{title}}",
            "issueUrlPattern": "https://example.com/n/{{number}}"
        }))
        .unwrap();

        assert_eq!(changes.len(), 4);
    }

    #[test]
    fn settings_from_item_reads_the_optional_settings() {
        let mut item = std::collections::HashMap::new();
        item.insert(
            "subjectTemplate".to_string(),
            AttributeValue::S("{{title}} #{{number}}".to_string()),
        );
        item.insert(
            "issueUrlPattern".to_string(),
            AttributeValue::S("https://example.com/n/{{number}}".to_string()),
        );

        let resolved = settings_from_item(Some(&item));
        assert_eq!(
            resolved.subject_template.as_deref(),
            Some("{{title}} #{{number}}")
        );
        assert_eq!(
            resolved.issue_url_pattern.as_deref(),
            Some("https://example.com/n/{{number}}")
        );
    }

    #[test]
    fn optional_settings_have_no_system_default() {
        // Unlike timezone and send time, these two stay None: guessing a
        // subject line or a domain would be worse than omitting them.
        let defaults = TenantSettings::default();
        assert!(defaults.subject_template.is_none());
        assert!(defaults.issue_url_pattern.is_none());
    }

    #[test]
    fn is_date_only_matches_bare_dates_only() {
        assert!(is_date_only("2026-08-01"));
        assert!(!is_date_only("2026-08-01T09:00:00Z"));
        assert!(!is_date_only("2026-08-01T09:00:00-05:00"));
        assert!(!is_date_only("now"));
        assert!(!is_date_only("08/01/2026"));
    }

    #[test]
    fn resolve_date_only_uses_tenant_time_and_zone() {
        // 09:00 in Chicago on a summer date is CDT (UTC-5) → 14:00Z.
        let resolved = resolve_date_only("2026-08-01", &settings("America/Chicago", "09:00"))
            .unwrap()
            .to_rfc3339();
        assert_eq!(resolved, "2026-08-01T14:00:00+00:00");
    }

    #[test]
    fn resolve_date_only_follows_daylight_saving() {
        // The same wall-clock time in winter is CST (UTC-6) → 15:00Z. A fixed
        // offset would have silently sent an hour off for half the year.
        let resolved = resolve_date_only("2026-01-15", &settings("America/Chicago", "09:00"))
            .unwrap()
            .to_rfc3339();
        assert_eq!(resolved, "2026-01-15T15:00:00+00:00");
    }

    #[test]
    fn resolve_date_only_defaults_to_utc_at_nine() {
        let resolved = resolve_date_only("2026-08-01", &TenantSettings::default())
            .unwrap()
            .to_rfc3339();
        assert_eq!(resolved, "2026-08-01T09:00:00+00:00");
    }

    #[test]
    fn resolve_date_only_skips_a_daylight_saving_gap() {
        // US spring forward 2026 is March 8: 02:00–02:59 local never happens.
        // The send must still land on March 8, at the first minute that exists.
        let resolved =
            resolve_date_only("2026-03-08", &settings("America/Chicago", "02:30")).unwrap();
        assert_eq!(resolved.to_rfc3339(), "2026-03-08T08:00:00+00:00");

        let local = resolved.with_timezone(&"America/Chicago".parse::<Tz>().unwrap());
        assert_eq!(local.format("%Y-%m-%d").to_string(), "2026-03-08");
    }

    #[test]
    fn resolve_date_only_picks_the_earlier_of_an_ambiguous_hour() {
        // US fall back 2026 is November 1: 01:30 local happens twice (CDT then
        // CST). The earlier occurrence keeps the send closest to the requested
        // wall-clock moment.
        let resolved = resolve_date_only("2026-11-01", &settings("America/Chicago", "01:30"))
            .unwrap()
            .to_rfc3339();
        assert_eq!(resolved, "2026-11-01T06:30:00+00:00");
    }

    #[test]
    fn resolve_date_only_rejects_invalid_dates() {
        assert!(resolve_date_only("2026-02-30", &TenantSettings::default()).is_err());
        assert!(resolve_date_only("nonsense", &TenantSettings::default()).is_err());
    }

    #[test]
    fn settings_accessors_fall_back_on_unparseable_stored_values() {
        // Stored values are validated on write, so this only guards against
        // hand-edited records — resolution should degrade, not fail.
        let broken = settings("Not/AZone", "nope");
        assert_eq!(broken.timezone(), chrono_tz::UTC);
        assert_eq!(
            broken.send_time(),
            NaiveTime::from_hms_opt(9, 0, 0).unwrap()
        );
    }

    #[test]
    fn settings_from_item_fills_gaps_with_defaults() {
        let mut item = std::collections::HashMap::new();
        item.insert(
            "timezone".to_string(),
            AttributeValue::S("Europe/London".to_string()),
        );

        let resolved = settings_from_item(Some(&item));
        assert_eq!(resolved.timezone, "Europe/London");
        assert_eq!(resolved.default_send_time, DEFAULT_SEND_TIME);
    }

    #[test]
    fn settings_from_item_ignores_blank_attributes() {
        let mut item = std::collections::HashMap::new();
        item.insert("timezone".to_string(), AttributeValue::S("".to_string()));

        assert_eq!(settings_from_item(Some(&item)), TenantSettings::default());
    }

    #[test]
    fn settings_from_item_defaults_when_no_record_exists() {
        assert_eq!(settings_from_item(None), TenantSettings::default());
    }

    #[test]
    fn build_response_reports_defaults_alongside_effective_values() {
        let mut item = std::collections::HashMap::new();
        item.insert(
            "timezone".to_string(),
            AttributeValue::S("Asia/Tokyo".to_string()),
        );
        item.insert(
            "updatedAt".to_string(),
            AttributeValue::S("2026-07-25T00:00:00Z".to_string()),
        );

        let response = build_response(Some(item));
        assert_eq!(response.settings.timezone, "Asia/Tokyo");
        assert_eq!(response.settings.default_send_time, DEFAULT_SEND_TIME);
        assert_eq!(response.defaults, TenantSettings::default());
        assert_eq!(response.updated_at.as_deref(), Some("2026-07-25T00:00:00Z"));
    }

    #[test]
    fn build_response_omits_updated_at_when_never_saved() {
        let response = build_response(None);
        assert!(response.updated_at.is_none());
        assert_eq!(response.settings, TenantSettings::default());
        assert!(response.configured.is_empty());
    }

    #[test]
    fn configured_lists_only_the_settings_the_tenant_chose() {
        let mut item = std::collections::HashMap::new();
        item.insert(
            "defaultSendTime".to_string(),
            AttributeValue::S("07:30".to_string()),
        );
        // A blank attribute is not a choice.
        item.insert("timezone".to_string(), AttributeValue::S("".to_string()));
        item.insert(
            "updatedAt".to_string(),
            AttributeValue::S("2026-07-25T00:00:00Z".to_string()),
        );

        let response = build_response(Some(item));

        // The tenant saved a send time but never picked a zone, even though
        // the effective timezone reads as the system default either way.
        assert_eq!(response.configured, vec!["defaultSendTime".to_string()]);
        assert_eq!(response.settings.timezone, DEFAULT_TIMEZONE);
    }

    #[test]
    fn configured_reports_a_timezone_that_matches_the_system_default() {
        // Explicitly choosing UTC is a choice, and must not be reported as an
        // unset value the dashboard is free to replace with a suggestion.
        let mut item = std::collections::HashMap::new();
        item.insert("timezone".to_string(), AttributeValue::S("UTC".to_string()));

        let response = build_response(Some(item));
        assert_eq!(response.configured, vec!["timezone".to_string()]);
    }
}
