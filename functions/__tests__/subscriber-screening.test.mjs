import { describe, test, expect, jest } from '@jest/globals';
import { screenSubscriber, checkMailDomain, canReceiveMarketing } from '../utils/subscriber-screening.mjs';

const subscriber = { email: 'reader@gmail.com' };
describe('subscriber screening', () => {
  test('reviews full identity fields even without existing bot flags', async () => {
    const decide = jest.fn(async () => ({ action: 'watch', confidence: 0.95 }));
    const input = { email: 'random.local.part+123@gmail.com', firstName: 'xQzRtYpL', lastName: 'bVnMcXaS', sourceIp: '1.2.3.4', userAgent: 'private-agent' };
    expect(await screenSubscriber(input, { domainStatus: 'valid', decide })).toMatchObject({ action: 'watch', source: 'model' });
    const evidence = decide.mock.calls[0][0];
    expect(evidence).toMatchObject({ email: input.email, firstName: input.firstName, lastName: input.lastName });
    expect(evidence).not.toHaveProperty('sourceIp');
    expect(evidence).not.toHaveProperty('userAgent');
  });
  test('normalizes legacy names and sends null for missing names', async () => {
    const decide = jest.fn(async () => ({ action: 'allow', confidence: 0.95 }));
    await screenSubscriber({ ...subscriber, firstName: '  José\n  García  ', lastName: { invalid: true } }, { domainStatus: 'valid', decide });
    expect(decide.mock.calls[0][0]).toMatchObject({ firstName: 'José García', lastName: null });
    await screenSubscriber({ ...subscriber, firstName: 'x'.repeat(500) }, { domainStatus: 'valid', decide });
    expect(decide.mock.calls[1][0].firstName).toHaveLength(50);
  });
  test('a model rejection based on identity alone stays on watch', async () => {
    expect(await screenSubscriber({ ...subscriber, firstName: 'xQzRtYpL' }, {
      domainStatus: 'valid', decide: async () => ({ action: 'reject', confidence: 0.99 })
    })).toMatchObject({ action: 'watch', modelAction: 'reject' });
  });
  test('confirmed suppression overrides a model and engagement', async () => {
    const decide = jest.fn();
    expect(await screenSubscriber({ ...subscriber, engagementCount: 30 }, { suppressionReason: 'BOUNCE', domainStatus: 'valid', decide }))
      .toMatchObject({ action: 'reject', source: 'evidence', reasons: ['ses_bounce'] });
    expect(decide).not.toHaveBeenCalled();
  });
  test('ordinary subscribers are allowed without a model call', async () => {
    expect(await screenSubscriber(subscriber, { domainStatus: 'valid' })).toMatchObject({ action: 'allow' });
  });
  test('delivery failures and missing DNS are uncertainty, not bot evidence', async () => {
    expect(await screenSubscriber(subscriber, { failedIssues: 2, decide: async () => ({ action: 'reject', confidence: 0.99 }) }))
      .toMatchObject({ action: 'watch', modelAction: 'reject' });
  });
  test.each([null, { action: 'reject', confidence: 2 }, { action: 'reject', confidence: '0.99' }])('invalid model response falls back to watch: %j', async decision => {
    expect(await screenSubscriber(subscriber, { decide: async () => decision })).toMatchObject({ action: 'watch', source: 'rules' });
  });
  test('multiple bot signals may support a confident rejection', async () => {
    expect(await screenSubscriber({ ...subscriber, fastSubmission: true, suspiciousUserAgent: true }, {
      domainStatus: 'valid', decide: async () => ({ action: 'reject', confidence: 0.95 })
    })).toMatchObject({ action: 'reject', source: 'model' });
  });
  test('decision outages fall back to watch', async () => {
    expect(await screenSubscriber(subscriber, { decide: async () => { throw new Error('outage'); } }))
      .toMatchObject({ action: 'watch', reasons: ['dns_uncertain', 'decision_unavailable'] });
  });
  test('pending, rejected and held addresses cannot receive marketing; legacy and watch may', () => {
    for (const action of ['pending', 'reject', 'hold']) expect(canReceiveMarketing({ screening: { action } })).toBe(false);
    for (const action of ['allow', 'watch']) expect(canReceiveMarketing({ screening: { action } })).toBe(true);
    expect(canReceiveMarketing(subscriber)).toBe(true);
  });
  test('null MX is rejected even if the domain hosts a website', async () => {
    expect(await checkMailDomain('example.com', { resolveMx: async () => [{ exchange: '', priority: 0 }] })).toBe('invalid');
  });
  test('implicit MX via address records remains valid', async () => {
    const noData = async () => { throw Object.assign(new Error(), { code: 'ENODATA' }); };
    expect(await checkMailDomain('example.com', { resolveMx: noData, resolve4: async () => ['1.2.3.4'], resolve6: noData })).toBe('valid');
    expect(await checkMailDomain('example.com', { resolveMx: async () => { throw Object.assign(new Error(), { code: 'ETIMEOUT' }); } })).toBe('unknown');
  });
});
