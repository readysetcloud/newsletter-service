import { jest } from '@jest/globals';
import { renderNotification } from '../functions/create-notification.mjs';
import {
  NOTIFICATION_TYPES,
  notificationId,
  notificationIdFromSortKey,
  notificationSortKey,
  buildNotificationItem
} from '../functions/utils/notification-record.mjs';

/**
 * Turning an event into a notification.
 *
 * Two things here are easy to get wrong and expensive to get wrong quietly.
 * The first is the envelope: `publishIssueEvent` nests its payload under
 * `data` while a plain `publishEvent` is flat, so a renderer that reads one
 * shape silently produces "Issue undefined went out to your subscribers".
 * The second is the deep link — the issue event's `issueId` is the composite
 * key, and the dashboard routes on the bare number, so the obvious field is
 * the wrong one.
 */

const EVENT_TIME = '2026-09-13T10:30:00.000Z';

const event = (detailType, detail, source = 'newsletter-service') => ({
  source,
  'detail-type': detailType,
  time: EVENT_TIME,
  detail
});

/** The shape `publishIssueEvent` actually puts on the bus. */
const issueEvent = (detailType, data, type = detailType) =>
  event(detailType, { tenantId: 'readysetcloud', userId: 'u1', type, data });

describe('events that produce nothing', () => {
  it('ignores an event for no tenant, rather than writing an orphan', () => {
    expect(renderNotification(event('Report Completed', { reportId: '2026-08' }))).toBeNull();
  });

  it('ignores a detail-type it does not know', () => {
    expect(renderNotification(event('Something Else', { tenantId: 't' }))).toBeNull();
  });

  it('survives an event with no detail at all', () => {
    expect(renderNotification({ 'detail-type': 'Report Completed' })).toBeNull();
  });
});

describe('reports', () => {
  const report = (over) =>
    renderNotification(event('Report Completed', {
      tenantId: 'readysetcloud',
      reportId: '2026-08',
      periodLabel: 'August 2026',
      ...over
    }));

  it('links a ready report straight to itself', () => {
    const rendered = report({ outcome: 'ready' });

    expect(rendered.type).toBe(NOTIFICATION_TYPES.REPORT_READY);
    expect(rendered.severity).toBe('success');
    expect(rendered.link).toBe('/reports/2026-08');
    expect(rendered.message).toContain('August 2026');
  });

  it('treats an empty range as an answer, not a failure', () => {
    const rendered = report({ outcome: 'empty' });

    expect(rendered.type).toBe(NOTIFICATION_TYPES.REPORT_EMPTY);
    expect(rendered.severity).toBe('info');
    expect(rendered.message).toMatch(/no issues went out/i);
  });

  it('says why a report failed when it knows', () => {
    const rendered = report({ outcome: 'failed', error: 'Bedrock throttled the request' });

    expect(rendered.type).toBe(NOTIFICATION_TYPES.REPORT_FAILED);
    expect(rendered.severity).toBe('error');
    expect(rendered.message).toContain('Bedrock throttled the request');
  });

  it('still says something useful when it does not know why', () => {
    const rendered = report({ outcome: 'failed' });

    expect(rendered.message).toMatch(/could not be generated/i);
  });

  it('sends a failed report to the list, not to a report that is not there', () => {
    expect(report({ outcome: 'failed' }).link).toBe('/reports');
  });

  it('truncates a reason too long to read', () => {
    const rendered = report({ outcome: 'failed', error: 'x'.repeat(500) });

    expect(rendered.message.length).toBeLessThan(320);
    expect(rendered.message).toMatch(/…$/);
  });
});

