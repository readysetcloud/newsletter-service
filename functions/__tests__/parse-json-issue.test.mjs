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
    // Cleanup +3 days and report +5 days from the send instant. Sending "now"
    // makes that the current time (the suite's fake clock, 09:00Z) rather than
    // a fixed hour of the day.
    expect(result.listCleanupDate).toBe('2026-06-22T09:00:00');
    expect(result.reportStatsDate).toBe('2026-06-24T09:00:00');
  });

  it('uses the future date for scheduling when it is ahead of now', async () => {
    const result = await handler({
      content: JSON.stringify({ metadata: {} }),
      issueId: 1,
      subject: 'Subj',
      futureDate: '2026-07-01T12:00:00Z'
    });

    expect(result.sendAtDate).toBe(new Date('2026-07-01T12:00:00Z').toISOString());
    // Offsets follow the scheduled send, so they track the time the issue
    // actually goes out instead of a hardcoded 14:00.
    expect(result.listCleanupDate).toBe('2026-07-04T12:00:00');
    expect(result.reportStatsDate).toBe('2026-07-06T12:00:00');
  });

  // The whole reason a publish lead time is safe. The workflow now starts at
  // (send instant - lead time), so "now" is earlier than the send and a json
  // issue has no send date of its own anywhere in its content: without `sendAt`
  // this returns 'now' and the issue publishes as soon as the early workflow
  // runs. The scheduler offsets have to follow it too, or list cleanup and the
  // stats report fire a lead time early, days later, with nothing watching.
  it('uses the forwarded send instant when the workflow starts early', async () => {
    const result = await handler({
      content: JSON.stringify({ metadata: {} }),
      issueId: 1,
      subject: 'Subj',
      sendAt: '2026-06-20T09:00:00+00:00'
    });

    expect(result.sendAtDate).toBe(new Date('2026-06-20T09:00:00Z').toISOString());
    expect(result.listCleanupDate).toBe('2026-06-23T09:00:00');
    expect(result.reportStatsDate).toBe('2026-06-25T09:00:00');
  });

  // `futureDate` is the older field and only a caller outside the state machine
  // can still send it, so `sendAt` - which comes off the issue's own schedule -
  // wins when both are present.
  it('prefers sendAt over a futureDate', async () => {
    const result = await handler({
      content: JSON.stringify({ metadata: {} }),
      issueId: 1,
      subject: 'Subj',
      sendAt: '2026-06-20T09:00:00Z',
      futureDate: '2026-07-01T12:00:00Z'
    });

    expect(result.sendAtDate).toBe(new Date('2026-06-20T09:00:00Z').toISOString());
  });

  // A send instant already in the past is not a future send: an immediate
  // publish carries `sendAt: null` and this is the shape a zero lead time
  // produces, where the workflow starts a moment after the instant it was
  // scheduled for.
  it('still says "now" for a send instant that has passed', async () => {
    const result = await handler({
      content: JSON.stringify({ metadata: {} }),
      issueId: 1,
      subject: 'Subj',
      sendAt: '2026-06-19T08:59:00Z'
    });

    expect(result.sendAtDate).toBe('now');
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

  describe('html mode', () => {
    it('carries a pre-rendered master through on data.__master without parsing', async () => {
      const master = '<html><body>hi __EMAIL_HASH__</body></html>';
      const result = await handler({
        content: master,
        contentType: 'html',
        issueId: 9,
        subject: 'HTML Subject'
      });

      expect(result.data.__master).toBe(master);
      expect(result.data.metadata.number).toBe(9);
      expect(result.subject).toBe('HTML Subject');
      expect(result.sendAtDate).toBe('now');
    });

    it('does not JSON-parse html content (non-JSON is fine)', async () => {
      const result = await handler({
        content: 'not json at all <b>ok</b>',
        contentType: 'html',
        issueId: 5,
        subject: 'S'
      });

      expect(result.data.__master).toBe('not json at all <b>ok</b>');
      expect(result.data.metadata.number).toBe(5);
    });
  });

  it('throws for an invalid issue id', async () => {
    await expect(
      handler({ content: JSON.stringify({ metadata: {} }), issueId: 'abc', subject: 'Subj' })
    ).rejects.toThrow(/Invalid or missing issueId/);
  });
});
