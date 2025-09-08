import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';

const s3 = new S3Client();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    const templateId = event.pathParameters?.templateId;
    const versionId = event.pathParameters?.versionId;

    if (!templateId) {
      return formatResponse(400, 'Template ID is required');
    }

    if (!versionId) {
      return formatResponse(400, 'Version ID is required');
    }

    // Generate S3 key for the template
    const s3Key = `templates/${tenantId}/${templateId}.hbs`;

    // Get the specific version from S3
    const getObjectCommand = new GetObjectCommand({
      Bucket: process.env.TEMPLATES_BUCKET_NAME,
      Key: s3Key,
      VersionId: versionId
    });

    const result = await s3.send(getObjectCommand);

    if (!result.Body) {
      return formatResponse(404, 'Template version not found');
    }

    // Convert stream to string
    const content = await result.Body.transformToString();

    const response = {
      templateId,
      versionId,
      content,
      lastModified: result.LastModified,
      size: result.ContentLength,
      etag: result.ETag,
      metadata: result.Metadata || {}
    };

    return formatResponse(200, response);

  } catch (error) {
    console.error('Get template version error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.name === 'NoSuchBucket' || error.name === 'NoSuchKey' || error.name === 'NoSuchVersion') {
      return formatResponse(404, 'Template version not found');
    }

    return formatResponse(500, 'Failed to get template version');
  }
};
