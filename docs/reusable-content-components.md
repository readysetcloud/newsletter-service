# Reusable Content Components (Snippets in Templates and Issue Bodies)

**Status:** Proposed
**Date:** 2026-06-25
**Context:** Generalizing one-off body shortcodes (e.g. `robotVoice`) into the
existing snippet system so reusable blocks can be authored once and used by any
tenant — including future third-party customers.

## Background

The service renders newsletter HTML from two distinct layers:

- **The template** — the email skeleton (header, the sections loop, the sponsor
  block, footer). It is Handlebars, customizable per tenant, and edited in the
  dashboard template builder.
- **The issue body** — the per-issue Markdown an author writes. It is converted
  to HTML in `functions/parse-md-to-json.mjs` (showdown) and injected into the
  template as raw `{{{ this.text }}}`.

Two reuse mechanisms have grown up across these layers:

| | Authored in | Rendered | Repeatable inline? | Managed how |
|---|---|---|---|---|
| **Snippet** (`{{> name }}`) | The template skeleton | Once at publish, against issue `data` | No — fixed slots | Dashboard UI (CRUD, typed params, versioning) |
| **Shortcode** (`{{< name attr="x" >}}`) | The issue body Markdown | In `parse-md-to-json`, before the template renders | Yes — 0..N, author-supplied | Hardcoded transforms in `parse-md-to-json.mjs` |

Snippets are the mature mechanism: tenant-scoped Handlebars partials with a typed
parameter schema (`string | number | boolean | select | textarea | url`, each
with `required`, `defaultValue`, `options`, `description`), CRUD API
(`functions/src/api/controllers/snippets.rs`), storage, a builder UI with
autocomplete, and a JS-send / Rust-preview parity harness
(`__tests__/fixtures/render-conformance.json`).

Shortcodes are the immature mechanism: each block type (sponsor, social, vote,
and now `robotVoice`) is a bespoke transform compiled into the parser. Adding a
block requires a code change and deploy.

`robotVoice` (`{{< robotVoice text="..." >}}`) is the trigger for this doc. It is
inherently a **body** concern — an author sprinkles it through their prose 0..N
times, with different text each time — which is exactly what the shortcode layer
does and exactly what the snippet layer, today, does not.

## The problem, stated precisely

We want reusable, parameterized blocks like `robotVoice` to be **defined once in
the UI** (no code deploy per block) and **usable inline in issue bodies**, 0..N
times. The snippet model already supports "defined once in the UI with typed
parameters." What it does not support is invocation from the issue body: the body
is converted to HTML and injected as raw `{{{ text }}}`, and Handlebars does not
recursively process data values, so a `{{> robotVoice }}` placed in body content
renders literally.

So the missing capability is **a bridge that lets the issue body invoke
snippets** — not a new component model.

A secondary question surfaced while scoping this: the body shortcode syntax
(`{{< name >}}`) and the template partial syntax (`{{> name }}`) differ. Since
one is a trivial transform of the other, should we unify on one, or support both?

## Decision

### 1. The snippet is the one durable concept; syntax is a thin front-end

A "reusable component" is a **snippet** — tenant-defined, parameterized,
versioned. That is the asset a user (including a future third-party customer)
learns once. The `{{< >}}` vs `{{> }}` syntax is just a parser front-end that
compiles down to "render snippet X with params Y." We already built the durable,
expensive part (the typed-parameter schema). Syntax is cheap.

### 2. Each surface uses its own native idiom — not two idioms per surface

We will **not** offer two interchangeable syntaxes on the same surface. Instead,
each surface references the same snippet using the idiom native to that surface:

- **Templates** are Handlebars (`{{#each}}`, `{{#if}}`, `{{ title }}`). There,
  `{{> snippet }}` is native. We do not add a second syntax to templates.
- **Issue bodies** are Markdown/prose. There, a shortcode
  `{{< snippet param="..." >}}` is native — friendly, CMS-flavored
  (Hugo/WordPress/MDX all look like this), and it does not leak the templating
  engine to a non-technical author.

