# Stage-Issue State Machine Simplification Plan

**Status:** Draft for review
**Scope:** `state-machines/stage-issue.asl.json` and the Lambdas it orchestrates. Reduce the definition from 25 states / 896 lines to ~10–12 states, remove duplication and dead code, close the failure-visibility gaps, and unblock timezone-correct local send — without ever risking a missed, duplicated, or stale send.
**Out of scope:** the send path itself (`send-email-v2.mjs`). See §7.

---

## 1. Goal

| | Today | After |
|---|---|---|
| States | 25 | ~10–12 |
| Lines | 896 | ~450 |
| Content-type paths | 2 (near-duplicate tails) | 1 |
| Dead states | 4 (preview) | 0 |
| `Catch` blocks | 0 | every Task |
| Definition tests | 0 | structural lint in CI + a midweek rehearsal protocol |
| Timers owning the send instant | 4 | 2 (start schedule + local-send groups) |

The state machine keeps the jobs it is genuinely good at — the status handshake, ordered post-send fan-out, and per-issue audit trail — and stops doing the two it is bad at: **waiting**, and **branching on content type**.

---

## 2. Operating cadence — the window this work happens in

Single operator, single tenant. Issues are staged **Friday** and send **Monday 9am**. That fixed rhythm is the most useful de-risking fact available, because it means there is a guaranteed window every week in which nothing is in flight:

| When | Stage-issue executions | Send path | Safe to deploy |
|---|---|---|---|
| Fri (staging) → Mon 09:00 | 1 parked in `Wait` | idle | **No** |
| Mon ~09:05 onward | drained (the execution ends as soon as `Publish` returns) | local-send groups + catch-all still firing | definition only |
| Mon ~16:00 → Fri (pre-staging) | none | idle | **Yes — everything** |

Two details behind the table:

- The stage-issue execution **completes Monday morning**, not when the last email lands. `publish-issue` hands off to `send-email-v2`, which fans out to Scheduler entries and returns; the execution is done by ~09:05.
- The *sends* continue for hours. Westmost group (9am local in UTC−11) plus the 30-minute catch-all puts the last delivery near 20:30Z ≈ 15:30 CDT. Lambda code is **not** versioned per-execution, so changing `send-email-v2` / `publish-issue` before then would alter an in-flight send. Hence the separate "definition only" row.

**The rule this yields: deploy Monday afternoon through Thursday. Never Friday — Friday is staging day.**

### Hazards, in light of that cadence

**H1 — Irreversible event, but a low-stakes and rehearsable one.** A send cannot be recalled. But the audience is your own list, there is a `sandbox | stage | production` environment parameter (`template.yaml:6-8`), and Monday–Friday is entirely free. So a **full end-to-end rehearsal is available five days a week** — stage a throwaway issue against a one-subscriber list, let it actually send. That is higher-fidelity than any simulation and takes minutes. It is the primary validation mechanism for every phase below.

**H2 — Largely neutralized, with one exception.** Updating a Standard state machine does not affect already-running executions: a scheduled issue parked in `Wait For Future Date` completes on the definition live when it started. That would normally force a two-deploy dance for every resource removal. It doesn't here — in the Monday-afternoon-to-Thursday window there are no running executions, so **definition and resource changes can land in a single deploy**. Confirm rather than assume, each time:

```
aws stepfunctions list-executions --state-machine-arn <StageIssue> --status-filter RUNNING
```

The exception is **EventBridge Scheduler entries, which outlive their execution by days**: `ISSUE-STATS-<issue>` fires at send +5 days and `<tenant>-CLEAN-<issue>` at +3 (`parse-md-to-json.mjs:137-145`). Both land mid-window for the *previous* issue. They target `ReportStatsStateMachine` and the EventBridge bus directly, so they do not pin the stage-issue definition — but do not delete those targets, their IAM roles, or the schedule-name patterns while entries are outstanding.

**H3 — No test coverage of the definition.** There is no SFN Local harness, no structural validation, and no ASL assertions in `__tests__/`. The `$.Execution.Input.tenant.id` typo at line 296 has been sitting in the file undetected precisely because nothing checks it. Phase 0 fixes this first.

**H4 — Two producers until #358 lands.** PR #358 removes `import-issue-from-github.mjs`. Until it merges, the execution input has two producers with different assumptions (notably `isPreview`), and any input-contract change has to satisfy both.

---

## 3. Defects this plan fixes

Tracked here so the refactor and the bug fixes stay distinguishable in review.

