import { Resolver } from 'node:dns/promises';
import { isValidEmail, isDisposableDomain, disposableDomainSet, isSuspiciousEmailPattern } from './bot-protection.mjs';
import { sanitizeName } from './subscriber-name.mjs';

export const SCREENING_VERSION = 1;
export const canReceiveMarketing = (subscriber) =>
  !['pending', 'reject', 'hold'].includes(subscriber?.screening?.action);

// RFC 5321 permits implicit MX via A/AAAA. DNS outages are uncertainty,
// never proof that a domain is invalid. A null MX explicitly refuses mail.
export async function checkMailDomain(domain, resolver = new Resolver({ timeout: 2000, tries: 2 })) {
  try {
    const mx = await resolver.resolveMx(domain);
    if (mx.some(record => record.exchange && record.exchange !== '.')) return 'valid';
    if (mx.length) return 'invalid';
  } catch (error) {
    if (error.code === 'ENOTFOUND') return 'invalid';
    if (error.code !== 'ENODATA') return 'unknown';
  }
  const results = await Promise.allSettled([resolver.resolve4(domain), resolver.resolve6(domain)]);
  if (results.some(result => result.status === 'fulfilled' && result.value.length)) return 'valid';
  return results.every(result => result.status === 'rejected' && ['ENOTFOUND', 'ENODATA'].includes(result.reason.code))
    ? 'invalid' : 'unknown';
}

/** Pure policy plus an optional, replaceable typed decision function. */
export async function screenSubscriber(subscriber, { suppressionReason, domainStatus = 'unknown', failedIssues = 0, decide } = {}) {
  const reasons = [];
  const result = (action, extra = {}) => ({ version: SCREENING_VERSION, action, reasons, checkedAt: new Date().toISOString(), ...extra });
  if (suppressionReason) reasons.push(`ses_${suppressionReason.toLowerCase()}`);
  if (!isValidEmail(subscriber.email)) reasons.push('invalid_email');
  if (domainStatus === 'invalid') reasons.push('domain_cannot_receive_mail');
  if (reasons.length) return result('reject', { source: 'evidence' });
  const flags = ['honeypotTriggered', 'disposableDomain', 'suspiciousUserAgent', 'unknownIp', 'fastSubmission', 'suspiciousEmailPattern'];
  for (const flag of flags) if (subscriber[flag] === true) reasons.push(flag);
  if (isDisposableDomain(subscriber.email, disposableDomainSet) && !reasons.includes('disposableDomain')) reasons.push('disposableDomain');
  if (isSuspiciousEmailPattern(subscriber.email) && !reasons.includes('suspiciousEmailPattern')) reasons.push('suspiciousEmailPattern');
  if (failedIssues > 0) reasons.push('previous_delivery_failure');
  if (domainStatus === 'unknown') reasons.push('dns_uncertain');
  // A clean set of existing flags does not rule out randomized names or
  // address patterns. When enabled, the model reviews those signups too.
  if (!reasons.length && !decide) return result('allow', { source: 'rules' });
  if (decide) {
    try {
      // Names are normalized again for legacy/imported records. Keep the full
      // address so the model can assess its local part alongside the names.
      const decision = await decide({
        email: subscriber.email,
        firstName: sanitizeName(subscriber.firstName),
        lastName: sanitizeName(subscriber.lastName),
        domain: subscriber.email.split('@')[1]?.slice(0, 253),
        reasons, failedIssues, domainStatus,
        elapsedMs: subscriber.elapsedMs,
        requestCountInWindow: subscriber.requestCountInWindow,
        engagementCount: subscriber.engagementCount || 0
      });
      if (!['allow', 'watch', 'reject'].includes(decision?.action) || !Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) throw new Error('Invalid decision');
      // Model confidence is not calibrated evidence of mailbox validity.
      // Only multiple independent bot signals may support a model rejection.
      const botSignals = reasons.filter(reason => flags.includes(reason)).length;
      const action = decision.confidence < 0.9 || (decision.action === 'reject' && botSignals < 2)
        ? 'watch' : decision.action;
      return result(action, { source: 'model', modelAction: decision.action, confidence: decision.confidence,
        ...(typeof decision.explanation === 'string' && { explanation: decision.explanation.slice(0, 400) }),
        ...(decision.model && { model: decision.model }) });
    } catch {
      reasons.push('decision_unavailable');
    }
  }
  return result('watch', { source: 'rules' });
}
