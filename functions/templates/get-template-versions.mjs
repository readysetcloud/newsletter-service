import { S3Client, ListObjectVersionsCommand } from '@aws-sdk/client-s3';
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
    if (!templateId) {
      return formatResponse(400, 'Template ID is required');
    }

    // Generate S3 key for the template
    const s3Key = `templates/${tenantId}/${templateId}.hbs`;

    // List all versions of the template from S3
    const listVersionsCommand = new ListObjectVersionsCommand({
      Bucket: process.env.TEMPLATES_BUCKET_NAME,
      Prefix: s3Key,
      MaxKeys: 50 // Limit to 50 versions
    });

    const versionsResult = await s3.send(listVersionsCommand);

    if (!versionsResult.Versions || versionsResult.Versions.length === 0) {
      return formatResponse(404, 'No versions found for this template');
    }

    // Filter and format versions
    const versions = versionsResult.Versions
      .filter(version => version.Key === s3Key && !version.IsDeleteMarker)
      .map(version => ({
        versionId: version.VersionId,
        lastModified: version.LastModified,
        size: version.Size,
        etag: version.ETag,
        isLatest: version.IsLatest || false
      }))
      .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

    const response = {
      templateId,
      s3Key,
      versions,
      totalVersions: versions.length
    };

    return formatResponse(200, response);

  } catch (error) {
    console.error('Get template versions error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.name === 'NoSuchBucket' || error.name === 'NoSuchKey') {
      return formatResponse(404, 'Template not found');
    }

    return formatResponse(500, 'Failed to get template versions');
  }
};
