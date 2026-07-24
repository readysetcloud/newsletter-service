import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, getTenantId, isOwnedByTenant } from './utils/helpers.mjs';

const ddb = new DynamoDBClient();

const CODE_PATTERN = /^[A-Za-z0-9]{6}$/;

export const handler = async (event) => {
  const tenantId = getTenantId(event);
  if (!tenantId) {
    return formatResponse(401, 'Unauthorized');
  }

  const code = event.pathParameters?.code;
  if (!code || !CODE_PATTERN.test(code)) {
    return formatResponse(400, 'code must be 6 alphanumeric characters');
  }

  const pk = `CAMPAIGN_LINK_CODE#${code}`;
  const [metadataResult, aggregateResult] = await Promise.all([
    ddb.send(new GetItemCommand({ TableName: process.env.TABLE_NAME, Key: marshall({ pk, sk: 'METADATA' }) })),
    ddb.send(new GetItemCommand({ TableName: process.env.TABLE_NAME, Key: marshall({ pk, sk: 'AGGREGATE' }) })),
  ]);

  // Ownership is established by the METADATA row (the aggregate isn't tenant
  // stamped). A link owned by another tenant is hidden as 404.
  const metadata = metadataResult.Item ? unmarshall(metadataResult.Item) : null;
  if (metadata && !isOwnedByTenant(metadata, tenantId)) {
    return formatResponse(404, `Code ${code} not found`);
  }

  if (!aggregateResult.Item) {
    return formatResponse(200, emptyAnalytics(code));
  }

  const row = unmarshall(aggregateResult.Item);
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
