import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';
import { uploadTemplate, generateSnippetKey } from './utils/s3-storage.mjs';
import { validateSnippet } from './utils/template-engine.mjs';
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
      parameters = [],
      content
    } = body;

    // Validate required fields
    if (!name || !content) {
      return formatResponse(400, 'Snippet name and content are required');
    }

    // Validate snippet name format
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return formatResponse(400, 'Snippet name can only contain letters, numbers, hyphens, and underscores');
    }

    // Check quota before proceeding
    try {
      await quotaManager.enforceQuota(tenantId, userTier || 'free-tier', 'snippet');
    } catch (quotaError) {
      if (quotaError.code === 'QUOTA_EXCEEDED') {
        return formatResponse(403, quotaManager.formatQuotaError(quotaError));
      }
      throw quotaError;
    }

    // Validate snippet content
    const validation = validateSnippet(content, parameters);
    if (!validation.isValid) {
      return formatResponse(400, {
        error: 'Snippet validation failed',
        validation: {
          errors: validation.errors,
          warnings: validation.warnings
        }
      });
    }

    // Validate parameters
    if (parameters && parameters.length > 0) {
      for (const param of parameters) {
        if (!param.name || !param.type) {
          return formatResponse(400, 'Each parameter must have a name and type');
        }

        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(param.name)) {
          return formatResponse(400, `Invalid parameter name "${param.name}". Must start with letter or underscore and contain only letters, numbers, and underscores.`);
        }

        if (!['string', 'number', 'boolean'].includes(param.type)) {
          return formatResponse(400, `Invalid parameter type "${param.type}". Must be string, number, or boolean.`);
        }
      }
    }

    // Generate snippet ID and metadata
    const snippetId = randomUUID();
    const now = new Date().toISOString();
    const s3Key = generateSnippetKey(tenantId, snippetId);

    // Upload snippet content to S3
    const uploadResult = await uploadTemplate(s3Key, content, {
      snippetId,
      tenantId,
      name,
      parameterCount: parameters.length
    });

    // Create snippet metadata in DynamoDB
    const snippetItem = {
      PK: `${tenantId}#${snippetId}`,
      SK: 'snippet',
      GSI1PK: tenantId,
      GSI1SK: `snippet#${now}`,
      id: snippetId,
      name,
      description: description || '',
      parameters: parameters || [],
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
      Item: marshall(snippetItem),
      ConditionExpression: 'attribute_not_exists(PK)'
    }));

    // Cache the snippet metadata
    await templateCache.cacheSnippetMetadata(tenantId, snippetId, snippetItem);

    // Invalidate snippet list cache
    await templateCache.invalidateSnippetListCache(tenantId);

    // Prepare response
    const response = {
      id: snippetId,
      name,
      description: description || '',
      parameters: parameters || [],
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
    console.error('Create snippet error:', error);

    if (error.name === 'ConditionalCheckFailedException') {
      return formatResponse(409, 'Snippet already exists');
    }

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Failed to create snippet');
  }
};
