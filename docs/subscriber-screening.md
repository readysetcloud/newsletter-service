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
output to return a validated action and confidence, and records the model ID.
`SCREENING_MODEL_ID` defaults to `us.amazon.nova-micro-v1:0`; changing the model
also requires updating the worker's IAM permissions. Calls are pay per use and
made for records that pass the deterministic rejection checks. Model confidence is not a calibrated probability
that an email will bounce.
Confirmed SES suppression or invalid domain routing overrides model decisions.
Missing DNS, past failures, low engagement or an unusual address alone never
justify model rejection. DNS routing does not verify that a mailbox exists.

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
