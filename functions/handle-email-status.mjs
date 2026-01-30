import { DynamoDBClient, UpdateItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { hash } from './utils/helpers.mjs';
import { hashEmail } from './utils/hash-email.mjs';
import { detectDevice } from './utils/detect-device.mjs';
import { lookupCountry } from './utils/geolocation.mjs';
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
        break;
      case 'click':
        stat = 'clicks';
        await trackLinkClick(issueId, detail.click.link, detail.click.ipAddress);
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
    }

    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
};

const captureOpenEvent = async (issueId, subscriberEmail, openEvent, commonHeaders) => {
  const openedAt = openEvent?.timestamp ? new Date(openEvent.timestamp) : new Date();
  const timestamp = openedAt.toISOString();

  const subscriberEmailHash = hashEmail(subscriberEmail);

  const userAgent = openEvent?.userAgent || null;

  const device = detectDevice(userAgent);
  const country = 'unknown';

  const sentAt = commonHeaders?.date || null;
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