describe('issues', () => {
  it('reads the payload through the `data` envelope publishIssueEvent uses', () => {
    const rendered = renderNotification(issueEvent('ISSUE_PUBLISHED', {
      issueId: 'readysetcloud#232',
      issueNumber: 232,
      subject: 'Picks of the Week #232',
      subscriberCount: 1450
    }));

    expect(rendered.title).toBe('Issue sent');
    expect(rendered.message).toContain('Picks of the Week #232');
  });

  it('links on the issue number, not the composite key the event carries', () => {
    // `/issues/readysetcloud#232` is not a route; `/issues/232` is.
    const rendered = renderNotification(issueEvent('ISSUE_PUBLISHED', {
      issueId: 'readysetcloud#232',
      issueNumber: 232,
      subject: 'Anything'
    }));

    expect(rendered.link).toBe('/issues/232');
  });

  it('formats the audience with a thousands separator', () => {
    const rendered = renderNotification(issueEvent('ISSUE_PUBLISHED', {
      issueNumber: 9,
      subject: 'S',
      subscriberCount: 12345
    }));

    expect(rendered.message).toContain('12,345 subscribers');
  });

  it('says "1 subscriber", not "1 subscribers"', () => {
    const rendered = renderNotification(issueEvent('ISSUE_PUBLISHED', {
      issueNumber: 9,
      subject: 'S',
      subscriberCount: 1
    }));

    expect(rendered.message).toContain('1 subscriber.');
  });

  it('avoids inventing a number when the count is missing', () => {
    const rendered = renderNotification(issueEvent('ISSUE_PUBLISHED', {
      issueNumber: 9,
      subject: 'S'
    }));

    expect(rendered.message).toContain('your subscribers');
    expect(rendered.message).not.toContain('0 subscribers');
  });

  it('ignores an analytics rebuild, which is not an issue going out', () => {
    // `POST /issues/{id}/analytics/rebuild` republishes ISSUE_PUBLISHED purely
    // to re-trigger aggregation. Announcing it would tell someone their
    // newsletter had been sent again every time they rebuilt a chart — and
    // with a fresh event time, so every rebuild would be a new notification.
    const rendered = renderNotification(issueEvent('ISSUE_PUBLISHED', {
      issueNumber: 232,
      publishedAt: '2026-09-01T00:00:00.000Z',
      title: 'Picks of the Week #232',
      reason: 'analytics-rebuild'
    }));

    expect(rendered).toBeNull();
  });

  it('reads `title` when the producer used that instead of `subject`', () => {
    // The two publishers of this event disagree on the field name. Reading
    // only one of them renders a notification about "Issue undefined".
    const rendered = renderNotification(issueEvent('ISSUE_PUBLISHED', {
      issueNumber: 232,
      title: 'Picks of the Week #232'
    }));

    expect(rendered.message).toContain('Picks of the Week #232');
  });

  it('reports a failed send as an error worth acting on', () => {
    const rendered = renderNotification(event('Issue Send Failed', {
      tenantId: 'readysetcloud',
      issueNumber: 233,
      subject: 'Picks #233',
      error: 'No verified sender'
    }));

    expect(rendered.type).toBe(NOTIFICATION_TYPES.ISSUE_FAILED);
    expect(rendered.severity).toBe('error');
    expect(rendered.message).toContain('No verified sender');
    expect(rendered.link).toBe('/issues/233');
  });
});

describe('senders', () => {
  it('celebrates a verified sender', () => {
    const rendered = renderNotification(event('Sender Verification Completed', {
      tenantId: 'readysetcloud',
      senderId: 's1',
      email: 'allen@readysetcloud.io',
      outcome: 'verified'
    }));

    expect(rendered.type).toBe(NOTIFICATION_TYPES.SENDER_VERIFIED);
    expect(rendered.message).toContain('allen@readysetcloud.io');
  });

  it('treats a failed verification as a warning, since nothing is broken yet', () => {
    const rendered = renderNotification(event('Sender Verification Completed', {
      tenantId: 'readysetcloud',
      senderId: 's1',
      domain: 'readysetcloud.io',
      outcome: 'failed'
    }));

    expect(rendered.type).toBe(NOTIFICATION_TYPES.SENDER_FAILED);
    expect(rendered.severity).toBe('warning');
    expect(rendered.message).toContain('readysetcloud.io');
  });
});

