# Stage-Issue Simplification — Outcome Report

**Branch:** `claude/local-send-timezone-m81cgx`
**Plan:** `docs/stage-issue-simplification-plan.md`
**Written:** Sunday 2026-07-26, for review Monday afternoon. **Nothing here has been deployed.**

Every number below was measured against the tree at HEAD and against
`git show main:state-machines/stage-issue.asl.json`, not estimated. The commands are in
§7 so the measurements can be reproduced or disputed.

**Short version:** Phases 0 through 5 landed. Phase 6 (the one the branch is named for) did
not, and is blocked on a real code change, not a config flip. The plan's *behavioral* targets
were met; its *size* targets were missed by roughly 2x and should be read as aspirational
rather than achieved. Two things need a decision before deploy: a concrete
interaction bug between Phase 1's failure write and the preserved local-send handshake (§4,
item 1), and Phase 2's unmet gate, which has already been documented in-tree but not fixed.

---

## 1. What landed

| Plan phase | Commit | State |
|---|---|---|
| 0a — definition linter | `ac830c6` | Landed, in CI |
| 0b — rehearsal protocol | `0e733d7` | Written, **never run** (see §6) |
| 3 prep — parse dispatcher | `6fd9192` | Landed |
| 1 — `Catch` coverage, `$$` fix, social copy off critical path | `4393e50` | Landed |
| 2 — delete dead preview path | `dcfd3bc` | Landed **with its gate unmet** |
| 3 — unify content-type paths | `8798b28` | Landed |
| 4 — link extraction before publish | `c5e9619` | Landed |
| 5 — Scheduler-started execution | `d229a7d` | Landed |
| 6 — local-send lead time | — | **Not landed.** Parameter wired, default 0, blocker documented |
| reconciliation of the above | `325694e` | Landed (docs, linter, `IS_PREVIEW` comments) |

The plan called for one phase per weekly window (§6 of the plan: eight windows, ~two
months). All of it is on one branch in one weekend. That is the single biggest deviation and
it is a review-load problem, not a code problem — but it means no phase has had the midweek
rehearsal the plan made the gate for the next one.

The branch also carries unrelated work from four already-merged PRs (dashboard, tenant
settings, send-progress). Plan-phase changes only:
`git diff --stat 264edea..HEAD` — 16 files, +3668/−576.

---

## 2. Targets vs actual (measured)

| | Plan: today | Plan: after | **Actual** | Verdict |
|---|---|---|---|---|
| States (top-level) | 25 | ~10–12 | **24** | **Missed badly** |
| States (incl. Parallel branches) | 39 | — | **28** | −28% |
| Lines | 896 (895 measured) | ~450 | **758** | **Missed** (−15%) |
| Lines excluding `"Comment"` lines | 892 | — | **729** | −18% |
| Content-type paths | 2 near-duplicate tails | 1 | **1 tail, 2 variable-binding Choices** | **Met in substance** |
| Dead states | 4 | 0 | **0**, asserted absent | Met — but see §3, D-note on Phase 2 |
| `Catch` blocks | 0 | every Task | **12/12 top-level Tasks+Parallel; 0/3 branch Tasks (deliberate)** | Met as designed |
| `Retry` on every Task | (not counted) | implied by 0a | **4 of 14 Tasks have `Retry`** | **Not met**, pinned as an allow-list |
| Definition tests | 0 | structural lint in CI | **39 tests**, run by `pre-deploy-validation.yaml` | Met |
| Timers owning the send instant | 4 | 2 | **still 4 mechanisms** (one added, none removed) | **Not met** |

Type breakdown, main → HEAD: Task 23→14, Choice 7→5, Parallel 3→1, Pass 2→4, Wait 1→1,
Succeed 2→2, Fail 1→1.

### Why the size targets were missed, honestly

The plan's `~450 lines / ~10–12 states` assumed the win was deleting the second tail
(~440 lines). That deletion happened. What the plan did not budget for is that the same
phases *add*:

