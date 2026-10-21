import { parseArgs } from 'node:util';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { DynamoDBClient, DescribeTableCommand, GetItemCommand, TransactWriteItemsCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SESv2Client, GetSuppressedDestinationCommand } from '@aws-sdk/client-sesv2';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { reportDigest, proposeAuditActions, validateAuditPlan, auditRowCondition } from '../functions/utils/audit-review.mjs';
import { checkMailDomain } from '../functions/utils/subscriber-screening.mjs';

const { values } = parseArgs({ options: {
  report: { type: 'string' }, plan: { type: 'string' }, execute: { type: 'boolean', default: false }
} });
if (!values.report) throw new Error('--report PATH is required');
const reportText = await readFile(values.report, 'utf8');
const report = JSON.parse(reportText);
const digest = reportDigest(reportText);
if (!values.plan) {
  if (values.execute) throw new Error('--execute requires an explicit reviewed --plan');
  const plan = proposeAuditActions(report, digest);
  const output = `${values.report}.plan.json`;
  await writeFile(output, JSON.stringify(plan, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ output, proposed: plan.operations.reduce((counts, row) => { counts[row.operation] = (counts[row.operation] || 0) + 1; return counts; }, {}) }));
  process.exit(0);
}
const plan = JSON.parse(await readFile(values.plan, 'utf8'));
const rows = validateAuditPlan(report, plan, digest);
console.log(JSON.stringify({ operations: plan.operations.length, execute: values.execute, reportSha256: digest }));
if (!values.execute) process.exit(0);
const ddb = new DynamoDBClient();
const ses = new SESv2Client();
const tableName = arn => arn.split(':table/')[1];
const table = tableName(report.source.newsletterTableArn);
const subscribers = tableName(report.source.subscribersTableArn);
for (const [name, expected] of [[table, report.source.newsletterTableArn], [subscribers, report.source.subscribersTableArn]]) {
  const response = await ddb.send(new DescribeTableCommand({ TableName: name }));
  if (response.Table.TableArn !== expected) throw new Error('AWS account/region/table mismatch');
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const journal = `${values.plan}.${stamp}.journal.jsonl`;
const backup = [];
for (const operation of plan.operations) {
  const response = await ddb.send(new GetItemCommand({ TableName: subscribers, Key: marshall({ tenantId: report.tenantId, email: operation.email }), ConsistentRead: true }));
  backup.push({ email: operation.email, subscriber: response.Item ? unmarshall(response.Item) : null });
}
await writeFile(`${values.plan}.${stamp}.backup.json`, JSON.stringify({ tenantId: report.tenantId, source: report.source, reportSha256: digest, rows: backup }, null, 2), { flag: 'wx' });
await writeFile(journal, '', { flag: 'wx' });
const counts = { applied: 0, skipped: 0 };
for (const operation of plan.operations) {
  const row = rows.get(operation.email);
  const key = marshall({ tenantId: report.tenantId, email: row.email });
  const condition = auditRowCondition(row);
  let status = 'applied';
  try {
    if (operation.operation === 'hold') {
      await ddb.send(new UpdateItemCommand({ TableName: subscribers, Key: key, ...condition,
        UpdateExpression: 'SET #screening = :hold',
        ExpressionAttributeNames: { ...condition.ExpressionAttributeNames, '#screening': 'screening' },
        ExpressionAttributeValues: { ...condition.ExpressionAttributeValues, ...marshall({ ':hold': {
          ...row.assessment, action: 'hold', reviewReason: 'existing-list-review', reportSha256: digest
        } }) }
      }));
    } else {
      let confirmed = false;
      if (row.assessment.reasons.some(reason => ['ses_bounce', 'ses_complaint'].includes(reason))) {
        try {
          const response = await ses.send(new GetSuppressedDestinationCommand({ EmailAddress: row.email }));
          confirmed = ['BOUNCE', 'COMPLAINT'].includes(response.SuppressedDestination?.Reason);
        } catch (error) { if (error.name !== 'NotFoundException') throw error; }
      } else if (row.assessment.reasons.includes('domain_cannot_receive_mail')) {
        confirmed = await checkMailDomain(row.email.split('@')[1]) === 'invalid';
      } else if (row.assessment.reasons.includes('invalid_email')) confirmed = true;
      if (!confirmed) { status = 'skipped-evidence-changed'; counts.skipped++; }
      else {
        const now = new Date().toISOString();
        await ddb.send(new TransactWriteItemsCommand({ TransactItems: [
          { Delete: { TableName: subscribers, Key: key, ...condition } },
          { Update: { TableName: table, Key: marshall({ pk: report.tenantId, sk: 'tenant' }),
            UpdateExpression: 'SET subscribers = subscribers - :one', ConditionExpression: 'subscribers >= :one',
            ExpressionAttributeValues: marshall({ ':one': 1 }) } },
          { Update: { TableName: table, Key: marshall({ pk: report.tenantId, sk: `suppression#${row.email.toLowerCase()}` }),
            UpdateExpression: 'SET email = :email, #method = if_not_exists(#method, :method), unsubscribedAt = if_not_exists(unsubscribedAt, :now), verified = if_not_exists(verified, :false), lastMethod = :method, lastUnsubscribedAt = :now, lastVerified = :false',
            ExpressionAttributeNames: { '#method': 'method' },
            ExpressionAttributeValues: marshall({ ':email': row.email.toLowerCase(), ':method': 'list-audit-delivery', ':now': now, ':false': false })
          } }
        ] }));
      }
    }
    if (status === 'applied') counts.applied++;
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException' || (error.name === 'TransactionCanceledException' && error.CancellationReasons?.some(reason => reason.Code === 'ConditionalCheckFailed'))) {
      status = 'skipped-concurrent-change-or-counter'; counts.skipped++;
    } else {
      await appendFile(journal, JSON.stringify({ email: row.email, operation: operation.operation, status: 'failed', error: error.name }) + '\n');
      throw error;
    }
  }
  await appendFile(journal, JSON.stringify({ email: row.email, operation: operation.operation, status }) + '\n');
}
console.log(JSON.stringify({ ...counts, journal }));
