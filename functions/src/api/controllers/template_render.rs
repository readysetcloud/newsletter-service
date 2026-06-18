//! Shared Handlebars rendering used by the template preview endpoints.
//!
//! The same rendering rule must be used by the send path (issue #267) so that
//! the live preview matches what subscribers actually receive: load the
//! tenant's snippets, register each as a Handlebars partial keyed by its
//! `name`, then render the template against the provided data. Any partial
//! reference (`{{> name }}`) that is *not* backed by a registered snippet
//! renders as an EMPTY string instead of failing — both for snippets that do
//! not exist yet and for arbitrary unknown partials.
//!
//! Snippets are loaded through the canonical reader in the [`snippets`]
//! controller ([`super::snippets::query_snippets_by_tenant`]); this module only
//! maps those records into the minimal [`Snippet`] shape the renderer needs.

use newsletter::admin::error::AppError;
use regex::Regex;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::OnceLock;

static PARTIAL_REF: OnceLock<Regex> = OnceLock::new();

/// Matches Handlebars partial references such as `{{> name }}` or
/// `{{> name param=value }}`, capturing the partial name. Partial names follow
/// the snippet naming rule (`^[a-zA-Z][a-zA-Z0-9_-]*$`).
fn partial_ref_regex() -> &'static Regex {
    PARTIAL_REF.get_or_init(|| {
        Regex::new(r"\{\{\s*>\s*([a-zA-Z][a-zA-Z0-9_-]*)").expect("Failed to compile partial regex")
    })
}

/// Minimal snippet shape the renderer needs: a partial `name` and its Handlebars
/// `content`. Produced from the canonical [`super::snippets::SnippetRecord`].
#[derive(Debug, Clone)]
pub struct Snippet {
    pub name: String,
    pub content: String,
}

impl From<super::snippets::SnippetRecord> for Snippet {
    fn from(record: super::snippets::SnippetRecord) -> Self {
        Snippet {
            name: record.name,
            content: record.content,
        }
    }
}

/// Collect the set of partial names referenced by a template source.
fn referenced_partials(source: &str) -> HashSet<String> {
    partial_ref_regex()
        .captures_iter(source)
        .filter_map(|c| c.get(1).map(|m| m.as_str().to_string()))
        .collect()
}

