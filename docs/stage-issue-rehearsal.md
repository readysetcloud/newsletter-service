# Publish pipeline rehearsal protocol

The end-to-end check for any change to the publish pipeline: the
`StageIssueStateMachine` definition, the Lambdas it orchestrates
(`parse-issue` and the two parsers it dispatches to, `parse-md-to-json` and
`parse-json-issue`, plus `update-link-tracking`, `publish-issue` and
`generate-social-post`), or the send path underneath them (`send-email-v2`).

**This exists instead of an SFN Local harness.** A simulation can only assert
what someone thought to assert; a real run exercises the Scheduler entries, the
SES send, the template render and the DynamoDB writes at once. The Friday-stage /
Monday-send cadence leaves Monday afternoon through Friday with nothing in
flight, so a real run is available five days a week and takes about **15
minutes** (longer for local send — see [Local-send rehearsal](#local-send-rehearsal)).

Rehearse before merging any phase of `docs/stage-issue-simplification-plan.md`,
and any change to the files named above.

## What a rehearsal proves, and what it does not

It proves the pipeline produced the right *effects* — an email, a record status,
two Scheduler entries, link records. It does **not** prove the pipeline took the
right *path*: verification 1 exists precisely because a wrong path can still
produce a right-looking outcome for one issue and break the next one.

Two independence rules follow from how the machine is wired, and they are the
reason the verifications below are separate rather than one glance:

- **An email in the inbox does not mean the record is correct.** Everything after
  `Publish` can still fail — the Scheduler entries, the metadata write, the
  status write — and every one of those routes to
  `Update Issue Record - Failure` on an issue that has already gone out. (Before
  Phase 3 this cut the other way too: `Publish` was a sibling branch of
  `Update Web Links`, so a link failure could abort the `Parallel` after the send
  had left. `Extract Links` runs ahead of `Publish` now and its `Catch` continues
  down the publish path, so a link failure reaches neither the record nor the
  send.)
- **A green execution does not mean the send succeeded.** `publish-issue`
  catches its own errors and returns `{ success: false }`
  (`functions/publish-issue.mjs:97-100`). A failed send therefore shows up as the
  `Publish Success?` choice routing to `Update Issue Record - Failure`, not as an
  execution error. Read the choice outcome, not the execution's colour.

---

## One-time setup

### 1. The audience

The send is irreversible, so the audience is the one thing to get right before
anything else. Either:

- **A throwaway tenant** in a `sandbox` or `stage` deployment
  (`Environment` parameter, `template.yaml:6-9`), with a list containing only
  your own address; or
- **The production tenant pointed at a one-subscriber list** containing only
  your own address.

Requirements either way:

- The tenant needs a **verified default sender** — `send-email-v2` validates it
  and refuses otherwise.
- **Confirm the tenant's `list` before every rehearsal**, not just at setup.
  `publish-issue` sends to `tenant.list` as it reads it at send time
  (`functions/publish-issue.mjs:71`); a list that grew since the last rehearsal
  is a real send to real people.
- **Reserve an issue-number band for rehearsals — 9000 and up.** The stats
  Scheduler entry is named `ISSUE-STATS-<issueId>` with *no tenant prefix*
  (`state-machines/stage-issue.asl.json:437`) and lives in the shared
  `newsletter` schedule group, so a rehearsal that reuses a live issue number
  collides with that issue's real entry and `CreateSchedule` fails mid-run.
- **Use a fresh issue number for every rehearsal.** `update-link-tracking` skips
  the Bedrock call when a `link#` record already carries a `primaryTopic`
  (`functions/update-link-tracking.mjs:319-321`), so re-running against a
  previously-used number silently stops exercising classification.

### 2. Fixtures

Keep one fixture per content type under `__tests__/fixtures/rehearsal/` so runs
are comparable to each other. Suggested contents; the constraints in the notes
matter more than the prose does.

**`issue-markdown.md`**

```markdown
---
title: Rehearsal Issue
description: End-to-end rehearsal of the publish pipeline
date: 2026-07-29
author: allenheltondev
---
### First Section
A tracked link to [the AWS blog](https://aws.amazon.com/blogs/) and a second to
[the Step Functions docs](https://docs.aws.amazon.com/step-functions/).

{{< robotVoice text="beep boop, this is a rehearsal" >}}

### Second Section
A third tracked link: [EventBridge Scheduler](https://docs.aws.amazon.com/scheduler/).
A relative link ([about](/about)) and a [mailto](mailto:me@example.com) — neither
should produce a link record.

### Tip of the Week
Rehearse on a weekday.

### Last Words
That's all.
```

Notes:

- **The frontmatter `date` is the send instant for a markdown issue, and it is
  what the two Scheduler dates hang off** — not the API's `scheduledAt`, and not
  the `ISSUE-SEND-*` entry that starts the workflow. `parse-md-to-json` resolves
  it through `resolveSendInstant` (`functions/parse-md-to-json.mjs:60`) and
  derives `listCleanupDate` / `reportStatsDate` from it
  (`functions/parse-md-to-json.mjs:143-147`).
  **Bump it to the rehearsal day on every run.** A stale date degrades
  `sendAtDate` to `'now'` and anchors both Scheduler entries in the past, which
  is exactly the silent failure verification 4 is looking for.
- A bare date carries no time, so it is anchored to the tenant's
  `defaultSendTime` read as wall-clock in the tenant's `timezone`
  (`functions/utils/tenant-settings.mjs:212-235`). A date that names a time is
  respected as-is — use one if you want the expected Scheduler values to be
  obvious.
- At least three **absolute `http(s)` links in `[text](url)` form**.
  `update-link-tracking` tracks only those and skips relative and `mailto:`
  links (`functions/update-link-tracking.mjs:239-252`), so the fixture needs one
  of each to prove `position` stays dense over the tracked set.
- The `robotVoice` shortcode and the `Tip of the Week` / `Last Words` sections
  exercise the shortcode bridge and the two sections that render outside
  `content.sections`.

**`issue-json.json`** — the template data object, shaped as `parse-md-to-json`
would have produced it. Requires a `templateId` on the request.

```json
{
  "metadata": {
    "number": 9001,
    "title": "Rehearsal Issue (json)",
    "description": "End-to-end rehearsal, json content type",
    "date": "July 29, 2026"
  },
  "content": {
    "sections": [
      { "header": "First Section", "text": "<p>A <a href=\"https://aws.amazon.com/blogs/\">tracked link</a>.</p>" },
      { "header": "Second Section", "text": "<p>Another <a href=\"https://docs.aws.amazon.com/scheduler/\">link</a>.</p>" }
    ],
    "tipOfTheWeek": { "text": "<p>Rehearse on a weekday.</p>", "url": "https://example.com/tip" },
    "lastWords": "<p>That's all.</p>"
  }
}
```

`metadata.number` is overwritten with the real issue number by
`parse-json-issue` (`functions/parse-json-issue.mjs:41-44`), so it only has to
be present, not right.

The `<a href>` anchors in the section bodies are load-bearing for verification 5:
as of Phase 4 `update-link-tracking` extracts anchors out of the HTML that json
section bodies are made of, so a json fixture whose links are bare URL fields
(`tipOfTheWeek.url` above) produces no `link#` records — those are chrome and are
deliberately not tracked, the same way a markdown issue does not track its
frontmatter or sponsor URLs.

**`issue-html.html`** — a small pre-rendered email master. In `html` mode the
content is carried through untouched on `data.__master`
(`functions/parse-json-issue.mjs:24-28`) and sent verbatim, no template render
(`functions/publish-issue.mjs:19-21`). Include one absolute link and one
distinctive string you can grep the delivered mail for.

Two things worth putting in the html fixture on purpose, both of which
verification 5 reads: the same URL twice (once as an image link, once as a text
link) to confirm `position` still counts both occurrences while only one record is
written; and an Outlook conditional (`<!--[if mso]>…<![endif]-->`) carrying a
duplicate of a visible link, which must *not* consume a position.

### 3. Reference execution histories

Export three to five recent **real** execution histories now, before changing
anything. They are what "expected sequence" means in verification 1.

```
aws stepfunctions list-executions \
  --state-machine-arn "$STAGE_ISSUE_ARN" --status-filter SUCCEEDED --max-items 5

aws stepfunctions get-execution-history --execution-arn "$ARN" --max-results 1000 \
  > __tests__/fixtures/rehearsal/history-<issue>.json
```

The history embeds the execution input, which contains the full issue content —
scrub it if the fixture directory is not a fine place for that.

### 4. Environment identifiers

Have these to hand; every command below uses them.

| Variable | Where from |
|---|---|
| `STAGE_ISSUE_ARN` | `StageIssueStateMachine`; also the `STATE_MACHINE_ARN` env var on the API function |
| `TABLE_NAME` | `NewsletterTable` |
| `TENANT` | the rehearsal tenant id |
| `API` / `TOKEN` | `DashboardApi` base URL and a Cognito token for the tenant |

Scheduler entries all live in the `newsletter` schedule group. Since Phase 5
there are **three** kinds, and only the first can send an issue:

| Prefix | Created by | Fires |
|---|---|---|
| `ISSUE-SEND-<tenant>-<issue>` | the API, when an issue is scheduled | at the send instant − `IssueSendLeadTimeMinutes`; **starts the workflow** |
| `ISSUE-STATS-<issue>` | the workflow | send +5 days |
| `<tenant>-CLEAN-<issue>` | the workflow | send +3 days |

---

## Deploy windows

From `docs/stage-issue-simplification-plan.md` §2. The distinction is that the
stage-issue *execution* ends Monday ~09:05, while the *sends* it kicked off keep
firing until roughly 20:30Z — and Lambda code is not versioned per-execution, so
changing send-path code before then alters an in-flight send.

| When | Safe to deploy |
|---|---|
| Fri (staging) → Mon 09:00 | **Nothing.** A send is pending — since Phase 5 as an `ISSUE-SEND-*` Scheduler entry rather than an execution parked in `Wait`. See the pre-deploy check: what is at risk in this window changed with it. |
| Mon ~09:05 → ~16:00 | **State machine definition only.** Local-send groups and the catch-all sweep are still firing. |
| Mon ~16:00 → Thu | **Everything** — definition, Lambdas, resources, in one deploy. |
| Fri | **Nothing.** Friday is staging day. |

"Send-path Lambda changes" means `send-email-v2`, `publish-issue`, and anything
they import (`functions/utils/send-progress.mjs`, `interest-assembly.mjs`): wait
for Monday late afternoon.

### Pre-deploy check

Updating a Standard state machine does not affect running executions — they
finish on the definition they started with. That normally forces a two-deploy
dance for any resource removal; it does not here, because in-window there is
nothing running. **Confirm rather than assume, every time:**

```
aws stepfunctions list-executions \
  --state-machine-arn "$STAGE_ISSUE_ARN" --status-filter RUNNING

aws scheduler list-schedules --group-name newsletter \
  --name-prefix ISSUE-SEND- --query 'Schedules[].{n:Name,t:Target.Arn}'
```

**Both have to be empty**, and the second one is the check Phase 5 added. A
scheduled issue is no longer a running execution: it is an `ISSUE-SEND-*` entry
that will *start* one at the send instant, so `list-executions` comes back empty
all week and says nothing about whether a send is pending. Anything listed by
either command — stop.

What each one puts at risk is different, which is the reason to read both:

- **A running execution** pins the definition it started with, so any resource it
  still needs has to survive the deploy.
- **A pending `ISSUE-SEND-*` entry** pins the *execution input the API baked into
  it when the issue was scheduled*, and it will start that input against
  **whatever definition is live when it fires**. So the thing to protect in this
  window is the input contract, not the resource list: a deploy that changes what
  the definition reads off `$$.Execution.Input` (or removes a state a pending
  input still steers through) mis-sends the pending issue. Reschedule the issue
  after such a deploy rather than reasoning about it — `PUT /issues/{id}` with
  `status: "draft"` deletes the entry, then re-schedule.

The exception neither check covers: **the two post-send Scheduler entries outlive
their execution by days.** `ISSUE-STATS-<issue>` fires at send +5 days and
`<tenant>-CLEAN-<issue>` at +3, so the previous issue's entries are outstanding
mid-window. Do not delete their targets (`ReportStatsStateMachine`, the default
event bus), their IAM roles (`ReportStatsRole`, `CleanupListRole`), or the
schedule-name patterns while entries exist.

---

## The run

Per content type, ~15 minutes. Repeat for markdown, json, and html.

1. **Pre-flight.** `list-executions --status-filter RUNNING` is empty. The
   tenant's `list` still has exactly your address in it. Pick an unused issue
   number ≥ 9000.
2. **Bump the markdown fixture's frontmatter `date`** to the rehearsal day (see
   the fixture notes — this is the step that gets skipped and invalidates
   verification 4).
3. **Stage the fixture with a send time ~10 minutes out.** Use an explicit
   RFC3339 UTC instant; a date-only `scheduledAt` gets the tenant's
   `defaultSendTime`, which is not 10 minutes from now.

   ```
   curl -sS -X POST "$API/issues" \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{
       "issueNumber": 9001,
       "subject": "Rehearsal 9001 (markdown)",
       "contentType": "markdown",
       "action": "schedule",
       "scheduledAt": "2026-07-29T14:10:00Z",
       "content": "<fixture contents>"
     }'
   ```

   For json: `"contentType": "json"` plus a `templateId` (required). For html:
   `"contentType": "html"`; both take the same path as markdown apart from social
   copy, and `Route By Content Type`
   (`state-machines/stage-issue.asl.json:223-250`) is where they diverge.

   Ten minutes is deliberate: long enough to confirm the issue is genuinely
   parked before the send, short enough that the whole rehearsal fits in one
   sitting.

4. **Confirm the pending send, before the send time.** Since Phase 5 there is
   nothing to describe yet — the record stays `scheduled` with no `executionArn`,
   and the workflow does not exist until the `ISSUE-SEND-*` entry starts it.
   Check both halves:

   ```
   aws dynamodb get-item --table-name "$TABLE_NAME" \
     --key "{\"pk\":{\"S\":\"$TENANT#9001\"},\"sk\":{\"S\":\"newsletter\"}}" \
     --query 'Item.{status:status.S,arn:executionArn.S,scheduledAt:scheduledAt.S}'

   aws scheduler get-schedule --group-name newsletter --name "ISSUE-SEND-$TENANT-9001"
   ```

   Expect `status: scheduled`, **no** `executionArn`, and a schedule whose
   `ScheduleExpression` is `at(<scheduledAt − IssueSendLeadTimeMinutes>)` in UTC
   targeting `StageIssueStateMachine`. A record already at `in progress` before
   the send time is the pre-Phase-5 shape and means the API started an execution
   directly (D5). No schedule but a `scheduled` record is the one unrecoverable
   combination — the send will never fire and nothing watches for it.

5. **Grab the execution ARN after the send time.** The execution records it
   itself (`Mark Issue In Progress`), because the API has no ARN for an execution
   it did not start (`functions/src/api/controllers/issues.rs:4071-4092` is the
   immediate-publish path only). Re-run the `get-item` above, or:

   ```
   aws stepfunctions list-executions --state-machine-arn "$STAGE_ISSUE_ARN" --max-items 5
   ```

6. **Wait out the send time**, then work the five verifications in order.

---

## The five verifications

### 1. The execution's state sequence matches expectation

Easiest to skip and easiest to be wrong about, because a wrong path still
produces a plausible-looking issue.

```
aws stepfunctions get-execution-history --execution-arn "$ARN" --max-results 1000 \
  --query 'events[?stateEnteredEventDetails].stateEnteredEventDetails.name' --output text
```

**Markdown, scheduled** (today's definition):

```
Get Existing Issue → Has Issue Been Processed? → Mark Issue In Progress
  → Is Scheduled In The Future? → Trigger Site Rebuild → Route By Content Type
  → Markdown Extras → Extract Links → Parse Issue → Publish → Publish Success?
  → Schedule Tasks and Update
       branch 0: Schedule Issue Report
       branch 1: Format List Cleanup Input → Schedule List Cleanup
       branch 2: Update Issue Metadata
  → Update Issue Record - Success → Social Copy Applies?
  → Generate Social Copy → Notify of Success → Success
```

**json / html, scheduled** — the same states, minus the one markdown-only step:

```
Get Existing Issue → Has Issue Been Processed? → Mark Issue In Progress
  → Is Scheduled In The Future? → Trigger Site Rebuild → Route By Content Type
  → No Markdown Extras → Extract Links → Parse Issue → Publish → Publish Success?
  → Schedule Tasks and Update
       branch 0: Schedule Issue Report
       branch 1: Format List Cleanup Input → Schedule List Cleanup
       branch 2: Update Issue Metadata
  → Update Issue Record - Success → Social Copy Applies?
  → Notify of Success → Success
```

**`Wait For Future Date` must not appear on either.** Phase 5 moved the waiting
out of the execution: the API sends no `futureDate`, so
`Is Scheduled In The Future?` falls through to `Trigger Site Rebuild` and a
scheduled issue looks exactly like an immediate one from `Get Existing Issue`
onward. Seeing the `Wait` means the input still carries a `futureDate` — either
the legacy GitHub ingress produced this execution (it resolves its own
frontmatter date and still uses the `Wait` deliberately), or the API was rolled
back to `StartExecution`. On an API-staged rehearsal it is a finding.

Phase 3 collapsed the two tails into one and Phase 4 made link extraction
shared, so the two sequences now differ in exactly two places — `Markdown Extras`
vs `No Markdown Extras`, which only bind `$contentType` and a fallback `$social`,
and whether `Social Copy Applies?` routes through `Generate Social Copy`.
Comparing them against each other is itself a check: any *third* difference is a
bug. In particular `Extract Links` must appear on both, and before `Publish` on
both.

Reading notes:

- **Branch states interleave nondeterministically.** Compare the states inside a
  `Parallel` as a set; only the order *across* the parallel's boundary is
  meaningful.
- `Mark Issue In Progress` is the expected third state, and it is where the issue
  content is read: the record is `draft` for an immediate publish and `scheduled`
  for a scheduled one (`create_issue_record`, `issues.rs:4256`), and both are
  sendable. `Save Issue Record` instead means the record was absent or `failed`,
  which for an API-staged issue now fails the execution rather than recovering it
  — the input carries identifiers only, so there is no content to write.
  `Success - Duplicate Request` means the record was past those statuses and
  **nothing was sent** — usually a re-run against a used issue number.
- `Update Issue Record - Failure` must **not** appear on any rehearsal. The
  preview states that used to be listed here alongside it (`Send Preview`,
  `Publish JSON Preview`) are gone — Phase 2 deleted them.
- `Trigger Site Rebuild` must appear on **both** the scheduled and the immediate
  path. It used to hang off the `Wait` alone, so an immediate publish never
  rebuilt the site (D6); Phase 3 moved it onto the common path, which makes its
  absence from an immediate-publish rehearsal a regression rather than the
  expected result it was before.
- After Phase 1, also check that every `Task` that failed routed through its
  `Catch` rather than failing the execution.

Diff against a reference history from setup step 3 when the phase touched the
definition.

### 2. The email arrives and renders

In the rehearsal inbox:

- **Subject.** The API always supplies one and a caller subject outranks the
  tenant's `subjectTemplate` (`functions/utils/tenant-settings.mjs:271-272`), so
  it should be exactly what was posted. No `[Preview]` prefix — that prefix
  means the preview path ran.
- **One copy only.** A second copy means a group send and the catch-all both
  delivered to the same address; check per-recipient idempotency.
- **Render.** Sections in fixture order, headers present, the `robotVoice`
  block expanded, tip-of-the-week and last-words blocks present, the sponsor
  block absent (no sponsor in the fixture). No literal `{{`/`}}` and no
  `%%BODYBLOCK` placeholders anywhere in the body — either is a render failure
  that still sends.
- **Links.** Each tracked link resolves to its destination.
- **html fixture:** the body is the master, verbatim. Grep for the distinctive
  string; any wrapping means the `html` branch did not take.

### 3. The issue record's terminal status is correct

```
aws dynamodb get-item --table-name "$TABLE_NAME" \
  --key "{\"pk\":{\"S\":\"$TENANT#9001\"},\"sk\":{\"S\":\"newsletter\"}}" \
  --query 'Item.{status:status.S,publishedAt:publishedAt.S,subject:subject.S,gsi:GSI1PK.S}'
```

| Issue | Expected status |
|---|---|
| Scheduled, before the send time | `scheduled` — for the whole wait, with no `executionArn` |
| Ordinary send | `published`, with `publishedAt` set |
| Local-send issue | `sending` while groups are outstanding, then `published` — see below |
| Deliberately broken run | `failed` |

The first row is Phase 5's fix for D5 and reads like a stall if you are used to
the old shape: the record used to claim `in progress` from the moment it was
staged, for days. `scheduled` until the send instant is now correct.

`in progress` after the execution finished is the wedged-record failure mode
(D2): the send may or may not have happened, so check the inbox before touching
anything. `GSI1PK` should be `<tenant>#newsletter` and `subject` should be set —
those come from `Update Issue Metadata`, which is easy to lose when the two
content-type paths get unified.

### 4. The two Scheduler entries exist with the right dates

**This is the highest-consequence silent failure in the system, and the one a
simulation is most likely to miss.** Both entries fire days later, targeting
things nobody is watching: a wrong date means the stats report or the bounce
cleanup misfires three to five days after the issue went out, with no alarm and
no operator present. Nothing else in the rehearsal is checked this carefully.

| Entry | Name | Fires | Target |
|---|---|---|---|
| Stats report | `ISSUE-STATS-<issueId>` | send **+5 days** | `ReportStatsStateMachine` via `ReportStatsRole` |
| List cleanup | `<tenantId>-CLEAN-<issueId>` | send **+3 days** | `eventbridge:putEvents` via `CleanupListRole` |

Both values are computed in the parse Lambdas — `reportStatsDate` and
`listCleanupDate` at `functions/parse-md-to-json.mjs:137-145` (and the mirror at
`functions/parse-json-issue.mjs:61-67`) — passed out on the parse result,
`Assign`ed to execution variables, and interpolated into
`ScheduleExpression: at(<value>)`.

```
aws scheduler get-schedule --group-name newsletter --name "ISSUE-STATS-9001"
aws scheduler get-schedule --group-name newsletter --name "$TENANT-CLEAN-9001"
```

Assert on each:

- `ScheduleExpression` is `at(YYYY-MM-DDTHH:MM:SS)` — no fractional seconds, no
  `Z` (the value is `toISOString().split('.')[0]`), and **+5 / +3 days from the
  send instant to the second**.
- `ScheduleExpressionTimezone` is absent, so Scheduler reads the expression as
  **UTC**. A timezone appearing here shifts the fire time by hours.
- `FlexibleTimeWindow.Mode` is `OFF`, `ActionAfterCompletion` is `DELETE`.
- `Target.Arn` / `Target.RoleArn` match the table above.
- On the cleanup entry, the event `Detail` carries `currentIssue`
  `<tenant>#9001` and `previousIssue` `<tenant>#9000` — the `States.MathAdd(…, -1)`
  in `Format List Cleanup Input` is trivially breakable when the paths are
  merged.

**The base instant differs by content type today, and both are correct-by-design
— know which one you are checking:**

- **markdown:** base is the resolved frontmatter `date`. If the fixture's date
  is stale, both entries land in the *past* and `sendAtDate` is `'now'`.
- **json / html:** base is the moment `Parse Issue` runs — i.e. when the
  execution starts, within seconds of the real send. The state machine does not
  forward `futureDate` to the parse step, so `hasFutureSend` is false and
  `baseDate` is `now` (`functions/parse-json-issue.mjs:52-62`). The dispatcher
  changed nothing here: it forwards the payload it is given and returns the
  parser's values verbatim (`functions/parse-issue.mjs`).

  **This is why `IssueSendLeadTimeMinutes` cannot simply be raised.** For json and
  html the base instant *is* the execution's start time, so a lead time of `L`
  moves both entries `L` earlier — and moves the send itself earlier, because
  `sendAtDate` comes out as `'now'` too. The parameter defaults to `0` and Phase 6
  has to forward the send instant to `Parse Issue` before it can be raised; see
  `issue_send_lead_time` in `functions/src/api/controllers/issues.rs`. If a
  rehearsal runs with a non-zero lead time, verification 4's expected values shift
  by it and verification 2 will show an email that arrived early.

Compute expectations **in UTC**, because `setDate()` does its arithmetic in the
runtime's local zone — UTC in Lambda, but your laptop's zone on your laptop,
which diverges across a DST boundary:

```
TZ=UTC node -e 'const b=new Date("2026-07-29T14:10:00Z");
  for (const d of [3,5]) { const x=new Date(b); x.setDate(x.getDate()+d);
    console.log(d, `at(${x.toISOString().split(".")[0]})`); }'
```

Any dispatcher or refactor that moves this computation must reproduce these
values **byte-identically**; diff the new output against both original parsers
on all three fixtures before deploying.

### 5. `link#` records exist with `url`, `position` and `primaryTopic`

```
aws dynamodb query --table-name "$TABLE_NAME" \
  --key-condition-expression 'pk = :pk AND begins_with(sk, :sk)' \
  --expression-attribute-values \
    "{\":pk\":{\"S\":\"$TENANT#9001\"},\":sk\":{\"S\":\"link#\"}}" \
  --query 'Items[].{sk:sk.S,url:url.S,position:position.N,topic:primaryTopic.S}'
```

Expected for **every** fixture, markdown, json and html: one record per distinct
**absolute `http(s)`** link, each with

- `url` — the original URL (the click redirect and the site render hook both key
  off `link#<hash(url)>` of *that* URL);
- `position` — 1-based, in document order. The relative and `mailto:` links must
  not consume a position: `position` is what aligns these records with the Hugo
  render hook's wrapping set (`functions/update-link-tracking.mjs:239-242`). It
  counts *occurrences*, so a URL used twice leaves a gap in the recorded
  positions — the record keeps the first occurrence's ordinal and the second
  occurrence still consumes one;
- `primaryTopic` — plus `secondaryTopics`, `summary`, `confidence` and
  `classifiedBy: "llm"`.

A record with `url` and `position` but no `primaryTopic` means the Bedrock
classification failed. That is *by design* fail-open — the base record is still
written so click counting works — so it will not redden anything. Check the
function's logs before accepting it.

**json and html are the point of this verification since Phase 4.** They used to
produce no `link#` records at all (D7 — the non-markdown path had no link branch),
which left interest assembly and top-link reporting with nothing to read for them.
Extraction is now shared and content-type aware: markdown links for a markdown
issue, `<a href>` anchors for the HTML a json section body or an html master is
made of. Records with all three fields appearing for all three fixtures is this
phase's primary acceptance criterion.

Two coverage limits to expect rather than chase:

- an `html` master's chrome is indistinguishable from its content, so a
  "view online" or sponsor-logo link gets a record and a classification like any
  other link. Markdown issues do not track those, so the two content types cannot
  be expected to produce identical link sets for the same issue;
- markdown links inside a json section body are not extracted — the documented
  shape of that field is HTML (it is what `parse-md-to-json` produces) and it is
  rendered as HTML, so a `[text](url)` in there would not be a link in the
  delivered email either.

---

## Local-send rehearsal

Run this as a fourth rehearsal whenever the change touches `send-email-v2`,
`functions/utils/send-progress.mjs`, `functions/src/api/controllers/send_progress.rs`,
or either `published` write in the state machine.

Stage the markdown fixture with local send on:

```json
"localSend": { "enabled": true, "defaultTimeZone": "America/Chicago", "mode": "timezone" }
```

Setup notes:

- Local send is **ignored when the issue has an active A/B test** — A/B wins
  (`functions/publish-issue.mjs:44-56`). Do not set both.
- With one subscriber you get one group plus the catch-all, which is enough to
  prove the handshake. To exercise more than one group you need subscribers with
  **different confirmed timezones**.
- **Budget the time.** The catch-all is scheduled 30 minutes after the latest
  group (`functions/send-email-v2.mjs:435-436`), and the issue does not reach
  `published` until it lands. Plan for latest-group + ~35 minutes, and pick
  zones close to the default zone unless you specifically want a long tail.

### The `sendProgress` record

```
aws dynamodb get-item --table-name "$TABLE_NAME" \
  --key "{\"pk\":{\"S\":\"$TENANT#9001\"},\"sk\":{\"S\":\"sendProgress\"}}"
```

- Written **before** any group event is emitted — a group that fires immediately
  can report back within milliseconds, and a plan written afterwards would drop
  it and leave the issue stuck at `sending`.
- `mode`, `defaultTimeZone`, `baseAt`, `catchAllAt`, `startedAt`,
  `totalSubscribers` all present and sane; `catchAllAt` is the latest group's
  `sendAt` + 30 minutes.
- `groups` is a map keyed by label: an IANA zone name per timezone group,
  `__default__` for subscribers with no confirmed timezone, `hour-<0-23>` in
  peak-hour mode, and `__catch_all__` for the sweep. The catch-all's `size` is
  `null` — how many it sends to is not knowable at plan time.
- **Every group reports.** Each entry ends at `status: sent` (delivered to at
  least one recipient) or `status: empty` (nothing left to send), with `sentAt`,
  `recipients` and `skipped`. `empty` is the *normal* outcome for the catch-all,
  because the per-group sends already covered everyone. A group still `pending`
  30 minutes past its `sendAt` is the stall case.
- `completedAt` is stamped exactly once, by whichever group reported last.

### The status handshake — preserve this exactly

The state machine's `published` write races the fan-out's `sending` write, and
both directions are guarded. Do not regress either half:

- The fan-out moves the issue to `sending`, conditional on it being mid-flight
  (`from: ['in progress', 'published', 'sending']` — `draft` is excluded so a
  stray event cannot resurrect an unsent issue).
- `Update Issue Record - Success` carries `ConditionExpression:
  "#status <> :sending"` plus a `Catch` on
  `DynamoDB.ConditionalCheckFailedException`. When the fan-out got there first,
  the write is refused and the execution **continues to `Social Copy Applies?`
  and Succeeds** with the record still at `sending`. A green execution plus
  `status: sending` is the correct state here, not a bug. Phase 3 merged the two
  writes that used to carry this (`Mark JSON Issue Published` was the json path's
  copy), so there is now one place for it to be right — and
  `__tests__/state-machines/stage-issue-definition.test.mjs` asserts both halves.
- The issue reaches `published` **only after the catch-all sweep has reported**,
  because the catch-all is one of the planned groups: `markGroupSent` stamps
  `completedAt` when `isComplete` first holds, and only then flips the status
  `sending → published`, preserving the earlier `publishedAt` via
  `if_not_exists`.

Verify the whole arc, not just the endpoint: `sending` shortly after publish,
still `sending` while any group is pending, `published` after the catch-all.

### The dashboard delivery panel

Open `/issues/9001`. `GET /issues/{id}` returns `sendProgress` and `workflow`
(`functions/src/api/controllers/issues.rs:522-530`), and the **"Local send
delivery"** card renders them (`dashboard-ui/src/components/issues/SendProgressCard.tsx`).

- Before fan-out there is no `sendProgress`, so the card shows the **workflow**
  row instead — `waiting`. Before the send time that row is derived from the
  record (`scheduled` plus a future `scheduledAt`), not from `DescribeExecution`:
  there is no execution to describe yet, and `get_workflow_state_for` returns
  `waiting_for_send_time` off the record for exactly that reason
  (`issues.rs:556-573`). The two are alternatives, never stacked.
- After fan-out: state `Sending`, `groupsDelivered` / `groupsTotal` climbing,
  one row per group with its scheduled time in the tenant's timezone, and
  `nextSendAt` pointing at the earliest outstanding group.
- After the catch-all: state `Delivered`, `groupsDelivered == groupsTotal`,
  `completedAt` set, `recipientsSent` matching what actually went out.
- `Needs attention` (`stalled`) appears when a group is more than
  `OVERDUE_GRACE_MINUTES` = 30 past its scheduled time and has not reported
  (`functions/src/api/controllers/send_progress.rs:29`). Seeing it during a
  rehearsal is a finding, not a UI quirk.

---

## Failure-path rehearsal

Phase 1 claims a failed Lambda lands the record on `failed` instead of wedging
it at `in progress`. Prove it: temporarily `throw` in `parse-md-to-json` on a
non-production deployment, stage a fixture, and confirm the execution routes
through the `Catch` to `Update Issue Record - Failure`, the record reads
`failed` with the error cause persisted, and **no email was sent**. Revert the
throw immediately afterwards.

Phase 4 has its own variant, and it is the one that proves the phase is safe
rather than merely useful: force `Extract Links` to time out — a `sleep` past the
state's `TimeoutSeconds` in `update-link-tracking`, or a Bedrock model id that
does not resolve — and confirm the execution goes on through `Parse Issue` to
`Publish`, the email arrives, and the record reads `published`, not `failed`. The
`States.Timeout` should appear in the history as a caught error on `Extract Links`
and nowhere else. Degraded personalization is acceptable; a missed issue is not.

---

## Cleanup

A rehearsal leaves live Scheduler entries behind, and `ActionAfterCompletion:
DELETE` only removes them **after they fire**. Left alone, `ISSUE-STATS-9001`
will run `ReportStatsStateMachine` against a throwaway issue five days later,
and the cleanup entry will emit a bounce-cleanup event three days later naming a
`previousIssue` that does not exist. Delete them unless you specifically want
those to happen:

```
aws scheduler delete-schedule --group-name newsletter --name "ISSUE-STATS-9001"
aws scheduler delete-schedule --group-name newsletter --name "$TENANT-CLEAN-9001"
aws scheduler list-schedules --group-name newsletter --name-prefix local- \
  --query 'Schedules[].Name'
```

**Abandon a rehearsal after step 3 and there is a fourth entry, and it is the only
one that sends an issue.** An `ISSUE-SEND-*` entry fires whether or not you are
still watching, and its `ActionAfterCompletion: DELETE` only tidies up after the
send has gone. Cancel through the API so the record and the schedule stay
consistent — the API deletes the schedule before writing the record back to
`draft`, in that order, because the state machine treats a `draft` record as
sendable:

```
curl -sS -X PUT "$API/issues/9001" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"draft"}'

aws scheduler list-schedules --group-name newsletter --name-prefix ISSUE-SEND- \
  --query 'Schedules[].Name'
```

The second command is the one that has to come back empty. `DELETE /issues/9001`
does the same thing and removes the record with it.

Any `local-*` entries left over from an aborted local-send rehearsal will fire
and send again — delete them too.

Then delete the rehearsal items: the `newsletter` record, the `sendProgress`
record, and the `link#` records for `pk = <tenant>#9001`.

---

## Sign-off

Copy into the PR and tick per content type.

```
Rehearsed on: <date>   Deployment: <sandbox|stage|production>   Issues: 9001-9003

[ ] Pre-deploy: list-executions --status-filter RUNNING was empty
[ ] Pre-deploy: list-schedules --name-prefix ISSUE-SEND- was empty
[ ] Tenant list confirmed to contain only the rehearsal address
[ ] Before the send time: record was `scheduled` with no executionArn
[ ] markdown: V1 sequence  V2 email  V3 status  V4 scheduler dates  V5 link records
[ ] json:     V1 sequence  V2 email  V3 status  V4 scheduler dates  V5 link records
[ ] html:     V1 sequence  V2 email  V3 status  V4 scheduler dates  V5 link records
[ ] Extract Links forced to time out: send still went, record published
[ ] local send: sendProgress plan, every group reported, published only after catch-all
[ ] dashboard "Local send delivery" card matched the record
[ ] No ISSUE-SEND-* entry left behind (the only leftover that can send)
[ ] Scheduler entries and rehearsal records cleaned up
```
