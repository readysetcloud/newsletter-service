import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';
import { templateCache } from './utils/template-cache.mjs';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    // Parse query parameters
    const queryParams = event.queryStringParameters || {};
    const limit = Math.min(parseInt(queryParams.limit) || 50, 100);
    const search = queryParams.search;
    const lastEvaluatedKey = queryParams.cursor ? JSON.parse(decodeURIComponent(queryParams.cursor)) : null;

    // Create cache key for this query (only for first page without cursor)
    const cacheFilters = { limit, search };
    let cachedResult = null;

    if (!lastEvaluatedKey) {
      cachedResult = await templateCache.getCachedSnippetList(tenantId, cacheFilters);
      if (cachedResult) {
        console.log('Returning cached snippet list');
        return formatResponse(200, {
          snippets: cachedResult,
          pagination: {
            hasMore: cachedResult.length >= limit,
            cursor: null,
            total: cachedResult.length,
            fromCache: true
          }
        });
      }
    }

    // Build optimized query parameters
    const queryInput = {
      TableName: process.env.TEMPLATES_TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :tenantId AND begins_with(SK, :snippetPrefix)',
      ExpressionAttributeValues: marshall({
        ':tenantId': tenantId,
        ':snippetPrefix': 'snippet'
      }),
      Limit: limit,
      ScanIndexForward: false, // Most recent first
      // Only return necessary attributes for list view
      ProjectionExpression: 'id, #name, description, parameters, version, createdAt, updatedAt, createdBy, isActive',
      ExpressionAttributeNames: {
        '#name': 'name'
      }
    };

    if (lastEvaluatedKey) {
      queryInput.ExclusiveStartKey = marshall(lastEvaluatedKey);
    }

    // Add search filter if provided
    if (search) {
      queryInput.FilterExpression = '(contains(#name, :search) OR contains(description, :search))';
      Object.assign(queryInput.ExpressionAttributeValues, marshall({
        ':search': search
      }));
    }

    const result = await ddb.send(new QueryCommand(queryInput));

    const snippets = result.Items ? result.Items.map(item => {
      const snippet = unmarshall(item);
      return {
        id: snippet.id,
        name: snippet.name,
        description: snippet.description,
        parameters: snippet.parameters || [],
        version: snippet.version,
        createdAt: snippet.createdAt,
        updatedAt: snippet.updatedAt,
        createdBy: snippet.createdBy,
        isActive: snippet.isActive
      };
    }) : [];

    // Cache the result if it's the first page and not too large
    if (!lastEvaluatedKey && snippets.length <= 100) {
      await templateCache.cacheSnippetList(tenantId, cacheFilters, snippets);
    }

    const response = {
      snippets,
      pagination: {
        hasMore: !!result.LastEvaluatedKey,
        cursor: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(unmarshall(result.LastEvaluatedKey))) : null,
        total: snippets.length,
        fromCache: false
      }
    };

    return formatResponse(200, response);

  } catch (error) {
    console.error('List snippets error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Failed to list snippets');
  }
};
