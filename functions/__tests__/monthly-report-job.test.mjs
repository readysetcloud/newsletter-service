import { jest } from '@jest/globals';

const { getReportingWindow, tenantRecordEmail, buildExecutionName } = await import('../monthly-report-job.mjs');

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

describe('monthly-report-job tenantRecordEmail', () => {
  test('rejects the SES setup map tenant-finalization writes to `email`', () => {
    const record = { pk: 'tenant-a', email: { tenantArn: 'arn:aws:ses:...', contactList: 'tenant-a' } };
    expect(tenantRecordEmail(record)).toBeNull();
  });

  test('rejects a record with no email at all', () => {
    expect(tenantRecordEmail({ pk: 'tenant-a' })).toBeNull();
    expect(tenantRecordEmail(undefined)).toBeNull();
  });

  test('accepts a real address left by the external Add/Update Tenant event', () => {
    expect(tenantRecordEmail({ pk: 'tenant-a', email: 'owner@example.com' })).toBe('owner@example.com');
    expect(tenantRecordEmail({ pk: 'tenant-a', email: '  owner@example.com  ' })).toBe('owner@example.com');
  });

  test('rejects a string that is not an address', () => {
    expect(tenantRecordEmail({ pk: 'tenant-a', email: 'not-an-address' })).toBeNull();
  });
});

describe('monthly-report-job buildExecutionName', () => {
  test('keeps a normal tenant id intact', () => {
    expect(buildExecutionName('ready-set-cloud', '2026-07', 1754049600000))
      .toBe('ready-set-cloud-2026-07-1754049600000');
  });

  test('replaces characters Step Functions will not take', () => {
    expect(buildExecutionName('tenant a/b', '2026-07', 1754049600000))
      .toBe('tenant_a_b-2026-07-1754049600000');
  });

  test('stays within the 80 character cap for a long tenant id', () => {
    const name = buildExecutionName('t'.repeat(120), '2026-07', 1754049600000);
    expect(name.length).toBe(80);
    expect(name.endsWith('-2026-07-1754049600000')).toBe(true);
  });
});
