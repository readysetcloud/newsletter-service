import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';
import { templateCache } from './utils/template-cache.mjs';
import { performanceMonitor } from './utils/performance-monitor.mjs';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  const timerId = performanceMonitor.startTimer('list_templates');

  try {
    const userContext = getUserContext(event);
    const { tenantId } = userContext;

    if (!tenantId) {
      performanceMonitor.endTimer(timerId, { success: false, error: 'No tenant ID' });
      return formatAuthError('Tenant access required');
    }

    // Parse query parameters
    const queryParams = event.queryStringParameters || {};
    const limit = Math.min(parseInt(queryParams.limit) || 50, 100);
    const category = queryParams.category;
    const search = queryParams.search;
    const lastEvaluatedKey = queryParams.cursor ? JSON.parse(decodeURIComponent(queryParams.cursor)) : null;

    // Create cache key for this query (only for first page without cursor)
    const cacheFilters = { limit, category, search };
    let cachedResult = null;

    if (!lastEvaluatedKey) {
      cachedResult = await templateCache.getCachedTemplateList(tenantId, cacheFilters);
      if (cachedResult) {
        performanceMonitor.logCacheMetric('template_list', true, { tenantId, filters: cacheFilters });
        performanceMonitor.endTimer(timerId, { success: true, fromCache: true, count: cachedResult.length });
        console.log('Returning cached template list');
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
      performanceMonitor.logCacheMetric('template_list', false, { tenantId, filters: cacheFilters });
    }

    // Build optimized query parameters
    const queryInput = {
      TableName: process.env.TEMPLATES_TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :tenantId AND begins_with(SK, :templatePrefix)',
      ExpressionAttributeValues: marshall({
        ':tenantId': tenantId,
        ':templatePrefix': 'template'
      }),
      Limit: limit,
      ScanIndexForward: false, // Most recent first
      // Only return necessary attributes for list view
      ProjectionExpression: 'id, #name, description, category, tags, snippets, isVisualMode, version, createdAt, updatedAt, createdBy, isActive',
      ExpressionAttributeNames: {
        '#name': 'name'
      }
    };

    if (lastEvaluatedKey) {
      queryInput.ExclusiveStartKey = marshall(lastEvaluatedKey);
    }

    // Add filter expressions if needed
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

    const ddbTimerId = performanceMonitor.startTimer('dynamodb_query_templates', { tenantId });
    const result = await ddb.send(new QueryCommand(queryInput));
    const ddbDuration = performanceMonitor.endTimer(ddbTimerId, { success: true }).duration;

    // Log DynamoDB performance
    performanceMonitor.logDynamoDBMetric(
      process.env.TEMPLATES_TABLE_NAME,
      'Query',
      result.Items?.length || 0,
      result.ConsumedCapacity?.CapacityUnits || 0,
      ddbDuration,
      { tenantId, indexName: 'GSI1' }
    );

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

    // Cache the result if it's the first page and not too large
    if (!lastEvaluatedKey && templates.length <= 100) {
      await templateCache.cacheTemplateList(tenantId, cacheFilters, templates);
    }

    const response = {
      templates,
      pagination: {
        hasMore: !!result.LastEvaluatedKey,
        cursor: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(unmarshall(result.LastEvaluatedKey))) : null,
        total: templates.length,
        fromCache: false
      }
    };

    performanceMonitor.endTimer(timerId, {
      success: true,
      fromCache: false,
      count: templates.length,
      hasMore: !!result.LastEvaluatedKey
    });

    return formatResponse(200, response);

  } catch (error) {
    performanceMonitor.endTimer(timerId, { success: false, error: error.message });
    console.error('List templates error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Failed to list templates');
  }
};
