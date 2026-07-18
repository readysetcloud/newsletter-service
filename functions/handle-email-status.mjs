import { DynamoDBClient, UpdateItemCommand, PutItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { hash } from './utils/helpers.mjs';
import { hashEmail } from './utils/hash-email.mjs';
import { detectDevice } from './utils/detect-device.mjs';
import { lookupCountry, lookupGeo } from './utils/geolocation.mjs';
import { updateSubscriberEngagement } from './utils/subscriber-engagement.mjs';
import { processInterestScoring } from './utils/interest-scoring.mjs';
import { recordTimeZoneObservation } from './utils/timezone-tracking.mjs';
import { ulid } from 'ulid';
import crypto from 'crypto';

const ddb = new DynamoDBClient();

const padIssueNumber = (issueNumber) => {
  return String(issueNumber).padStart(5, '0');
};

export const handler = async (event) => {
  try {
    const { detail } = event;
    console.log(JSON.stringify(detail));
    const referenceNumber = detail.mail.tags.referenceNumber;
    if (!referenceNumber?.length) {
      return;
    }

    const issueId = referenceNumber[0].replace(/_/g, '#');
    const [tenantId, issueNumber] = issueId.split('#');
    let stat;
    let failedEmail;
    switch (detail.eventType.toLowerCase()) {
      case 'bounce':
        await captureBounceEvent(issueId, detail.mail.destination[0], detail.bounce);
        stat = 'bounces';
        failedEmail = detail.mail.destination[0];
        break;
      case 'reject':
        stat = 'rejects';
        failedEmail = detail.mail.destination[0];
        break;
      case 'send':
        stat = 'sends';
        break;
      case 'delivery':
        stat = 'deliveries';
        break;
      case 'complaint':
        await captureComplaintEvent(issueId, detail.mail.destination[0], detail.complaint);
        stat = 'complaints';
        break;
      case 'open':
        await captureOpenEvent(issueId, detail.mail.destination[0], detail.open, detail.mail.commonHeaders);
        const isReopen = await trackUniqueOpen(issueId, detail.mail.destination[0], detail.open);
        stat = isReopen ? 'reopens' : 'opens';
        try {
          await updateSubscriberEngagement(tenantId, detail.mail.destination[0], parseInt(issueNumber, 10));
        } catch (err) {
          console.error('Subscriber engagement update failed on open', { issueId, error: err.message });
        }
        await recordTimeZoneFromIp(tenantId, detail.mail.destination[0], parseInt(issueNumber, 10), detail.open?.ipAddress);
        break;
      case 'click':
        stat = 'clicks';
        await trackLinkClick(issueId, detail.click.link, detail.click.ipAddress);
        await captureClickEvent(issueId, detail.mail.destination[0], detail.click);
        try {
          await updateSubscriberEngagement(tenantId, detail.mail.destination[0], parseInt(issueNumber, 10));
        } catch (err) {
          console.error('Subscriber engagement update failed on click', { issueId, error: err.message });
        }
        // Interest scoring + auto-segmentation runs on the SES email-click path
        // because that is the click event that identifies the subscriber
        // (detail.mail.destination). The CloudFront/web-version redirect path is
        // intentionally anonymous, so it never scores. processInterestScoring
        // looks up the clicked link's topic (link#hash(url)) and increments the
        // subscriber's interestScores, auto-creating an interest segment when a
        // topic crosses the threshold. It swallows its own errors; the wrapper
        // is defensive so a scoring failure never fails stat aggregation.
        try {
          await processInterestScoring(issueId, detail.mail.destination[0], detail.click.link);
        } catch (err) {
          console.error('Interest scoring failed on click', { issueId, error: err.message });
        }
        await recordTimeZoneFromIp(tenantId, detail.mail.destination[0], parseInt(issueNumber, 10), detail.click?.ipAddress);
        break;
      default:
        console.warn(`Unsupported stat ${detail.eventType} was provided`);
        return;
    }

    if (stat) {
      const updateExpression = `ADD #stat :val SET GSI1PK = if_not_exists(GSI1PK, :gsi1pk), GSI1SK = if_not_exists(GSI1SK, :gsi1sk), statsPhase = if_not_exists(statsPhase, :phase)${failedEmail ? ', #failedAddresses = list_append(if_not_exists(#failedAddresses, :emptyList), :failedAddresses)' : ''}`;

      await ddb.send(new UpdateItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({
          pk: issueId,
          sk: 'stats'
        }),
        UpdateExpression: updateExpression,
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
      }));

      const variantId = detail.mail.tags?.variant?.[0];
      if (variantId === 'a' || variantId === 'b') {
        await incrementVariantStat(issueId, variantId, stat);
      }
    }

    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
};

