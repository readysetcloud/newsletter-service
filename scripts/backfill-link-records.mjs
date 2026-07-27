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
 *   --table     DynamoDB newsletter table name (required)
 *   --tenant    Tenant id, e.g. readysetcloud (required)
 *   --issue     Single issue number. Omit to sweep every published issue.
 *   --model     Bedrock model id for classification
 *               (default us.amazon.nova-lite-v1:0, matching the deployed function)
 *   --dry-run   Report what would be written without calling Bedrock or DynamoDB
 *
 * Safe to re-run: an issue that already has any link record is skipped, and the
 * handler itself creates records under `attribute_not_exists(pk)` and re-uses an
 * existing classification rather than paying for a second one.
 */

import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';

// ── Parse CLI args ─────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { table: null, tenant: null, issue: null, model: 'us.amazon.nova-lite-v1:0', dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--table' && argv[i + 1]) { args.table = argv[++i]; }
    else if (argv[i] === '--tenant' && argv[i + 1]) { args.tenant = argv[++i]; }
    else if (argv[i] === '--issue' && argv[i + 1]) { args.issue = argv[++i]; }
    else if (argv[i] === '--model' && argv[i + 1]) { args.model = argv[++i]; }
    else if (argv[i] === '--dry-run') { args.dryRun = true; }
  }
  return args;
}

const args = parseArgs(process.argv);

if (!args.table || !args.tenant) {
  console.error('Usage: node scripts/backfill-link-records.mjs --table TABLE_NAME --tenant TENANT_ID [--issue N] [--dry-run]');
  process.exit(1);
}

// The handler and the classifier read these at call time. Set them before the
// import so a misconfigured run fails here rather than halfway through an issue.
process.env.TABLE_NAME = args.table;
process.env.MODEL_ID = args.model;

const { handler: extractLinks, extractIssueLinks } = await import('../functions/update-link-tracking.mjs');

const ddb = new DynamoDBClient();

// ── Issue discovery ────────────────────────────────────────────────────

/** Every published issue for the tenant, oldest first. */
async function listPublishedIssues() {
  const issues = [];
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
      if (item.issueNumber != null) {
        issues.push(item);
      }
    }

    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

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
  return item ? unmarshall(item) : null;
}

/** Link records already present for an issue. Any hit means it was extracted. */
async function countLinkRecords(issueNumber) {
  const result = await ddb.send(new QueryCommand({
    TableName: args.table,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: marshall({
      ':pk': `${args.tenant}#${issueNumber}`,
      ':sk': 'link#'
    }),
    Select: 'COUNT'
  }));

  return result.Count ?? 0;
}

// ── Backfill ───────────────────────────────────────────────────────────

async function backfillIssue(issue) {
  const issueNumber = issue.issueNumber;
  const existing = await countLinkRecords(issueNumber);

  if (existing > 0) {
    console.log(`  #${issueNumber}  skipped — already has ${existing} link record(s)`);
    return 'skipped';
  }

  if (!issue.content) {
    console.log(`  #${issueNumber}  skipped — no stored content to extract from`);
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
    const urls = new Set(
      extractIssueLinks(state.content, state.contentType)
        .map(link => link.url)
        .filter(url => /^https?:\/\//i.test(url))
    );
    console.log(`  #${issueNumber}  [would write] ${urls.size} link record(s) from ${issue.contentType} content`);
    for (const url of urls) {
      console.log(`      ${url}`);
    }
    return 'written';
  }

  const result = await extractLinks(state);
  const written = await countLinkRecords(issueNumber);
  console.log(`  #${issueNumber}  wrote ${written} link record(s) (${result.linkCount} link position(s) in ${issue.contentType} content)`);

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

  const counts = { written: 0, skipped: 0, failed: 0 };

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
  console.log(`  Skipped:      ${counts.skipped}`);
  console.log(`  Failed:       ${counts.failed}`);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
