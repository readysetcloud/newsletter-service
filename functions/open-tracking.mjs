import { formatEmptyResponse } from "./utils/helpers.mjs";
import { DynamoDBClient, UpdateItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";

const ddb = new DynamoDBClient();
const BOT_USER_AGENTS = [
  /apple.*mail/i,                 // Apple Mail Privacy Protection
  /googleimageproxy/i,            // Gmail image proxy
  /outlook/i,                     // Outlook prefetcher
  /yahoo/i,                       // Yahoo Mail
  /cloudflare/i,                  // Cloudflare proxy
  /akamai/i,                      // Akamai
  /proofpoint/i,                  // Proofpoint scanners
  /trendmicro/i,                  // TrendMicro security
  /barracuda/i,                   // Barracuda link scanners
  /symantec/i                     // Symantec mail security
];

export const handler = async (event) => {
  try {
    const { tenant, slug } = event.pathParameters;
    const email = event.queryStringParameters?.email;

    if (!email) {
      console.error("Missing email parameter");
      return formatEmptyResponse();
    }

    const userAgent = event.headers['user-agent'] || event.headers['User-Agent'] || '';
    if (isBotUserAgent(userAgent)) {
      console.log(`Bot User-Agent detected (${userAgent}). Skipping open tracking.`);
      return formatEmptyResponse();
    }

    let updateExpression = 'ADD totalOpens :inc SET lastOpened = :now';
    try {
      await ddb.send(new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: marshall({
          pk: `${tenant}#${slug}`,
          sk: `opens#${email}`,
          createdAt: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
        }),
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
      }));
      updateExpression += ' ADD uniqueOpens :inc';
    } catch (conditionalError) {
      // If condition fails, this email has already opened this newsletter
      // This is expected behavior, so we don't increment unique_opens
      if (conditionalError.name === 'ConditionalCheckFailedException') {
        console.log(`Email ${email} has already opened newsletter ${slug}`);
      } else {
        throw conditionalError; // propagate real errors
      }
    }

    const now = new Date().toISOString();
    await dynamoClient.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: `${tenant}#${slug}`,
        sk: 'stats'
      }),
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: {
        ":inc": { N: "1" },
        ":now": { S: now }
      }
    }));
  } catch (err) {
    console.error("Error tracking email open:", err);
  }

  return formatEmptyResponse();
};

const isBotUserAgent = (userAgent) => {
  return BOT_USER_AGENTS.some(regex => regex.test(userAgent));
};
