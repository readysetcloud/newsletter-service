import { DynamoDBClient, UpdateItemCommand, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { hash } from './utils/helpers.mjs';
import { hashEmail } from './utils/hash-email.mjs';
import { detectDevice } from './utils/detect-device.mjs';
import { lookupCountry, lookupGeo } from './utils/geolocation.mjs';
import { updateSubscriberEngagement } from './utils/subscriber-engagement.mjs';
import { processInterestScoring } from './utils/interest-scoring.mjs';
import { recordTimeZoneObservation } from './utils/timezone-tracking.mjs';
import { recordActivity, recordOpenHour } from './utils/activity-timeline.mjs';
import { ulid } from 'ulid';
import crypto from 'crypto';

const ddb = new DynamoDBClient();

const padIssueNumber = (issueNumber) => {
  return String(issueNumber).padStart(5, '0');
};

/**
 * Identity of one SES event, for dedup under EventBridge's at-least-once
 * delivery. messageId + eventType alone is not unique - the same message can
 * legitimately be opened or clicked many times - so the event's own timestamp
 * (millisecond precision, identical on a redelivery, different on a real
 * repeat) and, for clicks, the link disambiguate. Returns null when the event
 * carries no messageId; such an event is processed without dedup rather than
 * dropped.
 */
const processedMarkerSk = (detail) => {
  const messageId = detail.mail?.messageId;
  if (!messageId) {
    return null;
  }

  const eventType = detail.eventType.toLowerCase();
  const eventTimestamp = detail[eventType]?.timestamp || detail.mail.timestamp || '';
  const linkDiscriminator = eventType === 'click' && detail.click?.link
    ? `#${hash(detail.click.link)}`
    : '';

  return `processed#${messageId}#${eventType}#${eventTimestamp}${linkDiscriminator}`;
};

/**
 * Cheap pre-check that skips the enrichment reads for the common redelivery
 * case. It is NOT the idempotency guard - a consistent read gives no mutual
 * exclusion between two invocations that both find no marker. The conditional
 * Put inside commitEventAccounting is what actually decides who processes the
 * event.
 */
const wasEventProcessed = async (issueId, markerSk) => {
  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({ pk: issueId, sk: markerSk }),
    ConsistentRead: true,
    ProjectionExpression: 'pk'
  }));
  return Boolean(result.Item);
};

// Idempotency has to outlive every supported recovery path, not just the
// automatic retries: EmailPipelineDLQ holds failed work for 14 days, so a
// marker expiring at 7 would let a legitimate late redrive read as a brand
// new event and double-count it. 30 days keeps headroom over that horizon.
const PROCESSED_MARKER_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Stable id for the event's analytics record, so a reprocessed event rewrites
 * the same row instead of creating a second physical record for one logical
 * SES event. Falls back to a ULID when the event carries no messageId - such
 * an event cannot be deduped anyway.
 */
const eventRecordId = (detail) => {
  const messageId = detail.mail?.messageId;
  if (!messageId) {
    return ulid();
  }

  const eventType = detail.eventType.toLowerCase();
  const linkPart = eventType === 'click' && detail.click?.link ? detail.click.link : '';
  return crypto.createHash('sha256')
    .update(`${messageId}#${eventType}#${linkPart}`)
    .digest('hex')
    .slice(0, 26);
};

/**
 * Commit everything that counts as durable accounting for one SES event in a
 * single all-or-nothing transaction: the processed marker (conditional, which
 * is what makes concurrent duplicates mutually exclusive), the issue stats,
 * the per-variant stats that decide A/B winners, the event's analytics record,
 * and - for a first open - the unique-open marker.
 *
 * Doing these together closes the two windows a check-then-act sequence leaves
 * open: two invocations both finding no marker and both proceeding, and a
 * crash between the stat increment and the marker write that lets the retry
 * count the same event twice. A cancelled transaction writes nothing, so a
 * retry recomputes from scratch safely.
 *
 * @returns {Promise<boolean>} false when another invocation already claimed
 * this event (its marker condition failed), true when this invocation owns it.
 */
