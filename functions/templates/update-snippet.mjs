import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';
import { uploadTemplate, generateSnippetKey } from './utils/s3-storage.mjs';
import { validateTemplate } from './utils/template-engine.mjs';

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

    const body = JSON.parse(event.body || '{}');
    const { name, description, content, parameters } = body;

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

    const existingSnippet = unmarshall(getResult.Item);

    // Validate snippet name format if provided
    if (name && !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return formatResponse(400, 'Snippet name must contain only letters, numbers, hyphens, and underscores');
    }

    // Validate handlebars syntax if content is provided
    if (content) {
      const validation = validateTemplate(content);
      if (!validation.isValid) {
        return formatResponse(400, {
          message: 'Invalid handlebars syntax',
          errors: validation.errors
        });
      }
    }

    // Validate parameters if provided
    if (parameters && Array.isArray(parameters)) {
      for (const param of parameters) {
        if (!param.name || !param.type) {
          return formatResponse(400, 'Each parameter must have a name and type');
        }
        if (!['string', 'number', 'boolean'].includes(param.type)) {
          return formatResponse(400, 'Parameter type must be string, number, or boolean');
        }
        if (!/^[a-zA-Z0-9_]+$/.test(param.name)) {
          return formatResponse(400, 'Parameter names must contain only letters, numbers, and underscores');
        }
      }
    }

    const now = new Date().toISOString();
    let s3VersionId = existingSnippet.s3VersionId;

    // Upload new content to S3 if provided (creates new version)
    if (content) {
      try {
        const s3Key = generateSnippetKey(tenantId, snippetId);
        const s3Result = await uploadTemplate(s3Key, content, {
          snippetId,
          tenantId,
          name: name || existingSnippet.name,
          updatedBy: userId || apiKeyId,
          version: existingSnippet.version + 1
        });
        s3VersionId = s3Result.versionId;
      } catch (error) {
        console.error('S3 upload failed:', error);
        return formatResponse(500, 'Failed to store updated snippet content');
      }
    }

    // Build update expression
    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    if (name !== undefined) {
      updateExpressions.push('#name = :name');
      expressionAttributeNames['#name'] = 'name';
      expressionAttributeValues[':name'] = name;
    }

    if (description !== undefined) {
      updateExpressions.push('description = :description');
      expressionAttributeValues[':description'] = description;
    }

    if (parameters !== undefined) {
      updateExpressions.push('parameters = :parameters');
      expressionAttributeValues[':parameters'] = parameters;
    }

    if (content) {
      updateExpressions.push('s3VersionId = :s3VersionId');
      updateExpressions.push('#version = #version + :increment');
      expressionAttributeNames['#version'] = 'version';
      expressionAttributeValues[':s3VersionId'] = s3VersionId;
      expressionAttributeValues[':increment'] = 1;
    }

    updateExpressions.push('updatedAt = :updatedAt');
    expressionAttributeValues[':updatedAt'] = now;

    if (userId) {
      updateExpressions.push('updatedBy = :updatedBy');
      expressionAttributeValues[':updatedBy'] = userId;
    }

    // Update snippet in DynamoDB
    const updateResult = await ddb.send(new UpdateItemCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      Key: marshall({
        PK: `${tenantId}#${snippetId}`,
        SK: 'snippet'
      }),
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
      ExpressionAttributeValues: marshall(expressionAttributeValues),
      ReturnValues: 'ALL_NEW'
    }));

    const updatedSnippet = unmarshall(updateResult.Attributes);

    const response = {
      id: updatedSnippet.id,
      name: updatedSnippet.name,
      description: updatedSnippet.description,
      content: content || undefined, // Only include content if it was updated
      parameters: updatedSnippet.parameters || [],
      version: updatedSnippet.version,
      createdAt: updatedSnippet.createdAt,
      updatedAt: updatedSnippet.updatedAt,
      createdBy: updatedSnippet.createdBy,
      isActive: updatedSnippet.isActive,
      s3VersionId: updatedSnippet.s3VersionId
    };

    return formatResponse(200, response);

  } catch (error) {
    console.error('Update snippet error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.message === 'Snippet not found') {
      return formatResponse(404, 'Snippet not found');
    }

    return formatResponse(500, 'Failed to update snippet');
  }
};
