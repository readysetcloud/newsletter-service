# Content Curation Pipeline

Collect links you find on LinkedIn during the week, let AI vet them against your
newsletter's focus, and pick from an RSS feed of the best candidates when you sit
down to write on Friday.

## How it works

```
LinkedIn post ──► Chrome extension ──► POST /content-candidates (public API)
                                              │
                                              ▼
                                      DynamoDB (pending candidate)
                                              │  Content Candidate Submitted event
                                              ▼
                                   VetContentCandidateFunction
                                   - unwraps lnkd.in redirects
                                   - AI vets fit vs. tenant brand focus
                                   - stores verdict (include / maybe / skip)
                                              │
                                              ▼
                        GET /content-candidates/feed  (RSS or JSON)
```

1. **Capture** — the Chrome extension (see `chrome-extension/`) adds a
   "Save for newsletter" button to LinkedIn feed posts that contain external
   links. Clicking it submits the links plus post context (author, post text,
   permalink) to `POST /content-candidates`.
2. **Store & dedupe** — each link is normalized (tracking params stripped,
   hostname lowercased) and stored once per tenant, keyed by a hash of the
   normalized URL. Re-submitting the same link reports it as a duplicate.
   Candidates expire automatically after 90 days via TTL.
3. **Vet** — a `Content Candidate Submitted` event triggers
   `VetContentCandidateFunction`, which resolves redirect wrappers (e.g.
   `lnkd.in` short links), fetches the content, and asks Bedrock (Amazon Nova
   via the Strands SDK) to judge it against the tenant's name, brand
   description, and industry — plus the **learned content profile** built
   from past issues (see below). The verdict includes a recommendation
   (`include` / `maybe` / `skip`), a 0–1 score, the content's title, a short
   editor-ready summary, reasons, and — when a profile exists — `evidence`
   citations pointing at the past featured links the candidate resembles.
4. **Serve** — `GET /content-candidates/feed` returns the trailing window
   (default 7 days, so Friday's feed covers the whole week):
   - **RSS (default)** — only vetted `include`/`maybe` items, best first.
     Subscribe in any feed reader.
   - **JSON (`?format=json`)** — everything, including pending, failed, and
     skipped items, with full verdict details.

## API

Both endpoints live on the public API (`NewsletterApi`) and use tenant API
keys minted from the dashboard.

### Submit candidates

```
POST /content-candidates
Authorization: ak_...

{
  "source": "linkedin",
  "links": [{ "url": "https://lnkd.in/abc123", "anchorText": "great read" }],
  "post": {
    "author": "Jane Doe",
    "text": "You have to read this piece on...",
    "url": "https://www.linkedin.com/feed/update/urn:li:activity:123/"
  }
}
```

Returns `201` with `{ accepted, duplicates, invalid }` (or `200` when nothing
new was accepted).

### Read the feed

```
GET /content-candidates/feed?days=7            # RSS, Authorization header
GET /content-candidates/feed?key=ak_...        # RSS, key in query (for feed readers)
GET /content-candidates/feed?format=json&key=ak_...
```

Because most RSS readers cannot set request headers, this endpoint bypasses
the API Gateway authorizer and validates the API key in the handler
(`functions/utils/api-key-validator.mjs`), accepting it from either the
`Authorization` header or the `key` query parameter. Treat feed URLs
containing the key as secrets.

## Data model

Candidates live in the main `NewsletterTable`:

| Attribute | Value |
| --- | --- |
| `pk` | `<tenantId>#content-candidate#<urlHash>` |
| `sk` | `candidate` |
| `GSI1PK` | `<tenantId>#content-candidates` |
| `GSI1SK` | `<submittedAt ISO>#<urlHash>` |
| `status` | `pending` → `vetted` \| `failed` |
| `verdict` | `{ recommendation, score, title, summary, reasons }` |
| `ttl` | 90 days after submission |

The feed queries `GSI1` by tenant partition with a `GSI1SK >= <since>` range.

## Learned content profile

Vetting does not rely solely on the author-written brand description. A
learning loop builds an evidence-backed editorial profile from what past
issues actually featured:

- **Source of truth** — every published issue already stores `link#<hash>`
  tracking records (`pk = <tenantId>#<issueNumber>`) with an LLM topic
  classification, a summary, and click counts. These are the proof of what
  gets featured and what readers engage with.
- **Learner** — `LearnContentProfileFunction` runs on every `ISSUE_PUBLISHED`
  event (and can be invoked directly with `{ "tenantId": "...", "backfill": true }`
  to build from history). It digests each recent issue's link records into a
  compact per-issue summary (topic counts + top links by clicks), merges them
  into the profile record, recomputes cumulative topic weights and the top
  exemplar links, and asks the model to distill the evidence into a 2–3
  sentence editorial summary plus concrete selection patterns.
- **Durable memory** — link records expire after 90 days, but the per-issue
  digests stored on the profile do not, so the profile accumulates roughly
  six months of editorial history (last 26 issues) that the raw records lose.
  Re-running the learner refreshes click counts for issues still within the
  TTL window.
- **Profile record** — `pk = <tenantId>`, `sk = content-profile`, holding
  `issueDigests`, `topicWeights` (`{ topic: { featured, clicks } }`),
  `exemplars`, and `editorialProfile { summary, patterns, issuesAnalyzed, linksAnalyzed }`.
- **Applied at vetting time** — the vetting prompt includes the learned
  summary, patterns, topic distribution, and exemplar links, and instructs
  the model to weigh this evidence *above* the stated brand focus when they
  disagree, and to cite the supporting evidence in the verdict. Citations
  surface in the RSS feed as "Backed by: …".

Run a backfill once after deploying so the first vetting calls already have
history to lean on:

```
aws lambda invoke --function-name <stack>-LearnContentProfileFunction-... \
  --payload '{"tenantId":"<tenantId>","backfill":true}' /dev/null
```

## Vetting notes

- The vetting prompt is grounded in the tenant record's `name`,
  `brandDescription`, and `industry`, so keep the brand description accurate —
  it is effectively the editorial policy the AI applies.
- When a learned content profile exists, it takes precedence: the model is
  told real editorial decisions and reader clicks outweigh the stated focus.
- Vetting is best-effort: if the model call fails, the candidate is marked
  `failed` and still appears in the JSON view so nothing silently disappears.
- Model: `MODEL_ID` env var on `VetContentCandidateFunction`
  (default `us.amazon.nova-pro-v1:0`).

## Chrome extension setup

See [`chrome-extension/README.md`](../chrome-extension/README.md) for install
and configuration steps.
