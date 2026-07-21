import { jest } from '@jest/globals';
import { handler } from '../parse-json-issue.mjs';

describe('parse-json-issue handler', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-19T09:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('parses JSON content and forces metadata.number to the issue id', async () => {
    const result = await handler({
      content: JSON.stringify({ metadata: { title: 'Hello' }, content: { sections: [] } }),
      issueId: 7,
      subject: 'My Subject'
    });

    expect(result.data.metadata.number).toBe(7);
    expect(result.data.metadata.title).toBe('Hello');
    expect(result.subject).toBe('My Subject');
  });

  it('accepts an already-parsed object as content', async () => {
    const result = await handler({
      content: { metadata: { title: 'Hello' } },
      issueId: 3,
      subject: 'Subj'
    });

    expect(result.data.metadata.number).toBe(3);
  });

  it('defaults sendAtDate to "now" when there is no future date', async () => {
    const result = await handler({
      content: JSON.stringify({ metadata: {} }),
      issueId: 1,
      subject: 'Subj'
    });

    expect(result.sendAtDate).toBe('now');
    // Cleanup +3 days and report +5 days from the send day at 14:00.
    expect(result.listCleanupDate).toBe('2026-06-22T14:00:00');
    expect(result.reportStatsDate).toBe('2026-06-24T14:00:00');
  });

  it('uses the future date for scheduling when it is ahead of now', async () => {
    const result = await handler({
      content: JSON.stringify({ metadata: {} }),
      issueId: 1,
      subject: 'Subj',
      futureDate: '2026-07-01T12:00:00Z'
    });

    expect(result.sendAtDate).toBe(new Date('2026-07-01T12:00:00Z').toISOString());
    expect(result.listCleanupDate).toBe('2026-07-04T14:00:00');
    expect(result.reportStatsDate).toBe('2026-07-06T14:00:00');
  });

  it('falls back to the data title for the subject when none is supplied', async () => {
    const result = await handler({
      content: JSON.stringify({ metadata: { title: 'From Data' } }),
      issueId: 2
    });

    expect(result.subject).toBe('From Data');
  });

  it('throws for invalid JSON content', async () => {
    await expect(
      handler({ content: 'not json', issueId: 1, subject: 'Subj' })
    ).rejects.toThrow(/not valid JSON/);
  });

  it('throws for non-object JSON content', async () => {
    await expect(
      handler({ content: JSON.stringify([1, 2, 3]), issueId: 1, subject: 'Subj' })
    ).rejects.toThrow(/must be a JSON object/);
  });

  it('throws for an invalid issue id', async () => {
    await expect(
      handler({ content: JSON.stringify({ metadata: {} }), issueId: 'abc', subject: 'Subj' })
    ).rejects.toThrow(/Invalid or missing issueId/);
  });
});
