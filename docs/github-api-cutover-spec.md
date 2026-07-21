# GitHub Issue Ingress → API Cutover Spec

**Status:** Draft for review
**Branch:** `claude/github-api-cutover-automation-97alu1`
**Scope:** Retire the legacy EventBridge "GitHub import" ingress for newsletter issues and relocate GitHub coupling out of the backend, without losing link-click tracking or analytics parity.

---

## 1. Goal

Make the ready-set-cloud GitHub Action the single ingress for new newsletter issues (via `POST /issues`), and remove the backend's GitHub read/write coupling for issues entirely. When complete:

- The newsletter service owns only what is genuinely its own: newsletter records, the send pipeline, and `link#` click-tracking records.
- The website (Hugo) owns web link-tracking presentation.
- The Action owns everything that talks to GitHub (create the issue, comment the preview link).
- SES owns email click tracking (unchanged).

---

## 2. Background: how it works today

### 2.1 Two ingress paths, one engine

Both paths converge on the **same** `StageIssueStateMachine` (`state-machines/stage-issue.asl.json`):

- **Legacy (to be removed):** `stage-new-issue.js` in ready-set-cloud publishes an EventBridge event `Create Newsletter Issue` / `source: github`. `ImportFromGitHubFunction` (`template.yaml` ~2483–2526) consumes it, pulls the file from GitHub with the tenant's Octokit token (`functions/import-issue-from-github.mjs`), parses frontmatter, and starts the state machine.
- **REST (the target):** `stage-new-issue.js` also `POST`s to `/issues` when `NEWSLETTER_API_KEY` is set. `handle_create_issue` (`functions/src/api/controllers/issues.rs:1437`) writes the record as `status: draft`, then `start_issue_schedule` (`:3167`) starts the **same** state machine for `action: schedule`. Auth is via the API-key path in `functions/src/auth/lambda-authorizer.rs` (`ak_...` → tenant + email).

The REST endpoint already supports the full contract the script sends (draft/schedule, `ttlSeconds`, `issueNumber`, `scheduledAt`, `abTest`, `Idempotency-Key`) and the record status handshake is correct (`draft` → state machine "Mark Issue In Progress").

### 2.2 Link tracking is split by surface