/// Render `content` against `data`, registering `snippets` as partials and
/// treating any referenced-but-missing partial as an empty string.
///
/// Returns a [`AppError::BadRequest`] (HTTP 400) when the template or any
/// snippet fails to compile, or when rendering fails — never a 500 for
/// user-authored content.
pub fn render_template(
    content: &str,
    data: &Value,
    snippets: &[Snippet],
) -> Result<String, AppError> {
    let mut hb = handlebars::Handlebars::new();
    // Render literal HTML/text, not HTML-escaped output: email templates are
    // authored as HTML and the data is the tenant's own sample/issue data.
    hb.register_escape_fn(handlebars::no_escape);

    // Register each snippet as a named partial.
    let mut registered: HashSet<String> = HashSet::new();
    for snippet in snippets {
        hb.register_partial(&snippet.name, &snippet.content)
            .map_err(|e| {
                AppError::BadRequest(format!(
                    "Snippet \"{}\" is not valid Handlebars: {}",
                    snippet.name, e
                ))
            })?;
        registered.insert(snippet.name.clone());
    }

    // Any partial referenced by the template (or by a snippet) that is not
    // registered renders as an empty string. Scan both the template and the
    // snippet contents so nested references degrade gracefully too.
    let mut sources_to_scan: Vec<&str> = vec![content];
    for snippet in snippets {
        sources_to_scan.push(&snippet.content);
    }
    for source in sources_to_scan {
        for name in referenced_partials(source) {
            if !registered.contains(&name) {
                tracing::warn!(
                    partial = %name,
                    "Referenced partial is not a registered snippet; rendering as empty string"
                );
                hb.register_partial(&name, "").map_err(|e| {
                    AppError::InternalError(format!("Failed to register empty partial: {}", e))
                })?;
                registered.insert(name);
            }
        }
    }

    hb.render_template(content, data)
        .map_err(|e| AppError::BadRequest(format!("Failed to render template: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn snip(name: &str, content: &str) -> Snippet {
        Snippet {
            name: name.to_string(),
            content: content.to_string(),
        }
    }

    #[test]
    fn test_referenced_partials_basic() {
        let refs = referenced_partials("<div>{{> sponsorBlock }}</div>{{> footer}}");
        assert!(refs.contains("sponsorBlock"));
        assert!(refs.contains("footer"));
        assert_eq!(refs.len(), 2);
    }

    #[test]
    fn test_referenced_partials_with_params() {
        let refs = referenced_partials("{{> cta label=\"Buy\" }}");
        assert!(refs.contains("cta"));
    }

    #[test]
    fn test_render_simple_data() {
        let out = render_template("<h1>{{ title }}</h1>", &json!({ "title": "Hi" }), &[]).unwrap();
        assert_eq!(out, "<h1>Hi</h1>");
    }

    #[test]
    fn test_render_does_not_html_escape() {
        // Email HTML should pass through verbatim.
        let out = render_template("{{ body }}", &json!({ "body": "<b>bold</b>" }), &[]).unwrap();
        assert_eq!(out, "<b>bold</b>");
    }

    #[test]
    fn test_render_registers_snippet_partial() {
        let snippets = vec![snip("footer", "<footer>{{ company }}</footer>")];
        let out = render_template(
            "<p>Body</p>{{> footer }}",
            &json!({ "company": "Acme" }),
            &snippets,
        )
        .unwrap();
        assert_eq!(out, "<p>Body</p><footer>Acme</footer>");
    }

    #[test]
    fn test_missing_partial_renders_empty() {
        let out =
            render_template("<p>Hello</p>{{> doesNotExist }}<p>Bye</p>", &json!({}), &[]).unwrap();
        assert_eq!(out, "<p>Hello</p><p>Bye</p>");
    }

    #[test]
    fn test_nested_missing_partial_renders_empty() {
        // A snippet that itself references a missing partial.
        let snippets = vec![snip("layout", "<div>{{> innerMissing }}</div>")];
        let out = render_template("{{> layout }}", &json!({}), &snippets).unwrap();
        assert_eq!(out, "<div></div>");
    }

    #[test]
    fn test_each_block_renders() {
        let out = render_template(
            "{{#each items}}<li>{{ this }}</li>{{/each}}",
            &json!({ "items": ["a", "b"] }),
            &[],
        )
        .unwrap();
        assert_eq!(out, "<li>a</li><li>b</li>");
    }

    #[test]
    fn test_invalid_handlebars_is_bad_request() {
        let err = render_template("{{#if foo}}no close", &json!({}), &[]).unwrap_err();
        assert_eq!(err.status_code(), 400);
    }

    #[test]
    fn test_invalid_snippet_is_bad_request() {
        let snippets = vec![snip("broken", "{{#if x}}unclosed")];
        let err = render_template("{{> broken }}", &json!({}), &snippets).unwrap_err();
        assert_eq!(err.status_code(), 400);
    }

    // ── Cross-renderer conformance ──────────────────────────────────────
    //
    // These fixtures are shared with the JS send path
    // (`__tests__/render-conformance.test.mjs`). Both renderers assert against
    // the SAME expected HTML, so if the Rust preview and JS send diverge on any
    // shared fixture, one side's test fails — guaranteeing preview == delivered.

    #[derive(serde::Deserialize)]
    struct ConformanceSnippet {
        name: String,
        content: String,
    }

    #[derive(serde::Deserialize)]
    struct ConformanceCase {
        name: String,
        template: String,
        data: Value,
        #[serde(default)]
        snippets: Vec<ConformanceSnippet>,
        expected: String,
    }

    #[test]
    fn render_conformance_fixtures() {
        let raw = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/__tests__/fixtures/render-conformance.json"
        ));
        let cases: Vec<ConformanceCase> =
            serde_json::from_str(raw).expect("render-conformance.json should be valid JSON");
        assert!(!cases.is_empty(), "conformance fixtures must not be empty");

        for case in cases {
            let snippets: Vec<Snippet> = case
                .snippets
                .into_iter()
                .map(|s| Snippet {
                    name: s.name,
                    content: s.content,
                })
                .collect();
            let out = render_template(&case.template, &case.data, &snippets)
                .unwrap_or_else(|e| panic!("case \"{}\" failed to render: {:?}", case.name, e));
            assert_eq!(
                out, case.expected,
                "case \"{}\" diverged from the shared expected HTML",
                case.name
            );
        }
    }
}