const commitEventAccounting = async ({
  issueId, tenantId, issueNumber, markerSk, stat, failedEmail, variantId, eventRecord, uniqueOpenItem
}) => {
  const transactItems = [];

  if (markerSk) {
    transactItems.push({
      Put: {
        TableName: process.env.TABLE_NAME,
        Item: marshall({
          pk: issueId,
          sk: markerSk,
          ttl: Math.floor(Date.now() / 1000) + PROCESSED_MARKER_TTL_SECONDS
        }),
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
      }
    });
  }

  if (stat) {
    transactItems.push({
      Update: {
        TableName: process.env.TABLE_NAME,
        Key: marshall({ pk: issueId, sk: 'stats' }),
        UpdateExpression: `ADD #stat :val SET GSI1PK = if_not_exists(GSI1PK, :gsi1pk), GSI1SK = if_not_exists(GSI1SK, :gsi1sk), statsPhase = if_not_exists(statsPhase, :phase)${failedEmail ? ', #failedAddresses = list_append(if_not_exists(#failedAddresses, :emptyList), :failedAddresses)' : ''}`,
        ExpressionAttributeNames: {
          '#stat': stat,
          ...(failedEmail ? { '#failedAddresses': 'failedAddresses' } : {})
        },
        ExpressionAttributeValues: marshall({
          ':val': 1,
          ':gsi1pk': `${tenantId}#issue`,
          ':gsi1sk': padIssueNumber(parseInt(issueNumber)),
          ':phase': 'realtime',
          ...(failedEmail ? { ':failedAddresses': [failedEmail], ':emptyList': [] } : {})
        })
      }
    });

    // Previously best-effort with a swallowed error, which let the main stat
    // land, the variant stat fail, and the event still be marked processed -
    // permanently skewing the numbers winner selection reads.
    if (variantId === 'a' || variantId === 'b') {
      transactItems.push({
        Update: {
          TableName: process.env.TABLE_NAME,
          Key: marshall({ pk: issueId, sk: `stats#v#${variantId}` }),
          UpdateExpression: 'ADD #stat :val SET statsPhase = if_not_exists(statsPhase, :phase)',
          ExpressionAttributeNames: { '#stat': stat },
          ExpressionAttributeValues: marshall({ ':val': 1, ':phase': 'realtime' })
        }
      });
    }
  }

  if (eventRecord) {
    transactItems.push({
      Put: {
        TableName: process.env.TABLE_NAME,
        Item: marshall(eventRecord)
      }
    });
  }

  if (uniqueOpenItem) {
    transactItems.push({
      Put: {
        TableName: process.env.TABLE_NAME,
        Item: marshall(uniqueOpenItem),
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
      }
    });
  }

  if (transactItems.length === 0) {
    return true;
  }

  try {
    await ddb.send(new TransactWriteItemsCommand({ TransactItems: transactItems }));
    return true;
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      const reasons = err.CancellationReasons ?? [];
      // The marker is always item 0 when present. Its condition failing means
      // another invocation got there first - that is a duplicate, not an error.
      if (markerSk && reasons[0]?.Code === 'ConditionalCheckFailed') {
        return false;
      }
      // Anything else (e.g. two distinct opens racing on the unique-open
      // marker) rethrows: nothing was written, so the retry recomputes - and
      // the loser of that race correctly reclassifies its open as a reopen.
      console.warn('Email status accounting transaction cancelled', {
        issueId,
        reasons: reasons.map((reason) => reason?.Code)
      });
    }
    throw err;
  }
};

