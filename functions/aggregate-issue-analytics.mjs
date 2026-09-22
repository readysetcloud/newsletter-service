import { DynamoDBClient, QueryCommand, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import { decrypt, getTenant } from './utils/helpers.mjs';
import { classifyScannerClicks } from './utils/scanner-clicks.mjs';

const ddb = new DynamoDBClient();
const eventBridge = new EventBridgeClient();

export const handler = async (event) => {
  const { tenantId, issueNumber, publishedAt } = event;

  if (!tenantId || !issueNumber || !publishedAt) {
    console.error('Missing required parameters:', { tenantId, issueNumber, publishedAt });
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Missing required parameters: tenantId, issueNumber, publishedAt' })
    };
  }

  // A local-send issue is still delivering long after it is handed off: the
  // groups fan out across the better part of a day and the catch-all sweeps 30
  // minutes behind the last of them. Aggregating before that finishes counts
  // not-yet-sent subscribers in `deliveries` with no chance to have opened,
  // which deflates open rate - and the harder the issue was personalised, the
  // worse it reads.
  //
  // Deferring has to re-book the run itself, not rely on being retried.
  //
  // Scheduler's RetryPolicy governs *delivery* to the target, and an async
  // Lambda invoke is delivered the moment Lambda accepts it - a later
  // exception is Lambda's async retry (two attempts, about a minute apart),
  // which a fan-out lasting hours outlives easily. Simply returning is no
  // better: it consumes the run, leaving the fan-out and completion
  // announcements as the only things that could book another, and both swallow
  // PutEvents failures by design.
  //
  // So this re-announces the plan's own `catchAllAt`, which
  // schedule-aggregation already knows how to turn into a window. It is the
  // same event the fan-out sends and the handling is idempotent, so a
  // redelivery costs one schedule update. Sits outside the try below because
  // that catch turns a throw into a `{statusCode: 500}` return value, which to
  // an asynchronous invoker is a success.
  const pk = `${tenantId}#${issueNumber}`;
  const progress = await readSendProgress(pk);

  if (progress && !progress.completedAt && !isSendOverdue(progress)) {
    await rebookForInFlightSend(pk, tenantId, issueNumber, progress);
    return {
      success: false,
      message: 'Send still in flight - aggregation re-booked for after the catch-all',
      issueNumber
    };
  }

  if (progress && !progress.completedAt) {
    // Past its own catch-all and still not complete: this send is not going to
    // finish. Deferring again would re-book for `catchAllAt + 24h`, which is
    // now in the past, and `ensureFutureScheduleTime` floors a past time at a
    // minute from now - so the run would come straight back, defer again, and
    // spin every minute for as long as the record stayed incomplete.
    //
    // Aggregating what did send is the better failure: the numbers undercount
    // a delivery that genuinely did not happen, which is true, and the issue
    // gets analytics instead of an endless loop and none.
    console.error(`Send for ${pk} is past its catch-all and still incomplete - aggregating what delivered`, {
      catchAllAt: progress.catchAllAt
    });
  }

  try {
    const sk = 'stats';

    // ALL_NEW so the realtime counters come back on the claim itself — the
    // anomaly check below reads them and would otherwise need its own GetItem.
    let counters = {};
    try {
      const claim = await ddb.send(new UpdateItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({ pk, sk }),
        UpdateExpression: 'SET statsPhase = :aggregating',
        ConditionExpression: 'attribute_not_exists(statsPhase) OR (statsPhase <> :consolidated AND statsPhase <> :aggregating)',
        ExpressionAttributeValues: marshall({
          ':aggregating': 'aggregating',
          ':consolidated': 'consolidated'
        }),
        ReturnValues: 'ALL_NEW'
      }));
      counters = claim.Attributes ? unmarshall(claim.Attributes) : {};
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        console.log(`Aggregation already in progress or completed for ${pk}`);
        return {
          success: false,
          message: 'Aggregation already in progress or completed',
          issueNumber
        };
      }
      throw err;
    }

    const events = await queryAllEventsParallel(ddb, tenantId, issueNumber);

    console.log(`Aggregating analytics for ${pk}: ${events.clicks.length} clicks, ${events.opens.length} opens, ${events.bounces.length} bounces, ${events.complaints.length} complaints`);

    const abTestSummary = await calculateAbTestSummary(ddb, tenantId, issueNumber);

    const analytics = {
      links: calculateLinkPerformance(events.clicks),
      clickDecay: calculateClickDecay(events.clicks, publishedAt),
      openDecay: calculateOpenDecay(events.opens, publishedAt),
      geoDistribution: calculateGeoDistribution(events.clicks, events.opens),
      deviceBreakdown: calculateDeviceBreakdown(events.opens),
      timingMetrics: calculateTimingMetrics(events.opens, events.clicks, publishedAt),
      engagementType: await calculateEngagementType(events.clicks, ddb, tenantId),
      trafficSource: calculateTrafficSource(events.clicks),
      // Reported alongside the raw counters, never subtracted from them. The
      // anomaly check below reads `clicks` and treats scanner traffic as the
      // floor that separates a dead click path from a quiet week.
      clickQuality: classifyScannerClicks(events.clicks).summary,
      bounceReasons: calculateBounceReasons(events.bounces),
      complaintDetails: formatComplaintDetails(events.complaints),
      ...(abTestSummary && { abTest: abTestSummary })
    };

    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk, sk }),
      UpdateExpression: 'SET analytics = :analytics, statsPhase = :phase, consolidatedAt = :now, aggregationVersion = :version',
      ExpressionAttributeValues: marshall({
        ':analytics': analytics,
        ':phase': 'consolidated',
        ':now': new Date().toISOString(),
        // 1.1: open/click timing is anchored to each recipient's own send
        // instant rather than the issue-wide publish, and aggregation waits for
        // a local send to finish fanning out. Records below this version can
        // hold a deflated open rate for any locally-sent issue, so anything
        // comparing issues across the boundary has to account for it.
        ':version': '1.1'
      })
    }));

    console.log(`Successfully consolidated analytics for ${pk}`);

    await reportCounterAnomalies(tenantId, issueNumber, counters);

    return {
      success: true,
      issueNumber,
      eventCounts: {
        clicks: events.clicks.length,
        opens: events.opens.length,
        bounces: events.bounces.length,
        complaints: events.complaints.length
      }
    };
  } catch (err) {
    console.error('Aggregation error:', err);

    try {
      const sk = 'stats';
      await ddb.send(new UpdateItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({ pk, sk }),
        UpdateExpression: 'REMOVE statsPhase'
      }));
      console.log(`Reset statsPhase for ${pk} after error`);
    } catch (resetErr) {
      console.error('Failed to reset statsPhase:', resetErr);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Aggregation failed', error: err.message })
    };
  }
};

