import { jest } from '@jest/globals';

const { getReportingWindow } = await import('../monthly-report-job.mjs');

describe('monthly-report-job getReportingWindow', () => {
  test('targets the previous month when run on the 1st', () => {
    const w = getReportingWindow(new Date('2026-06-01T14:00:00.000Z'));
    expect(w.month).toBe('2026-05');
    expect(w.monthLabel).toBe('May 2026');
    expect(w.periodStart).toBe('2026-05-01T00:00:00.000Z');
    expect(w.periodEnd).toBe('2026-06-01T00:00:00.000Z');
  });

  test('rolls back across a year boundary', () => {
    const w = getReportingWindow(new Date('2026-01-01T14:00:00.000Z'));
    expect(w.month).toBe('2025-12');
    expect(w.monthLabel).toBe('December 2025');
    expect(w.periodStart).toBe('2025-12-01T00:00:00.000Z');
    expect(w.periodEnd).toBe('2026-01-01T00:00:00.000Z');
  });
});