export const handler = async (event) => {
  const { detail } = event ?? {};
  // Not one of ours (or a malformed relay) - nothing to retry, so don't throw.
  if (!detail?.mail?.tags || !detail.eventType) {
    console.warn('Ignoring email status event without mail tags or an event type');
    return;
  }

  try {
    console.log(JSON.stringify(detail));
    const referenceNumber = detail.mail.tags.referenceNumber;
    if (!referenceNumber?.length) {
      return;
    }

    const markerSk = processedMarkerSk(detail);

    const issueId = referenceNumber[0].replace(/_/g, '#');
    if (markerSk && await wasEventProcessed(issueId, markerSk)) {
      console.log('Skipping already-processed email status event', { issueId, eventType: detail.eventType });
      return true;
    }
    const [tenantId, issueNumber] = issueId.split('#');
    const recipient = detail.mail.destination?.[0];
    const recordId = eventRecordId(detail);
    let stat;
    let failedEmail;
    // Built here, written by the transaction below - nothing durable is
    // recorded until the whole accounting set commits together.
    let eventRecord = null;
    let uniqueOpenItem = null;
    switch (detail.eventType.toLowerCase()) {
      case 'bounce':
        eventRecord = buildBounceEventRecord(issueId, recipient, detail.bounce, recordId);
        stat = 'bounces';
        failedEmail = recipient;
        break;
      case 'reject':
        stat = 'rejects';
        failedEmail = recipient;
        break;
      case 'send':
        stat = 'sends';
        break;
      case 'delivery':
        stat = 'deliveries';
        break;
      case 'complaint':
        eventRecord = buildComplaintEventRecord(issueId, recipient, detail.complaint, recordId);
        stat = 'complaints';
        break;
      case 'open': {
        eventRecord = await buildOpenEventRecord(issueId, recipient, detail.open, detail.mail.commonHeaders, recordId);
        // Read-only here; the unique-open marker rides the transaction so the
        // open/reopen classification and the row that decides it commit as one.
        const alreadyOpened = await hasUniqueOpen(issueId, recipient);
        stat = alreadyOpened ? 'reopens' : 'opens';
        if (!alreadyOpened) {
          uniqueOpenItem = buildUniqueOpenItem(issueId, recipient, detail.open);
        }
        break;
      }
      case 'click':
        eventRecord = await buildClickEventRecord(issueId, recipient, detail.click, recordId);
        stat = 'clicks';
        break;
      default:
        console.warn(`Unsupported stat ${detail.eventType} was provided`);
        return;
    }

    const claimed = await commitEventAccounting({
      issueId,
      tenantId,
      issueNumber,
      markerSk,
      stat,
      failedEmail,
      variantId: detail.mail.tags?.variant?.[0],
      eventRecord,
      uniqueOpenItem
    });

    if (!claimed) {
      console.log('Another invocation already recorded this email status event', { issueId, eventType: detail.eventType });
      return true;
    }

    // Enrichment runs only after the accounting is durable, and never fails
    // the invocation. Ordering matters: a retry that finds the marker skips
    // straight past this, so running it before the transaction would let a
    // failed commit replay these non-idempotent side effects.
    await runEnrichment(detail, { issueId, tenantId, issueNumber, recipient });

    return true;
  } catch (err) {
    // Rethrow so the platform retries and, once retries are exhausted, the
    // event lands in the on-failure queue instead of evaporating. A swallowed
    // error here used to lose the stat forever - including the bounce and
    // complaint records that clean-bounced-subscribers and deliverability
    // depend on.
    console.error('Email status processing failed - rethrowing for retry', {
      eventType: detail.eventType,
      error: err.message
    });
    throw err;
  }
};

/**
 * Resolve the event IP to an IANA timezone (requires the GeoLite2 City DB in
 * the geolocation layer) and record it as a per-issue observation on the
 * subscriber. After the same zone is seen for 3 distinct issues (including at
 * least one click observation) the subscriber's timeZone is confirmed, which
 * powers the local-send feature. The source ('open'|'click') is stored so a
 * click can supersede an Apple Mail Privacy Protection-proxied open.
 * Never throws — timezone tracking must not affect stat aggregation.
 */
const recordTimeZoneFromIp = async (tenantId, email, issueNumber, ipAddress, source) => {
  if (!ipAddress) {
    return;
  }

  try {
    const geo = await lookupGeo(ipAddress);
    if (geo?.timeZone) {
      await recordTimeZoneObservation(tenantId, email, issueNumber, geo.timeZone, source);
    }
  } catch (err) {
    console.error('Timezone observation failed', { tenantId, issueNumber, error: err.message });
  }
};

/**
 * Append an 'open' entry to the subscriber's rolling recentActivity list and
 * bump their open-hour histogram (a data foundation for a future peak-hour send
 * feature). Defensive — a failure here must never affect stat aggregation.
 */
const recordOpenActivity = async (tenantId, email, issueNumber, openEvent) => {
  try {
    const openedAt = openEvent?.timestamp ? new Date(openEvent.timestamp) : new Date();
    await recordActivity(tenantId, email, {
      type: 'open',
      issue: issueNumber,
      ts: openedAt.toISOString()
    });
    await recordOpenHour(tenantId, email, openedAt.getUTCHours());
  } catch (err) {
    console.error('Failed to record open activity', { tenantId, issueNumber, error: err.message });
  }
};

