import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';
import { downloadTemplate } from './utils/s3-storage.mjs';

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

    // First verify the snippet exists and belongs to this tenant
    const snippetResult = await ddb.send(new QueryCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: marshall({
        ':pk': `${tenantId}#${snippetId}`,
        ':sk': 'snippet'
      })
    }));

    if (!snippetResult.Items || snippetResult.Items.length === 0) {
      return formatResponse(404, 'Snippet not found');
    }

    const snippet = unmarshall(snippetResult.Items[0]);
    if (!snippet.isActive) {
      return formatResponse(404, 'Snippet not found');
    }

    // Query all templates for this tenant
    const templatesResult = await ddb.send(new QueryCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: '#GSI1PK = :tenantId AND begins_with(#GSI1SK, :templatePrefix)',
      ExpressionAttributeValues: marshall({
        ':tenantId': tenantId,
        ':templatePrefix': 'template'
      }),
      ProjectionExpression: '#id, #name, #description, snippets, s3Key, s3VersionId, createdAt, updatedAt, isActive',
      ExpressionAttributeNames: {
        '#id': 'id',
        '#name': 'name',
        '#description': 'description',
        '#GSI1PK': 'GSI1PK',
        '#GSI1SK': 'GSI1SK'
      }
    }));

    const templates = templatesResult.Items ? templatesResult.Items.map(item => unmarshall(item)) : [];
    const dependentTemplates = [];

    // Check each template to see if it uses this snippet
    for (const template of templates) {
      if (!template.isActive) continue;

      let usesSnippet = false;

      // Check if snippet is listed in the snippets array
      if (template.snippets && template.snippets.includes(snippetId)) {
        usesSnippet = true;
      } else {
        // Check template content for snippet usage
        try {
          const templateContent = await downloadTemplate(
            tenantId,
            template.id,
            template.s3Key,
            template.s3VersionId
          );

          // Look for snippet usage patterns in the content
          const snippetPatterns = [
            new RegExp(`{{>\\s*${snippet.name}\\s*.*?}}`, 'g'), // Handlebars partial syntax
            new RegExp(`{{\\s*snippet\\s+["']${snippet.name}["'].*?}}`, 'g'), // Custom snippet helper
            new RegExp(`\\[snippet:${snippet.name}\\]`, 'g'), // Shortcode syntax
            new RegExp(`\\[${snippet.name}\\]`, 'g') // Simple shortcode syntax
          ];

          for (const pattern of snippetPatterns) {
            if (pattern.test(templateContent.content)) {
              usesSnippet = true;
              break;
            }
          }
        } catch (error) {
          console.warn(`Failed to check template content for snippet usage: ${template.id}`, error);
          // Continue checking other templates even if one fails
        }
      }

      if (usesSnippet) {
        dependentTemplates.push({
          id: template.id,
          name: template.name,
          description: template.description,
          createdAt: template.createdAt,
          updatedAt: template.updatedAt
        });
      }
    }

    const response = {
      snippetId,
      snippetName: snippet.name,
      templates: dependentTemplates,
      usageCount: dependentTemplates.length
    };

    return formatResponse(200, response);

  } catch (error) {
    console.error('Get snippet usage error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Failed to get snippet usage');
  }
};
