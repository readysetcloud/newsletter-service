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
| Definition tests | 0 | structural lint + golden-path behavioral |
| Timers owning the send instant | 4 | 2 (start schedule + local-send groups) |

The state machine keeps the jobs it is genuinely good at — the status handshake, ordered post-send fan-out, and per-issue audit trail — and stops doing the two it is bad at: **waiting**, and **branching on content type**.

---

## 2. Why this is risky (name the hazards before mitigating them)

**H1 — Low iteration count on an irreversible event.** A newsletter send cannot be recalled, and it happens roughly weekly. Real-world validation opportunities arrive ~4× a month, so "deploy and watch" is not a viable test strategy on its own. Everything below is designed to be validated *before* a send, not by one.

**H2 — In-flight executions pin the old definition, but not the resources it points at.** Updating a Standard state machine does not affect already-running executions; a scheduled issue sitting in `Wait For Future Date` will complete on the definition that was live when it started. That is helpful for *definition* changes and dangerous for *resource* changes: deleting a Lambda, an IAM statement, or a `DefinitionSubstitution` that an in-flight execution still needs breaks it silently at fire time, days later.

> **Rule (applies to every phase):** removing a resource is always a **second** deploy. Deploy (a) "definition no longer references it", wait for the drain window, then deploy (b) "resource deleted". Before any structural deploy, run:
> ```
> aws stepfunctions list-executions --state-machine-arn <StageIssue> --status-filter RUNNING
> ```
> If anything is running, it is almost certainly parked in `Wait`. Either let it drain or keep the old resources until it clears.

**H3 — No test coverage of the definition.** There is no SFN Local harness, no structural validation, and no ASL assertions in `__tests__/`. The `$.Execution.Input.tenant.id` typo at line 296 has been sitting in the file undetected precisely because nothing checks it. Phase 0 exists to fix this first.

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

This is the phase that converts "big risk" into "mechanical". Two deliverables, deliberately ordered cheapest-first.

**0a. Definition linter (pure jest, no Docker, ~1 hour).** A test that loads the ASL as JSON and asserts invariants:

- every `".$"` value starting with `$$.` uses a known context path, and **no** value matches `^\$\.Execution` (catches D1 and its whole family);
- every `Task` has a `Retry` and, after Phase 1, a `Catch`;
- every `${Substitution}` in the definition exists in `template.yaml`'s `DefinitionSubstitutions`, and vice versa (catches orphaned substitutions when deleting states);
- every `Next`/`Default` target resolves to a state in the same scope; no unreachable states (this alone would have flagged the 4 dead preview states);
- state count and `Choice` count against expected values, so structural change is always deliberate.

**0b. Golden-path behavioral tests (SFN Local + Docker, ~1 day).** Step Functions Local with a `MockConfigFile` stubbing every service integration, run from jest with a Docker service in `pre-deploy-validation.yaml`. Assert the **state sequence and the payload passed to each Lambda** for:

1. markdown, immediate,
2. markdown, scheduled (`futureDate` present),
3. json, immediate,
4. html, immediate,
5. duplicate request (existing `published` record → `Success - Duplicate Request`),
6. retry of a `failed` record → re-runs,
7. `publish-issue` returns `success: false` → `Update Issue Record - Failure` → `Fail`,
8. (after Phase 1) a Lambda throws past its retries → record marked `failed`, not left `in progress`.

Before writing 0b, export 3–5 recent real execution histories from the console as fixtures, so "expected sequence" is grounded in what production actually does rather than in a reading of the JSON.

**Gate to Phase 1:** 0a and 0b green in CI, and 0b's expected sequences reviewed against the exported histories.

---

## 5. Phases

Each phase is one PR, independently deployable and reversible. No phase both changes structure and deletes a resource.

### Phase 1 — Correctness only, no structural change

**Change**
- Fix D1 (`$$`).
- Add `Catch` to every `Task` and to both `Parallel` states, routing to `Update Issue Record - Failure` with `ResultPath: "$.error"`; persist the error cause on the record so the failure is diagnosable without opening the console. Make `Update Issue Record - Failure` idempotent (it can now be reached from more than one place).
- Move `Generate Social Copy` off the critical path (D3): after `Notify of Success`, or fire an event and let it run outside the execution. Preference: keep it in the machine but give it `Catch → Notify of Success` so it can never fail a published issue.

**Why first:** purely additive to the definition, no states removed, so H2 does not apply and in-flight executions are unaffected either way. It also shrinks the blast radius of every later phase — after this, a mistake in Phase 3 marks the record `failed` instead of leaving it silently wedged.

**Validation:** 0a + 0b, plus new 0b case 8. **Rollback:** revert the definition; no resource or contract change.

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