/**
 * Append a 'click' entry (with the clicked URL) to the subscriber's rolling
 * recentActivity list. Defensive — a failure here must never affect stat
 * aggregation.
 */
const recordClickActivity = async (tenantId, email, issueNumber, clickEvent) => {
  try {
    const clickedAt = clickEvent?.timestamp ? new Date(clickEvent.timestamp) : new Date();
    await recordActivity(tenantId, email, {
      type: 'click',
      issue: issueNumber,
      ts: clickedAt.toISOString(),
      url: clickEvent?.link
    });
  } catch (err) {
    console.error('Failed to record click activity', { tenantId, issueNumber, error: err.message });
  }
};

/**
 * Everything that enriches a subscriber's profile off the back of an event:
 * engagement recency, interest scoring, timezone inference, activity history,
 * per-link click tallies. Deliberately outside the accounting transaction and
 * deliberately unable to fail the invocation - none of it is what the issue's
 * reported numbers or deliverability decisions are built from.
 */
const runEnrichment = async (detail, { issueId, tenantId, issueNumber, recipient }) => {
  const issueNumeric = parseInt(issueNumber, 10);

  if (detail.eventType.toLowerCase() === 'open') {
    try {
      await updateSubscriberEngagement(tenantId, recipient, issueNumeric);
    } catch (err) {
      console.error('Subscriber engagement update failed on open', { issueId, error: err.message });
    }
    await recordTimeZoneFromIp(tenantId, recipient, issueNumeric, detail.open?.ipAddress, 'open');
    await recordOpenActivity(tenantId, recipient, issueNumeric, detail.open);
    return;
  }

  if (detail.eventType.toLowerCase() !== 'click') {
    return;
  }

  // Each step is a side effect of the click and none of them may cost the
  // others. An issue that shipped without its `link#` records once lost every
  // one of its email clicks to a ValidationException out of trackLinkClick.
  try {
    await trackLinkClick(issueId, detail.click.link, detail.click.ipAddress);
  } catch (err) {
    console.error('Link click counter update failed', { issueId, error: err.message });
  }
  try {
    await updateSubscriberEngagement(tenantId, recipient, issueNumeric);
  } catch (err) {
    console.error('Subscriber engagement update failed on click', { issueId, error: err.message });
  }
  // Interest scoring + auto-segmentation runs on the SES email-click path
  // because that is the click event that identifies the subscriber
  // (detail.mail.destination). The CloudFront/web-version redirect path is
  // intentionally anonymous, so it never scores. processInterestScoring looks
  // up the clicked link's topic (link#hash(url)) and increments the
  // subscriber's interestScores, auto-creating an interest segment when a
  // topic crosses the threshold.
  try {
    await processInterestScoring(issueId, recipient, detail.click.link);
  } catch (err) {
    console.error('Interest scoring failed on click', { issueId, error: err.message });
  }
  await recordTimeZoneFromIp(tenantId, recipient, issueNumeric, detail.click?.ipAddress, 'click');
  await recordClickActivity(tenantId, recipient, issueNumeric, detail.click);
};

const buildOpenEventRecord = async (issueId, subscriberEmail, openEvent, commonHeaders, recordId) => {
  const openedAt = openEvent?.timestamp ? new Date(openEvent.timestamp) : new Date();
  const timestamp = openedAt.toISOString();

  const subscriberEmailHash = hashEmail(subscriberEmail);

  const userAgent = openEvent?.userAgent || null;

  const device = detectDevice(userAgent);

  const ipAddress = openEvent?.ipAddress || null;
  const countryData = ipAddress ? await lookupCountry(ipAddress) : null;
  const country = countryData?.countryCode || 'unknown';

  let publishedAt = null;
  try {
    const statsResult = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: issueId, sk: 'stats' }),
      ProjectionExpression: 'publishedAt'
    }));
    if (statsResult.Item) {
      const stats = unmarshall(statsResult.Item);
      publishedAt = stats.publishedAt || null;
    }
  } catch (err) {
    console.error('Failed to fetch publishedAt for timeToOpen', { issueId, error: err.message });
  }

  const sentAt = publishedAt || commonHeaders?.date || null;
  const timeToOpen = sentAt
    ? Math.floor((openedAt - new Date(sentAt)) / 1000)
    : null;

  const openEventRecord = {
    pk: issueId,
    sk: `open#${timestamp}#${subscriberEmailHash}#${recordId}`,
    eventType: 'open',
    timestamp,
    subscriberEmailHash,
    device,
    country,
    timeToOpen,
    ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60)
  };

  return openEventRecord;
};

