import { describe, it, expect } from '@jest/globals';
import { buildAbHistoryRecord } from '../ab-history.mjs';

const subjectAbTest = (overrides = {}) => ({
  dimension: 'subject',
  winMetric: 'openRate',
  status: 'sent',
  winnerVariantId: 'b',
  variants: [
    { variantId: 'a', subject: 'Control' },
    { variantId: 'b', subject: 'Challenger' }
  ],
  evaluation: { significant: true, confidence: 0.95, decidedAt: '2026-06-01T00:00:00.000Z' },
  ...overrides
});

const counters = {
  a: { opens: 300, clicks: 50, deliveries: 1000 },
  b: { opens: 450, clicks: 90, deliveries: 1000 }
};

describe('buildAbHistoryRecord', () => {
  it('keys the record per issue and denormalizes variant rates', () => {
    const record = buildAbHistoryRecord({ tenantId: 'tenant-1', issueNumber: 42, abTest: subjectAbTest(), counters });

    expect(record.pk).toBe('tenant-1#abhistory');
    expect(record.sk).toBe('test#42');
    expect(record.recordType).toBe('abHistory');
    expect(record.issueNumber).toBe(42);
    expect(record.dimension).toBe('subject');
    expect(record.winMetric).toBe('openRate');
    expect(record.winnerVariantId).toBe('b');
    expect(record.significant).toBe(true);
    expect(record.confidence).toBe(0.95);
    expect(record.decidedAt).toBe('2026-06-01T00:00:00.000Z');

    const a = record.variants.find((v) => v.variantId === 'a');
    const b = record.variants.find((v) => v.variantId === 'b');
    expect(a.openRate).toBe(30); // 300/1000
    expect(b.openRate).toBe(45); // 450/1000
    expect(b.clickRate).toBe(9); // 90/1000
    expect(a.subject).toBe('Control');
  });

  it('computes lift as winner minus control on the win metric', () => {
    const record = buildAbHistoryRecord({ tenantId: 't', issueNumber: 7, abTest: subjectAbTest(), counters });
    // open rate: winner b 45 - control a 30 = 15
    expect(record.lift).toBe(15);
  });

  it('uses click rate for lift when winMetric is clickRate', () => {
    const record = buildAbHistoryRecord({
      tenantId: 't', issueNumber: 7,
      abTest: subjectAbTest({ winMetric: 'clickRate' }),
      counters
    });
    // click rate: winner b 9 - control a 5 = 4
    expect(record.lift).toBe(4);
  });

  it('returns null lift for an inconclusive test (no winner)', () => {
    const record = buildAbHistoryRecord({
      tenantId: 't', issueNumber: 7,
      abTest: subjectAbTest({ status: 'inconclusive', winnerVariantId: null, evaluation: { significant: false } }),
      counters
    });
    expect(record.winnerVariantId).toBeNull();
    expect(record.lift).toBeNull();
    expect(record.significant).toBe(false);
  });

  it('carries sendAt (not subject) for send-time variants', () => {
    const record = buildAbHistoryRecord({
      tenantId: 't', issueNumber: 9,
      abTest: {
        dimension: 'sendTime',
        winMetric: 'openRate',
        status: 'sent',
        winnerVariantId: 'a',
        variants: [
          { variantId: 'a', sendAt: '2026-06-01T09:00:00.000Z' },
          { variantId: 'b', sendAt: '2026-06-01T17:00:00.000Z' }
        ],
        evaluation: { significant: true, confidence: 0.95 }
      },
      counters
    });
    const a = record.variants.find((v) => v.variantId === 'a');
    expect(a.sendAt).toBe('2026-06-01T09:00:00.000Z');
    expect(a.subject).toBeUndefined();
    expect(record.dimension).toBe('sendTime');
  });

  it('defaults missing counters to zero rates', () => {
    const record = buildAbHistoryRecord({
      tenantId: 't', issueNumber: 1, abTest: subjectAbTest(), counters: {}
    });
    expect(record.variants.every((v) => v.openRate === 0 && v.clickRate === 0 && v.deliveries === 0)).toBe(true);
  });
});
