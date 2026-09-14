/**
 * Repair stats records that never got their seeded fields.
 *
 * `setupIssueStats` in publish-issue.mjs seeds a stats record with `subject`
 * and `publishedAt` when an issue publishes. When that seed does not land the
 * record still comes into existence — the SES event counters create it on their
 * own the first time a delivery is recorded — but carries neither field.
 *
 * Nothing about that is visible until somebody runs a report. Reports pick
 * their issues by reading `publishedAt` off the stats record and drop anything
 * without one, silently: no error, no gap in the output, just a smaller number.
 * Three consecutive issues were missing from every report that way before a
 * count looked wrong enough to check.
 *
 * The issue record has both fields and is authoritative, so this copies them
 * across. It only ever fills blanks — a stats record that already has a value
 * keeps it, because `publishedAt` there is the send instant (see
 * `resolvePublishedAt`) and the issue record's is the earlier hand-off. This is
 * a repair for missing data, not a re-dating of anything.
 *
 * Usage:
 *   node scripts/backfill-issue-stats-seed.mjs --table TABLE_NAME --tenant TENANT [--apply]
 *
 * Options:
 *   --table    DynamoDB newsletter table name (required)
 *   --tenant   Tenant id to repair (required)
 *   --apply    Actually write. Without it this only reports what it would do.
 *
 * Dry by default, and deliberately so: it writes to the table that holds every
 * issue's only record of what was sent.
 */

import { DynamoDBClient, QueryCommand, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const parseArgs = (argv) => {
  const args = { table: null, tenant: null, apply: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--table' && argv[i + 1]) args.table = argv[++i];
    else if (argv[i] === '--tenant' && argv[i + 1]) args.tenant = argv[++i];
    else if (argv[i] === '--apply') args.apply = true;
  }
  return args;
};

const args = parseArgs(process.argv);

if (!args.table || !args.tenant) {
  console.error('Usage: node scripts/backfill-issue-stats-seed.mjs --table TABLE --tenant TENANT [--apply]');
  process.exit(1);
}

const ddb = new DynamoDBClient();

/** Every stats record for the tenant, via the index reports read. */
const statsRecords = async () => {
  const items = [];
  let lastKey;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: args.table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: marshall({ ':pk': `${args.tenant}#issue` }),
      ProjectionExpression: 'pk, publishedAt, subject',
      ...(lastKey && { ExclusiveStartKey: lastKey })
    }));

    for (const item of result.Items ?? []) {
      items.push(unmarshall(item));
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
};

const issueRecord = async (pk) => {
  const { Item } = await ddb.send(new GetItemCommand({
    TableName: args.table,
    Key: marshall({ pk, sk: 'newsletter' }),
    ProjectionExpression: 'publishedAt, subject, #status',
    ExpressionAttributeNames: { '#status': 'status' }
  }));

  return Item ? unmarshall(Item) : null;
};

const run = async () => {
  const stats = await statsRecords();
  const short = stats.filter((record) => !record.publishedAt || !record.subject);

  console.log(`${stats.length} stats record(s); ${short.length} missing a seeded field.\n`);

  if (short.length === 0) {
    console.log('Nothing to repair.');
    return;
  }

  const planned = [];
  const skipped = [];

  for (const record of short) {
    const issue = await issueRecord(record.pk);

    if (!issue) {
      skipped.push({ pk: record.pk, why: 'no issue record' });
      continue;
    }

    // Only a published issue has a send to describe. Anything else with a
    // stats record is stranger than this script should be repairing blind.
    if (issue.status !== 'published') {
      skipped.push({ pk: record.pk, why: `issue status is ${issue.status}` });
      continue;
    }

    const sets = {};
    if (!record.publishedAt && issue.publishedAt) sets.publishedAt = issue.publishedAt;
    if (!record.subject && issue.subject) sets.subject = issue.subject;

    if (Object.keys(sets).length === 0) {
      skipped.push({ pk: record.pk, why: 'issue record has nothing to copy' });
      continue;
    }

    planned.push({ pk: record.pk, sets });
  }

  for (const { pk, sets } of planned) {
    const fields = Object.entries(sets).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('  ');
    console.log(`  ${args.apply ? 'SET ' : 'would set'} ${pk}  ${fields}`);
  }

  for (const { pk, why } of skipped) {
    console.log(`  skip ${pk} — ${why}`);
  }

  if (!args.apply) {
    console.log(`\nDry run. ${planned.length} record(s) would change. Re-run with --apply to write.`);
    return;
  }

  let written = 0;

  for (const { pk, sets } of planned) {
    const names = {};
    const values = {};
    const clauses = [];

    for (const [field, value] of Object.entries(sets)) {
      names[`#${field}`] = field;
      values[`:${field}`] = value;
      // `if_not_exists` as well as the filter above: two runs, or a publish
      // landing between the read and the write, must not overwrite a real value.
      clauses.push(`#${field} = if_not_exists(#${field}, :${field})`);
    }

    await ddb.send(new UpdateItemCommand({
      TableName: args.table,
      Key: marshall({ pk, sk: 'stats' }),
      UpdateExpression: `SET ${clauses.join(', ')}`,
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(values)
    }));

    written++;
  }

  console.log(`\nRepaired ${written} record(s).`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