- ~121 lines of `Catch` JSON (Phase 1's own mandate — the plan asked for both and only
  costed one);
- 26 lines of `"Comment"` (3 comment lines on main, 29 now — this is deliberate and matches
  house style, but it is a third of the gap to 450);
- three Pass states that exist only as plumbing: `Record Publish Rejection` (supplies
  `$.error` on the one non-`Catch` route into the failure write), `Markdown Extras` and
  `No Markdown Extras` (bind `$contentType` and the fallback `$social`);
- `Wait For Future Date` + `Is Scheduled In The Future?` retained on purpose as Phase 5's
  one-deploy rollback, which the plan itself asked for (plan §5, "Transitional safety") while
  also counting them as removed in §1.

So ~10–12 states was not reachable while keeping Catch coverage, the `$social` invariant, and
the Phase 5 rollback. Roughly 5 of the 24 states are error/variable plumbing and 2 are the
retained rollback path. **Treat §1 of the plan as internally inconsistent, not as a target
that was ducked** — but also do not let this report claim a halving that did not happen.

The "timers" row is simply unmet: `ISSUE-SEND-*` was added, the `Wait` was retained, and
`send-email-v2`'s `local-*` group schedules, its 30-minute catch-all, and its `email-*`
deferred-send schedule are all untouched. It gets to 3 on the API path (`ISSUE-SEND-*` +
groups + catch-all) and to 2 only after the cleanup PR that removes the `Wait`.

---

## 3. Defect ledger D1–D10

| # | Defect | Status | Evidence / caveat |
|---|---|---|---|
| D1 | `$.Execution.Input.tenant.id` single-`$` | **Fixed** | Fixed in Phase 1 rather than waiting for Phase 2 to delete the state; the linter now bans the whole class with no allow-list (`uses no single-dollar $.Execution paths`) |
| D2 | No `Catch` anywhere | **Fixed, with a new interaction bug** | Every top-level Task and the Parallel now catch; cause persisted as `failureReason`. **But the failure write is unconditional and can stamp `failed` over a `sending` record — see §4 item 1** |
| D3 | `Generate Social Copy` reddens a published issue | **Fixed** | Catches onward to `Notify of Success`; `$social` fallback bound at the content-type fork so the notification still formats |
| D4 | Edit-after-schedule sends stale content | **Fixed** | Execution input is identifiers only; `Mark Issue In Progress` returns `ALL_NEW` and binds `$content` from the record it just claimed. Note the shape: in-place edit of a `scheduled` issue is still rejected (`check_update_allowed` unchanged) — the supported path is unschedule → edit → reschedule |
| D5 | Scheduled issue reports `in progress` for its whole wait | **Fixed** | `mark_issue_scheduled` writes `scheduled`; the handshake treats `scheduled` as sendable; `get_workflow_state_for` reports "waiting for the send time" off the record when there is no ARN yet |
| D6 | `Trigger Site Rebuild` only on the scheduled path | **Fixed** | Now on the common path. Relative order is unchanged from main (it still runs *before* publish), so no new ordering question |
| D7 | JSON/HTML issues get no `link#` records | **Fixed** | `update-link-tracking` is content-type aware: `<a href>` extraction for html masters and json section bodies, comments/style/script stripped. Two documented limits remain (markdown links inside a json section body; html chrome links are indistinguishable from content) |
| D8 | Link classification races the send | **Fixed** | Sequential, ahead of `Publish`, for all content types; `interest-assembly.mjs`'s stale comment updated |
| D9 | Local send cannot honor eastward zones | **NOT fixed** | Phase 6 did not land. `IssueSendLeadTimeMinutes` exists, defaults to `"0"` = today's behavior. Raising it needs the send instant forwarded to `Parse Issue` first, or an early execution publishes early instead of scheduling — documented on `issue_send_lead_time` in `issues.rs`. **The branch name promises this; the branch does not deliver it.** The plan's requested test ("assert eastward zones are *scheduled*, not emitted immediately") was also not added |
| D10 | No way to cancel a scheduled issue | **Fixed** | `PUT /issues/{id}` with `status: "draft"` unschedules and deletes the entry; `DELETE` deletes any entry before the record. Schedule always goes first, because the state machine treats a `draft` record as sendable |

