import { test, expect } from '@jest/globals';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { proposeAuditActions, validateAuditPlan, reviewSnapshot, auditRowCondition, reportDigest } from '../utils/audit-review.mjs';
const makeRow = (email, assessment) => ({ email, assessment, reviewSnapshot: reviewSnapshot({ email, firstName: 'Reader', engagementCount: 3 }) });
const makeReport = () => ({ schemaVersion: 2, complete: true, generatedAt: new Date().toISOString(), tenantId: 'tenant', source: {
  newsletterTableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/newsletter', subscribersTableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/subscribers'
}, total: 3, rows: [
  makeRow('bounce@example.com', { source: 'evidence', action: 'reject', reasons: ['ses_bounce'] }),
  makeRow('bot@example.com', { source: 'model', action: 'watch', modelAction: 'reject', reasons: ['fastSubmission'] }),
  makeRow('maybe@example.com', { source: 'model', action: 'watch', modelAction: 'watch', reasons: [] })
] });
test('proposes permanent exclusions only for evidence and holds for suspected bots', () => {
  expect(proposeAuditActions(makeReport(), 'hash').operations.map(row => [row.email, row.operation])).toEqual([
    ['bounce@example.com', 'suppress-remove'], ['bot@example.com', 'hold']
  ]);
});
test('incomplete reports cannot be applied or proposed', () => {
  expect(() => proposeAuditActions({ ...makeReport(), complete: false }, 'hash')).toThrow();
});
test('holds, pending and previous rejects remain protected during review', () => {
  const report = makeReport(); report.rows[0].preserveExistingState = true;
  const plan = proposeAuditActions(report, 'hash');
  expect(plan.operations).toHaveLength(1);
  plan.operations.push({ email: report.rows[0].email, operation: 'hold' });
  expect(() => validateAuditPlan(report, plan, 'hash')).toThrow('protected');
});
test('changed report bytes invalidate the plan', () => {
  const report = makeReport();
  const digest = reportDigest(JSON.stringify(report));
  const plan = proposeAuditActions(report, digest);
  expect(() => validateAuditPlan(report, plan, reportDigest(JSON.stringify({ ...report, total: 99 })))).toThrow('match');
});
test('duplicate plan addresses and model-only permanent removal are rejected', () => {
  const report = makeReport(); const plan = proposeAuditActions(report, 'hash');
  plan.operations[1].operation = 'suppress-remove';
  expect(() => validateAuditPlan(report, plan, 'hash')).toThrow('confirmed');
  plan.operations[1] = plan.operations[0];
  expect(() => validateAuditPlan(report, plan, 'hash')).toThrow('protected');
});
test('stale reports are rejected before AWS writes', () => {
  const report = makeReport(); report.generatedAt = '2020-01-01T00:00:00Z';
  expect(() => validateAuditPlan(report, proposeAuditActions(report, 'hash'), 'hash')).toThrow('too old');
});
test('changed account or table bindings invalidate the plan', () => {
  const report = makeReport(); const plan = proposeAuditActions(report, 'hash');
  plan.source = { ...plan.source, subscribersTableArn: 'other' };
  expect(() => validateAuditPlan(report, plan, 'hash')).toThrow('match');
});
test('concurrency conditions guard names and engagement, including null versus absent', () => {
  const row = makeReport().rows[0];
  row.reviewSnapshot = reviewSnapshot({ firstName: null, engagementCount: 3 });
  const guard = auditRowCondition(row);
  const names = Object.values(guard.ExpressionAttributeNames);
  expect(names).toEqual(expect.arrayContaining(['firstName', 'lastName', 'engagementCount', 'lastEngagedIssue', 'recentActivity', 'screening']));
  expect(guard.ConditionExpression).toContain('attribute_not_exists');
  expect(Object.values(unmarshall(guard.ExpressionAttributeValues))).toContain(null);
  expect(Object.values(unmarshall(guard.ExpressionAttributeValues))).toContain(3);
});