// A zero only means something once there is enough volume above it for the zero
// to be implausible. Below these, zero is ordinary: a handful of recipients can
// all decline the tracking pixel, and a lightly-opened issue genuinely may go
// unclicked. Both are set against this tenant's own history, where the lowest
// issue that recorded clicks did so on 30 opens from 64 deliveries (#200, 23
// clicks). Every issue these would have fired on — #174-177, all ~1,270
// delivered with 45-163 opens and no clicks at all, and #226 — was in fact
// broken.
const MIN_DELIVERIES_TO_EXPECT_AN_OPEN = 50;
const MIN_OPENS_TO_EXPECT_A_CLICK = 25;

/**
 * Decides whether an issue's realtime counters are shaped like a broken
 * pipeline rather than a quiet week.
 *
 * Firing has to mean something is actually wrong, because the only way this can
 * fail is by training the reader to ignore it. So it reports a zero only where
 * the volume above it makes zero implausible — an issue opened by 25+ readers
 * that records no click at all is a dead click path, not a boring issue, and
 * corporate link scanners prefetching every link within seconds of delivery put
 * a floor under it well below that.
 *
 * Counters, not events: the click *events* for a broken issue are not
 * necessarily zero, because the web-version redirect path writes its own and is
 * unaffected by anything on the email path. Issue 226 had 52 of them while its
 * `clicks` counter did not exist at all.
 *
 * Known blind spot: an issue with no trackable links in it would read as a dead
 * click path. That is not a real shape for this product — every issue is a link
 * roundup — and the cost is one nuisance mail rather than a recurring one, so
 * it is not worth reading the issue content here to rule out.
 *
 * @param {Object} counters - The issue's stats record
 * @returns {string|null} Human-readable description of the anomaly, or null
 */
