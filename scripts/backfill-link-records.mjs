/**
 * One-off backfill: create the missing `link#<hash(url)>` records for issues
 * that went out without them.
 *
 * Before the content-type fork was removed from stage-issue, 'Extract Links'
 * only ran on the markdown branch, so json and html issues shipped with no link
 * records at all. Those records are what per-link click counters, top-link
 * reporting and interest scoring read, and — until the fix that ships alongside
 * this script — their absence made handle-email-status throw on every email
 * click, which cost the issue its entire click stat.
 *
 * Extraction, ordering and LLM classification are not reimplemented here: this
 * reads the stored issue content and calls the real update-link-tracking handler,
 * so a backfilled issue gets byte-identical records to one staged today.
 *
 * Usage:
 *   node scripts/backfill-link-records.mjs --table TABLE_NAME --tenant TENANT_ID [--issue N] [--dry-run]
 *
 * Options:
 *   --table          DynamoDB newsletter table name (required)
 *   --tenant         Tenant id, e.g. readysetcloud (required)
 *   --issue          Single issue number, processed whatever its age. Omit to
 *                    sweep recent published issues.
 *   --max-age-days   How far back the sweep reaches (default 30). Ignored by
 *                    --issue. See the note below on why the default is not
 *                    "everything".
 *   --model          Bedrock model id for classification
 *                    (default us.amazon.nova-lite-v1:0, matching the deployed function)
 *   --dry-run        Report what would be written without calling Bedrock or DynamoDB
 *
 * Safe to re-run, and re-running is sometimes required: an issue is processed
 * whenever its content implies a link record the table does not have, so a
 * partially extracted issue is repaired rather than skipped. The handler creates
 * records under `attribute_not_exists(pk)` and re-uses an existing
 * classification rather than paying for a second one, so replaying a complete
 * issue costs one GetItem per link and no LLM calls.
 *
 * The sweep is bounded to recent issues on purpose. Link records carry a 90-day
 * TTL and only earn their keep while clicks are still arriving — an old issue
 * reads as "missing every record" simply because its originals aged out
 * naturally, and rewriting them buys nothing: the clicks they would have counted
 * happened months ago, so `clicks_total` stays at 0 and no interest scoring will
 * ever read them. Unbounded, this tenant's sweep wanted to write ~400 Bedrock
 * classifications to recreate records nothing would read.
 */

import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';

// ── Parse CLI args ─────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { table: null, tenant: null, issue: null, maxAgeDays: 30, model: 'us.amazon.nova-lite-v1:0', dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--table' && argv[i + 1]) { args.table = argv[++i]; }
    else if (argv[i] === '--tenant' && argv[i + 1]) { args.tenant = argv[++i]; }
    else if (argv[i] === '--issue' && argv[i + 1]) { args.issue = argv[++i]; }
    else if (argv[i] === '--max-age-days' && argv[i + 1]) { args.maxAgeDays = Number(argv[++i]); }
    else if (argv[i] === '--model' && argv[i + 1]) { args.model = argv[++i]; }
    else if (argv[i] === '--dry-run') { args.dryRun = true; }
  }
  return args;
}

const args = parseArgs(process.argv);

if (!args.table || !args.tenant) {
  console.error('Usage: node scripts/backfill-link-records.mjs --table TABLE_NAME --tenant TENANT_ID [--issue N] [--max-age-days N] [--dry-run]');
  process.exit(1);
}

if (!Number.isFinite(args.maxAgeDays) || args.maxAgeDays <= 0) {
  console.error('--max-age-days must be a positive number of days');
  process.exit(1);
}

// The handler and the classifier read these at call time. Set them before the
// import so a misconfigured run fails here rather than halfway through an issue.
process.env.TABLE_NAME = args.table;
process.env.MODEL_ID = args.model;

const { handler: extractLinks, extractIssueLinks } = await import('../functions/update-link-tracking.mjs');
const { hash } = await import('../functions/utils/helpers.mjs');

const ddb = new DynamoDBClient();

// ── Issue discovery ────────────────────────────────────────────────────

/**
 * The issue number, taken from the `pk` rather than the `issueNumber`
 * attribute. Records from issues 202-225 predate that attribute entirely, and
 * reading it instead of the key silently drops that whole era from the sweep —
 * including the partially extracted issues this script exists to repair.
 */
function issueNumberFromKey(pk) {
  const tail = String(pk ?? '').split('#').slice(1).join('#');
  return /^\d+$/.test(tail) ? Number(tail) : null;
}

/** Recently published issues for the tenant, oldest first. */
async function listPublishedIssues() {
  const issues = [];
  const cutoff = Date.now() - (args.maxAgeDays * 24 * 60 * 60 * 1000);
  let skippedAsOld = 0;
  let exclusiveStartKey;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: args.table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      FilterExpression: '#status = :published',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: marshall({
        ':gsi1pk': `${args.tenant}#newsletter`,
        ':published': 'published'
      }),
      ExclusiveStartKey: exclusiveStartKey
    }));

    for (const rawItem of (result.Items || [])) {
      const item = unmarshall(rawItem);
      const issueNumber = issueNumberFromKey(item.pk);
      // Legacy records key on a file path rather than an issue number. There is
      // no issue to backfill for those and no `link#` records hang off them.
      if (issueNumber == null) {
        continue;
      }

      const publishedAt = Date.parse(item.publishedAt || item.GSI1SK || '');
      if (Number.isNaN(publishedAt) || publishedAt < cutoff) {
        skippedAsOld++;
        continue;
      }

      issues.push({ ...item, issueNumber });
    }

    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  if (skippedAsOld > 0) {
    console.log(`Ignoring ${skippedAsOld} issue(s) older than ${args.maxAgeDays} days — pass --max-age-days to widen, or --issue N to target one directly`);
  }

  return issues.sort((a, b) => a.issueNumber - b.issueNumber);
}