Eight of ten fixed; D9 open (Phase 6); D2 fixed but with a new failure mode.

---

## 4. What a reviewer should look at hardest

Ordered by consequence. Items 1–3 are findings, not style notes.

**1. `Update Issue Record - Failure` can strand a local send at `failed`, forever.**
`state-machines/stage-issue.asl.json:706` — the failure write is deliberately unconditional
("so re-entering it cannot fail on a condition of its own"). `Update Issue Record - Success`
correctly guards `#status <> :sending`; the failure write does not. It is reachable *after*
publish from three places: the `Schedule Tasks and Update` Parallel's `Catch`, the
`States.ALL` catcher on `Update Issue Record - Success`, and `Record Publish Rejection`. If a
local-send fan-out has already moved the record to `sending`, any of those stamps `failed`
over it. The fan-out's terminal transition is
`setIssueStatus(..., from: ['sending'])` (`functions/utils/send-progress.mjs:255`), so it then
logs "Status transition not applicable" and the issue stays `failed` while emails are
delivered for hours. The trigger is not exotic: `Schedule Issue Report` and
`Schedule List Cleanup` have **no `Retry`**, so one Scheduler throttle does it.
Two candidate fixes, neither applied here because both are judgement calls: add
`ConditionExpression: "#status <> :sending"` plus a `ConditionalCheckFailedException` catcher
to the failure write, the same shape the success write already uses; or give the branch Tasks
a `Retry` so the common trigger goes away. Preferably both.

**2. Phase 2 shipped with its gate unmet, and non-production GitHub imports now really send.**
PR #358 is still open (verified: `state: open`, `mergeable_state: dirty`, and its own body says
do not merge until the REST cutover is confirmed). `import-issue-from-github.mjs:30` still
sets `isPreview` from `IS_PREVIEW`, which `template.yaml:2504` sets true for every
non-production deploy. With the preview states deleted, a GitHub import in sandbox or stage
runs the real publish path and sends to that stack's subscriber list. Production is
unaffected. This is documented in four places (`template.yaml`, the producer, the plan's
Phase 2 section, the linter constant) and deliberately not repaired, because every repair is
a product decision. **It is a decision to make before this branch reaches a non-production
stack, not before production.** Note also that #358 is not a merge away — it is gated on an
external Action cutover — so "merge #358" is not a same-day option.

**3. `Save Issue Record` reads content the API no longer sends.**
`asl.json:132` binds `$content` from `$$.Execution.Input.content`. The handshake routes both
"no record" and "record is `failed`" there. The API's input is identifiers-only since Phase 5,
so the `failed` route would throw `States.Runtime` and mark the issue failed again. It is
unreachable today only because `handle_create_issue` returns 409 for any non-draft record and
`handle_resend_issue` requires `published`. The definition's comment ("An API-started
execution always has a record") understates this: an API-started execution *for a failed
issue* would land there. Nothing ties that 409 to this definition — if the re-stage rule is
ever relaxed, re-staging a failed issue silently cannot work. The GitHub producer still sends
content, which is why the path works at all.

**4. Retry coverage is an allow-list, not an invariant.** 10 of 14 Tasks have no `Retry`
(`TASKS_WITHOUT_RETRY` in the linter). The plan's 0a asked for "every `Task` has a `Retry`
and, after Phase 1, a `Catch`" — only the `Catch` half is enforced. Phase 1 turned these from
silent wedges into recorded failures, which is real progress, but a throttle still fails a
publish that would have succeeded on retry.

**5. `Extract Links` runs before `Publish Success?`.** Link records are written for issues that
are then rejected at publish. Harmless (records are keyed by `hash(url)` under the issue) but
worth a conscious nod. The bound on the Bedrock latency it puts on the send path
(`TimeoutSeconds: 75`, `States.Timeout` deliberately absent from `Retry`, `Catch → Parse Issue`)
is the right shape and is pinned by three linter assertions.

