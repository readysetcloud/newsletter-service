import { jest } from '@jest/globals';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
const { handler } = await import('../finalize-report.mjs');

const base = {
  tenant: { id: 'tenant123' },
  reportId: '01JBQ7ZS4C8N2WK9X3F0PDTM5H',
  reportType: 'adhoc',
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-06-15T00:00:00.000Z',
  periodLabel: '1–14 Jun 2026'
};

describe('finalize-report', () => {
  let ddbSend;
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.TABLE_NAME;
    process.env.TABLE_NAME = 'test-table';
    ddbSend = jest.fn(async () => ({}));
    DynamoDBClient.prototype.send = ddbSend;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv;
  });

  const write = () => ddbSend.mock.calls[0][0].input;
  const values = () => unmarshall(write().ExpressionAttributeValues);

  it('references every value it supplies', async () => {
    await handler({ ...base, outcome: 'failed', error: { Error: 'States.TaskFailed' } });

    const input = write();
    for (const placeholder of Object.keys(input.ExpressionAttributeValues)) {
      expect(input.UpdateExpression).toContain(placeholder);
    }
  });

  describe('a range with no issues in it', () => {
    it('completes the report rather than failing it', async () => {
      const result = await handler({ ...base, outcome: 'empty' });

      // Asking about a quiet fortnight is a fair question with a real answer.
      expect(values()[':status']).toBe('complete');
      expect(result.status).toBe('complete');
    });

    it('records that there were no issues, for the empty state to render', async () => {
      await handler({ ...base, outcome: 'empty' });

      expect(values()[':report']).toEqual({ hasIssues: false, insights: [] });
    });

    it('clears a reason left by an earlier attempt', async () => {
      await handler({ ...base, outcome: 'empty' });

      expect(write().UpdateExpression).toContain('REMOVE failureReason');
    });
  });

  describe('a run that failed', () => {
    it('marks the report failed', async () => {
      await handler({ ...base, outcome: 'failed', error: { Error: 'States.TaskFailed' } });

      expect(values()[':status']).toBe('failed');
    });

    it('keeps the message and drops the stack', async () => {
      await handler({
        ...base,
        outcome: 'failed',
        error: {
          Error: 'Lambda.Unknown',
          Cause: JSON.stringify({
            errorMessage: 'Bedrock throttled the request',
            trace: ['at one', 'at two']
          })
        }
      });

      const reason = values()[':failureReason'];
      expect(reason).toBe('Lambda.Unknown: Bedrock throttled the request');
      expect(reason).not.toContain('at one');
    });

    it('copes with a cause that is not JSON', async () => {
      await handler({
        ...base,
        outcome: 'failed',
        error: { Error: 'States.Timeout', Cause: 'the state timed out' }
      });

      expect(values()[':failureReason']).toBe('States.Timeout: the state timed out');
    });

    it('truncates a reason too long to show anyone', async () => {
      await handler({
        ...base,
        outcome: 'failed',
        error: { Error: 'Error', Cause: JSON.stringify({ errorMessage: 'x'.repeat(900) }) }
      });

      expect(values()[':failureReason'].length).toBeLessThanOrEqual(400);
    });

    it('says something rather than nothing when there is no error at all', async () => {
      await handler({ ...base, outcome: 'failed' });

      expect(values()[':failureReason']).toBe('Unknown error');
    });
  });

  describe('keys', () => {
    it('writes an on-demand report under its id', async () => {
      await handler({ ...base, outcome: 'empty' });

      expect(unmarshall(write().Key)).toEqual({
        pk: 'tenant123#report',
        sk: 'adhoc#01JBQ7ZS4C8N2WK9X3F0PDTM5H'
      });
    });

    it('writes a scheduled report under its month', async () => {
      await handler({
        ...base,
        reportId: '2026-05',
        reportType: 'monthly',
        month: '2026-05',
        monthLabel: 'May 2026',
        outcome: 'failed',
        error: { Error: 'Boom' }
      });

      expect(unmarshall(write().Key)).toEqual({ pk: 'tenant123#report', sk: 'monthly#2026-05' });
    });

    it('upserts, so a scheduled run that never wrote a row still leaves one', async () => {
      await handler({
        ...base,
        reportId: '2026-05',
        reportType: 'monthly',
        month: '2026-05',
        monthLabel: 'May 2026',
        outcome: 'failed',
        error: { Error: 'Boom' }
      });

      // No condition on the item existing: before this, a monthly run that
      // failed left no trace at all.
      expect(write().ConditionExpression).toBeUndefined();
      expect(write().UpdateExpression).toContain('createdAt = if_not_exists(createdAt, :now)');
    });
  });
});