| # | Defect | Location | Fixed in |
|---|---|---|---|
| D1 | `"$.Execution.Input.tenant.id"` — single `$`, unretryable `States.Runtime` at runtime | asl:296 | Phase 1 |
| D2 | No `Catch` anywhere: a post-retry throw leaves the record at `in progress` forever — possibly *after* the email was sent, since `Publish` is inside the parallel | asl (all Tasks) | Phase 1 |
| D3 | `Generate Social Copy` runs after the success write, so a Bedrock failure reddens the execution for an issue that published fine | asl:833 | Phase 1 |
| D4 | Edit-after-schedule sends stale content: the record is editable while `in progress` (`issues.rs:2668`) but the execution publishes `$$.Execution.Input.content` captured at schedule time | asl + issues.rs | Phase 5 |
| D5 | A scheduled issue reports `in progress` for its entire wait, not `scheduled` (a valid status per `issues.rs:2144`) | asl:62 | Phase 5 |
| D6 | `Trigger Site Rebuild` fires only on the scheduled path; immediate publishes never rebuild the site | asl:120–145 | Phase 3 |
| D7 | JSON/HTML issues never run link extraction, so they get no `link#` records with `url`/`position`/`primaryTopic`; interest assembly and top-link reporting cannot work for them | asl:465 (path has no link branch) | Phase 4 |
| D8 | For markdown, link classification races the send — it is a sibling parallel branch, so topics are often unknown at render time (acknowledged in `interest-assembly.mjs:21-22`) | asl:193–226 | Phase 4 |
| D9 | Local send cannot honor zones east of the base zone: all work happens after the `Wait`, so their local target time is always already past | asl:142 | Phase 6 |
| D10 | No way to cancel a scheduled issue — there is no `StopExecution` path in the API | issues.rs | Phase 5 (gains `DeleteSchedule`) |

---

## 4. Phase 0 — Safety net (do this first, ship nothing else with it)

This is the phase that converts "big risk" into "mechanical". Two deliverables — one automated guard against structural regressions, one high-fidelity behavioral check that the Monday–Friday window makes almost free.

**0a. Definition linter (pure jest, no Docker, ~1 hour).** A test that loads the ASL as JSON and asserts invariants:

- every `".$"` value starting with `$$.` uses a known context path, and **no** value matches `^\$\.Execution` (catches D1 and its whole family);
- every `Task` has a `Retry` and, after Phase 1, a `Catch`;
- every `${Substitution}` in the definition exists in `template.yaml`'s `DefinitionSubstitutions`, and vice versa (catches orphaned substitutions when deleting states);
- every `Next`/`Default` target resolves to a state in the same scope; no unreachable states (this alone would have flagged the 4 dead preview states);
- state count and `Choice` count against expected values, so structural change is always deliberate.

**0b. A written rehearsal protocol (~2 hours to establish, ~15 minutes to run).** Not a test harness — a checklist, because the cadence means real end-to-end runs are available Monday through Friday and a real run beats a simulated one. Set up once:

- a throwaway tenant (or the production tenant pointed at a one-subscriber list containing only your own address);
- a fixture issue per content type — markdown, json, html — kept in `__tests__/fixtures/` so rehearsals are identical run to run;
- the checklist itself: for each content type, stage the fixture with a send time ~10 minutes out, then verify (1) the execution's state sequence in the console, (2) the email arrives and renders, (3) the record's terminal status is `published`, (4) `ISSUE-STATS-*` and `*-CLEAN-*` Scheduler entries exist with dates at send +5 and +3, (5) `link#` records exist with `url`, `position`, and `primaryTopic`.

Item (4) is the one a simulation would most likely miss, and it is the highest-consequence silent failure in the system: a wrong date there mis-schedules a job three to five days out, where nothing is watching.

Also export 3–5 recent real execution histories from the console now, before anything changes, and keep them as reference fixtures. They are what "expected sequence" means.

**On SFN Local:** deliberately deferred, not adopted. Its value is simulating what you cannot run for real — and you can run this for real, any weekday, in minutes. Revisit only if Phase 3 rehearsals turn up something the linter didn't catch, or if this service ever gets a second operator who cannot rehearse against production.

**Gate to Phase 1:** 0a green in CI; rehearsal protocol written and run clean once on all three content types.

---

## 5. Phases

Each phase is one PR, independently deployable and reversible. No phase both changes structure and deletes a resource.

### Phase 1 — Correctness only, no structural change

**Change**
- Fix D1 (`$$`).
- Add `Catch` to every `Task` and to both `Parallel` states, routing to `Update Issue Record - Failure` with `ResultPath: "$.error"`; persist the error cause on the record so the failure is diagnosable without opening the console. Make `Update Issue Record - Failure` idempotent (it can now be reached from more than one place).
- Move `Generate Social Copy` off the critical path (D3): after `Notify of Success`, or fire an event and let it run outside the execution. Preference: keep it in the machine but give it `Catch → Notify of Success` so it can never fail a published issue.

