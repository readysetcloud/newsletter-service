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

  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({ pk: `CAMPAIGN_LINK_CODE#${code}`, sk: 'METADATA' }),
  }));

  const row = result.Item ? unmarshall(result.Item) : null;
  // A link with a tenantId belonging to another tenant is reported as 404 so
  // existence isn't revealed. Legacy links (no tenantId) remain accessible.
  if (!row || !isOwnedByTenant(row, tenantId)) {
    return formatResponse(404, `Code ${code} not found`);
  }
  return formatResponse(200, {
    code: row.code,
    short_url: `${process.env.SHORT_LINK_BASE}/${row.code}`,
    url: row.url,
    src: row.src ?? null,
    campaign_id: row.campaignId ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    expires_at: row.expiresAt,
  });
};
