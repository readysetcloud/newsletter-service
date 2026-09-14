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
    /**
     * Events this handler put on the bus, by detail-type.
     *
     * Selected rather than indexed because two different things leave here now
     * — the completion announcement that feeds in-app notifications, and the
     * report email — and asserting on `calls[0]` would make either one's
     * ordering load-bearing.
     */
    const eventsOfType = (detailType) => eventSend.mock.calls
      .flatMap(call => call[0].input.Entries)
      .filter(entry => entry.DetailType === detailType)
      .map(entry => JSON.parse(entry.Detail));

    const emails = () => eventSend.mock.calls
      .flatMap(call => call[0].input.Entries)
      .filter(entry => entry.DetailType !== 'Report Completed')
      .map(entry => JSON.parse(entry.Detail));

    it('emails a scheduled report to the tenant owner', async () => {
      await handler(monthlyInput);

      const [email] = emails();
      expect(email.to.email).toBe('owner@example.com');
      expect(email.subject).toContain('May 2026');
    });

    it('announces that the report is ready, whoever asked for it', async () => {
      // What in-app notifications are built on. It has to fire for both kinds,
      // including the on-demand report that is never emailed.
      await handler(monthlyInput);

      const [announced] = eventsOfType('Report Completed');
      expect(announced.outcome).toBe('ready');
      expect(announced.tenantId).toBe('tenant123');
      expect(announced.reportId).toBe('2026-05');
    });

    it('announces an on-demand report too, though it sends no email', async () => {
      await handler(adhocInput);

      expect(eventsOfType('Report Completed')).toHaveLength(1);
      expect(emails()).toHaveLength(0);
    });

    it('never emails an on-demand report', async () => {
      const result = await handler(adhocInput);

      // Somebody asked for this and is already looking at it.
      expect(emails()).toHaveLength(0);
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
      expect(emails()).toHaveLength(0);
      expect(result.emailed).toBe(false);
    });

    it('still announces a report it could not email', async () => {
      // No address to send to is not a reason to leave the dashboard silent.
      await handler({ ...monthlyInput, tenant: { id: 'tenant123' } });

      expect(eventsOfType('Report Completed')).toHaveLength(1);
    });
  });
});