const buildBounceEventRecord = (issueId, subscriberEmail, bounceEvent, recordId) => {
  const bouncedAt = bounceEvent?.timestamp ? new Date(bounceEvent.timestamp) : new Date();
  const timestamp = bouncedAt.toISOString();

  const subscriberEmailHash = hashEmail(subscriberEmail);

  const bounceType = categorizeBounceType(bounceEvent);
  const bounceReason = extractBounceReason(bounceEvent);

  const bounceEventRecord = {
    pk: issueId,
    sk: `bounce#${timestamp}#${subscriberEmailHash}#${recordId}`,
    eventType: 'bounce',
    timestamp,
    subscriberEmailHash,
    bounceType,
    bounceReason,
    ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60)
  };

  return bounceEventRecord;
};

const buildComplaintEventRecord = (issueId, subscriberEmail, complaintEvent, recordId) => {
  const complainedAt = complaintEvent?.timestamp ? new Date(complaintEvent.timestamp) : new Date();
  const timestamp = complainedAt.toISOString();

  const subscriberEmailHash = hashEmail(subscriberEmail);

  const complaintType = determineComplaintType(complaintEvent);

  const complaintEventRecord = {
    pk: issueId,
    sk: `complaint#${timestamp}#${subscriberEmailHash}#${recordId}`,
    eventType: 'complaint',
    timestamp,
    subscriberEmailHash,
    complaintType,
    ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60)
  };

  return complaintEventRecord;
};

const determineComplaintType = (complaintEvent) => {
  if (!complaintEvent) return 'spam';

  const complaintFeedbackType = complaintEvent.complaintFeedbackType?.toLowerCase();

  if (complaintFeedbackType === 'abuse') return 'abuse';
  if (complaintFeedbackType === 'fraud') return 'abuse';
  if (complaintFeedbackType === 'virus') return 'abuse';

  return 'spam';
};

const categorizeBounceType = (bounceEvent) => {
  if (!bounceEvent) return 'temporary';

  const bounceSubType = bounceEvent.bounceSubType?.toLowerCase();
  if (bounceSubType === 'suppressed') return 'suppressed';

  const bounceType = bounceEvent.bounceType?.toLowerCase();

  if (bounceType === 'permanent') return 'permanent';
  if (bounceType === 'transient') return 'temporary';
  if (bounceType === 'undetermined') return 'temporary';

  return 'temporary';
};

const extractBounceReason = (bounceEvent) => {
  if (!bounceEvent) return 'unknown';

  const bouncedRecipients = bounceEvent.bouncedRecipients;
  if (bouncedRecipients && bouncedRecipients.length > 0) {
    const firstRecipient = bouncedRecipients[0];
    if (firstRecipient.diagnosticCode) {
      return firstRecipient.diagnosticCode;
    }
    if (firstRecipient.status) {
      return firstRecipient.status;
    }
  }

  if (bounceEvent.bounceSubType) {
    return bounceEvent.bounceSubType;
  }

  return 'unknown';
};

/**
 * Whether this subscriber has already opened the issue, which decides between
 * the `opens` and `reopens` counters. Read-only and strongly consistent: the
 * write that claims the first open rides the accounting transaction, so the
 * classification and the row it depends on commit together or not at all.
 */
const hasUniqueOpen = async (issueId, emailAddress) => {
  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({ pk: issueId, sk: `opens#${emailAddress}` }),
    ConsistentRead: true,
    ProjectionExpression: 'pk'
  }));
  return Boolean(result.Item);
};

const buildUniqueOpenItem = (issueId, emailAddress, openEvent) => {
  const item = {
    pk: issueId,
    sk: `opens#${emailAddress}`,
    createdAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
  };

  if (openEvent?.userAgent) {
    item.userAgent = openEvent.userAgent;
  }

  if (openEvent?.ipAddress) {
    item.ipAddress = openEvent.ipAddress;
  }

  if (openEvent?.timestamp) {
    item.openedAt = openEvent.timestamp;
  }

  return item;
};