async function getIssue(issueNumber) {
  const result = await ddb.send(new QueryCommand({
    TableName: args.table,
    KeyConditionExpression: 'pk = :pk AND sk = :sk',
    ExpressionAttributeValues: marshall({
      ':pk': `${args.tenant}#${issueNumber}`,
      ':sk': 'newsletter'
    })
  }));

  const item = result.Items?.[0];
  return item ? { ...unmarshall(item), issueNumber: Number(issueNumber) } : null;
}

/** Sort keys of the link records already present for an issue. */
async function listLinkRecordKeys(issueNumber) {
  const keys = new Set();
  let exclusiveStartKey;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: args.table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: marshall({
        ':pk': `${args.tenant}#${issueNumber}`,
        ':sk': 'link#'
      }),
      ProjectionExpression: 'sk',
      ExclusiveStartKey: exclusiveStartKey
    }));

    for (const item of (result.Items || [])) {
      keys.add(unmarshall(item).sk);
    }

    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return keys;
}

/**
 * The link records an issue's content should have produced, keyed the same way
 * update-link-tracking keys them.
 */
function expectedLinkKeys(content, contentType) {
  const keys = new Set();

  for (const { url } of extractIssueLinks(content, contentType)) {
    if (url && /^https?:\/\//i.test(url)) {
      keys.add(`link#${hash(url)}`);
    }
  }

  return keys;
}

// ── Backfill ───────────────────────────────────────────────────────────

async function backfillIssue(issue) {
  const issueNumber = issue.issueNumber;

  if (!issue.content) {
    console.log(`  #${issueNumber}  skipped — no stored content to extract from`);
    return 'skipped';
  }

  // A partially extracted issue is the common case, not an edge case: 'Extract
  // Links' calls Bedrock per link three at a time under a 60s Lambda timeout,
  // and its state is built to accept the timeout with whatever records it
  // managed to write. Presence of *some* records therefore proves nothing —
  // issues 222/223/224 have 6 of 16, 6 of 11 and 5 of 14. Diff the two sets.
  const expected = expectedLinkKeys(issue.content, issue.contentType);
  const present = await listLinkRecordKeys(issueNumber);
  const missing = [...expected].filter(key => !present.has(key));

  if (missing.length === 0) {
    const detail = expected.size === 0 ? 'no trackable links' : `all ${expected.size} link record(s) present`;
    console.log(`  #${issueNumber}  skipped — ${detail}`);
    return 'skipped';
  }

  // Same shape the 'Extract Links' state passes, and the same issueId: the
  // records must key on `<tenant>#<issueNumber>` to match what click tracking
  // and interest scoring look up.
  const state = {
    content: issue.content,
    contentType: issue.contentType,
    tenantId: args.tenant,
    issueId: String(issueNumber)
  };

  if (args.dryRun) {
    console.log(`  #${issueNumber}  [would write] ${missing.length} of ${expected.size} link record(s) from ${issue.contentType} content (${present.size} already present)`);
    for (const { url } of extractIssueLinks(state.content, state.contentType)) {
      if (missing.includes(`link#${hash(url)}`)) {
        console.log(`      ${url}`);
      }
    }
    return 'written';
  }

  // The handler re-walks every link, not just the missing ones. That is the
  // point of replaying it rather than writing records here: an already-complete
  // record costs one GetItem and no LLM call, and one that exists without a
  // classification gets the classification it never got.
  const result = await extractLinks(state);
  const after = await listLinkRecordKeys(issueNumber);
  const stillMissing = [...expected].filter(key => !after.has(key));

  console.log(
    `  #${issueNumber}  wrote ${after.size - present.size} link record(s), now ${after.size} of ${expected.size}` +
    ` (${result.linkCount} link position(s) in ${issue.contentType} content)`
  );

  if (stillMissing.length > 0) {
    // Bedrock is on the critical path, so a slow classification can time the
    // handler out mid-sweep exactly as it did on the original run. Re-runnable.
    console.warn(`  #${issueNumber}  WARNING: ${stillMissing.length} link record(s) still missing — re-run to finish`);
    return 'partial';
  }

  return 'written';
}

async function backfill() {
  const mode = args.dryRun ? 'DRY RUN' : 'LIVE';
  console.log(`[${mode}] Backfilling link records`);
  console.log(`  Table:   ${args.table}`);
  console.log(`  Tenant:  ${args.tenant}`);
  console.log(`  Model:   ${args.model}\n`);

  let issues;
  if (args.issue) {
    const issue = await getIssue(args.issue);
    if (!issue) {
      console.error(`No issue record found at ${args.tenant}#${args.issue}`);
      process.exit(1);
    }
    issues = [issue];
  } else {
    issues = await listPublishedIssues();
    console.log(`Found ${issues.length} published issue(s)\n`);
  }

  const counts = { written: 0, partial: 0, skipped: 0, failed: 0 };

  for (const issue of issues) {
    try {
      counts[await backfillIssue(issue)]++;
    } catch (err) {
      counts.failed++;
      console.error(`  #${issue.issueNumber}  FAILED — ${err.message}`);
    }
  }

  const verb = args.dryRun ? 'Would backfill' : 'Backfilled';
  console.log(`\n[${mode}] Complete:`);
  console.log(`  ${verb}:  ${counts.written}`);
  console.log(`  Incomplete:   ${counts.partial}${counts.partial > 0 ? '  <- re-run to finish' : ''}`);
  console.log(`  Skipped:      ${counts.skipped}`);
  console.log(`  Failed:       ${counts.failed}`);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
