/**
 * Backfill: classify past issues' click events into scanner vs reader traffic
 * and record the split on each issue's stored analytics.
 *
 * Reads the raw `click#` events already retained per issue (90-day TTL) and
 * writes `analytics.clickQuality`. Raw counters are never touched — this only
 * adds the derived split, so an issue that already has analytics keeps every
 * number it had.
 *
 * Usage:
 *   node scripts/backfill-click-quality.mjs --table TABLE_NAME --tenant TENANT_ID [--dry-run]
 *
 * Options:
 *   --table     DynamoDB issues/stats table name (required)
 *   --tenant    Tenant to backfill (required)
 *   --issue     Single issue number; omit to do every issue found
 *   --dry-run   Print the split without writing
 *
 * Safe to re-run — the classification is derived fresh from the events each
 * time, so a re-run after a threshold change simply overwrites with the new
 * answer.
 */

import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import { classifyScannerClicks } from '../functions/utils/scanner-clicks.mjs';

// ── Parse CLI args ─────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { table: null, tenant: null, issue: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--table' && argv[i + 1]) { args.table = argv[++i]; }
    else if (argv[i] === '--tenant' && argv[i + 1]) { args.tenant = argv[++i]; }
    else if (argv[i] === '--issue' && argv[i + 1]) { args.issue = argv[++i]; }
    else if (argv[i] === '--dry-run') { args.dryRun = true; }
  }
  return args;
}

const args = parseArgs(process.argv);

if (!args.table || !args.tenant) {
  console.error('Usage: node scripts/backfill-click-quality.mjs --table TABLE_NAME --tenant TENANT_ID [--issue N] [--dry-run]');
  process.exit(1);
}

const ddb = new DynamoDBClient();

// ── Issue discovery ────────────────────────────────────────────────────

/**
 * Issue numbers to process. With --issue this is just that one; otherwise the
 * partition keys are discovered from the stats records the tenant already has.
 *
 * There is no index over issues, so discovery walks stats rows via a scan-free
 * query per candidate. Instead of guessing a range, the caller passes --issue
 * for a spot check and omits it for a full sweep, which walks upward from 1
 * until it hits a run of missing issues.
 */
async function discoverIssueNumbers() {
  if (args.issue) return [args.issue];

  const found = [];
  let consecutiveMisses = 0;
  const STOP_AFTER_CONSECUTIVE_MISSES = 25;

  for (let n = 1; consecutiveMisses < STOP_AFTER_CONSECUTIVE_MISSES; n++) {
    const result = await ddb.send(new QueryCommand({
      TableName: args.table,
      KeyConditionExpression: 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: marshall({ ':pk': `${args.tenant}#${n}`, ':sk': 'stats' }),
      ProjectionExpression: 'pk'
    }));

    if (result.Items?.length) {
      found.push(String(n));
      consecutiveMisses = 0;
    } else {
      consecutiveMisses++;
    }
  }

  return found;
}

// ── Event loading ──────────────────────────────────────────────────────

async function loadClickEvents(issueNumber) {
  const pk = `${args.tenant}#${issueNumber}`;
  const clicks = [];
  let exclusiveStartKey;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: args.table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: marshall({ ':pk': pk, ':prefix': 'click#' }),
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ProjectionExpression: 'sk, subscriberEmailHash, linkUrl, #ts',
      ExclusiveStartKey: exclusiveStartKey
    }));

    for (const raw of result.Items || []) {
      clicks.push(unmarshall(raw));
    }
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return clicks;
}

// ── Backfill ───────────────────────────────────────────────────────────

async function backfill() {
  const mode = args.dryRun ? 'DRY RUN' : 'LIVE';
  console.log(`[${mode}] Classifying click traffic`);
  console.log(`  Table:  ${args.table}`);
  console.log(`  Tenant: ${args.tenant}\n`);

  const issueNumbers = await discoverIssueNumbers();
  if (issueNumbers.length === 0) {
    console.log('No issues found for this tenant.');
    return;
  }

  let processed = 0;
  let skipped = 0;
  let totalScanner = 0;
  let totalClassified = 0;

  for (const issueNumber of issueNumbers) {
    const clicks = await loadClickEvents(issueNumber);

    // Events age out on a 90-day TTL, so older issues legitimately have none
    // left to classify. Writing a zeroed split for those would read as "no
    // scanner traffic" rather than "no evidence either way".
    if (clicks.length === 0) {
      skipped++;
      continue;
    }

    const { summary } = classifyScannerClicks(clicks);

    const line = `  issue #${issueNumber}: ${summary.scannerClicks} scanner / ${summary.humanClicks} reader`
      + ` / ${summary.unattributedClicks} unattributed`
      + (summary.scannerRate === null ? '' : ` (${summary.scannerRate}% scanner)`);

    if (!args.dryRun) {
      try {
        await ddb.send(new UpdateItemCommand({
          TableName: args.table,
          Key: marshall({ pk: `${args.tenant}#${issueNumber}`, sk: 'stats' }),
          UpdateExpression: 'SET analytics.clickQuality = :quality',
          // Only touch issues that already have an analytics blob; creating one
          // here would half-populate a record the aggregator owns.
          ConditionExpression: 'attribute_exists(analytics)',
          ExpressionAttributeValues: marshall({ ':quality': summary })
        }));
      } catch (err) {
        if (err.name !== 'ConditionalCheckFailedException') throw err;
        console.log(`  [no analytics record] issue #${issueNumber} — skipped`);
        skipped++;
        continue;
      }
    }

    // Counted only once the issue is actually accounted for, so the totals
    // below match the lines printed above them.
    processed++;
    totalScanner += summary.scannerClicks;
    totalClassified += summary.scannerClicks + summary.humanClicks;
    console.log(args.dryRun ? `  [would write]${line}` : line);
  }

  const overallRate = totalClassified > 0
    ? `${Math.round((totalScanner / totalClassified) * 1000) / 10}%`
    : 'n/a';

  console.log(`\n[${mode}] Complete:`);
  console.log(`  Issues classified:   ${processed}`);
  console.log(`  Issues skipped:      ${skipped} (no retained click events, or no analytics record)`);
  console.log(`  Scanner share:       ${overallRate} of classifiable clicks`);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
