import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';
import { downloadTemplate } from './utils/s3-storage.mjs';
import { templateCache } from './utils/template-cache.mjs';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    const snippetId = event.pathParameters?.id;
    if (!snippetId) {
      return formatResponse(400, 'Snippet ID is required');
    }

    const queryParams = event.queryStringParameters || {};
    const versionId = queryParams.version;
    const includeContent = queryParams.includeContent !== 'false';

    // Try to get cached metadata first
    let snippet = await templateCache.getCachedSnippetMetadata(tenantId, snippetId);

    if (!snippet) {
      // Get snippet metadata from DynamoDB
      const result = await ddb.send(new QueryCommand({
        TableName: process.env.TEMPLATES_TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: marshall({
          ':pk': `${tenantId}#${snippetId}`,
          ':sk': 'snippet'
        })
      }));

      if (!result.Items || result.Items.length === 0) {
        return formatResponse(404, 'Snippet not found');
      }

      snippet = unmarshall(result.Items[0]);

      // Cache the metadata
      await templateCache.cacheSnippetMetadata(tenantId, snippetId, snippet);
    }

    // Check if snippet is active
    if (!snippet.isActive) {
      return formatResponse(404, 'Snippet not found');
    }

    const response = {
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

    // Include content if requested
    if (includeContent) {
      try {
        const s3Result = await downloadTemplate(
          tenantId,
          snippetId,
          snippet.s3Key,
          versionId || snippet.s3VersionId
        );

        response.content = s3Result.content;
        response.s3Metadata = {
          versionId: s3Result.versionId,
          lastModified: s3Result.lastModified,
          contentLength: s3Result.contentLength,
          fromCache: s3Result.fromCache
        };
      } catch (error) {
        console.error('Error downloading snippet content:', error);
        return formatResponse(500, 'Failed to retrieve snippet content');
      }
    }

    return formatResponse(200, response);

  } catch (error) {
    console.error('Get snippet error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Failed to retrieve snippet');
  }
};