export function describeCounterAnomaly(counters) {
  const deliveries = counters?.deliveries || 0;
  const opens = counters?.opens || 0;
  const clicks = counters?.clicks || 0;

  const count = (n) => n.toLocaleString('en-US');

  if (opens === 0 && deliveries >= MIN_DELIVERIES_TO_EXPECT_AN_OPEN) {
    return `${count(deliveries)} emails were delivered, but not one open was recorded.`;
  }

  if (clicks === 0 && opens >= MIN_OPENS_TO_EXPECT_A_CLICK) {
    return `${count(opens)} opens were recorded across ${count(deliveries)} delivered emails, but not one click.`;
  }

  return null;
}

/**
 * Emails the tenant when consolidation finds counters that can't be real.
 *
 * Issue 226 recorded 949 opens and zero clicks for a week before anyone noticed:
 * handle-email-status threw on every SES click event and swallowed it, so no
 * invocation failed, the Lambda error metric never moved, and the dashboard
 * simply had nothing to draw. A CloudWatch alarm would have been just as
 * invisible — so this reuses the 'Send Email v2' path the publish workflow
 * already notifies on, and the warning lands in the same inbox as the issue's
 * own scheduling mail.
 *
 * Never throws: a warning that fails must not fail the consolidation it rode in
 * on, which has already been written by this point.
 */
const reportCounterAnomalies = async (tenantId, issueNumber, counters) => {
  try {
    const anomaly = describeCounterAnomaly(counters);
    if (!anomaly) {
      return;
    }

    const tenant = await getTenant(tenantId);
    if (!tenant?.email) {
      console.warn('Counter anomaly found but the tenant has no email', { tenantId, issueNumber });
      return;
    }

    console.warn(`Counter anomaly for ${tenantId}#${issueNumber}: ${anomaly}`);

    await eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: 'newsletter-service',
        DetailType: 'Send Email v2',
        Detail: JSON.stringify({
          to: { email: tenant.email },
          subject: `[Check] Issue ${issueNumber} analytics look wrong`,
          html: [
            '<div>',
            `<p>Analytics for issue ${issueNumber} were just consolidated, and one of the numbers looks off:</p>`,
            `<p><b>${anomaly}</b></p>`,
            '<p>At this volume that usually means a tracking pipeline is dropping events rather than that the issue underperformed. Worth a look at the issue in the dashboard, and at the CloudWatch logs for the stat handler.</p>',
            '</div>'
          ].join(''),
          tenantId
        })
      }]
    }));
  } catch (err) {
    console.error('Failed to report counter anomaly', { tenantId, issueNumber, error: err.message });
  }
};

export async function queryEventsByType(ddb, tenantId, issueNumber, eventType) {
  const pk = `${tenantId}#${issueNumber}`;
  const events = [];
  let lastEvaluatedKey = null;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :eventType)',
      ProjectionExpression: 'sk, eventType, #ts, subscriberEmailHash, linkUrl, linkPosition, trafficSource, device, country, timeToClick, timeToOpen, timingAnchor, bounceType, bounceReason, complaintType',
      ExpressionAttributeNames: {
        '#ts': 'timestamp'
      },
      ExpressionAttributeValues: marshall({
        ':pk': pk,
        ':eventType': `${eventType}#`
      }),
      ExclusiveStartKey: lastEvaluatedKey
    }));

    if (result.Items) {
      events.push(...result.Items.map(item => unmarshall(item)));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return events;
}

export async function queryAllEventsParallel(ddb, tenantId, issueNumber) {
  const [clicks, opens, bounces, complaints] = await Promise.all([
    queryEventsByType(ddb, tenantId, issueNumber, 'click'),
    queryEventsByType(ddb, tenantId, issueNumber, 'open'),
    queryEventsByType(ddb, tenantId, issueNumber, 'bounce'),
    queryEventsByType(ddb, tenantId, issueNumber, 'complaint')
  ]);

  return { clicks, opens, bounces, complaints };
}

