import { DynamoDBClient, GetItemCommand, UpdateItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import crypto from 'crypto';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { formatResponse } from './utils/helpers.mjs';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    if (!event.pathParameters?.tenant || !event.pathParameters?.slug) {
      return formatResponse(400, 'Missing tenant or slug');
    }
    if (!event.body) {
      return formatResponse(400, 'Missing request body');
    }
    if (!event.requestContext?.identity?.sourceIp) {
      return formatResponse(400, 'Unable to identify voter');
    }

    const { tenant, slug } = event.pathParameters;
    let choice;

    try {
      ({ choice } = JSON.parse(event.body));
    } catch {
      return formatResponse(400, 'Invalid JSON body');
    }

    if (!choice) {
      return formatResponse(400, 'Missing choice');
    }

    const voteResponse = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: `${tenant}#${slug}`,
        sk: 'votes',
      })
    }));

    if (!voteResponse.Item) {
      return formatResponse(404, 'Vote not found');
    }

    const vote = unmarshall(voteResponse.Item);
    if (!vote.options?.some(o => o.id === choice)) {
      return formatResponse(400, 'Invalid choice');
    }

    const ip = event.requestContext.identity.sourceIp;
    const hashedIp = crypto.createHash('sha256').update(ip).digest('hex');

    let updatedVote = vote;

    try {
      await ddb.send(new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: marshall({
          pk: `${tenant}#${slug}`,
          sk: `voter#${hashedIp}`,
          createdAt: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
        }),
        ConditionExpression: 'attribute_not_exists(pk)'
      }));

      // If we get here, this is a new vote - update the count
      const updateResponse = await ddb.send(new UpdateItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({
          pk: `${tenant}#${slug}`,
          sk: 'votes'
        }),
        UpdateExpression: 'SET #choice = #choice + :inc',
        ExpressionAttributeNames: {
          '#choice': choice
        },
        ExpressionAttributeValues: marshall({
          ':inc': 1
        }),
        ReturnValues: 'ALL_NEW'
      }));

      updatedVote = unmarshall(updateResponse.Attributes);
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        // User has already voted - that's fine, we'll just return current results
        // updatedVote is already set to the original vote data
      } else {
        throw err;
      }
    }

    const options = vote.options.reduce((acc, option) => {
      acc[option.id] = updatedVote[option.id] || 0;
      return acc;
    }, {});
    return formatResponse(200, options);
  } catch (err) {
    console.error(err);
    return formatResponse(500, 'Something went wrong');
  }
};
