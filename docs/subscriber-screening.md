# Subscriber screening

Public signup still returns 201 after committing a subscriber. The new row has
`screening.action = pending`. One shared DynamoDB lifecycle stream consumer routes INSERT events to screening,
then routes pending-to-allow/watch MODIFY events to welcome delivery. Screening checks SES account suppression, DNS mail routing, existing bot
flags, and Amazon Nova Micro on Bedrock on demand for records not already rejected
by suppression or email/domain checks.
The result is persisted with an incarnation/pending condition so retries cannot
recreate a deleted subscriber or overwrite a later assessment.

- `allow`: eligible for marketing.
- `watch`: eligible for marketing, with recorded reasons for review.
- `hold`: temporarily excluded from marketing for operator review; record retained.
- `reject`: retained for review, excluded from marketing.
- `pending`: excluded until screening completes.

Welcome mail follows the durable pending-to-allow/watch stream transition.
The shared consumer starts at TRIM_HORIZON to cover rollout events and leaves
only two Subscribers stream readers, including segment-membership cleanup.
Per-record failures retry from the earliest failed sequence number.
Existing subscribers without an assessment remain eligible. Imports retain their
existing behavior; audit imported subscribers before sending. Rejected rows are
retained and included in the existing subscriber count; this is not a count of
eligible recipients. Signup cannot bypass a rejection by submitting the same email.

The model sees the full email address, optional first and last names, domain,
bot/rule findings, form completion time, rate-limit window request count,
engagement count and recent failed-issue count (audit only). Names use the same
normalization and 50-character limit as signup; absent names are null. Raw IPs
and user agents are not sent. Identity fields are untrusted data, never prompt
instructions. The model examines randomized name/address patterns together with
other evidence; unfamiliar names or a name/email mismatch alone cannot justify
rejection. Records without existing bot flags are also reviewed when the model
is enabled so random names are not missed by the rules-only shortcut.
`screening-decider.mjs` uses Strands structured
output to return a validated action, confidence and `signals`, and records the
model ID.
`SCREENING_MODEL_ID` defaults to `us.amazon.nova-micro-v1:0`; changing the model
also requires updating the worker's IAM permissions. Calls are pay per use and
made for records that pass the deterministic rejection checks. Model confidence is not a calibrated probability
that an email will bounce.
Confirmed SES suppression or invalid domain routing overrides model decisions.
DNS routing does not verify that a mailbox exists.

## What makes a model rejection hold

A model rejection takes effect only at confidence 0.9 or above *and* with two
independent deterministic bot flags on the record. Anything short of that is
recorded as `watch` — eligible for mail — keeping `modelAction`, `confidence`
and `signals` for review. Missing DNS, past failures, low engagement, an
unusual name or an unfamiliar domain never justify a model rejection.

`signals` is the model's own account of the evidence it used:
`address_pattern`, `name_pattern`, `behavioral`, `delivery_history`, `domain`.
It is recorded and never acted on.

This rule rejects very few signups, and that is the measured outcome rather
than an oversight. Of the six flags only `fastSubmission` and the Gmail dot
trick have ever fired in production, so "two independent flags" is effectively
one specific pair. Loosening it was tried and measured against the live list
on 2026-11-02, re-screening all 4,241 subscribers:

| rule | rejects | of which had opened or clicked |
| --- | --- | --- |
| two flags (current) | 5 | 0 |
| one flag, or a model-cited `address_pattern` | 153 | 69 (45%) |
| one flag, dot trick needing a partner | 35 | 17 (49%) |

Roughly half of what the looser rules reject is an engaged reader, several with
more than twenty recorded opens. The signals available at signup do not
separate a bot from a reader: the Gmail dot trick is something real people
type, a sub-1500ms submission is a password manager, and the model's `signals`
do not survive checking — `behavioral` is the one category that maps onto data
we hold, and only 438 of the 1859 rows claiming it (24%) had any such flag.