**Validation:** 0b cases 1–4 must produce identical Lambda payloads before and after (assert on the recorded payloads, not just on success). **Rollback:** revert the definition. Deploy the dispatcher Lambda in a *prior* deploy so the rollback target still has it; delete the two direct substitutions only in a later cleanup deploy (H2).

### Phase 4 — Link extraction before publish, for all content types

**Change** Move link extraction/classification out of the parallel to a sequential step ahead of `Publish`, running for markdown, json, and html. Fixes D7 and D8 together.

**Constraint (important):** classification calls Bedrock, so this puts LLM latency on the critical path. It must have a bounded `TimeoutSeconds` and a `Catch` that continues to `Publish` regardless. **Link classification must never be able to block or fail a send** — degraded personalization is acceptable, a missed issue is not.

**Validation:** 0b asserts extraction runs before publish on all three content types and that a simulated classification timeout still reaches `Publish`. **Rollback:** revert; the function is unchanged, only its position moves.

### Phase 5 — Replace `Wait` with a scheduled execution start

The one that unblocks local send, and the only phase that changes the API contract.

**Change**
- The API stops calling `StartExecution` for scheduled issues. Instead it creates a one-shot EventBridge Scheduler entry named deterministically (e.g. `ISSUE-SEND-<tenant>-<issue>`) targeting `states:startExecution`, firing at `sendInstant − leadTime` (`leadTime = 0` for now; Phase 6 raises it).
- **Idempotency gets stronger, not weaker:** a fixed schedule name makes `CreateSchedule` conflict-detecting, so the duplicate-request guard no longer depends solely on the record status. Keep `Has Issue Been Processed?` as defense in depth.
- **Change the execution input to identifiers, not content.** The execution reads the issue record when it starts. This fixes D4 (edits after scheduling are respected), removes the 256 KB execution-state ceiling on large HTML issues, and stops a week-long execution from pinning a stale payload.
- Keep the record at `scheduled` until the execution actually starts, then `in progress` (D5).
- Add the cancel path the API never had: `DeleteSchedule` on unschedule/delete (D10).

**Transitional safety:** leave the `Wait For Future Date` state in the definition through this phase. It is a no-op when `futureDate` is absent, so the consumer tolerates both the old and new producer and the flip is a producer-side change you can revert in one deploy. Remove the `Wait` state in a later cleanup PR once no scheduled issue has been created the old way.

**Validation:** 0b gains a "scheduled via Scheduler" case; a staging dry run scheduling an issue ~10 minutes out, verifying the execution starts at the right time, reads current content, and that editing between schedule and fire changes what sends. **Rollback:** flip the API back to immediate `StartExecution` + `futureDate` (the `Wait` is still there).

### Phase 6 — Timezone-correct local send

**Gate:** Phase 5 deployed.

**Change** Set `leadTime` to cover the largest eastward offset among confirmed subscriber timezones (or a flat 24h) so the fan-out in `send-email-v2.mjs:347` runs *before* the base instant and can schedule eastward groups instead of firing them immediately (D9). This is the fix for the behavior described in the local-send analysis: today only zones at or west of the base zone get their 9am-local delivery.

**Validation:** unit-level coverage already exists in `__tests__/send-email-v2-local-send.test.mjs` (its fan-out tests use a future base, which is exactly the post-Phase-5 shape). Add a case asserting eastward zones are *scheduled*, not emitted immediately. **Rollback:** set `leadTime` back to 0.

---

## 6. Sequencing and the one open decision

Recommended order is **0 → 1 → 2 → 3 → 4 → 5 → 6**.

The one call to make: **if timezone-correct local send matters more than the LOC reduction**, Phase 5 can move directly after Phase 1 (it only depends on Phase 1's `Catch` coverage). The cost is that Phase 3 then has to edit a definition Phase 5 just restructured — roughly a day of extra rework, and two risky phases back-to-back instead of separated by two safe ones. My recommendation is to keep 5 where it is; the local-send gap is a quality-of-delivery issue, not a correctness one, and D4 (stale content) is the more urgent of the bugs 5 fixes.

Phases 1, 2, and 4 are each small enough to ship in a normal week. Phase 0 and Phase 3 are the two that need real time.

---

## 7. Deferred: send-path quality

Parked deliberately, tracked here so it does not get lost. `functions/send-email-v2.mjs` is ~1150 lines carrying at least six responsibilities: sender validation, subscriber retrieval and pagination, A/B splitting and holdout selection, local-send fan-out, interest assembly, per-recipient idempotency, SES TPS pacing, and metrics. It also owns two of the four timers named in §1. Nothing in this plan changes it, and Phases 1–6 are all safe against it as-is.

It deserves its own audit and its own spec — the questions there are different in kind (throughput, partial-failure semantics mid-list, what happens when a send is interrupted halfway through a 10k-recipient list), and mixing them into a state-machine refactor would make both harder to review.
