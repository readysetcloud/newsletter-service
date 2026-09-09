import { jest } from '@jest/globals';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
const { EventBridgeClient } = await import('@aws-sdk/client-eventbridge');
const { handler } = await import('../compile-monthly-report.mjs');

/** Enough of a report for the email template to render without throwing. */
const reportData = {
  summary: {
    issuesSent: 2,
    totalDelivered: 2100,
    totalClicks: 320,
    avgOpenRate: 57.1,
    avgClickRate: 15.2,
    avgClickToOpenRate: 26.6,
    avgBounceRate: 0.47
  },
  subscriberGrowth: { startCount: 1000, endCount: 1100, netChange: 100, growthRate: 10 },
  topLinks: [{ label: 'Popular', url: 'https://example.com/popular', clicks: 240, issues: [42, 43] }],
  issues: [{ issueNumber: 42, subject: 'First', openRate: 50, clickRate: 12, clicks: 120 }],
  bestIssue: {
    byOpenRate: { subject: 'First', value: 50 },
    byClickRate: { subject: 'First', value: 12 },
    byClicks: { subject: 'First', value: 120 }
  },
  abTests: []
};

const monthlyInput = {
  tenant: { id: 'tenant123', email: 'owner@example.com' },
  reportId: '2026-05',
  reportType: 'monthly',
  deliverEmail: true,
  month: '2026-05',
  monthLabel: 'May 2026',
  periodLabel: 'May 2026',
  periodStart: '2026-05-01T00:00:00.000Z',
  periodEnd: '2026-05-31T23:59:59.999Z',
  reportData,
  insights: [{ severity: 'watch', title: 'Something', body: 'Worth a look' }]
};

const adhocInput = {
  ...monthlyInput,
  reportId: '01JBQ7ZS4C8N2WK9X3F0PDTM5H',
  reportType: 'adhoc',
  deliverEmail: false,
  month: null,
  monthLabel: null,
  periodLabel: '1–14 Jun 2026',
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-06-15T00:00:00.000Z'
};

describe('compile-monthly-report', () => {
  let ddbSend;
  let eventSend;
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.TABLE_NAME;
    process.env.TABLE_NAME = 'test-table';
    ddbSend = jest.fn(async () => ({}));
    eventSend = jest.fn(async () => ({}));
    DynamoDBClient.prototype.send = ddbSend;
    EventBridgeClient.prototype.send = eventSend;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv;
  });

  const write = () => ddbSend.mock.calls[0][0].input;

  describe('persistence', () => {
    it('updates rather than replaces, so a pending row keeps who asked for it', async () => {
      await handler(adhocInput);

      const input = write();
      expect(input.UpdateExpression).toMatch(/^SET /);
      // A put would drop requestedBy and createdAt from the row written when
      // the report was requested.
      expect(input.Item).toBeUndefined();
    });

    it('preserves the ordering key across the rewrite', async () => {
      await handler(adhocInput);

      // createdAt is the GSI1 sort key. If compile stamped its own, an
      // on-demand report would jump position the moment it finished.
      expect(write().UpdateExpression).toContain('createdAt = if_not_exists(createdAt, :generatedAt)');
      expect(write().UpdateExpression).toContain('GSI1SK = if_not_exists(GSI1SK, :generatedAt)');
    });

    it('references every value it supplies', async () => {
      await handler(adhocInput);

      const input = write();
      for (const placeholder of Object.keys(input.ExpressionAttributeValues)) {
        expect(input.UpdateExpression).toContain(placeholder);
      }
    });

    it('keys a scheduled report by its month', async () => {
      await handler(monthlyInput);

      expect(unmarshall(write().Key)).toEqual({ pk: 'tenant123#report', sk: 'monthly#2026-05' });
    });

    it('keys an on-demand report by its id', async () => {
      await handler(adhocInput);

      expect(unmarshall(write().Key)).toEqual({
        pk: 'tenant123#report',
        sk: 'adhoc#01JBQ7ZS4C8N2WK9X3F0PDTM5H'
      });
    });

    it('marks the report complete and clears any earlier failure', async () => {
      await handler(adhocInput);

      const input = write();
      expect(unmarshall(input.ExpressionAttributeValues)[':status']).toBe('complete');
      expect(input.UpdateExpression).toContain('REMOVE failureReason');
    });

    it('omits month attributes from an on-demand report', async () => {
      await handler(adhocInput);

      expect(write().UpdateExpression).not.toContain('monthLabel');
      expect(Object.keys(write().ExpressionAttributeValues)).not.toContain(':month');
    });
  });

  describe('delivery', () => {
    it('emails a scheduled report to the tenant owner', async () => {
      await handler(monthlyInput);

      expect(eventSend).toHaveBeenCalledTimes(1);
      const detail = JSON.parse(eventSend.mock.calls[0][0].input.Entries[0].Detail);
      expect(detail.to.email).toBe('owner@example.com');
      expect(detail.subject).toContain('May 2026');
    });

    it('never emails an on-demand report', async () => {
      const result = await handler(adhocInput);

      // Somebody asked for this and is already looking at it.
      expect(eventSend).not.toHaveBeenCalled();
      expect(result.emailed).toBe(false);
    });

    it('still persists an on-demand report before returning', async () => {
      await handler(adhocInput);

      expect(ddbSend.mock.calls[0][0].input.UpdateExpression).toBeDefined();
    });

    it('frees the range it was holding once the report is written', async () => {
      await handler(adhocInput);

      // The reservation exists to stop a second report over the same dates
      // while this one runs. It is done running.
      const released = ddbSend.mock.calls
        .map(call => call[0].input)
        .find(input => input.Key && !input.UpdateExpression);
      expect(unmarshall(released.Key).sk).toBe(
        'lock#2026-06-01T00:00:00.000Z#2026-06-15T00:00:00.000Z'
      );
    });

    it('does not try to free anything for a scheduled report', async () => {
      await handler(monthlyInput);

      // The monthly job never reserved a range; there is nothing to release.
      const releases = ddbSend.mock.calls
        .map(call => call[0].input)
        .filter(input => input.Key && !input.UpdateExpression);
      expect(releases).toHaveLength(0);
    });

    it('persists a scheduled report even with no owner address', async () => {
      const result = await handler({ ...monthlyInput, tenant: { id: 'tenant123' } });

      expect(ddbSend).toHaveBeenCalledTimes(1);
      expect(eventSend).not.toHaveBeenCalled();
      expect(result.emailed).toBe(false);
    });
  });
});
