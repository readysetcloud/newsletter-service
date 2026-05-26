import { DynamoDBClient, QueryCommand, BatchGetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { formatResponse } from './utils/helpers.mjs';

const ddb = new DynamoDBClient();

const MAX_CAMPAIGN_ID_LENGTH = 128;

export const handler = async (event) => {
  const campaignId = event.pathParameters?.campaignId;
  if (!campaignId || typeof campaignId !== 'string' || campaignId.trim().length === 0) {
    return formatResponse(400, 'campaignId is required');
  }
  if (campaignId.length > MAX_CAMPAIGN_ID_LENGTH) {
    return formatResponse(400, `campaignId exceeds ${MAX_CAMPAIGN_ID_LENGTH} chars`);
  }

  const links = await queryCampaignLinks(campaignId);
  const analyticsByCode = await batchGetAnalytics(links.map((link) => link.code));

  return formatResponse(200, {
    campaign_id: campaignId,
    total_links: links.length,
    total_clicks: links.reduce((sum, link) => sum + (analyticsByCode.get(link.code)?.total_clicks ?? 0), 0),
    links: links.map((link) => ({
      ...formatLink(link),
      analytics: analyticsByCode.get(link.code) ?? emptyAnalytics(link.code),
    })),
  });
};

async function queryCampaignLinks(campaignId) {
  const links = [];
  let exclusiveStartKey;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :campaign',
      ExpressionAttributeValues: marshall({
        ':campaign': `CAMPAIGN_LINK_CAMPAIGN#${campaignId}`,
      }),
      ExclusiveStartKey: exclusiveStartKey,
    }));

    links.push(...(result.Items || []).map((item) => unmarshall(item)));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return links;
}

async function batchGetAnalytics(codes) {
  const analyticsByCode = new Map();

  for (let i = 0; i < codes.length; i += 100) {
    const keys = codes.slice(i, i + 100).map((code) => marshall({
      pk: `CAMPAIGN_LINK_CODE#${code}`,
      sk: 'AGGREGATE',
    }));

    if (keys.length === 0) continue;
    let requestItems = {
      [process.env.TABLE_NAME]: { Keys: keys },
    };

    do {
      const result = await ddb.send(new BatchGetItemCommand({ RequestItems: requestItems }));
      for (const item of result.Responses?.[process.env.TABLE_NAME] || []) {
        const row = unmarshall(item);
        analyticsByCode.set(row.code, formatAnalytics(row.code, row));
      }
      requestItems = result.UnprocessedKeys && Object.keys(result.UnprocessedKeys).length > 0
        ? result.UnprocessedKeys
        : null;
    } while (requestItems);
  }

  return analyticsByCode;
}

function formatLink(row) {
  return {
    code: row.code,
    short_url: `${process.env.SHORT_LINK_BASE}/${row.code}`,
    url: row.url,
    src: row.src ?? null,
    campaign_id: row.campaignId ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    expires_at: row.expiresAt,
  };
}

function formatAnalytics(code, row) {
  return {
    code,
    total_clicks: row.totalClicks ?? 0,
    by_day: row.byDay ?? {},
    by_src: row.bySrc ?? {},
    first_click_at: row.firstClickAt ?? null,
    last_click_at: row.lastClickAt ?? null,
  };
}

function emptyAnalytics(code) {
  return formatAnalytics(code, {});
}
