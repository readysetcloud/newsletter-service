/**
 * One-time backfill: give existing reports the fields the dashboard now lists
 * and orders them by.
 *
 * Reports used to be written only by the monthly job, keyed `monthly#<YYYY-MM>`
 * on both the table and GSI1, and they were always finished. Now they are
 * listed from GSI1 sorted by `createdAt`, and they carry a `status`, because a
 * report someone asks for exists before it has any content.
 *
 * Without this, older reports sort by a key that means something else and
 * would interleave wrongly with new ones. Everything set here is derived from
 * what the record already stores:
 *
 *   createdAt   <- generatedAt   (one write, so they are the same moment)
 *   GSI1SK      <- generatedAt   (the ordering key mirrors createdAt)
 *   status      <- "complete"    (they exist, so they finished)
 *   periodLabel <- monthLabel    (the label that reads for both kinds)
 *
 * Usage:
 *   node scripts/backfill-report-ordering.mjs --table TABLE_NAME [--dry-run]
 *
 * Safe to re-run: only touches report records that are missing `createdAt`.
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
  console.error('Usage: node scripts/backfill-report-ordering.mjs --table TABLE_NAME [--dry-run]');
  process.exit(1);
}

const ddb = new DynamoDBClient();

async function run() {
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let lastEvaluatedKey;

  do {
    const result = await ddb.send(new ScanCommand({
      TableName: args.table,
      FilterExpression: 'begins_with(sk, :monthly) AND attribute_not_exists(createdAt)',
      ExpressionAttributeValues: marshall({ ':monthly': 'monthly#' }),
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    }));

    for (const item of result.Items || []) {
      const record = unmarshall(item);
      scanned++;

      // `generatedAt` is what every one of these has and what `createdAt`
      // would have been. A record without it cannot be ordered, and guessing a
      // timestamp would put it somewhere untrue in the list.
      if (!record.generatedAt) {
        console.warn(`Skipping ${record.pk} / ${record.sk}: no generatedAt to derive an order from`);
        skipped++;
        continue;
      }

      if (args.dryRun) {
        console.log(`[dry-run] would order ${record.pk} / ${record.sk} at ${record.generatedAt}`);
        updated++;
        continue;
      }

      await ddb.send(new UpdateItemCommand({
        TableName: args.table,
        Key: marshall({ pk: record.pk, sk: record.sk }),
        UpdateExpression:
          'SET createdAt = :generatedAt, GSI1SK = :generatedAt, #status = :complete, periodLabel = :periodLabel',
        // Re-running must not overwrite a report that has since been rewritten.
        ConditionExpression: 'attribute_not_exists(createdAt)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: marshall({
          ':generatedAt': record.generatedAt,
          ':complete': 'complete',
          ':periodLabel': record.monthLabel ?? record.month ?? ''
        })
      }));
      updated++;
      console.log(`Ordered ${record.pk} / ${record.sk}`);
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`\nDone. Reports ${args.dryRun ? 'to order' : 'ordered'}: ${updated} (scanned ${scanned}, skipped ${skipped}).`);
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