describe('billing, which has been publishing into the void until now', () => {
  const billing = (type, data) =>
    renderNotification(event('User Notification', {
      tenantId: 'readysetcloud',
      userId: 'u1',
      type,
      data
    }, 'newsletter.billing'));

  it('renders a successful payment in the currency it was taken in', () => {
    const rendered = billing('PAYMENT_SUCCEEDED', {
      invoiceId: 'in_1',
      amount: 4900,
      currency: 'usd'
    });

    expect(rendered.type).toBe(NOTIFICATION_TYPES.BILLING_PAYMENT_SUCCEEDED);
    expect(rendered.message).toContain('$49.00');
  });

  it('says so when a payment restored a lapsed subscription', () => {
    const rendered = billing('PAYMENT_SUCCEEDED', {
      invoiceId: 'in_1',
      amount: 4900,
      currency: 'usd',
      wasRestored: true
    });

    expect(rendered.title).toBe('Subscription restored');
  });

  it('does not lose the notification over a currency code it cannot format', () => {
    const rendered = billing('PAYMENT_SUCCEEDED', {
      invoiceId: 'in_1',
      amount: 4900,
      currency: 'not-a-currency'
    });

    expect(rendered).not.toBeNull();
    expect(rendered.message).toContain('49.00');
  });

  it('prefers the sentence the producer already wrote for the customer', () => {
    // The handlers know which attempt this was and what happens next. That
    // beats anything this can infer.
    const rendered = billing('PAYMENT_FINAL_FAILURE', {
      invoiceId: 'in_2',
      isFinalFailure: true,
      message: 'Your subscription will be cancelled due to repeated payment failures.'
    });

    expect(rendered.message).toBe(
      'Your subscription will be cancelled due to repeated payment failures.'
    );
  });

  it('does not promise a retry on a failure the producer called final', () => {
    // The producer signals finality with the type and `isFinalFailure`; there
    // is no `willRetry` field. Reading one told a customer whose subscription
    // was about to be cancelled to sit tight.
    const rendered = billing('PAYMENT_FINAL_FAILURE', {
      invoiceId: 'in_2',
      isFinalFailure: true
    });

    expect(rendered.title).toBe('Subscription at risk');
    expect(rendered.message).toMatch(/will not be retried/i);
    expect(rendered.message).not.toMatch(/we will retry/i);
  });

  it('treats isFinalFailure as final even under another type', () => {
    const rendered = billing('PAYMENT_RETRY_FAILED', {
      invoiceId: 'in_2',
      isFinalFailure: true
    });

    expect(rendered.message).toMatch(/will not be retried/i);
  });

  it('is gentler about an early failure that will be retried', () => {
    const rendered = billing('PAYMENT_FAILED', {
      invoiceId: 'in_2',
      isFirstFailure: true,
      isFinalFailure: false
    });

    expect(rendered.title).toBe('Payment problem');
    expect(rendered.message).toMatch(/we will retry/i);
  });
});

describe('idempotency', () => {
  it('gives two deliveries of one event the same id', () => {
    // EventBridge delivers at least once and keeps `time` stable across
    // retries. That is the whole reason the id is built from it.
    const delivery = () => renderNotification(event('Report Completed', {
      tenantId: 'readysetcloud',
      reportId: '2026-08',
      periodLabel: 'August 2026',
      outcome: 'ready'
    }));

    const first = buildNotificationItem(delivery());
    const second = buildNotificationItem(delivery());

    expect(first.sk).toBe(second.sk);
  });

  it('gives two different events different ids', () => {
    const ready = buildNotificationItem(renderNotification(event('Report Completed', {
      tenantId: 'readysetcloud', reportId: '2026-08', outcome: 'ready'
    })));
    const failed = buildNotificationItem(renderNotification(event('Report Completed', {
      tenantId: 'readysetcloud', reportId: '2026-08', outcome: 'failed'
    })));

    expect(ready.sk).not.toBe(failed.sk);
  });

  it('would write a fresh notification if the clock were used instead of the event', () => {
    // Guards the reason `occurredAt` is the event's time: swap in `Date.now()`
    // and every retry becomes a new row.
    const withClock = notificationId(new Date(), 'report:2026-08:ready');
    const withEvent = notificationId(EVENT_TIME, 'report:2026-08:ready');

    expect(withClock).not.toBe(withEvent);
  });
});

