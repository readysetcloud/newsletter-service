import crypto from 'node:crypto';
import { marshall } from '@aws-sdk/util-dynamodb';

export const reportDigest = text => crypto.createHash('sha256').update(text).digest('hex');
const evidenceReasons = new Set(['ses_bounce', 'ses_complaint', 'domain_cannot_receive_mail', 'invalid_email']);
export function reviewSnapshot(subscriber) {
  return Object.fromEntries(['addedAt', 'firstName', 'lastName', 'screening', 'engagementCount', 'lastEngagedIssue', 'lastSentAt', 'lastIssueSent', 'recentActivity',
    'honeypotTriggered', 'disposableDomain', 'suspiciousUserAgent', 'unknownIp', 'fastSubmission', 'suspiciousEmailPattern', 'elapsedMs', 'requestCountInWindow']
    .map(key => [key, Object.hasOwn(subscriber, key) ? { present: true, value: subscriber[key] } : { present: false }]));
}
export function proposeAuditActions(report, digest) {
  if (report.schemaVersion !== 2 || !report.complete || report.rows.length !== report.total || !report.source) throw new Error('A complete version 2 report is required');
  return { schemaVersion: 1, reportSha256: digest, tenantId: report.tenantId, source: { ...report.source },
    operations: report.rows.filter(row => !row.preserveExistingState && !['pending', 'reject', 'hold'].includes(row.previousScreening?.action)).flatMap(row => {
      if (row.assessment.source === 'evidence' && row.assessment.action === 'reject' && row.assessment.reasons.some(reason => evidenceReasons.has(reason))) {
        return [{ email: row.email, firstName: row.firstName || null, lastName: row.lastName || null, operation: 'suppress-remove', reasons: [...row.assessment.reasons] }];
      }
      if (row.assessment.source === 'model' && (row.assessment.modelAction === 'reject' || row.assessment.action === 'reject')) {
        return [{ email: row.email, firstName: row.firstName || null, lastName: row.lastName || null, operation: 'hold', reasons: [...row.assessment.reasons], explanation: row.assessment.explanation || '' }];
      }
      return [];
    }) };
}

export function validateAuditPlan(report, plan, digest) {
  proposeAuditActions(report, digest);
  if (plan.schemaVersion !== 1 || plan.reportSha256 !== digest || plan.tenantId !== report.tenantId ||
      JSON.stringify(plan.source) !== JSON.stringify(report.source)) throw new Error('Plan does not match the exact audit report');
  const age = Date.now() - Date.parse(report.generatedAt);
  if (!Number.isFinite(age) || age < -60000 || age > 48 * 3600000) throw new Error('Audit is too old; refresh before applying');
  const rows = new Map(report.rows.map(row => [row.email, row]));
  if (rows.size !== report.rows.length) throw new Error('Duplicate report addresses');
  const seen = new Set();
  for (const operation of plan.operations) {
    const row = rows.get(operation.email);
    if (!row || seen.has(operation.email) || row.preserveExistingState || ['pending', 'reject', 'hold'].includes(row.previousScreening?.action)) throw new Error('Invalid or protected plan address');
    if (!row.reviewSnapshot) throw new Error('Report lacks a concurrency snapshot');
    seen.add(operation.email);
    if (!['hold', 'suppress-remove'].includes(operation.operation)) throw new Error('Unsupported review operation');
    if (operation.operation === 'suppress-remove' && !(row.assessment.source === 'evidence' && row.assessment.action === 'reject' && row.assessment.reasons.some(reason => evidenceReasons.has(reason)))) {
      throw new Error('Permanent suppression requires confirmed delivery evidence');
    }
  }
  return rows;
}

// Guard identity, screening and engagement fields so a review cannot override
// a changed signup or newly engaged reader between inspection and commit.
export function auditRowCondition(row) {
  const names = { '#tenant': 'tenantId' };
  const values = {};
  const clauses = ['attribute_exists(#tenant)'];
  if (!row.reviewSnapshot) throw new Error('Report lacks a concurrency snapshot');
  const expected = row.reviewSnapshot;
  let index = 0;
  for (const [key, snapshot] of Object.entries(expected)) {
    const name = `#field${index}`;
    names[name] = key;
    if (!snapshot.present) clauses.push(`attribute_not_exists(${name})`);
    else { values[`:value${index}`] = snapshot.value; clauses.push(`${name} = :value${index}`); }
    index++;
  }
  return { ConditionExpression: clauses.join(' AND '), ExpressionAttributeNames: names,
    ...(Object.keys(values).length && { ExpressionAttributeValues: marshall(values) }) };
}
