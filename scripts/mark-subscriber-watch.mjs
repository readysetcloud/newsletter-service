import { parseArgs } from 'node:util';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { DynamoDBClient, DescribeTableCommand, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { reportDigest } from '../functions/utils/audit-review.mjs';

// Metadata only: never changes screening, subscription eligibility, or counters.
const { values } = parseArgs({ options: {
  report: { type: 'string' }, plan: { type: 'string' }, execute: { type: 'boolean', default: false }
} });
if (!values.report || !values.plan) throw new Error('--report and --plan are required');
const reportText = await readFile(values.report, 'utf8');
const report = JSON.parse(reportText);
const plan = JSON.parse(await readFile(values.plan, 'utf8'));
const digest = reportDigest(reportText);
if (!report.complete || digest !== plan.reportSha256 || report.tenantId !== plan.tenantId ||
    JSON.stringify(report.source) !== JSON.stringify(plan.source)) throw new Error('Report/plan mismatch');
const rows = new Map(report.rows.map(row => [row.email, row]));
const emails = plan.operations.map(operation => operation.email);
if (new Set(emails).size !== emails.length || !emails.length) throw new Error('Empty or duplicate selection');
for (const operation of plan.operations) {
  if (operation.operation !== 'hold' || rows.get(operation.email)?.assessment.modelAction !== 'reject') {
    throw new Error('Selection must contain only audited model-suggested candidates');
  }
}
console.log(JSON.stringify({ selected: emails.length, execute: values.execute, reportSha256: digest }));
if (!values.execute) process.exit(0);
const client = new DynamoDBClient();
const arn = report.source.subscribersTableArn;
const table = arn.split(':table/')[1];
const described = await client.send(new DescribeTableCommand({ TableName: table }));
if (described.Table.TableArn !== arn) throw new Error('AWS account/region/table mismatch');
const markedAt = new Date().toISOString();
const prefix = `${values.plan}.watch.${markedAt.replace(/[:.]/g, '-')}`;
const backup = [];
for (const email of emails) {
  const result = await client.send(new GetItemCommand({ TableName: table,
    Key: marshall({ tenantId: report.tenantId, email }), ConsistentRead: true }));
  backup.push({ email, subscriber: result.Item ? unmarshall(result.Item) : null });
}
await writeFile(`${prefix}.backup.json`, JSON.stringify({ source: report.source, tenantId: report.tenantId, rows: backup }, null, 2), { flag: 'wx' });
await writeFile(`${prefix}.journal.jsonl`, '', { flag: 'wx' });
let applied = 0;
let skipped = 0;
for (const { email, subscriber } of backup) {
  const row = rows.get(email);
  let status = 'skipped-missing-or-identity-changed';
  if (subscriber && ['addedAt', 'firstName', 'lastName'].every(key =>
    JSON.stringify(subscriber[key]) === JSON.stringify(row.reviewSnapshot[key].value))) {
    const names = { '#watch': 'watchStatus' };
    const vals = { ':watch': { status: 'watch', reason: 'Model-suggested review candidate',
      source: 'model-audit', markedAt, auditReportSha256: digest } };
    const conditions = ['attribute_exists(email)', 'attribute_not_exists(#watch)'];
    for (const key of ['addedAt', 'firstName', 'lastName']) {
      names[`#${key}`] = key;
      if (subscriber[key] === undefined) conditions.push(`attribute_not_exists(#${key})`);
      else { conditions.push(`#${key} = :${key}`); vals[`:${key}`] = subscriber[key]; }
    }
    try {
      await client.send(new UpdateItemCommand({ TableName: table, Key: marshall({ tenantId: report.tenantId, email }),
        UpdateExpression: 'SET #watch = :watch', ConditionExpression: conditions.join(' AND '),
        ExpressionAttributeNames: names, ExpressionAttributeValues: marshall(vals) }));
      status = 'applied';
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') throw error;
      status = 'skipped-existing-marker-or-concurrent-change';
    }
  }
  if (status === 'applied') applied++; else skipped++;
  await appendFile(`${prefix}.journal.jsonl`, JSON.stringify({ email, status }) + '\n');
}
console.log(JSON.stringify({ applied, skipped, backup: `${prefix}.backup.json`, journal: `${prefix}.journal.jsonl` }));
