import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';

const s3 = new S3Client();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId } = userContext;

    if (!tenantId) {
      return formatResponse(400, 'Tenant ID is required. Please complete brand setup first.');
    }

    const queryParams = event.queryStringParameters || {};
    const { search, limit = '50', continuationToken } = queryParams;

    return await listBrandPhotos(tenantId, { search, limit: parseInt(limit), continuationToken });

  } catch (error) {
    console.error('List brand photos error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Something went wrong');
  }
};

/**
 * Lists brand photos for a tenant
 * @param {string} tenantId - Tenant ID
 * @param {Object} options - Query options
 * @returns {Object} Response with photo list
 */
const listBrandPhotos = async (tenantId, options = {}) => {
  const { search, limit = 50, continuationToken } = options;

  // List objects in the tenant's brand photos folder
  const prefix = `brand-photos/${tenantId}/`;

  const listParams = {
    Bucket: process.env.HOSTING_BUCKET_NAME,
    Prefix: prefix,
    MaxKeys: Math.min(limit, 100), // Cap at 100 for performance
  };

  if (continuationToken) {
    listParams.ContinuationToken = continuationToken;
  }

  const response = await s3.send(new ListObjectsV2Command(listParams));

  let photos = (response.Contents || [])
    .filter(obj => obj.Key !== prefix) // Exclude the folder itself
    .map(obj => {
      const fileName = obj.Key.replace(prefix, '');
      const publicUrl = `https://${process.env.HOSTING_BUCKET_NAME}.s3.amazonaws.com/${obj.Key}`;

      return {
        key: obj.Key,
        fileName,
        publicUrl,
        size: obj.Size,
        lastModified: obj.LastModified,
        // Extract original filename from the timestamped filename
        originalName: fileName.includes('-') ? fileName.substring(fileName.indexOf('-') + 1) : fileName
      };
    });

  // Apply search filter if provided
  if (search && search.trim()) {
    const searchTerm = search.toLowerCase().trim();
    photos = photos.filter(photo =>
      photo.originalName.toLowerCase().includes(searchTerm) ||
      photo.fileName.toLowerCase().includes(searchTerm)
    );
  }

  // Sort by last modified (newest first)
  photos.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

  return formatResponse(200, {
    photos,
    hasMore: response.IsTruncated || false,
    nextContinuationToken: response.NextContinuationToken,
    totalCount: photos.length
  });
};