This is not "two competing syntaxes for one thing." It is one component concept
referenced idiomatically per surface, because the surfaces are genuinely
different languages. The mental model stays clean: *components live in one place;
in the template you reference them the Handlebars way, in the body the shortcode
way, because the body is prose.* We build exactly one transform — shortcode →
snippet render — because templates already speak snippets.

We may quietly accept `{{> name }}` in the body as a lenient alias for
copy-paste, but it is **not** documented as a parallel path.

### 3. Parameter resolution happens once, centrally — this is the real work

The syntax choice is not load-bearing. The decision that matters for a
third-party user is **parameter semantics at render time**: applying
`defaultValue`, enforcing `required`, and coercing by `type` (number/boolean/
select). Today the parameter schema is only builder metadata; the renderer
ignores it. We will implement parameter resolution **once, centrally**, so a
snippet behaves identically whether invoked from a template or a body shortcode.

### 4. Hugo-website parity stays a perk, not a constraint

The owner's body Markdown is also published to a Hugo site, where `{{< robotVoice >}}`
is a real Hugo shortcode. Keeping `{{< >}}` as the body idiom makes website +
email authoring identical — but that is a *free benefit* of choosing the
Markdown-native idiom, not a requirement a third-party customer inherits.

## Consequences

### Forward-compatible with a no-code builder

Mass-market newsletter tools (Beehiiv, Substack, Mailchimp) insert blocks via UI
and store a structured tree — users type no syntax at all. The typed-parameter
snippet schema is already the metadata such an inserter needs: a `select` param
becomes a dropdown, a `textarea` a text box, `required`/`default` drive
validation. A future visual builder sits **on top of** the snippet model, with
the text syntax as the escape hatch / interchange format. Whatever syntax we pick
now is therefore not locked in.

### What needs to be built (backend-light)

1. **Thread `tenantId` into the parser.** `ParseMdToJson`'s payload in
   `state-machines/stage-issue.asl.json` does not pass it today; `$$.Execution.Input.tenant.id`
   is already available (the Publish step uses it). One-line ASL change.
2. **Load the tenant's snippets** in `parse-md-to-json` — reuse the existing
   `snippet#{tenantId}` GSI1 query from `publish-issue.mjs` / `snippets.rs`.
3. **Resolve body shortcodes against snippets.** Scan each section for
   `{{< name attr="..." >}}`; if `name` matches a snippet, parse attrs into a
   data object, apply the central parameter resolution (defaults / required /
   coercion), and render the snippet via the shared `renderWithSnippets` so it
   matches the rest of the pipeline. Use a placeholder swap so showdown does not
   mangle the injected HTML (same technique as the current `robotVoice` block).
4. **Migrate `robotVoice` to a seeded snippet**, keeping the hardcoded block as a
   fallback when no same-named tenant snippet exists. New block types then need
   zero code deploys.

### Rendering boundaries / parity

Body shortcodes render only in the JS path (`parse-md-to-json`); the Hugo site is
the website's renderer. There is no Rust preview of *body* content, so this does
not disturb the template preview/parity harness (`template_render.rs` ⇄
`render-conformance.json`), which covers template rendering only.

### What we explicitly avoid

- Two interchangeable syntaxes on the same surface (doc burden, "which is
  canonical?" support load).
- Treating the syntax transform as the important decision. It is incidental; the
  parameter-resolution layer and the schema are the assets.

## Open questions for v1 scope

- **Override model:** does a tenant snippet *override* a same-named hardcoded
  block, or do we fully replace hardcoded blocks (sponsor included) with seeded
  system snippets?
- **v1 surface area:** ship just `robotVoice`-style param blocks, or the general
  "any snippet usable in body" bridge (which also lets us retire the per-shortcode
  code in `parse-md-to-json`)?
- **Content-editor autocomplete:** the current autocomplete
  (`dashboard-ui/src/pages/templates/builder/autocomplete.ts`) targets the
  template builder. A body/issue editor would want its own shortcode
  autocomplete sourced from the same snippet list.