/**
 * Resolve the event IP to an IANA timezone (requires the GeoLite2 City DB in
 * the geolocation layer) and record it as a per-issue observation on the
 * subscriber. After the same zone is seen for 3 distinct issues the
 * subscriber's timeZone is confirmed, which powers the local-send feature.
 * Never throws — timezone tracking must not affect stat aggregation.
 */
const recordTimeZoneFromIp = async (tenantId, email, issueNumber, ipAddress) => {
  if (!ipAddress) {
    return;
  }

  try {
    const geo = await lookupGeo(ipAddress);
    if (geo?.timeZone) {
      await recordTimeZoneObservation(tenantId, email, issueNumber, geo.timeZone);
    }
  } catch (err) {
    console.error('Timezone observation failed', { tenantId, issueNumber, error: err.message });
  }
};

const incrementVariantStat = async (issueId, variantId, stat) => {
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: issueId,
        sk: `stats#v#${variantId}`
      }),
      UpdateExpression: 'ADD #stat :val SET statsPhase = if_not_exists(statsPhase, :phase)',
      ExpressionAttributeNames: {
        '#stat': stat
      },
      ExpressionAttributeValues: marshall({
        ':val': 1,
        ':phase': 'realtime'
      })
    }));
  } catch (err) {
    console.error('Failed to increment per-variant stat', { issueId, variantId, stat, error: err.message });
  }
};

const captureOpenEvent = async (issueId, subscriberEmail, openEvent, commonHeaders) => {
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

  const eventId = ulid();

  const openEventRecord = {
    pk: issueId,
    sk: `open#${timestamp}#${subscriberEmailHash}#${eventId}`,
    eventType: 'open',
    timestamp,
    subscriberEmailHash,
    device,
    country,
    timeToOpen,
    ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60)
  };

  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall(openEventRecord)
  }));
};

const captureBounceEvent = async (issueId, subscriberEmail, bounceEvent) => {
  const bouncedAt = bounceEvent?.timestamp ? new Date(bounceEvent.timestamp) : new Date();
  const timestamp = bouncedAt.toISOString();

  const subscriberEmailHash = hashEmail(subscriberEmail);

  const bounceType = categorizeBounceType(bounceEvent);
  const bounceReason = extractBounceReason(bounceEvent);

  const eventId = ulid();

  const bounceEventRecord = {
    pk: issueId,
    sk: `bounce#${timestamp}#${subscriberEmailHash}#${eventId}`,
    eventType: 'bounce',
    timestamp,
    subscriberEmailHash,
    bounceType,
    bounceReason,
    ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60)
  };

  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall(bounceEventRecord)
  }));
};

const captureComplaintEvent = async (issueId, subscriberEmail, complaintEvent) => {
  const complainedAt = complaintEvent?.timestamp ? new Date(complaintEvent.timestamp) : new Date();
  const timestamp = complainedAt.toISOString();

  const subscriberEmailHash = hashEmail(subscriberEmail);

  const complaintType = determineComplaintType(complaintEvent);

  const eventId = ulid();

  const complaintEventRecord = {
    pk: issueId,
    sk: `complaint#${timestamp}#${subscriberEmailHash}#${eventId}`,
    eventType: 'complaint',
    timestamp,
    subscriberEmailHash,
    complaintType,
    ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60)
  };

  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall(complaintEventRecord)
  }));
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

const trackUniqueOpen = async (issueId, emailAddress, openEvent) => {
  const timestamp = new Date().toISOString();
  const item = {
    pk: issueId,
    sk: `opens#${emailAddress}`,
    createdAt: timestamp,
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

  try {
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall(item),
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
    }));
    return false;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return true;
    }
    throw err;
  }
};

const trackLinkClick = async (issueId, link, ipAddress) => {
  const countryData = ipAddress ? await lookupCountry(ipAddress) : null;
  const country = countryData?.countryCode || 'unknown';

  const day = new Date().toISOString().slice(0, 10);
  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: issueId,
      sk: `link#${hash(link)}`
    }),
    UpdateExpression: 'ADD clicks_total :one SET #by.#day = if_not_exists(#by.#day, :zero) + :one, #country = if_not_exists(#country, :country)',
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

const captureClickEvent = async (issueId, subscriberEmail, clickEvent) => {
  const clickedAt = clickEvent?.timestamp ? new Date(clickEvent.timestamp) : new Date();
  const timestamp = clickedAt.toISOString();

  const subscriberEmailHash = hashEmail(subscriberEmail);
  const linkUrl = clickEvent?.link || 'unknown';
  const linkId = crypto.createHash('md5').update(linkUrl).digest('hex').substring(0, 8);
  const eventId = ulid();

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
    sk: `click#${timestamp}#${subscriberEmailHash}#${linkId}#${eventId}`,
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

  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall(clickEventRecord)
  }));
};
