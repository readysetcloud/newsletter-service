import { describe, test, expect, jest, afterEach } from '@jest/globals';
import { emitSignupMetric, SIGNUPS_ACCEPTED, SIGNUPS_BLOCKED } from '../utils/signup-metrics.mjs';

const captured = () => JSON.parse(console.log.mock.calls.at(-1)[0]);

describe('signup metrics', () => {
  afterEach(() => jest.restoreAllMocks());

  test('writes one embedded-metric document CloudWatch can extract', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    emitSignupMetric(SIGNUPS_ACCEPTED, 'readysetcloud');
    const doc = captured();
    const [definition] = doc._aws.CloudWatchMetrics;
    expect(definition.Namespace).toBe('Newsletter/Signups');
    expect(definition.Metrics).toEqual([{ Name: 'SignupsAccepted', Unit: 'Count' }]);
    expect(doc).toMatchObject({ TenantId: 'readysetcloud', SignupsAccepted: 1 });
    expect(typeof doc._aws.Timestamp).toBe('number');
  });

  // The empty dimension set is what SignupVelocityAlarm watches: an alarm has
  // to name every dimension value, and the template has no tenant id to name.
  test('emits both a per-tenant and an aggregate series', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    emitSignupMetric(SIGNUPS_BLOCKED, 'readysetcloud');
    expect(captured()._aws.CloudWatchMetrics[0].Dimensions).toEqual([['TenantId'], []]);
  });

  test('a missing tenant still produces a usable document', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    emitSignupMetric(SIGNUPS_ACCEPTED, undefined, 3);
    expect(captured()).toMatchObject({ TenantId: 'unknown', SignupsAccepted: 3 });
  });

  // A signup must never fail because a metric could not be written.
  test('a logging failure is swallowed', () => {
    jest.spyOn(console, 'log').mockImplementation(() => { throw new Error('stream closed'); });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => emitSignupMetric(SIGNUPS_ACCEPTED, 'readysetcloud')).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});