describe('the stored shape', () => {
  const item = () => buildNotificationItem(renderNotification(event('Report Completed', {
    tenantId: 'readysetcloud',
    reportId: '2026-08',
    periodLabel: 'August 2026',
    outcome: 'ready'
  })));

  it('partitions by tenant', () => {
    expect(item().pk).toBe('readysetcloud#notification');
  });

  it('sorts chronologically, because the id leads with epoch millis', () => {
    const earlier = notificationSortKey(notificationId('2026-09-13T10:00:00Z', 'a'));
    const later = notificationSortKey(notificationId('2026-09-13T11:00:00Z', 'a'));

    expect(earlier < later).toBe(true);
  });

  it('leaves readAt off entirely, since unread is an absent attribute', () => {
    // `attribute_not_exists(readAt)` is what the API filters on; an explicit
    // null would make every notification read forever.
    expect('readAt' in item()).toBe(false);
  });

  it('sets a ttl in the future', () => {
    expect(item().ttl).toBeGreaterThan(Date.now() / 1000);
  });

  it('round-trips an id through its sort key', () => {
    const id = notificationId(EVENT_TIME, 'report:2026-08:ready');

    expect(notificationIdFromSortKey(notificationSortKey(id))).toBe(id);
  });

  it('keeps a dedupe key safe for a sort key and a URL path', () => {
    const id = notificationId(EVENT_TIME, 'issue:readysetcloud#232/weird?');

    expect(id).not.toMatch(/[#/?]/);
  });
});

describe('the handler', () => {
  const load = async () => {
    let send;
    let handler;

    await jest.isolateModulesAsync(async () => {
      send = jest.fn().mockResolvedValue({});

      jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
        DynamoDBClient: jest.fn(() => ({ send })),
        PutItemCommand: jest.fn((params) => ({ __type: 'PutItem', ...params }))
      }));

      ({ handler } = await import('../functions/create-notification.mjs'));
    });

    return { send, handler };
  };

  const readyEvent = event('Report Completed', {
    tenantId: 'readysetcloud',
    reportId: '2026-08',
    periodLabel: 'August 2026',
    outcome: 'ready'
  });

  beforeEach(() => jest.resetModules());

  it('writes only if the row is not already there', async () => {
    const { send, handler } = await load();

    await handler(readyEvent);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].ConditionExpression)
      .toBe('attribute_not_exists(pk) AND attribute_not_exists(sk)');
  });

  it('writes nothing for an event it does not recognise', async () => {
    const { send, handler } = await load();

    await handler(event('Unknown Thing', { tenantId: 't' }));

    expect(send).not.toHaveBeenCalled();
  });

  it('swallows a duplicate delivery instead of failing the event', async () => {
    const { send, handler } = await load();
    send.mockRejectedValue(Object.assign(new Error('exists'), {
      name: 'ConditionalCheckFailedException'
    }));

    await expect(handler(readyEvent)).resolves.toBeUndefined();
  });

  it('does not throw when the write fails for a real reason', async () => {
    // Publishing an issue succeeded whether or not anyone was told about it.
    // Throwing here only buys a retry that cannot do better.
    const { send, handler } = await load();
    send.mockRejectedValue(new Error('Throughput exceeded'));

    await expect(handler(readyEvent)).resolves.toBeUndefined();
  });
});
