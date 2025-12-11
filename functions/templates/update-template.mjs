import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';
import { uploadTemplate } from './utils/s3-storage.mjs';
import { validateTemplate, extractUsedSnippets } from './utils/template-engine.mjs';
import { templateCache } from './utils/template-cache.mjs';
import { validateTemplateName } from './utils/name-validation.mjs';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId, userId } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    const templateId = event.pathParameters?.templateId;
    if (!templateId) {
      return formatResponse(400, 'Template ID is required');
    }

    const body = JSON.parse(event.body || '{}');
    const {
      name,
      description,
      content,
      category,
      tags,
      isVisualMode,
      visualConfig
    } = body;

    // Get existing template
    const existingResult = await ddb.send(new GetItemCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      Key: marshall({
        PK: `${tenantId}#${templateId}`,
        SK: 'template'
      })
    }));

    if (!existingResult.Item) {
      return formatResponse(404, 'Template not found');
    }

    const existingTemplate = unmarshall(existingResult.Item);

    // Verify tenant
    console.log(tenantId);
    console.log(JSON.stringify(existingTemplate))
    if (existingTemplate.GSI1PK !== tenantId) {
      return formatAuthError('Access denied');
    }

    const timestamp = new Date().toISOString();
    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    // Build update expression for changed fields
    if (name !== undefined) {
      // Validate template name if it's being changed
      if (name !== existingTemplate.name) {
        const nameValidation = await validateTemplateName(tenantId, name, templateId);
        if (!nameValidation.isValid) {
          const statusCode = nameValidation.code === 'NAME_EXISTS' ? 409 : 400;
          return formatResponse(statusCode, {
            error: nameValidation.error,
            code: nameValidation.code,
            suggestions: nameValidation.suggestions || []
          });
        }

        updateExpressions.push('#name = :name');
        expressionAttributeNames['#name'] = 'name';
        expressionAttributeValues[':name'] = nameValidation.normalizedName;
      } else {
        // Name unchanged, still add to update expression
        updateExpressions.push('#name = :name');
        expressionAttributeNames['#name'] = 'name';
        expressionAttributeValues[':name'] = name;
      }
    }

    if (description !== undefined) {
      updateExpressions.push('description = :description');
      expressionAttributeValues[':description'] = description;
    }

    if (category !== undefined) {
      updateExpressions.push('category = :category');
      expressionAttributeValues[':category'] = category;
    }

    if (tags !== undefined) {
      updateExpressions.push('tags = :tags');
      expressionAttributeValues[':tags'] = tags;
    }

    if (isVisualMode !== undefined) {
      updateExpressions.push('isVisualMode = :isVisualMode');
      expressionAttributeValues[':isVisualMode'] = isVisualMode;
    }

    if (visualConfig !== undefined) {
      updateExpressions.push('visualConfig = :visualConfig');
      expressionAttributeValues[':visualConfig'] = visualConfig;
    }

    // Handle content update
    let newVersionId = existingTemplate.s3VersionId;
    if (content !== undefined) {
      // Validate template syntax
      const validation = validateTemplate(content);
      if (!validation.isValid) {
        return formatResponse(400, {
          message: 'Template validation failed',
          errors: validation.errors
        });
      }

      // Extract used snippets
      const snippets = extractUsedSnippets(content);
      updateExpressions.push('snippets = :snippets');
      expressionAttributeValues[':snippets'] = snippets;

      // Upload new version to S3
      const uploadResult = await uploadTemplate(existingTemplate.s3Key, content, {
        templateId,
        tenantId,
        name: name || existingTemplate.name,
        updatedBy: userId || 'api-key'
      });

      newVersionId = uploadResult.versionId;
      updateExpressions.push('s3VersionId = :s3VersionId');
      expressionAttributeValues[':s3VersionId'] = newVersionId;
    }

    // Always update these fields
    updateExpressions.push('updatedAt = :updatedAt');
    updateExpressions.push('#version = #version + :increment');
    updateExpressions.push('GSI1SK = :timestamp');

    expressionAttributeNames['#version'] = 'version';
    expressionAttributeValues[':updatedAt'] = timestamp;
    expressionAttributeValues[':increment'] = 1;
    expressionAttributeValues[':timestamp'] = timestamp;

    if (userId) {
      updateExpressions.push('updatedBy = :updatedBy');
      expressionAttributeValues[':updatedBy'] = userId;
    }

    // Update template in DynamoDB
    const updateResult = await ddb.send(new UpdateItemCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      Key: marshall({
        PK: `${tenantId}#${templateId}`,
        SK: 'template'
      }),
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
      ExpressionAttributeValues: marshall(expressionAttributeValues),
      ReturnValues: 'ALL_NEW'
    }));

    const updatedTemplate = unmarshall(updateResult.Attributes);

    // Update cache with new template metadata
    await templateCache.cacheTemplateMetadata(tenantId, templateId, updatedTemplate);

    // Invalidate template list cache to ensure updated template appears in lists
    await templateCache.invalidateTemplateListCache(tenantId);

    const response = {
      id: updatedTemplate.id,
      name: updatedTemplate.name,
      description: updatedTemplate.description,
      category: updatedTemplate.category,
      tags: updatedTemplate.tags || [],
      snippets: updatedTemplate.snippets || [],
      isVisualMode: updatedTemplate.isVisualMode || false,
      visualConfig: updatedTemplate.visualConfig,
      version: updatedTemplate.version,
      createdAt: updatedTemplate.createdAt,
      updatedAt: updatedTemplate.updatedAt,
      createdBy: updatedTemplate.createdBy,
      updatedBy: updatedTemplate.updatedBy,
      isActive: updatedTemplate.isActive,
      s3: {
        key: updatedTemplate.s3Key,
        versionId: newVersionId
      }
    };

    return formatResponse(200, response);

  } catch (error) {
    console.error('Update template error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.message.includes('Template validation failed')) {
      return formatResponse(400, error.message);
    }

    return formatResponse(500, 'Failed to update template');
  }
};