**6. Minor: the failure write can create a ghost record.** If `Get Existing Issue` itself
throws, its `Catch` runs an `UpdateItem` that will create a `failed` record for an issue that
never existed. The Rust side guards the mirror case with `attribute_exists(pk)`; the
definition does not.

**7. Pre-existing, not introduced, but observed while measuring:** resending a `published`
issue routes to `Success - Duplicate Request` and sends nothing — same on `main`, so Phase 5
neither caused nor worsened it. `import-issue-from-github.mjs:78` references an undefined
`github` in `processNewIssue`; also on `main`.

---

## 5. Deploy order and gates for Monday

The plan's window rules, unchanged and still correct (plan §2, restated in
`docs/stage-issue-rehearsal.md` §"Deploy windows"):

| When | Safe |
|---|---|
| Fri → Mon 09:00 | Nothing. A send is pending |
| Mon ~09:05 → ~16:00 | **State machine definition only.** Local-send groups and the 30-minute catch-all are still firing until ~20:30Z |
| Mon ~16:00 → Thu | Everything, in one deploy |
| Fri | Nothing. Friday is staging day |

**This branch cannot use the mid-morning window.** It changes `issues.rs` (the API Lambda),
`update-link-tracking.mjs`, `parse-md-to-json.mjs`, `import-issue-from-github.mjs` and
`template.yaml` alongside the definition. Send-path Lambda code is not versioned
per-execution. **Deploy after ~16:00 Monday, or Tue–Thu.**

Order, and the gates on each step:

1. **Before anything:** run both pre-deploy checks and require both to be empty —
   `aws stepfunctions list-executions --status-filter RUNNING` **and**
   `aws scheduler list-schedules --group-name newsletter --name-prefix ISSUE-SEND-`.
   The second is the one Phase 5 made necessary: a scheduled issue is no longer a running
   execution, so `list-executions` is empty all week and proves nothing.
2. **Decide on §4 item 1** (failure write vs `sending`). It is a small definition change and
   it is cheaper to land with this branch than after a stranded send.
3. **Decide on §4 item 2 before any sandbox/stage deploy.** Options, in the plan's preference
   order: merge #358 (not available today); give the ingress its own preview mechanism
   (`send-test-email.mjs` already is one); or accept non-production sends and delete
   `IS_PREVIEW` so nothing reads as a guard that isn't. **Phase 2 must not ship to a
   non-production stack before one of these.** Production is safe either way.
4. **Deploy Phases 0–5 together** (they are one branch; splitting them now costs more review
   than it buys) in the Mon-after-16:00 or Tue–Thu window, as a single deploy. H2 permits it:
   nothing is parked, and `ParseMdToJsonFunction` / `ParseJsonIssueFunction` keep their
   functions and their `lambda:InvokeFunction` grants precisely so any execution started on
   the pre-dispatcher definition can still finish.
5. **Rehearse before Friday staging** — all three content types, per `docs/stage-issue-rehearsal.md`.
   This is the plan's Phase 0b gate and it has never been run. See §6 for what only it can catch.
6. **One live Friday→Monday cycle** on the real issue before anyone touches Phase 6. The plan
   asks for this explicitly and it is the only thing that exercises the
   schedule-Friday/fire-Monday path end to end.
7. **Phase 6 is not a config change.** Do not raise `IssueSendLeadTimeMinutes` above 0 until
   the send instant is forwarded to `Parse Issue`; otherwise an early execution publishes
   early. Then add the eastward-zone scheduling assertion the plan asked for.

Never Friday.

---

## 6. Not covered by any automated test — this is what the rehearsal is for

Suites are green as landed: jest 94 suites / 1231 tests, eslint clean, `cargo test --workspace`
clean, `cargo clippy --workspace --all-targets --all-features -- -D warnings` clean,
`cargo fmt --all --check` clean. That green covers less than it looks like it does.

**Nothing at all covers:**