/**
 * Increments the issue's per-link click counters on the `link#<hash(url)>`
 * record that 'Extract Links' writes at stage time.
 *
 * A missing record is a state this has to survive. Link extraction is
 * best-effort by design — its state catches States.ALL and times out rather than
 * delay a send — and before the content-type fork was removed it did not run for
 * json or html issues at all. `SET #by.#day` cannot survive it: the nested path
 * only resolves when `byDay` already exists, so with no record DynamoDB rejects
 * the whole update as `ValidationException: The document path provided in the
 * update expression is invalid for update`.
 *
 * The condition turns that into a cheap, explicit miss, matching what
 * process-link-click already does on the redirect path. It deliberately does not
 * create the record: a counter-only record carries no url, position or topic
 * classification, and would then block the real one, which update-link-tracking
 * writes under `attribute_not_exists(pk)`.
 */
const trackLinkClick = async (issueId, link, ipAddress) => {
  const countryData = ipAddress ? await lookupCountry(ipAddress) : null;
  const country = countryData?.countryCode || 'unknown';

  const sk = `link#${hash(link)}`;
  const day = new Date().toISOString().slice(0, 10);

  try {
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: issueId,
        sk
      }),
      UpdateExpression: 'ADD clicks_total :one SET #by.#day = if_not_exists(#by.#day, :zero) + :one, #country = if_not_exists(#country, :country)',
      ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
      ExpressionAttributeNames: {
        '#by': 'byDay',
        '#day': day,
        '#country': 'country'
      },
      ExpressionAttributeValues: marshall({
        ':one': 1,
        ':zero': 0,
        ':country': country
      })
    }));
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') {
      throw err;
    }
    // The click still counts everywhere else; only this link's own tally and
    // the top-link reporting built on it lose the event.
    console.warn('No link record to count this click against', { issueId, sk });
  }
};

const getStoredLinkPosition = async (issueId, link) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: issueId,
        sk: `link#${hash(link)}`
      }),
      ProjectionExpression: '#position',
      ExpressionAttributeNames: {
        '#position': 'position'
      }
    }));

    if (!result.Item) {
      return null;
    }

    const linkRecord = unmarshall(result.Item);
    return typeof linkRecord.position === 'number' ? linkRecord.position : null;
  } catch (err) {
    console.error('Failed to fetch link position', { issueId, link, error: err.message });
    return null;
  }
};

const buildClickEventRecord = async (issueId, subscriberEmail, clickEvent, recordId) => {
  const clickedAt = clickEvent?.timestamp ? new Date(clickEvent.timestamp) : new Date();
  const timestamp = clickedAt.toISOString();

  const subscriberEmailHash = hashEmail(subscriberEmail);
  const linkUrl = clickEvent?.link || 'unknown';
  const linkId = crypto.createHash('md5').update(linkUrl).digest('hex').substring(0, 8);

  const ipAddress = clickEvent?.ipAddress || null;
  const countryData = ipAddress ? await lookupCountry(ipAddress) : null;
  const country = countryData?.countryCode || 'unknown';

  const userAgent = clickEvent?.userAgent || null;
  const device = detectDevice(userAgent);
  const trafficSource = 'email';

  let publishedAt = null;
  try {
    const statsResult = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: issueId, sk: 'stats' }),
      ProjectionExpression: 'publishedAt'
    }));
    if (statsResult.Item) {
      const stats = unmarshall(statsResult.Item);
      publishedAt = stats.publishedAt || null;
    }
  } catch (err) {
    console.error('Failed to fetch publishedAt for timeToClick', { issueId, error: err.message });
  }

  const timeToClick = publishedAt
    ? Math.floor((clickedAt - new Date(publishedAt)) / 1000)
    : null;

  const linkPosition = await getStoredLinkPosition(issueId, linkUrl);

  const clickEventRecord = {
    pk: issueId,
    sk: `click#${timestamp}#${subscriberEmailHash}#${linkId}#${recordId}`,
    eventType: 'click',
    timestamp,
    subscriberEmailHash,
    linkUrl,
    linkPosition,
    trafficSource,
    device,
    country,
    timeToClick,
    ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60)
  };

  return clickEventRecord;
};