**Why first:** purely additive to the definition, no states removed, so H2 does not apply and in-flight executions are unaffected either way. It also shrinks the blast radius of every later phase — after this, a mistake in Phase 3 marks the record `failed` instead of leaving it silently wedged.

**Validation:** 0a, plus a rehearsal with a deliberately broken Lambda (temporarily throw in `parse-md-to-json` on stage) to prove the record now lands on `failed` instead of wedging at `in progress`. **Rollback:** revert the definition; no resource or contract change.

### Phase 2 — Delete the dead preview path

**Gate:** #358 merged (H4), and no RUNNING executions started by the legacy ingress.

**Change** Remove `Send email preview?`, `Send Preview`, `Send JSON Preview?`, `Publish JSON Preview`, and the `isPreview` plumbing from the definition and from the API's execution input.

**Keep** `publish-issue.mjs`'s `isPreview` branch (`publish-issue.mjs:24`) — `send-test-email.mjs:63` invokes it directly and is the live preview mechanism. Only the *state machine's* preview states are dead.

**Validation:** 0a's unreachable-state check should go from "4 known dead" to zero. **Rollback:** revert; nothing else references these states.

### Phase 3 — Unify the two content-type paths

The big diff and the big win (~440 lines → ~1 path). Do it after Phase 1 so failures are visible, and before Phase 5 so the `Wait` removal only has one path to edit.

**Change**
- One `Parse Issue` Task backed by a dispatcher Lambda that switches on `contentType` and delegates to the existing `parse-md-to-json` / `parse-json-issue` modules. They already return the same contract (`data`, `sendAtDate`, `reportStatsDate`, `listCleanupDate`, `subject`), which is what makes this safe.
- Collapse to a single tail: `Parse → Publish → Schedule Tasks and Update{report, cleanup, metadata} → Update Issue Record - Success → Notify`.
- Markdown-only extras become conditional steps on the single path, not a duplicated path.
- Fix D6 by moving `Trigger Site Rebuild` onto the common path.
- Retire the now-unused `Build Web and Email Versions` parallel and the `$[0]`/`$[1]` index-based `Success?` choice — indexed parallel output is the most brittle construct in the file.

**The specific thing to guard:** `reportStatsDate` and `listCleanupDate` are computed in the parse Lambdas and consumed by the two Scheduler entries. The dispatcher must reproduce them **byte-identically** — a wrong value here mis-fires a job three to five days later, with nothing watching. Diff the dispatcher's output against both original parsers on the fixture issues before deploying, and check item (4) of the rehearsal explicitly.

**Validation:** full rehearsal on all three content types, comparing the console's recorded Lambda payloads against the pre-change reference histories. **Rollback:** revert the definition and redeploy — single deploy is fine in-window, since nothing is parked in `Wait` (§2, H2).

### Phase 4 — Link extraction before publish, for all content types

**Change** Move link extraction/classification out of the parallel to a sequential step ahead of `Publish`, running for markdown, json, and html. Fixes D7 and D8 together.

**Constraint (important):** classification calls Bedrock, so this puts LLM latency on the critical path. It must have a bounded `TimeoutSeconds` and a `Catch` that continues to `Publish` regardless. **Link classification must never be able to block or fail a send** — degraded personalization is acceptable, a missed issue is not.

**Validation:** rehearsal item (5) — `link#` records with `url`, `position`, and `primaryTopic` must now appear for **json and html** fixtures, not just markdown. Plus one rehearsal with the classification step forced to time out, proving the send still goes. **Rollback:** revert; the function is unchanged, only its position moves.

### Phase 5 — Replace `Wait` with a scheduled execution start

The one that unblocks local send, and the only phase that changes the API contract.

**Change**
- The API stops calling `StartExecution` for scheduled issues. Instead it creates a one-shot EventBridge Scheduler entry named deterministically (e.g. `ISSUE-SEND-<tenant>-<issue>`) targeting `states:startExecution`, firing at `sendInstant − leadTime` (`leadTime = 0` for now; Phase 6 raises it).
- **Idempotency gets stronger, not weaker:** a fixed schedule name makes `CreateSchedule` conflict-detecting, so the duplicate-request guard no longer depends solely on the record status. Keep `Has Issue Been Processed?` as defense in depth.
- **Change the execution input to identifiers, not content.** The execution reads the issue record when it starts. This fixes D4 (edits after scheduling are respected), removes the 256 KB execution-state ceiling on large HTML issues, and stops a week-long execution from pinning a stale payload.
- Keep the record at `scheduled` until the execution actually starts, then `in progress` (D5).
- Add the cancel path the API never had: `DeleteSchedule` on unschedule/delete (D10).

