# Existing-list cleanup

1. Run `scripts/audit-subscribers.mjs` with explicit tenant/table arguments,
   `--model` and a new `--output` path. The report contains identity fields,
   model explanations, delivery evidence, table ARNs and concurrency snapshots.
   Its companion `.backup.json` contains all original subscriber records. These
   artifacts contain personal information and remain under gitignored `.local/`.
2. Generate a proposed action plan from the completed report:

   ```powershell
   node scripts/apply-subscriber-audit.mjs --report .local/REPORT.json
   ```

   This creates `.local/REPORT.json.plan.json`, bound to the report's SHA-256.
   Confirmed SES suppressions/invalid domains are proposed as `suppress-remove`.
   Model rejection candidates are proposed as `hold`, retaining their records.
   Watch alone does not create a hold. Review the identities, explanations,
   evidence and a sample of allowed subscribers. Remove unwanted operations
   from the plan, or explicitly add reviewed `hold` operations for watch rows.
   Never convert a model suspicion into permanent delivery suppression.
3. Validate the edited plan without changing AWS:

   ```powershell
   node scripts/apply-subscriber-audit.mjs --report .local/REPORT.json --plan .local/REPORT.json.plan.json
   ```

4. Deploy and verify the marketing filter before applying holds. Then, after
   approving the concrete operation list, use the same command with `--execute`.
   This is the only command in this flow that changes the subscriber list.

Application never invokes a model or recomputes a classification. It rejects
incomplete/stale reports (48-hour maximum), changed hashes, duplicate addresses,
protected states and wrong AWS account/region/table ARNs. Each operation checks
the reviewed identity, screening, signup signals and engagement fields at commit
time; concurrent changes skip the operation rather than overwriting a new signup
or newly engaged reader. Null and absent fields are distinguished.

SES or invalid-domain evidence is rechecked before permanent suppression.
Suppression, deletion and tenant-counter decrement commit together. A stale or
zero tenant counter skips the transaction for investigation; it never goes
negative. Existing opt-outs and verified ownership evidence are preserved.
Holds change only screening state and do not revoke consent or change counts.

Before any writes, the apply script saves fresh selected subscriber backups.
It journals each applied, skipped or failed operation to a separate JSONL file.
Inspect skips and the journal afterward. Restoring a backup must be an explicit
reviewed operation; never use it to silently restore a prior opt-out or hard
bounce. The script sends no email and never clears a suppression.

The first post-cleanup send should use established readers with credible recent
engagement and no known delivery failures. A rules-only allow or model allow
does not verify mailbox ownership. Monitor SES reputation, delivery events and
the pipeline DLQ before expanding the audience. Confirmed opt-in is still a
separate signup improvement.


### Monitoring markers

`watchStatus` is an informational map on a subscriber, separate from `screening`.
The dashboard list and profile display Watch, the reason, and the date marked.
The list includes a Watch filter. A marker does not change mail eligibility or
clear an existing suppression or screening decision.

To mark a reviewed selection of model candidates, use:

```powershell
node scripts/mark-subscriber-watch.mjs --report PATH --plan CANDIDATES_PLAN
# After reviewing the dry run:
node scripts/mark-subscriber-watch.mjs --report PATH --plan CANDIDATES_PLAN --execute
```

This interprets the selected hold candidates as monitoring markers only. It
checks the report hash and table ARN, backs up current records before writes,
checks signup identity, and journals each conditional metadata update. Existing
markers are skipped. It never changes counters or screening decisions.

The October 19 audit's selected 412 model candidates were marked on October 20.
All 412 updates were verified; no other subscriber fields changed. Backups and
verification are under the ignored `.local/` directory. This marker alone does
not implement a one-more-chance suppression policy; delivery handling remains
responsible for suppression.
