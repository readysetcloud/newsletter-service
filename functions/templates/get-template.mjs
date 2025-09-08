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

    const templateId = event.pathParameters?.id;
    if (!templateId) {
      return formatResponse(400, 'Template ID is required');
    }

    const queryParams = event.queryStringParameters || {};
    const versionId = queryParams.version;
    const includeContent = queryParams.includeContent !== 'false';

    // Try to get cached metadata first
    let template = await templateCache.getCachedTemplateMetadata(tenantId, templateId);

    if (!template) {
      // Get template metadata from DynamoDB
      const result = await ddb.send(new QueryCommand({
        TableName: process.env.TEMPLATES_TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: marshall({
          ':pk': `${tenantId}#${templateId}`,
          ':sk': 'template'
        })
      }));

      if (!result.Items || result.Items.length === 0) {
        return formatResponse(404, 'Template not found');
      }

      template = unmarshall(result.Items[0]);

      // Cache the metadata
      await templateCache.cacheTemplateMetadata(tenantId, templateId, template);
    }

    // Check if template is active
    if (!template.isActive) {
      return formatResponse(404, 'Template not found');
    }

    const response = {
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      tags: template.tags || [],
      snippets: template.snippets || [],
      isVisualMode: template.isVisualMode || false,
      visualConfig: template.visualConfig,
      version: template.version,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      createdBy: template.createdBy,
      isActive: template.isActive
    };

    // Include content if requested
    if (includeContent) {
      try {
        const s3Result = await downloadTemplate(
          tenantId,
          templateId,
          template.s3Key,
          versionId || template.s3VersionId
        );

        response.content = s3Result.content;
        response.s3Metadata = {
          versionId: s3Result.versionId,
          lastModified: s3Result.lastModified,
          contentLength: s3Result.contentLength,
          fromCache: s3Result.fromCache
        };
      } catch (error) {
        console.error('Error downloading template content:', error);
        return formatResponse(500, 'Failed to retrieve template content');
      }
    }

    return formatResponse(200, response);

  } catch (error) {
    console.error('Get template error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Failed to retrieve template');
  }
};