export function calculateLinkPerformance(clicks) {
  const linkMap = new Map();

  for (const click of clicks) {
    const key = click.linkUrl;
    if (!linkMap.has(key)) {
      linkMap.set(key, {
        url: click.linkUrl,
        clicks: 0,
        positions: [],
        countries: new Map()
      });
    }
    const linkData = linkMap.get(key);
    linkData.clicks++;

    if (click.linkPosition != null && !linkData.positions.includes(click.linkPosition)) {
      linkData.positions.push(click.linkPosition);
    }

    const country = click.country || 'unknown';
    if (!linkData.countries.has(country)) {
      linkData.countries.set(country, { clicks: 0, users: new Set() });
    }
    const countryData = linkData.countries.get(country);
    countryData.clicks++;
    if (click.subscriberEmailHash && click.subscriberEmailHash !== 'unknown') {
      countryData.users.add(click.subscriberEmailHash);
    }
  }

  const totalClicks = clicks.length;
  const links = Array.from(linkMap.values())
    .map(link => ({
      url: link.url,
      clicks: link.clicks,
      percentOfTotal: totalClicks > 0 ? (link.clicks / totalClicks) * 100 : 0,
      position: link.positions.length > 0 ? Math.min(...link.positions) : 0,
      geoDistribution: Array.from(link.countries.entries())
        .map(([country, data]) => ({
          country,
          clicks: data.clicks,
          uniqueUsers: data.users.size
        }))
        .sort((a, b) => b.clicks - a.clicks)
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 20);

  return links;
}

/**
 * Whether a send has missed its own backstop.
 *
 * The catch-all sweep is the last thing a fan-out does, so an issue that is
 * still incomplete well past `catchAllAt` is stalled rather than slow. The
 * grace period covers the sweep's own run time and clock skew.
 *
 * A record with no `catchAllAt` counts as overdue: there is nothing to wait
 * for, and nothing to re-book against either.
 *
 * @param {{catchAllAt?: string}} progress
 * @returns {boolean}
 */
const SEND_OVERDUE_GRACE_MS = 60 * 60 * 1000;

const isSendOverdue = (progress) => {
  const catchAllAt = new Date(progress?.catchAllAt).getTime();
  if (!Number.isFinite(catchAllAt)) {
    return true;
  }
  return Date.now() > catchAllAt + SEND_OVERDUE_GRACE_MS;
};

/**
 * The issue's local-send progress record, or null when there is none.
 *
 * Only local-send issues have one, so its absence means there is nothing to
 * wait for. A read failure reads as absent: a missing aggregation is worse
 * than an early one, so bookkeeping is never allowed to block analytics.
 *
 * @param {string} pk - `<tenantId>#<issueNumber>`
 * @returns {Promise<Object|null>}
 */
const readSendProgress = async (pk) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk, sk: 'sendProgress' }),
      ProjectionExpression: 'completedAt, catchAllAt, baseAt'
    }));
    return result.Item ? unmarshall(result.Item) : null;
  } catch (err) {
    console.error('Failed to read send progress - aggregating anyway', { pk, error: err.message });
    return null;
  }
};

/**
 * Re-book this issue's aggregation for after its catch-all sweep.
 *
 * Emits the same event the fan-out emits, because schedule-aggregation already
 * turns it into a window at `catchAllAt + 24h` and the handling is idempotent.
 *
 * Throws when it cannot be sent. There is nothing else left at that point, and
 * a failed invocation at least gets Lambda's async retries and lands in the
 * failure destination rather than disappearing silently.
 *
 * @param {string} pk - `<tenantId>#<issueNumber>`
 * @param {string} tenantId
 * @param {string|number} issueNumber
 * @param {{catchAllAt?: string, baseAt?: string}} progress
 */
const rebookForInFlightSend = async (pk, tenantId, issueNumber, progress) => {
  const { catchAllAt, baseAt } = progress;

  if (!catchAllAt || !baseAt) {
    // Nothing to re-book against. Fail loudly rather than return a success
    // that quietly drops the issue's analytics.
    throw new Error(`Send in flight for ${pk} but its progress record has no catchAllAt/baseAt to re-book against`);
  }

  console.log(`Send still in flight for ${pk} - re-booking aggregation for after ${catchAllAt}`);

  await eventBridge.send(new PutEventsCommand({
    Entries: [{
      Source: 'newsletter-service',
      DetailType: 'Issue Fanout Planned',
      Detail: JSON.stringify({ tenantId, issueNumber, baseAt, catchAllAt })
    }]
  }));
};

