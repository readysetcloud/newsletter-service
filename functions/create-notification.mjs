import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import {
  NOTIFICATION_SEVERITY,
  NOTIFICATION_TYPES,
  buildNotificationItem
} from './utils/notification-record.mjs';

const ddb = new DynamoDBClient();

/** Longest failure reason worth putting in front of someone. */
const MAX_REASON = 240;

const trim = (reason) => {
  const text = String(reason ?? '').trim();
  if (!text) return null;
  return text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1)}…` : text;
};

/** `1,234` rather than `1234`, for counts that appear mid-sentence. */
const count = (value) => Number(value ?? 0).toLocaleString('en-US');

/** Money as it was charged, in the currency it was charged in. */
const money = (amount, currency) => {
  const value = Number(amount ?? 0) / 100;
  const code = String(currency ?? 'usd').toUpperCase();

  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(value);
  } catch {
    // An unknown currency code should not cost someone their notification.
    return `${value.toFixed(2)} ${code}`;
  }
};

/**
 * Turns one event into the notification it deserves, or `null` for an event
 * that is not worth telling anyone about.
 *
 * Every branch returns the same shape, and `dedupeKey` is the part that matters
 * most: it has to name the *thing that happened*, not the delivery. Two
 * deliveries of one report finishing must produce the same key, or the retry
 * shows up as a second notification.
 */
export const renderNotification = (event) => {
  const envelope = event?.detail ?? {};
  const tenantId = envelope.tenantId ?? envelope.tenant?.id;

  if (!tenantId) return null;

  // Two envelope shapes reach here, because the publishers predate this.
  // `publishIssueEvent` nests its payload under `data` and puts `tenantId`
  // beside it; a plain `publishEvent` is flat. Reading through `data` when it
  // is there handles both without asking either publisher to change.
  const detail = envelope.data ?? envelope;

  const base = { tenantId, occurredAt: event.time ?? new Date().toISOString() };

  switch (event['detail-type']) {
    case 'Report Completed': {
      const { reportId, periodLabel, outcome } = detail;
      const label = periodLabel ?? 'Your report';

      if (outcome === 'failed') {
        return {
          ...base,
          dedupeKey: `report:${reportId}:failed`,
          type: NOTIFICATION_TYPES.REPORT_FAILED,
          severity: NOTIFICATION_SEVERITY.ERROR,
          title: 'Report could not be generated',
          message: trim(detail.error)
            ? `${label} failed: ${trim(detail.error)}`
            : `${label} could not be generated.`,
          link: '/reports'
        };
      }

      if (outcome === 'empty') {
        return {
          ...base,
          dedupeKey: `report:${reportId}:empty`,
          type: NOTIFICATION_TYPES.REPORT_EMPTY,
          severity: NOTIFICATION_SEVERITY.INFO,
          title: 'Report has nothing to show',
          message: `No issues went out in ${label}, so there is nothing to report on.`,
          link: '/reports'
        };
      }

      return {
        ...base,
        dedupeKey: `report:${reportId}:ready`,
        type: NOTIFICATION_TYPES.REPORT_READY,
        severity: NOTIFICATION_SEVERITY.SUCCESS,
        title: 'Report ready',
        message: `${label} is ready to read.`,
        link: `/reports/${reportId}`
      };
    }

    case 'Issue Send Completed': {
      // Raised by send-progress.mjs when the last group reports, not by
      // `ISSUE_PUBLISHED` — that one fires at hand-off, which for a scheduled
      // issue is up to twenty-six hours before any mail moves. See
      // `announceSendCompleted`.
      const { issueNumber, subject, recipients } = detail;
      const who = recipients == null
        ? 'your subscribers'
        : `${count(recipients)} subscriber${Number(recipients) === 1 ? '' : 's'}`;

      return {
        ...base,
        dedupeKey: `issue:${issueNumber}:sent`,
        type: NOTIFICATION_TYPES.ISSUE_PUBLISHED,
        severity: NOTIFICATION_SEVERITY.SUCCESS,
        title: 'Issue sent',
        message: `"${subject ?? `Issue ${issueNumber}`}" went out to ${who}.`,
        // The dashboard routes on the bare issue number, as `IssueListItem.id`.
        link: `/issues/${issueNumber}`
      };
    }

    case 'Issue Send Failed': {
      const { issueNumber, subject, error } = detail;
      const reason = trim(error);
      const name = subject ?? `Issue ${issueNumber}`;

      return {
        ...base,
        dedupeKey: `issue:${issueNumber}:failed`,
        type: NOTIFICATION_TYPES.ISSUE_FAILED,
        severity: NOTIFICATION_SEVERITY.ERROR,
        title: 'Issue failed to send',
        message: reason ? `"${name}" did not send: ${reason}` : `"${name}" did not send.`,
        link: `/issues/${issueNumber}`
      };
    }

    case 'Sender Verification Completed': {
      const { senderId, email, domain, outcome } = detail;
      const what = email ?? domain ?? 'Your sender';
      const verified = outcome === 'verified';

      return {
        ...base,
        dedupeKey: `sender:${senderId ?? what}:${verified ? 'verified' : 'failed'}`,
        type: verified ? NOTIFICATION_TYPES.SENDER_VERIFIED : NOTIFICATION_TYPES.SENDER_FAILED,
        severity: verified ? NOTIFICATION_SEVERITY.SUCCESS : NOTIFICATION_SEVERITY.WARNING,
        title: verified ? 'Sender verified' : 'Sender not verified',
        message: verified
          ? `${what} is verified and can send issues.`
          : `${what} could not be verified. Check its DNS records and try again.`,
        link: '/senders'
      };
    }

    // Already published by the billing handlers, and until now consumed by
    // nothing at all. The envelope carries its own notion of type.
    case 'User Notification': {
      const { type } = envelope;
      const data = detail;

      if (type === 'PAYMENT_SUCCEEDED') {
        return {
          ...base,
          dedupeKey: `billing:${data.invoiceId ?? data.subscriptionId}:paid`,
          type: NOTIFICATION_TYPES.BILLING_PAYMENT_SUCCEEDED,
          severity: NOTIFICATION_SEVERITY.SUCCESS,
          title: data.wasRestored ? 'Subscription restored' : 'Payment received',
          message: data.wasRestored
            ? `${money(data.amount, data.currency)} received — your subscription is active again.`
            : `${money(data.amount, data.currency)} received. Thank you.`,
          link: '/billing'
        };
      }

      // Every other billing notification the handlers raise is a failure of
      // some grade, and all of them want the same thing: go fix the card.
      //
      // How final it is comes from the producer, which grades its own failures:
      // `PAYMENT_FINAL_FAILURE` with `isFinalFailure` once Stripe has given up,
      // `PAYMENT_RETRY_FAILED` in between, `PAYMENT_FAILED` first time. There
      // is no `willRetry` field — reading one meant a customer whose
      // subscription was about to be cancelled was told to sit tight.
      const isFinal = type === 'PAYMENT_FINAL_FAILURE' || data.isFinalFailure === true;

      return {
        ...base,
        dedupeKey: `billing:${data.invoiceId ?? data.subscriptionId ?? type}:${type}`,
        type: NOTIFICATION_TYPES.BILLING_PAYMENT_FAILED,
        severity: NOTIFICATION_SEVERITY.ERROR,
        title: isFinal ? 'Subscription at risk' : 'Payment problem',
        // The handlers already write a sentence aimed at the customer, and it
        // knows things this does not — which attempt this was, what happens
        // next. Prefer it, and keep a generic line for the events that carry
        // none.
        message: trim(data.message) ?? (isFinal
          ? 'A payment failed and will not be retried. Update your payment method to keep sending.'
          : 'A payment failed. We will retry, but updating your payment method now avoids interruption.'),
        link: '/billing'
      };
    }

    default:
      return null;
  }
};

/**
 * Writes the notification an event calls for, if it calls for one.
 *
 * The write is conditional on the key not already being there, so a repeated
 * delivery lands on the row it already wrote and stops. That is the whole
 * idempotency story — see `notificationId`.
 *
 * Anything other than that condition is thrown, which is the opposite of what
 * this used to do. The reasoning for swallowing was that a notification must
 * not fail the thing it describes — true, but it was already true: this is a
 * separate Lambda that EventBridge invokes long after the issue went out or
 * the report finished. Nothing here can fail those. What throwing does buy is
 * the retry, and because the write is idempotent the retry is free. Swallowing
 * turned every throttle into a notification nobody would ever see.
 */
export const handler = async (event) => {
  const rendered = renderNotification(event);

  if (!rendered) {
    console.log('No notification for event', {
      detailType: event?.['detail-type'],
      source: event?.source
    });
    return;
  }

  const item = buildNotificationItem(rendered);

  try {
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall(item, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
    }));

    console.log('Wrote notification', { tenantId: rendered.tenantId, id: item.id, type: item.type });
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.log('Notification already written, ignoring duplicate delivery', { id: item.id });
      return;
    }

    console.error('Failed to write notification', {
      id: item.id,
      type: item.type,
      error: error.message
    });

    // Hand it back to EventBridge. The put is conditional on a key derived from
    // the event, so a retry either writes the row or finds it already there.
    throw error;
  }
};

export default handler;