So the model stays advisory. Raising precision needs evidence this pipeline
does not have: confirmed opt-in, or bounce outcomes labeled per signup.
Deterministic front-door controls — confirmed opt-in, signup velocity limits —
are what reduce bot signups; a better classifier behind the door is not.

## The generated-name block

One such control now exists, in `functions/utils/generated-name.mjs`. It is
not a screening rule and the model has no part in it: it matches one signup
source's name generator, which emits two tokens of exactly ten random
characters. 1,475 subscribers carry that shape, none before 24 Jun 2026, and
they engage at 14.8% where ordinary names engage at 47.7%. Every existing
deterministic flag missed all of them.

It blocks at the door — `generatedNameAction`, defaulting to `block`, with the
same silent 201 and no record that the honeypot gets.

Two things to know before relying on it. It matches a signature, not a
quality, so it stops working the day the operator changes a constant, and
nothing will report that it has. And entropy is not a substitute: scored
against real names it flags 23% of them, and 445 subscribers on this list have
single random tokens of 16-24 characters while engaging at 46.5% — the same
rate as everyone else. They are real readers that an entropy rule blocks.

Model rejection candidates can be reviewed and held through the flow in
[existing-list cleanup](existing-list-cleanup.md). A hold is reversible and
changes only `screening`. On 2026-11-02, 52 candidates that carried a
deterministic flag *and* had never engaged were held that way; rows with any
recorded engagement were deliberately excluded.

## Existing-list audit

```powershell
$env:AWS_REGION = 'us-east-1'
node scripts/audit-subscribers.mjs --tenant readysetcloud --table NEWSLETTER_TABLE --subscribers SUBSCRIBERS_TABLE
```

This is read-only by default. It pages the tenant's subscribers and SES account
suppression list, checks each distinct domain once, and includes delivery failure
history from the three most recent sent issues. Segment bookkeeping is excluded.
The JSON report contains one assessment per subscriber and is saved beneath
gitignored `.local/`; keep it private because it contains email addresses.
`--model` enables paid model calls for every row that passes deterministic
rejection checks. Without it, flagged rows are watch candidates and clean rows
are allowed by rules. `--output PATH` selects a new report destination. A full
private input backup is saved alongside it before model calls. `--concurrency N`
controls parallel per-subscriber requests (default 8, maximum 16). Periodic
checkpoints are incomplete artifacts and cannot be applied.

The audit is always read-only; its former `--apply` option now fails explicitly.
It sends no email and changes no subscribers. Use the exact-report review flow
in [existing-list cleanup](existing-list-cleanup.md) to prepare a separate action
plan, inspect it, and apply only those reviewed operations. Deploy the marketing
filter before applying holds. Pending, rejected and held records are never
automatically released by an audit.

## Operations

Deploy the signup producer, stream consumers and marketing eligibility filter
together. Stream failures retry and leave the signup pending, so they cannot
silently release it for mailing. Monitor failed screening and pending age; repair
permissions or outages and replay retained failures. A `watch` result from a model
outage remains eligible by policy. Reassessment/release of a rejected row is an
operator action, not an automatic audit side effect.

Live bounce handling and scheduled SES reconciliation are described in
[delivery health](delivery-health.md). This audit's historical failure lists do
not distinguish hard bounces, mailbox-full failures or policy blocks; only SES
suppression and domain evidence cause deterministic rejection.
Use actual bounce diagnostics and labeled signup outcomes to evaluate model
precision before allowing it to reject real subscribers at scale.

## Model costs and failures

There is no dedicated model endpoint or idle compute charge. The worker invokes
Nova Micro on Bedrock after suppression and email/domain checks, including
signups with no existing bot flags. The audit calls the model only when `--model`
is supplied.
AWS credentials for a local model audit need `bedrock:InvokeModel` permission.
Model timeouts, outages and malformed responses fall back to `watch` with
`decision_unavailable`. Evaluate classifications against labeled signup outcomes
before relying on model confidence for automatic rejection.