1. **That the definition runs.** 39 tests parse the JSON and assert its shape. No test
   executes it — no SFN Local, by deliberate choice (plan §4). A definition can satisfy every
   assertion and still fail at runtime on a path expression.
2. **Every AWS call Phase 5 added.** `create_schedule`, `delete_schedule`, the
   conflict→409 mapping, the ordering of schedule-before-status, and
   `mark_issue_scheduled`'s `attribute_exists(pk)` guard are all untested — the Rust tests
   cover only pure functions (name building, lead-time parsing, fire-time clamping,
   status validation).
3. **That an `ISSUE-SEND-*` entry actually starts the execution at the right instant.** The
   entire premise of Phase 5. Rehearse with a send ~10 minutes out.
4. **The D4 proof.** That an edit between scheduling and firing changes what sends. Requires
   unschedule → edit → reschedule, then observing the delivered email.
5. **Verification 4 of the rehearsal — `ISSUE-STATS-*` at send+5 and `*-CLEAN-*` at send+3.**
   `__tests__/parse-issue.test.mjs` proves the dispatcher returns the parsers' dates verbatim,
   and the linter pins the schedule names, expressions and the IAM patterns that allow them.
   Neither proves the resulting entries exist with the right dates. This remains the
   highest-consequence silent failure in the system: a wrong value misfires three to five days
   out with nothing watching. Phase 5 changed the inputs to that computation (no more
   `futureDate` on the API path — json/html now anchor on parse time, which equals the send
   instant only while the lead time is 0), so this needs checking on **all three** content types.
6. **§4 item 1's failure mode.** No test puts a record into `sending` and then drives the
   definition into its failure write. The plan's Phase 1 validation (break a Lambda on stage,
   prove the record lands on `failed` instead of wedging) has not been run either.
7. **`link#` records for json and html fixtures** with `url`, `position` and `primaryTopic`
   — unit tests cover the extractor, not the records in the table. Plus one run with
   classification forced to time out, proving the send still goes.
8. **Reference execution histories.** The plan asked for 3–5 real histories exported *before*
   anything changed, as the definition of "expected sequence". They were not exported, and
   after this branch the pre-change definition is gone from HEAD. `main` still has it, so this
   is recoverable, but the fixtures the rehearsal doc tells the operator to save
   (`__tests__/fixtures/rehearsal/`) do not exist — the fixture content is inline in the doc
   and has to be written out by hand on the first run.

Item 8 is the honest summary of Phase 0b's status: **the checklist was written, the setup was
not done, and the protocol has never been run.** Every later phase's stated gate depended on it.

---

## 7. How to re-measure

```bash
# lines
wc -l state-machines/stage-issue.asl.json
git show main:state-machines/stage-issue.asl.json | wc -l

# state counts, by scope and type
node -e 'const d=require("./state-machines/stage-issue.asl.json");let t=0,a=0,y={};
(function w(s,dep){for(const[n,v]of Object.entries(s)){a++;if(!dep)t++;y[v.Type]=(y[v.Type]||0)+1;
if(v.Type==="Parallel")v.Branches.forEach(b=>w(b.States,dep+1));}})(d.States,0);
console.log({topLevel:t,total:a,...y});'

# Retry / Catch coverage per Task
node -e 'const d=require("./state-machines/stage-issue.asl.json");
(function w(s,sc){for(const[n,v]of Object.entries(s)){if(v.Type==="Task"||v.Type==="Parallel")
console.log(sc,n,"Retry="+!!v.Retry,"Catch="+!!v.Catch);
if(v.Branches)v.Branches.forEach((b,i)=>w(b.States,`${n}[${i}]`));}})(d.States,"top");'

npm test -- __tests__/state-machines/stage-issue-definition.test.mjs   # 39 tests
npm test && npm run lint
cargo test --workspace && cargo clippy --workspace --all-targets --all-features -- -D warnings
```

Plan-phase diff only (excludes the four merged PRs also on this branch):
`git diff --stat 264edea..HEAD`.
