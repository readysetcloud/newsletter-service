import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { formatResponse } from './utils/helpers.mjs';

const ddb = new DynamoDBClient();

const CODE_PATTERN = /^[A-Za-z0-9]{6}$/;

export const handler = async (event) => {
  const code = event.pathParameters?.code;
  if (!code || !CODE_PATTERN.test(code)) {
    return formatResponse(400, 'code must be 6 alphanumeric characters');
  }

  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({ pk: `CAMPAIGN_LINK_CODE#${code}`, sk: 'AGGREGATE' }),
  }));

  if (!result.Item) {
    return formatResponse(200, emptyAnalytics(code));
  }

  const row = unmarshall(result.Item);
  return formatResponse(200, {
    code,
    total_clicks: row.totalClicks ?? 0,
    by_day: row.byDay ?? {},
    by_src: row.bySrc ?? {},
    first_click_at: row.firstClickAt ?? null,
    last_click_at: row.lastClickAt ?? null,
  });
};

function emptyAnalytics(code) {
  return {
    code,
    total_clicks: 0,
    by_day: {},
    by_src: {},
    first_click_at: null,
    last_click_at: null,
  };
}
