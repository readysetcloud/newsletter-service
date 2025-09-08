import { DynamoDBClient, GetItemCommand, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';
import { deleteTemplate } from './utils/s3-storage.mjs';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId, userId, apiKeyId } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    const snippetId = event.pathParameters?.id;
    if (!snippetId) {
      return formatResponse(400, 'Snippet ID is required');
    }

    // Get existing snippet
    const getResult = await ddb.send(new GetItemCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      Key: marshall({
        PK: `${tenantId}#${snippetId}`,
        SK: 'snippet'
      })
    }));

    if (!getResult.Item) {
      return formatResponse(404, 'Snippet not found');
    }

    const snippet = unmarshall(getResult.Item);

    // Check for dependencies - find templates that use this snippet
    const dependentTemplates = await findDependentTemplates(tenantId, snippet.name);

    if (dependentTemplates.length > 0) {
      return formatResponse(409, {
        message: 'Cannot delete snippet because it is used by other templates',
        dependentTemplates: dependentTemplates.map(template => ({
          id: template.id,
          name: template.name
        }))
      });
    }

    const now = new Date().toISOString();

    // Soft delete - mark as inactive instead of hard delete
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      Key: marshall({
        PK: `${tenantId}#${snippetId}`,
        SK: 'snippet'
      }),
      UpdateExpression: 'SET isActive = :isActive, updatedAt = :updatedAt, deletedBy = :deletedBy',
      ExpressionAttributeValues: marshall({
        ':isActive': false,
        ':updatedAt': now,
        ':deletedBy': userId || apiKeyId
      })
    }));

    // Mark S3 object for deletion (due to versioning, this creates a delete marker)
    try {
      await deleteTemplate(snippet.s3Key);
    } catch (error) {
      console.error('S3 delete failed:', error);
      // Continue - DynamoDB record is already marked as deleted
    }

    return formatResponse(200, {
      message: 'Snippet deleted successfully',
      id: snippetId
    });

  } catch (error) {
    console.error('Delete snippet error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.message === 'Snippet not found') {
      return formatResponse(404, 'Snippet not found');
    }

    return formatResponse(500, 'Failed to delete snippet');
  }
};

/**
 * Find templates that depend on a specific snippet
 * @param {string} tenantId - Tenant ID
 * @param {string} snippetName - Name of the snippet to check
 * @returns {Promise<Array>} Array of dependent templates
 */
const findDependentTemplates = async (tenantId, snippetName) => {
  try {
    // Query all active templates for this tenant
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :tenantId AND begins_with(SK, :templatePrefix)',
      FilterExpression: 'isActive = :isActive AND contains(snippets, :snippetName)',
      ExpressionAttributeValues: marshall({
        ':tenantId': tenantId,
        ':templatePrefix': 'template',
        ':isActive': true,
        ':snippetName': snippetName
      })
    }));

    return result.Items ? result.Items.map(item => unmarshall(item)) : [];
  } catch (error) {
    console.error('Error finding dependent templates:', error);
    // Return empty array to be safe - don't block deletion due to query errors
    return [];
  }
};
