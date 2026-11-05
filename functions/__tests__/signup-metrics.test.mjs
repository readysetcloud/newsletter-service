import { describe, test, expect, jest, afterEach } from '@jest/globals';
import { emitSignupMetric, SIGNUPS_ACCEPTED, SIGNUPS_BLOCKED } from '../utils/signup-metrics.mjs';

// The metric document goes to the file descriptor, not through console, so
// that Lambda's JSON log format cannot nest it under `message` and hide the
// `_aws` block from the EMF extractor. The tests read the same way.
const stubStdout = () => jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
const written = () => process.stdout.write.mock.calls.at(-1)[0];
const captured = () => JSON.parse(written());

describe('signup metrics', () => {
  afterEach(() => jest.restoreAllMocks());

  test('writes one embedded-metric document CloudWatch can extract', () => {
    stubStdout();
    emitSignupMetric(SIGNUPS_ACCEPTED, 'readysetcloud');
    const doc = captured();
    const [definition] = doc._aws.CloudWatchMetrics;
    expect(definition.Namespace).toBe('Newsletter/Signups');
    expect(definition.Metrics).toEqual([{ Name: 'SignupsAccepted', Unit: 'Count' }]);
    expect(doc).toMatchObject({ TenantId: 'readysetcloud', SignupsAccepted: 1 });
    expect(typeof doc._aws.Timestamp).toBe('number');
  });

  // EMF is read a line at a time, so the document has to be terminated and has
  // to be the whole line. console.log supplied the newline; stdout does not.
  test('the document is a single newline-terminated line', () => {
    stubStdout();
    emitSignupMetric(SIGNUPS_ACCEPTED, 'readysetcloud');
    const raw = written();
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.trimEnd()).not.toContain('\n');
  });

  // Nothing may reach the console on the success path: a stray console.log in
  // this function is exactly the wrapping the stdout write exists to avoid.
  test('bypasses console entirely', () => {
    stubStdout();
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    emitSignupMetric(SIGNUPS_ACCEPTED, 'readysetcloud');
    expect(log).not.toHaveBeenCalled();
    expect(process.stdout.write).toHaveBeenCalledTimes(1);
  });

  // The empty dimension set is the one that can be queried without knowing a
  // tenant id, which is what a "how many signups, and when" question needs.
  test('emits both a per-tenant and an aggregate series', () => {
    stubStdout();
    emitSignupMetric(SIGNUPS_BLOCKED, 'readysetcloud');
    expect(captured()._aws.CloudWatchMetrics[0].Dimensions).toEqual([['TenantId'], []]);
  });

  test('a missing tenant still produces a usable document', () => {
    stubStdout();
    emitSignupMetric(SIGNUPS_ACCEPTED, undefined, 3);
    expect(captured()).toMatchObject({ TenantId: 'unknown', SignupsAccepted: 3 });
  });

  // A signup must never fail because a metric could not be written.
  test('a write failure is swallowed', () => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => { throw new Error('stream closed'); });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => emitSignupMetric(SIGNUPS_ACCEPTED, 'readysetcloud')).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});