/**
 * Seconds between a recorded event and the send of the copy it belongs to.
 *
 * Two pipelines write `open#` / `click#` records and they anchor differently.
 * The SES event handler has the message's own Date header, which is
 * per-recipient, and labels what it stored with `timingAnchor`. The redirect
 * click handler only knows the issue and a subscriber hash, so it can only
 * measure from the issue-wide publish instant and says so.
 *
 * Only a value labelled `recipient` is trusted as-is. Everything else -
 * publish-labelled, and every record written before the label existed - is
 * re-derived from the publish instant, which is what those values already
 * mean. Reading an unlabelled value as recipient-relative is what would bucket
 * a prompt click from a late timezone group many hours late.
 *
 * @param {{timestamp: string, timingAnchor?: string}} event - The recorded open or click
 * @param {number|string|null|undefined} storedSeconds - timeToOpen / timeToClick
 * @param {number} publishTime - Issue publish instant, epoch ms
 * @returns {number} Seconds since that recipient's send
 */
function secondsSinceSend(event, storedSeconds, publishTime) {
  if (event?.timingAnchor === 'recipient'
    // `null` has to be rejected before the numeric coercion, not after it. The
    // builders persist an explicit null when no anchor was available at all,
    // DynamoDB round-trips it back as null, and `Number(null)` is 0 - finite,
    // and would file the event at the instant of its own send.
    && storedSeconds !== null && storedSeconds !== undefined && storedSeconds !== '') {
    const seconds = Number(storedSeconds);
    if (Number.isFinite(seconds)) {
      return seconds;
    }
  }
  return Math.floor((new Date(event.timestamp).getTime() - publishTime) / 1000);
}

/**
 * The same measurement in whole hours, for the decay buckets.
 */
function hoursSinceSend(event, storedSeconds, publishTime) {
  return Math.floor(secondsSinceSend(event, storedSeconds, publishTime) / 3600);
}

export function calculateClickDecay(clicks, publishedAt) {
  const publishTime = new Date(publishedAt).getTime();
  const hourlyClicks = new Map();

  for (const click of clicks) {
    const hoursSinceSent = hoursSinceSend(click, click.timeToClick, publishTime);

    if (hoursSinceSent >= 0 && hoursSinceSent < 168) {
      hourlyClicks.set(hoursSinceSent, (hourlyClicks.get(hoursSinceSent) || 0) + 1);
    }
  }

  const hours = Array.from(hourlyClicks.keys());
  const maxHour = hours.length > 0 ? Math.min(Math.max(...hours), 167) : 0;
  const decay = [];
  let cumulative = 0;

  for (let hour = 0; hour <= maxHour; hour++) {
    const clicks = hourlyClicks.get(hour) || 0;
    cumulative += clicks;
    decay.push({ hour, clicks, cumulativeClicks: cumulative });
  }

  return decay;
}

export function calculateOpenDecay(opens, publishedAt) {
  const publishTime = new Date(publishedAt).getTime();
  const hourlyOpens = new Map();

  for (const open of opens) {
    const hoursSinceSent = hoursSinceSend(open, open.timeToOpen, publishTime);

    if (hoursSinceSent >= 0 && hoursSinceSent < 168) {
      hourlyOpens.set(hoursSinceSent, (hourlyOpens.get(hoursSinceSent) || 0) + 1);
    }
  }

  const hours = Array.from(hourlyOpens.keys());
  const maxHour = hours.length > 0 ? Math.min(Math.max(...hours), 167) : 0;
  const decay = [];
  let cumulative = 0;

  for (let hour = 0; hour <= maxHour; hour++) {
    const opens = hourlyOpens.get(hour) || 0;
    cumulative += opens;
    decay.push({ hour, opens, cumulativeOpens: cumulative });
  }

  return decay;
}

