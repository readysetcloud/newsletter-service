import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DynamoDBClient, QueryCommand, GetItemCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { SESv2Client, ListSuppressedDestinationsCommand } from '@aws-sdk/client-sesv2';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { isSubscriberRecord } from '../functions/utils/subscriber-record.mjs';
import { checkMailDomain, screenSubscriber } from '../functions/utils/subscriber-screening.mjs';
import { reviewSnapshot } from '../functions/utils/audit-review.mjs';

const { values } = parseArgs({ options: {
  tenant: { type: 'string' }, table: { type: 'string' }, subscribers: { type: 'string' },
  output: { type: 'string', default: '.local/subscriber-audit.json' },
  apply: { type: 'boolean', default: false }, model: { type: 'boolean', default: false },
  concurrency: { type: 'string', default: '8' }
} });
if (!values.tenant || !values.table || !values.subscribers) throw new Error('Required: --tenant ID --table NEWSLETTER_TABLE --subscribers SUBSCRIBERS_TABLE [--model] [--apply] [--output PATH]');
if (values.apply) throw new Error('Audit is read-only. Apply the exact reviewed report with apply-subscriber-audit.mjs instead.');
const concurrency = Number(values.concurrency);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('--concurrency must be between 1 and 16');
const ddb = new DynamoDBClient();
const ses = new SESv2Client();
async function queryAll(input) {
  const items = [];
  let key;
  do {
    const response = await ddb.send(new QueryCommand({ ...input, ExclusiveStartKey: key }));
    items.push(...(response.Items || []).map(unmarshall));
    key = response.LastEvaluatedKey;
  } while (key);
  return items;
}
const subscribers = (await queryAll({ TableName: values.subscribers,
  KeyConditionExpression: 'tenantId = :tenant', ExpressionAttributeValues: marshall({ ':tenant': values.tenant }), ConsistentRead: true
})).filter(isSubscriberRecord);
const suppressed = new Map();
let token;
do {
  const response = await ses.send(new ListSuppressedDestinationsCommand({ NextToken: token, PageSize: 1000 }));
  for (const item of response.SuppressedDestinationSummaries || []) suppressed.set(item.EmailAddress.toLowerCase(), item.Reason);
  token = response.NextToken;
} while (token);
const issues = await queryAll({ TableName: values.table, IndexName: 'GSI1',
  KeyConditionExpression: 'GSI1PK = :tenant', ExpressionAttributeValues: marshall({ ':tenant': `${values.tenant}#issue` }), ScanIndexForward: false
});
const failures = new Map();
for (const issue of issues.filter(issue => issue.publishedAt && Date.parse(issue.publishedAt) <= Date.now()).slice(0, 3)) {
  const response = await ddb.send(new GetItemCommand({ TableName: values.table, Key: marshall({ pk: issue.pk, sk: 'stats' }) }));
  for (const email of new Set(response.Item ? unmarshall(response.Item).failedAddresses || [] : [])) {
    const normalized = email.toLowerCase();
    failures.set(normalized, (failures.get(normalized) || 0) + 1);
  }
}
const [newsletterInfo, subscriberInfo] = await Promise.all([
  ddb.send(new DescribeTableCommand({ TableName: values.table })),
  ddb.send(new DescribeTableCommand({ TableName: values.subscribers }))
]);
const source = { newsletterTableArn: newsletterInfo.Table.TableArn, subscribersTableArn: subscriberInfo.Table.TableArn };
const generatedAt = new Date().toISOString();
await mkdir(dirname(values.output), { recursive: true });
// Full original records are saved before any model calls. Keep these private.
await writeFile(`${values.output}.backup.json`, JSON.stringify({ tenantId: values.tenant, source, generatedAt, subscribers }, null, 2), { flag: 'wx' });
const domains = new Map();
const decide = values.model ? (await import('../functions/utils/screening-decider.mjs')).decideSubscriber : undefined;
const rows = new Array(subscribers.length);
let cursor = 0;
let completed = 0;
let checkpoint = Promise.resolve();
const summaryOf = () => rows.filter(Boolean).reduce((counts, row) => { counts[row.assessment.action]++; return counts; }, { allow: 0, watch: 0, reject: 0 });
const report = () => ({ schemaVersion: 2, tenantId: values.tenant, source, generatedAt, modelEnabled: values.model,
  complete: completed === subscribers.length, completed, total: subscribers.length, summary: summaryOf(), rows: rows.filter(Boolean) });
// Concurrent workers share domain promises, but each subscriber has a separate
// model request. The backup preserves the input if the run is interrupted.
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (cursor < subscribers.length) {
    const index = cursor++;
    const subscriber = subscribers[index];
    const domain = subscriber.email.split('@')[1];
    if (!domains.has(domain)) domains.set(domain, domain ? checkMailDomain(domain) : Promise.resolve('invalid'));
    const assessment = await screenSubscriber(subscriber, {
      suppressionReason: suppressed.get(subscriber.email.toLowerCase()),
      domainStatus: await domains.get(domain), failedIssues: failures.get(subscriber.email.toLowerCase()) || 0, decide
    });
    const protectedState = ['pending', 'reject', 'hold'].includes(subscriber.screening?.action);
    rows[index] = { email: subscriber.email, firstName: subscriber.firstName || null, lastName: subscriber.lastName || null,
      addedAt: subscriber.addedAt, assessment, previousScreening: subscriber.screening || null, reviewSnapshot: reviewSnapshot(subscriber),
      ...(protectedState && { preserveExistingState: true }) };
    completed++;
    if (completed % 100 === 0) {
      console.log(`Assessed ${completed}/${subscribers.length}`);
      const snapshot = JSON.stringify(report(), null, 2);
      checkpoint = checkpoint.then(() => writeFile(`${values.output}.checkpoint.json`, snapshot));
    }
  }
}));
await checkpoint;
await writeFile(values.output, JSON.stringify(report(), null, 2), { flag: 'wx' });
console.log(JSON.stringify({ total: rows.length, ...summaryOf(), output: values.output, apply: false }));
