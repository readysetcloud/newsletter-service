import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, getTenant } from '../utils/helpers.mjs';

const ddb = new DynamoDBClient();

let cache = {};

export const handler = async (event) => {
  try {
    const { tenant: tenantId } = event.pathParameters;

    if (!tenantId) {
      return formatResponse(400, 'Tenant ID is required');
    }

    const weekStartDate = getPreviousSunday();
    const cacheKey = `stats:${tenantId}:${weekStartDate.getTime()}`;

    if (cache[cacheKey] && cache[cacheKey].expiresAt > Date.now()) {
      const response = formatResponse(200, cache[cacheKey].data);
      response.headers['Cache-Control'] = 'public, max-age=3600';
      return response;
    }

    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return formatResponse(404, 'Tenant not found');
    }

    const totalSubscribers = tenant.subscribers || 0;

    const weekStartTimestamp = weekStartDate.getTime();
    const queryResult = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :tenantId AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: marshall({
        ':tenantId': tenantId,
        ':prefix': `subscriber#${weekStartTimestamp}`
      })
    }));

    const newThisWeek = queryResult.Items ? queryResult.Items.length : 0;

    const stats = {
      totalSubscribers,
      newThisWeek
    };

    cache[cacheKey] = {
      data: stats,
      expiresAt: Date.now() + (60 * 60 * 1000)
    };

    const response = formatResponse(200, stats);
    response.headers['Cache-Control'] = 'public, max-age=3600';
    return response;
  } catch (err) {
    console.error('Get subscriber stats error:', err);
    return formatResponse(500, 'Failed to retrieve subscriber stats');
  }
};

const getPreviousSunday = () => {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const daysToSubtract = dayOfWeek === 0 ? 7 : dayOfWeek;
  const sunday = new Date(now);
  sunday.setUTCDate(now.getUTCDate() - daysToSubtract);
  sunday.setUTCHours(0, 0, 0, 0);
  return sunday;
};