- **Email clicks → SES.** The SES `ConfigurationSet` has a `CLICK` event destination (`template.yaml:885–910`). SES wraps links in the sent HTML itself and emits Click events; `handle-email-status.mjs` (`trackLinkClick`, line 407) writes them to `link#${hash(url)}`. The email content is parsed from **raw** markdown — it never uses the app redirect domain.
- **Web clicks → app redirect.** `update-link-tracking.mjs` (the state machine's "Update Web Links" step) rewrites `[text](url)` → `${REDIRECT_URL}?u=…&cid=…&p=…&s=__EMAIL_HASH__`, and `Transform and Callback` (`transform-and-callback.mjs`) **commits that rewritten markdown back into the GitHub repo** so Hugo builds a tracked on-site version. `process-link-click.mjs` (`template.yaml:3450`) resolves web redirect clicks into `link#${hash(u)}`.

### 2.3 The `link#` records are shared, not web-only

Both surfaces resolve clicks into the same `link#<hash(originalUrl)>` records (`pk = <tenant>#<issue>`, `sk = link#<hash(url)>`). Downstream consumers: `send-email-v2` (interest section reordering), `functions/utils/interest-scoring.mjs`, `process-link-click.mjs`, `handle-email-status.mjs`, `build-report-data.mjs`, `generate-outreach.mjs`. Today these records are created as a **side-effect** of `update-link-tracking.mjs`, and that function's rewritten `content` output flows **only** into `Transform and Callback` (nothing else reads it).

### 2.4 The coupling to remove

The only reason the backend touches GitHub for issues is:
1. **Ingress:** `ImportFromGitHubFunction` reads the file from GitHub.
2. **Egress:** `Transform and Callback` commits the tracked web markdown back to GitHub.

Everything else (records, email, send) needs only the content the API is already handed.

---

## 3. Target architecture

```
ready-set-cloud PR/merge
        │
        ▼
  GitHub Action (stage-new-issue.js)
        │  POST /issues  (draft on PR, schedule on merge)
        ▼
 newsletter-service API ── writes draft record ── starts StageIssueStateMachine
        │                                              │
        │                                              ├─ extract links → create + classify link# records   (backend, from content, NO GitHub)
        │                                              └─ email branch → SES send (SES CLICK events → link#)
        │
        └─ returns issue → Action comments preview link on the PR

ready-set-cloud site build (Hugo)
        └─ render-link hook wraps external newsletter links with the redirect domain  (web tracking; web clicks → link#)
```

Backend has **zero GitHub coupling for issues**. `OWNER` / `REPO` / the GitHub secret remain only for `sync-repo-data`.

---

## 4. Ownership boundary (design principle)

| Concern | Owner | Notes |
|---|---|---|
| `link#` record creation + LLM topic classification | **Backend** | Pure `content → records`; needs `content`, `tenantId`, `issueId`. No GitHub. |
| Email link wrapping + click events | **SES** | `ConfigurationSet` CLICK destination. Unchanged. |
| Web link wrapping (redirect URLs) | **Website (Hugo)** | Render hook at build time. Web-only presentation. |
| Talking to GitHub (create issue, PR comment) | **GitHub Action** | The only component that touches GitHub. |
| Redirect click resolution / `hash(url)` keying | **Backend** | Never leaves the backend. Web/Action only ever pass the raw destination in `u`. |

The only cross-repo contract is the redirect URL shape (§5). The load-bearing `hash(url)` keying stays entirely server-side, so the two repos cannot drift on the fragile part.

---

## 5. Canonical redirect URL contract

Web link wrapping (Hugo) must produce:

```
${REDIRECT_BASE}?u=${encodeURIComponent(destinationUrl)}&cid=${tenant}_${issueNumber}&p=${position}&src=web
```

- `u` — the **original** destination, `encodeURIComponent`-encoded (not `encodeURI`; see the cautionary history in `update-link-tracking.mjs:72–87`).
- `cid` — `tenant#issue`, but with `#` written as `_` in the URL. The redirect function restores it (`cid.replace(/_/g, '#')`, `template.yaml:2859`).
- `p` — 1-based link position (optional for resolution; click resolution is by `hash(u)`, position is metadata only).
- `s=__EMAIL_HASH__` — **email only**, substituted per recipient at send. The web hook omits `s`.
- `src` — `web` for the Hugo hook; SES clicks arrive as `email`.

The redirect function (`GenericRedirectFunction`, `template.yaml:2808+`) is **stateless**: it decodes `u`, validates scheme/loop/length, logs `{cid,u,src,ip,s}`, and 302s. No DB lookup. `process-link-click.mjs` reads those logs and increments `link#${hash(u)}`.

The Hugo hook never computes `hash()` — it only wraps `u=<original url>`. The backend computes `hash(url)` on both the record-creation side and the click-resolution side, so they always agree.

---

## 6. Changes

### 6.1 Backend (`newsletter-service`)

**6.1.1 Split `functions/update-link-tracking.mjs` into record-creation-only.**
- Keep: `extractLinks`, `extractContext`, `processLinks`, `enrichLinkRecord`, `createLinkRecord`, `applyClassification`, `classificationFields`, and the per-link `position` assignment (by order of appearance).
- Remove: the `updatedContent = state.content.replace(...)` rewrite that injects `${REDIRECT_URL}` and the `{ content }` return. The handler's job becomes: extract links (assigning position) → create/classify `link#` records. Return a small summary (e.g. `{ linkCount }`) or nothing.
- Drop the `REDIRECT_URL` env var from this function (no longer used here).
- Suggested rename: `classify-issue-links.mjs` (behavior is now "extract + classify + record", not "rewrite"). Update the state machine substitution name accordingly.

**6.1.2 State machine `state-machines/stage-issue.asl.json`.**
- In the `Build Web and Email Versions` parallel, replace the web branch `Update Web Links → Transform and Callback` with a single record-creation task (the renamed function), ending the branch there. The email branch is unchanged.
- Delete the `Transform and Callback` state.
- Remove `TransformAndCallback` from `DefinitionSubstitutions` (`template.yaml:2695`) and from the state machine's Lambda-invoke IAM (`template.yaml:2714`).

**6.1.3 Remove the egress function.**
- Delete `functions/transform-and-callback.mjs`.
- Delete the `TransformAndCallbackFunction` resource (`template.yaml` ~2409–2433).

**6.1.4 Remove the ingress (do this in the cleanup phase — see §8).**
- Delete `functions/import-issue-from-github.mjs`.
- Delete the `ImportFromGitHubFunction` resource **and its `AmplifyBuildSuccessful`/`Create Newsletter Issue` EventBridge event** (`template.yaml` ~2483–2526), plus its IAM.

**6.1.5 Housekeeping.**
- `functions/utils/event-publisher.mjs` (`publishIssueEvent` / `EVENT_TYPES`) is used by other functions — keep it; only the `import-issue-from-github.mjs` usage goes away.
- After 6.1.3/6.1.4, `OWNER` / `REPO` / `/readysetcloud/secrets` (GitHub token) are referenced only by `SyncRepoDataFunction` — keep them for that; do not remove.
- No `POST /issues` contract change is required. (The Action already sends everything.)

### 6.2 Website (`ready-set-cloud`)

**6.2.1 Add a Hugo link render hook** at `layouts/_default/_markup/render-link.html`:
- Wrap **external** links (skip internal/relative and `mailto:`) in newsletter content with the redirect URL from §5, using a site param for `REDIRECT_BASE` and the issue number for `cid`.
- **Idempotent:** if the destination already points at `REDIRECT_BASE` (legacy issues whose markdown was committed pre-cutover with wrapped links), pass it through unchanged — do not double-wrap.
- Scope: newsletter section only (guard on `.Page.Section`/path) unless site-wide web tracking is desired (open decision §9).

**6.2.2 Config:** expose `REDIRECT_BASE` (the redirect domain) as a Hugo param.

### 6.3 GitHub Action (`ready-set-cloud`)

**6.3.1 `.github/scripts/newsletter/stage-new-issue.js` — make the two paths mutually exclusive.**
- When `restEnabled` (i.e. `NEWSLETTER_API_KEY` present), **skip** the EventBridge `PutEvents` publish. This is the actual cutover switch: set the secret → REST becomes the sole ingress; unset → EventBridge fallback. (Today both fire, which double-creates — see §7.)

**6.3.2 After the cutover is proven,** remove the EventBridge code path, `@aws-sdk/client-eventbridge`, and the `PROD_EVENTBRIDGE_*` / `AMPLIFY_*` credentials from the workflows if nothing else uses them.

**6.3.3** The existing PR draft-preview deep-link comment (`newsletter-pr.yaml`) stays; it replaces the legacy preview email.

---

## 7. Feature-parity checklist

| Legacy behavior | Under target design | Action needed |
|---|---|---|
| File fetched from GitHub by tenant Octokit token | Action sends checked-out file body in `POST /issues` | None |
| Frontmatter parse (subject, date, issue #) | Done in `stage-new-issue.js` | Verify slug/`Issue-N` derivation parity |
| Email click tracking | SES CLICK events (unchanged) | None |
| Web click tracking (commit wrapped markdown to Git) | Hugo render hook at build | §6.2 |
| `link#` records + classification | Backend record-only step (§6.1.1) | Must not be lost in the split |
| Preview email to author | PR draft + dashboard deep-link | Confirm acceptable (§9) |
| Schedule at noon for date-only frontmatter | Legacy normalized `T00:00Z`→`T12:00Z`; REST/script do not | Decide: normalize in `stage-new-issue.js` or accept 00:00 UTC (§9) |
| Double-create when secret set | N/A | Fixed by §6.3.1 (either/or) |
| Idempotency | `Idempotency-Key` (better than legacy) | None |

---

## 8. Cutover sequence (phased, each independently reversible)

**Phase 1 — Website (safe, additive).**
Add the idempotent Hugo render hook (§6.2). On-site newsletter links now get web tracking at build time; legacy already-wrapped links are passed through. No backend/Action change yet.

**Phase 2 — Backend transformation split (deploy together).**
Split `update-link-tracking` to record-only, delete `Transform and Callback` (§6.1.1–6.1.3). New issues stop committing wrapped markdown to Git (content stays as authored); `link#` records still created; Hugo does web wrapping. Safe even while the legacy ingress is still live, because Phase 1 already covers web tracking.
*Rollback:* redeploy the previous template/state machine.

**Phase 3 — Flip ingress to REST.**
1. Ship §6.3.1 (skip EventBridge when `restEnabled`) with the secret **not yet set** — no behavior change.
2. Set `NEWSLETTER_API_KEY`. REST is now the sole ingress; the legacy `ImportFromGitHubFunction` goes idle.
   *Rollback:* unset the secret → EventBridge path resumes (ingress still present).
3. Validate: PR creates a draft + preview link; merge schedules a send; web + email clicks both land on `link#` records.

**Phase 4 — Remove the ingress.**
Once Phase 3 is proven, delete `ImportFromGitHubFunction` + the `Create Newsletter Issue` rule + `import-issue-from-github.mjs` (§6.1.4).

**Phase 5 — Final cleanup.**
Remove the EventBridge publish code and AWS creds from the Action/workflows (§6.3.2). Confirm `OWNER`/`REPO`/GitHub secret remain only for `sync-repo-data`.

---

## 9. Open decisions

1. **Preview email vs dashboard link.** The REST PR flow creates a draft and comments a dashboard deep-link instead of emailing a preview. Accept as the replacement, or add a preview-send trigger for drafts?
2. **Schedule-time normalization.** Replicate legacy's date-only → noon-UTC normalization in `stage-new-issue.js`, or accept `scheduledAt` at the literal frontmatter time? (Check whether RSC frontmatter uses full timestamps — if so, moot.)
3. **Hugo hook scope.** Wrap only newsletter-section external links, or all external links site-wide (blog posts included)?
4. **Position parity on web.** Should the Hugo hook emit `p=<position>`, or omit it (resolution is by `hash(u)`; position is metadata only)?

---

## 10. Removal inventory

**newsletter-service**
- `functions/import-issue-from-github.mjs` (delete)
- `functions/transform-and-callback.mjs` (delete)
- `ImportFromGitHubFunction` + `Create Newsletter Issue` EventBridge rule + IAM (`template.yaml` ~2483–2526)
- `TransformAndCallbackFunction` + IAM (`template.yaml` ~2409–2433)
- `TransformAndCallback` substitution + invoke permission (`template.yaml:2695`, `:2714`)
- `Transform and Callback` state + web-branch rewrite in `state-machines/stage-issue.asl.json`
- `REDIRECT_URL` env on the (renamed) link function
- **Keep:** `OWNER`/`REPO`/`/readysetcloud/secrets` (used by `SyncRepoDataFunction`), `event-publisher.mjs`

**ready-set-cloud**
- EventBridge publish in `.github/scripts/newsletter/stage-new-issue.js` + `@aws-sdk/client-eventbridge` (Phase 5)
- `PROD_EVENTBRIDGE_*` / `AMPLIFY_*` EventBridge credentials if unused elsewhere (Phase 5)
- **Add:** `layouts/_default/_markup/render-link.html` + `REDIRECT_BASE` param
