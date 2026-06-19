/**
 * One-time backfill: add GSI1 keys to tenant records so they can be listed via
 * the index (GSI1PK = "tenant") instead of a table Scan.
 *
 * Newer tenants already carry GSI1PK="tenant" / GSI1SK=<tenantId> (set by the
 * onboarding paths). This backfills any older tenant records that predate that.
 *
 * Usage:
 *   node scripts/backfill-tenant-gsi.mjs --table TABLE_NAME [--dry-run]
 *
 * Options:
 *   --table     DynamoDB newsletter table name (required)
 *   --dry-run   Show what would change without writing to DynamoDB
 *
 * Safe to re-run (idempotent) — only touches tenant records missing GSI1PK.
 */

import { DynamoDBClient, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

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
  console.error('Usage: node scripts/backfill-tenant-gsi.mjs --table TABLE_NAME [--dry-run]');
  process.exit(1);
}

const ddb = new DynamoDBClient();

async function run() {
  let scanned = 0;
  let updated = 0;
  let lastEvaluatedKey;

  do {
    const result = await ddb.send(new ScanCommand({
      TableName: args.table,
      FilterExpression: 'sk = :sk AND attribute_not_exists(GSI1PK)',
      ExpressionAttributeValues: marshall({ ':sk': 'tenant' }),
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    }));

    for (const item of result.Items || []) {
      const record = unmarshall(item);
      scanned++;

      if (args.dryRun) {
        console.log(`[dry-run] would index tenant ${record.pk}`);
        updated++;
        continue;
      }

      await ddb.send(new UpdateItemCommand({
        TableName: args.table,
        Key: marshall({ pk: record.pk, sk: 'tenant' }),
        UpdateExpression: 'SET GSI1PK = :gsi1pk, GSI1SK = :gsi1sk',
        ConditionExpression: 'attribute_not_exists(GSI1PK)',
        ExpressionAttributeValues: marshall({ ':gsi1pk': 'tenant', ':gsi1sk': record.pk })
      }));
      updated++;
      console.log(`Indexed tenant ${record.pk}`);
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`\nDone. Tenant records ${args.dryRun ? 'to index' : 'indexed'}: ${updated} (scanned ${scanned}).`);
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