export function calculateGeoDistribution(clicks, opens) {
  const geoMap = new Map();

  for (const click of clicks) {
    const country = click.country || 'unknown';
    if (!geoMap.has(country)) {
      geoMap.set(country, {
        country,
        clicks: 0,
        opens: 0,
        uniqueClickUsers: new Set(),
        uniqueOpenUsers: new Set()
      });
    }
    const countryData = geoMap.get(country);
    countryData.clicks++;
    if (click.subscriberEmailHash && click.subscriberEmailHash !== 'unknown') {
      countryData.uniqueClickUsers.add(click.subscriberEmailHash);
    }
  }

  for (const open of opens) {
    const country = open.country || 'unknown';
    if (!geoMap.has(country)) {
      geoMap.set(country, {
        country,
        clicks: 0,
        opens: 0,
        uniqueClickUsers: new Set(),
        uniqueOpenUsers: new Set()
      });
    }
    const countryData = geoMap.get(country);
    countryData.opens++;
    if (open.subscriberEmailHash && open.subscriberEmailHash !== 'unknown') {
      countryData.uniqueOpenUsers.add(open.subscriberEmailHash);
    }
  }

  return Array.from(geoMap.values())
    .map(data => ({
      country: data.country,
      clicks: data.clicks,
      opens: data.opens,
      uniqueClickUsers: data.uniqueClickUsers.size,
      uniqueOpenUsers: data.uniqueOpenUsers.size
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 20);
}

export function calculateDeviceBreakdown(opens) {
  const breakdown = { desktop: 0, mobile: 0, tablet: 0 };

  for (const open of opens) {
    const device = open.device || 'unknown';
    if (device in breakdown) {
      breakdown[device]++;
    }
  }

  return breakdown;
}

export function calculateTimingMetrics(opens, clicks, publishedAt) {
  // Normalised the same way the decay curves are: a median that mixes
  // recipient-relative and publish-relative values is not a median of anything.
  // Without a publish instant there is nothing to re-derive against, so the
  // stored values are used as they are.
  const publishTime = new Date(publishedAt).getTime();
  const normalize = (event, stored) => (Number.isFinite(publishTime)
    ? secondsSinceSend(event, stored, publishTime)
    : stored);

  const openTimes = opens.map(o => normalize(o, o.timeToOpen)).filter(t => t != null).sort((a, b) => a - b);
  const clickTimes = clicks.map(c => normalize(c, c.timeToClick)).filter(t => t != null).sort((a, b) => a - b);

  return {
    medianTimeToOpen: calculateMedian(openTimes),
    p95TimeToOpen: calculatePercentile(openTimes, 95),
    medianTimeToClick: calculateMedian(clickTimes),
    p95TimeToClick: calculatePercentile(clickTimes, 95)
  };
}

function calculateMedian(sortedArray) {
  if (sortedArray.length === 0) return 0;
  const mid = Math.floor(sortedArray.length / 2);
  return sortedArray.length % 2 === 0
    ? (sortedArray[mid - 1] + sortedArray[mid]) / 2
    : sortedArray[mid];
}

function calculatePercentile(sortedArray, percentile) {
  if (sortedArray.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
  return sortedArray[Math.max(0, index)];
}

/**
 * Classifies unique clickers as "new" (engagementCount === 1) or
 * "returning" (engagementCount > 1) by decrypting the subscriber tokens
 * stored in click events back to emails, then looking up engagement
 * directly in the SubscribersTable.
 *
 * Click events store an encrypted token (from send-email-v2 link tracking),
 * not a SHA-256 hash, so we decrypt to recover the original email for lookup.
 *
 * @param {Array} clicks - Click events for the issue
 * @param {DynamoDBClient} ddb - DynamoDB client
 * @param {string} tenantId - Tenant ID for subscriber lookups
 * @returns {Promise<{ newClickers: number, returningClickers: number }>}
 */
export async function calculateEngagementType(clicks, ddb, tenantId) {
  // Decrypt unique subscriber tokens to emails
  const uniqueEmails = new Set();
  for (const click of clicks) {
    const token = click.subscriberEmailHash;
    if (token && token !== 'unknown') {
      try {
        const email = decrypt(token);
        uniqueEmails.add(email);
      } catch {
        // Malformed token — skip
      }
    }
  }

  if (uniqueEmails.size === 0) {
    return { newClickers: 0, returningClickers: 0 };
  }

  const emailToEngagement = await lookupSubscriberEngagements(ddb, tenantId, uniqueEmails);

  let newClickers = 0;
  let returningClickers = 0;

  for (const email of uniqueEmails) {
    const engagementCount = emailToEngagement.get(email);
    if (engagementCount != null && engagementCount > 1) {
      returningClickers++;
    } else {
      newClickers++;
    }
  }

  return { newClickers, returningClickers };
}

/**
 * Looks up engagementCount for a set of subscriber emails by direct
 * GetItem calls against the SubscribersTable (keyed by tenantId + email).
 *
 * @param {DynamoDBClient} ddb - DynamoDB client
 * @param {string} tenantId - Tenant partition key
 * @param {Set<string>} emails - Subscriber emails to look up
 * @returns {Promise<Map<string, number>>} Map of email → engagementCount
 */
async function lookupSubscriberEngagements(ddb, tenantId, emails) {
  const emailToEngagement = new Map();

  const lookups = Array.from(emails).map(async (email) => {
    try {
      const result = await ddb.send(new GetItemCommand({
        TableName: process.env.SUBSCRIBERS_TABLE_NAME,
        Key: marshall({ tenantId, email }),
        ProjectionExpression: 'engagementCount'
      }));

      if (result.Item) {
        const subscriber = unmarshall(result.Item);
        emailToEngagement.set(email, subscriber.engagementCount ?? null);
      }
    } catch (err) {
      console.error('Failed to look up subscriber engagement', { tenantId, email, error: err.message });
    }
  });

  await Promise.all(lookups);
  return emailToEngagement;
}

/**
 * Builds the A/B test summary for consolidated analytics/reports: per-variant
 * engagement rates plus the recorded significance verdict. Returns null when the
 * issue has no A/B test. The abTest config (with its evaluation) is read from the
 * issue record; per-variant counters come from the `stats#v#{a,b}` records.
 *
 * @param {DynamoDBClient} ddb
 * @param {string} tenantId
 * @param {string|number} issueNumber
 * @returns {Promise<Object|null>}
 */
export async function calculateAbTestSummary(ddb, tenantId, issueNumber) {
  const pk = `${tenantId}#${issueNumber}`;

  let abTest = null;
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk, sk: 'newsletter' }),
      ProjectionExpression: 'abTest'
    }));
    if (result.Item) {
      const record = unmarshall(result.Item);
      if (record.abTest) {
        abTest = typeof record.abTest === 'string' ? JSON.parse(record.abTest) : record.abTest;
      }
    }
  } catch (err) {
    console.error('Failed to load abTest for analytics summary', { pk, error: err.message });
  }

  if (!abTest || !Array.isArray(abTest.variants)) {
    return null;
  }

  const counters = {};
  await Promise.all(['a', 'b'].map(async (variantId) => {
    try {
      const result = await ddb.send(new GetItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({ pk, sk: `stats#v#${variantId}` })
      }));
      counters[variantId] = result.Item ? unmarshall(result.Item) : {};
    } catch {
      counters[variantId] = {};
    }
  }));

  const variants = abTest.variants.map((variant) => {
    const counter = counters[variant.variantId] || {};
    const opens = counter.opens || 0;
    const clicks = counter.clicks || 0;
    const deliveries = counter.deliveries || 0;
    return {
      variantId: variant.variantId,
      ...(variant.subject !== undefined && { subject: variant.subject }),
      ...(variant.sendAt !== undefined && { sendAt: variant.sendAt }),
      opens,
      clicks,
      deliveries,
      openRate: deliveries > 0 ? (opens / deliveries) * 100 : 0,
      clickRate: deliveries > 0 ? (clicks / deliveries) * 100 : 0
    };
  });

  return {
    dimension: abTest.dimension,
    winMetric: abTest.winMetric || 'openRate',
    status: abTest.status,
    winnerVariantId: abTest.winnerVariantId ?? null,
    variants,
    evaluation: abTest.evaluation ?? null
  };
}

export function calculateTrafficSource(clicks) {
  const clickSource = { email: 0, web: 0 };

  for (const click of clicks) {
    const source = click.trafficSource || 'web';
    if (source === 'email') clickSource.email++;
    else if (source === 'web') clickSource.web++;
  }

  return {
    clicks: clickSource
  };
}

export function calculateBounceReasons(bounces) {
  const reasons = { permanent: 0, temporary: 0, suppressed: 0 };

  for (const bounce of bounces) {
    const type = bounce.bounceType || 'temporary';
    if (type in reasons) {
      reasons[type]++;
    }
  }

  return reasons;
}

export function formatComplaintDetails(complaints) {
  return complaints
    .slice(0, 100)
    .map(c => ({
      email: c.subscriberEmailHash,
      timestamp: c.timestamp,
      complaintType: c.complaintType || 'spam'
    }));
}
