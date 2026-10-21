import { recordDeliveryOutcome } from '../utils/delivery-health.mjs';

export function resolveDeliveryTenant(detail) {
  const tagged = detail.mail?.tags?.tenantId?.[0];
  if (tagged) return tagged;
  const reference = detail.mail?.tags?.referenceNumber?.[0];
  const separator = reference?.lastIndexOf('_') ?? -1;
  return separator > 0 ? reference.slice(0, separator) : null;
}

export const handler = async (event) => {
  const detail = event?.detail;
  const tenantId = detail && resolveDeliveryTenant(detail);
  const type = detail?.eventType?.toLowerCase();
  // Tenant tags are emitted only for marketing. Reference tags cover older
  // issue sends. Administrative mail must never remove a subscription.
  if (!tenantId || !['bounce', 'delivery'].includes(type)) return;
  if (!detail.mail.messageId || !Number.isFinite(Date.parse(detail.mail.timestamp))) {
    throw new Error('Delivery health requires SES message identity and send timestamp');
  }
  const sentAt = new Date(detail.mail.timestamp).toISOString();
  const reference = detail.mail.tags?.referenceNumber?.[0];
  const separator = reference?.lastIndexOf('_') ?? -1;
  const issuePk = separator > 0 && /^\d+$/.test(reference.slice(separator + 1)) && reference.slice(0, separator) === tenantId
    ? `${tenantId}#${Number(reference.slice(separator + 1))}` : null;
  const recipients = type === 'bounce' ? detail.bounce?.bouncedRecipients?.map(recipient => recipient.emailAddress) :
    detail.delivery?.recipients || detail.mail.destination;
  if (!recipients?.length || recipients.some(email => typeof email !== 'string' || !email.includes('@'))) {
    throw new Error('Delivery health event has no valid affected recipients');
  }
  let kind = 'delivery';
  if (type === 'bounce') {
    const bounce = detail.bounce;
    kind = bounce?.bounceSubType?.toLowerCase() === 'suppressed' ? 'suppressed' :
      bounce?.bounceType?.toLowerCase() === 'permanent' ? 'permanent' :
        bounce?.bounceType?.toLowerCase() === 'transient' ? 'temporary' : 'unknown';
  }
  for (const email of new Set(recipients.map(email => email.trim().toLowerCase()))) {
    await recordDeliveryOutcome(tenantId, email, { id: detail.mail.messageId, sentAt, kind, ...(issuePk && { issuePk }) });
  }
};
