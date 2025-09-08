import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';
import { uploadTemplate, generateTemplateKey } from './utils/s3-storage.mjs';
import { validateTemplate } from './utils/template-engine.mjs';
import { templateCache } from './utils/template-cache.mjs';
import { quotaManager } from './utils/quota-manager.mjs';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId, userTier } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const {
      name,
      description,
      category,
      tags = [],
      content,
      isVisualMode = false,
      visualConfig
    } = body;

    // Validate required fields
    if (!name || !content) {
      return formatResponse(400, 'Template name and content are required');
    }

    // Check quota before proceeding
    try {
      await quotaManager.enforceQuota(tenantId, userTier || 'free-tier', 'template');
    } catch (quotaError) {
      if (quotaError.code === 'QUOTA_EXCEEDED') {
        return formatResponse(403, quotaManager.formatQuotaError(quotaError));
      }
      throw quotaError;
    }

    // Validate template content
    const validation = validateTemplate(content);
    if (!validation.isValid) {
      return formatResponse(400, {
        error: 'Template validation failed',
        validation: {
          errors: validation.errors,
          warnings: validation.warnings
        }
      });
    }

    // Generate template ID and metadata
    const templateId = randomUUID();
    const now = new Date().toISOString();
    const s3Key = generateTemplateKey(tenantId, templateId);

    // Upload template content to S3
    const uploadResult = await uploadTemplate(s3Key, content, {
      templateId,
      tenantId,
      name,
      category: category || 'general'
    });

    // Create template metadata in DynamoDB
    const templateItem = {
      PK: `${tenantId}#${templateId}`,
      SK: 'template',
      GSI1PK: tenantId,
      GSI1SK: `template#${now}`,
      id: templateId,
      name,
      description: description || '',
      category: category || 'general',
      tags: tags || [],
      snippets: [], // Will be populated when snippets are used
      isVisualMode,
      visualConfig: visualConfig || null,
      s3Key,
      s3VersionId: uploadResult.versionId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: userContext.userId || 'unknown',
      isActive: true
    };

    await ddb.send(new PutItemCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      Item: marshall(templateItem),
      ConditionExpression: 'attribute_not_exists(PK)'
    }));

    // Cache the template metadata
    await templateCache.cacheTemplateMetadata(tenantId, templateId, templateItem);

    // Invalidate template list cache
    await templateCache.invalidateTemplateListCache(tenantId);

    // Prepare response
    const response = {
      id: templateId,
      name,
      description: description || '',
      category: category || 'general',
      tags: tags || [],
      snippets: [],
      isVisualMode,
      visualConfig: visualConfig || null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: userContext.userId || 'unknown',
      isActive: true,
      s3Metadata: {
        versionId: uploadResult.versionId,
        etag: uploadResult.etag
      }
    };

    return formatResponse(201, response);

  } catch (error) {
    console.error('Create template error:', error);

    if (error.name === 'ConditionalCheckFailedException') {
      return formatResponse(409, 'Template already exists');
    }

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Failed to create template');
  }
};
