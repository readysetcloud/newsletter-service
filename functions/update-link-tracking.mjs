import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { hash } from './utils/helpers.mjs';

const ddb = new DynamoDBClient();

const LINK_EXPIRATION_DAYS = 14;

export const handler = async (state) => {
  const linkRegex = /\[.*?\]\((.*?)\)/g;
  let matches;

  let updatedContent = state.content;
  while ((matches = linkRegex.exec(state.content)) !== null) {
    // Avoid infinite loops with zero-width matches
    if (matches.index === linkRegex.lastIndex) {
      linkRegex.lastIndex++;
    }

    if (matches[1] && matches[1].indexOf('mailto:') === -1) {
      await initializeLinkRecord(state.tenantId, state.issueId, matches[1]);
      updatedContent = updatedContent.replace(matches[1], `${process.env.REDIRECT_URL}/r?u=${encodeURI(matches[1])}&cid=${encodeURIComponent(`${state.tenantId}_${state.issueId}`)}`)
    }
  }

  return { content: updatedContent };
};

const initializeLinkRecord = async (tenantId, issueId, link) => {
  try {
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        pk: `${tenantId}#${issueId}`,
        sk: `link#${hash(link)}`,
        url: link,
        totalClicks: 0,
        byDay: {},
        ttl: Math.floor(Date.now() / 1000) + (LINK_EXPIRATION_DAYS * 24 * 60 * 60)
      }),
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
    }));
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') {
      throw err;
    }
  }
};
