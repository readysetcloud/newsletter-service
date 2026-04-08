/**
 * One-time backfill: scan all subscribers and flag bot-like emails.
 *
 * Checks:
 *   1. Disposable email domain → sets `disposableDomain: true`
 *   2. Gmail dot-trick (3+ dots in local part) → sets `suspiciousEmailPattern: true`
 *
 * Usage:
 *   node scripts/backfill-disposable-domain-flags.mjs --table TABLE_NAME [--dry-run]
 *
 * Options:
 *   --table     DynamoDB subscribers table name (required)
 *   --dry-run   Show what would be flagged without writing to DynamoDB
 *
 * Safe to re-run (idempotent) — skips subscribers already flagged.
 */

import { DynamoDBClient, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ── Parse CLI args ─────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { table: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--table' && argv[i + 1]) { args.table = argv[++i]; }
    else if (argv[i] === '--dry-run') { args.dryRun = true; }
  }
  return args;
}

const args = parseArgs(process.argv);

if (!args.table) {
  console.error('Usage: node scripts/backfill-disposable-domain-flags.mjs --table TABLE_NAME [--dry-run]');
  process.exit(1);
}

// ── Load disposable domains ────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const domainsPath = join(__dirname, '..', 'functions', 'data', 'disposable-domains.json');
const domainsList = JSON.parse(readFileSync(domainsPath, 'utf-8'));
const disposableDomainSet = new Set(domainsList);

// ── Dot-trick detection ────────────────────────────────────────────────

const DOT_ALIAS_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

function isDotTrick(email) {
  const atIndex = email.indexOf('@');
  if (atIndex === -1) return false;
  const localPart = email.substring(0, atIndex);
  const domain = email.substring(atIndex + 1).toLowerCase();
  if (!DOT_ALIAS_DOMAINS.has(domain)) return false;
  const dotCount = (localPart.match(/\./g) || []).length;
  return dotCount >= 3;
}

// ── DynamoDB client ────────────────────────────────────────────────────

const ddb = new DynamoDBClient();

// ── Backfill ───────────────────────────────────────────────────────────

async function backfill() {
  let scanned = 0;
  let disposableFlagged = 0;
  let dotTrickFlagged = 0;
  let skipped = 0;
  let exclusiveStartKey;

  const mode = args.dryRun ? 'DRY RUN' : 'LIVE';
  console.log(`[${mode}] Starting bot email backfill`);
  console.log(`  Table:    ${args.table}`);
  console.log(`  Domains:  ${disposableDomainSet.size} in disposable list\n`);

  do {
    const scanParams = {
      TableName: args.table,
      ProjectionExpression: 'tenantId, email, disposableDomain, suspiciousEmailPattern',
    };
    if (exclusiveStartKey) {
      scanParams.ExclusiveStartKey = exclusiveStartKey;
    }

    const result = await ddb.send(new ScanCommand(scanParams));

    for (const rawItem of (result.Items || [])) {
      const item = unmarshall(rawItem);
      scanned++;

      const email = (item.email || '').toLowerCase();
      const atIndex = email.indexOf('@');
      if (atIndex === -1) continue;

      const domain = email.substring(atIndex + 1);
      const updates = {};

      // Check disposable domain
      if (item.disposableDomain !== true && disposableDomainSet.has(domain)) {
        updates.disposableDomain = true;
        disposableFlagged++;
      }

      // Check dot-trick
      if (item.suspiciousEmailPattern !== true && isDotTrick(email)) {
        updates.suspiciousEmailPattern = true;
        dotTrickFlagged++;
      }

      if (Object.keys(updates).length === 0) {
        if (item.disposableDomain === true || item.suspiciousEmailPattern === true) skipped++;
        continue;
      }

      const setExprs = Object.keys(updates).map(k => `${k} = :${k}`).join(', ');
      const exprValues = {};
      for (const [k, v] of Object.entries(updates)) {
        exprValues[`:${k}`] = { BOOL: v };
      }

      const reasons = Object.keys(updates).join(', ');
      if (args.dryRun) {
        console.log(`  [would flag] ${item.email} (${item.tenantId}) — ${reasons}`);
      } else {
        await ddb.send(new UpdateItemCommand({
          TableName: args.table,
          Key: marshall({ tenantId: item.tenantId, email: item.email }),
          UpdateExpression: `SET ${setExprs}`,
          ExpressionAttributeValues: exprValues,
        }));
        console.log(`  [flagged] ${item.email} (${item.tenantId}) — ${reasons}`);
      }
    }

    exclusiveStartKey = result.LastEvaluatedKey;
    if (exclusiveStartKey) {
      await new Promise(r => setTimeout(r, 50));
    }
  } while (exclusiveStartKey);

  const verb = args.dryRun ? 'Would flag' : 'Flagged';
  console.log(`\n[${mode}] Backfill complete:`);
  console.log(`  Scanned:              ${scanned}`);
  console.log(`  ${verb} (disposable):  ${disposableFlagged}`);
  console.log(`  ${verb} (dot-trick):   ${dotTrickFlagged}`);
  console.log(`  Already flagged:      ${skipped}`);
  console.log(`  Total ${verb.toLowerCase()}:        ${disposableFlagged + dotTrickFlagged}`);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