**Transitional safety:** leave the `Wait For Future Date` state in the definition through this phase. It is a no-op when `futureDate` is absent, so the consumer tolerates both the old and new producer and the flip is a producer-side change you can revert in one deploy. Remove the `Wait` state in a later cleanup PR once no scheduled issue has been created the old way.

**Validation:** rehearsal scheduling ~10 minutes out, verifying the execution starts on time, reads *current* content, and that an edit between schedule and fire changes what sends (the D4 proof). Then one live Friday→Monday cycle with the real issue before Phase 6 raises the lead time.

**Rollback:** flip the API back to immediate `StartExecution` + `futureDate` — the `Wait` is still in the definition, so this is a producer-side revert in one deploy. Worth noting this is the one phase whose rollback may need to happen on a Friday, if staging reveals a problem. Keep it a config/flag flip rather than a code revert if that's cheap to arrange.

### Phase 6 — Timezone-correct local send

**Gate:** Phase 5 deployed.

**Change** Set `leadTime` to cover the largest eastward offset among confirmed subscriber timezones (a flat 24h covers everything, including UTC+14) so the fan-out in `send-email-v2.mjs:347` runs *before* the base instant and can schedule eastward groups instead of firing them immediately (D9). This is the fix for the behavior described in the local-send analysis: today only zones at or west of the base zone get their 9am-local delivery.

**The tradeoff to accept consciously:** `leadTime` *is* the content freeze point, because the execution reads the record when it starts. With a 24h lead, a Monday 9am send freezes Sunday 9am. Against the Friday-staging cadence that's still a two-day improvement on today (frozen at staging time), but it does mean Phase 5's "edits are respected" property holds only up to T−24h, not T. If you ever want to edit Sunday evening, the lead time is what's stopping you — and it can be tuned down to the actual maximum eastward offset among *confirmed* subscriber zones rather than a flat 24h.

**Validation:** unit-level coverage already exists in `__tests__/send-email-v2-local-send.test.mjs` (its fan-out tests use a future base, which is exactly the post-Phase-5 shape). Add a case asserting eastward zones are *scheduled*, not emitted immediately. Then confirm on a live cycle: the Sunday-morning fan-out should log scheduled groups for eastward zones instead of "sending now". **Rollback:** set `leadTime` back to 0 — degrades to today's behavior, sends nothing twice.

---

## 6. Sequencing — one phase per Mon–Fri window

Recommended order is **0 → 1 → 2 → 3 → 4 → 5 → 6**, at most one phase per weekly window. Each window: deploy Monday afternoon at the earliest, rehearse midweek, land by Thursday, leave Friday clear for staging.

| Window | Phase | Deploy shape |
|---|---|---|
| 1 | 0 — linter + rehearsal protocol | CI only, no runtime change |
| 2 | 1 — `Catch`, `$$` fix, social copy off critical path | definition only |
| 3 | 2 — delete dead preview states | definition only; gated on #358 |
| 4–5 | 3 — unify content-type paths | definition + new dispatcher Lambda; the one that may need two windows |
| 6 | 4 — link extraction before publish | definition + function position |
| 7 | 5 — Scheduler-started execution | API contract change; the only phase touching Rust |
| 8 | 6 — local-send lead time | config value |

Roughly two months at one phase a week, and every phase is independently valuable — stopping after Phase 3 still leaves the definition ~half its current size with failures that no longer lie.

**The one call to make:** if timezone-correct local send matters more than the size reduction, Phase 5 can move directly after Phase 1 (it only depends on Phase 1's `Catch` coverage). The cost is that Phase 3 then edits a definition Phase 5 just restructured — about a day of rework, and two risky phases back to back instead of separated by two safe ones. I'd keep 5 where it is: the local-send gap is a delivery-quality issue, while D4 (stale content on edit-after-schedule) is a correctness bug that Phase 5 also fixes, and neither is urgent enough to reorder around given you stage Friday and rarely edit after.

---

## 7. Deferred: send-path quality

Parked deliberately, tracked here so it does not get lost. `functions/send-email-v2.mjs` is ~1150 lines carrying at least six responsibilities: sender validation, subscriber retrieval and pagination, A/B splitting and holdout selection, local-send fan-out, interest assembly, per-recipient idempotency, SES TPS pacing, and metrics. It also owns two of the four timers named in §1. Nothing in this plan changes it, and Phases 1–6 are all safe against it as-is.

It deserves its own audit and its own spec — the questions there are different in kind (throughput, partial-failure semantics mid-list, what happens when a send is interrupted halfway through a 10k-recipient list), and mixing them into a state-machine refactor would make both harder to review.
