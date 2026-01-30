import { DynamoDBClient, UpdateItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { hash } from './utils/helpers.mjs';

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
        stat = 'complaints';
        break;
      case 'open':
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
  // TODO - geo-ip tracking. need to roll this up somewhere
  const day = new Date().toISOString().slice(0, 10);
  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: issueId,
      sk: `link#${hash(link)}`
    }),
    UpdateExpression: 'ADD clicks_total :one SET #by.#day = if_not_exists(#by.#day, :zero) + :one',
    ExpressionAttributeNames: {
      '#by': 'byDay',
      '#day': day
    },
    ExpressionAttributeValues: marshall({
      ':one': 1,
      ':zero': 0
    })
  }));
};
