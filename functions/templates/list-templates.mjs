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
    const category = queryParams.category;
    const search = queryParams.search;
    const lastEvaluatedKey = queryParams.cursor ? JSON.parse(decodeURIComponent(queryParams.cursor)) : null;

    // Check cache for first page only
    const cacheFilters = { limit, category, search };
    if (!lastEvaluatedKey) {
      const cachedResult = await templateCache.getCachedTemplateList(tenantId, cacheFilters);
      if (cachedResult) {
        return formatResponse(200, {
          templates: cachedResult,
          pagination: {
            hasMore: cachedResult.length >= limit,
            cursor: null,
            total: cachedResult.length,
            fromCache: true
          }
        });
      }
    }

    // Build DynamoDB query
    const queryInput = {
      TableName: process.env.TEMPLATES_TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :tenantId AND begins_with(GSI1SK, :templatePrefix)',
      ExpressionAttributeValues: marshall({
        ':tenantId': tenantId,
        ':templatePrefix': 'template'
      }),
      Limit: limit,
      ScanIndexForward: false,
      ProjectionExpression: 'id, #name, description, category, tags, snippets, isVisualMode, version, createdAt, updatedAt, createdBy, isActive',
      ExpressionAttributeNames: {
        '#name': 'name'
      }
    };

    if (lastEvaluatedKey) {
      queryInput.ExclusiveStartKey = marshall(lastEvaluatedKey);
    }

    // Add filters
    const filterExpressions = [];
    const filterValues = {};

    if (category) {
      filterExpressions.push('category = :category');
      filterValues[':category'] = category;
    }

    if (search) {
      filterExpressions.push('(contains(#name, :search) OR contains(description, :search))');
      filterValues[':search'] = search;
    }

    if (filterExpressions.length > 0) {
      queryInput.FilterExpression = filterExpressions.join(' AND ');
      Object.assign(queryInput.ExpressionAttributeValues, marshall(filterValues));
    }

    const result = await ddb.send(new QueryCommand(queryInput));

    const templates = result.Items ? result.Items.map(item => {
      const template = unmarshall(item);
      return {
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
        tags: template.tags || [],
        snippets: template.snippets || [],
        isVisualMode: template.isVisualMode || false,
        version: template.version,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
        createdBy: template.createdBy,
        isActive: template.isActive
      };
    }) : [];

    // Cache first page results
    if (!lastEvaluatedKey && templates.length <= 100) {
      await templateCache.cacheTemplateList(tenantId, cacheFilters, templates);
    }

    return formatResponse(200, {
      templates,
      pagination: {
        hasMore: !!result.LastEvaluatedKey,
        cursor: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(unmarshall(result.LastEvaluatedKey))) : null,
        total: templates.length,
        fromCache: false
      }
    });

  } catch (error) {
    console.error('List templates error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Failed to list templates');
  }
};
