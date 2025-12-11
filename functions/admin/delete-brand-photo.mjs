import { S3Client, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
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

    const { key } = event.pathParameters || {};

    if (!key) {
      return formatResponse(400, 'Photo key is required');
    }

    // Decode the key since it comes from URL path
    const decodedKey = decodeURIComponent(key);

    return await deleteBrandPhoto(tenantId, decodedKey);

  } catch (error) {
    console.error('Delete brand photo error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Something went wrong');
  }
};

/**
 * Deletes a brand photo from S3
 * @param {string} tenantId - Tenant ID
 * @param {string} key - S3 object key
 * @returns {Object} Response confirming deletion
 */
const deleteBrandPhoto = async (tenantId, key) => {
  // Validate the key belongs to this tenant (security check)
  if (!key.startsWith(`brand-photos/${tenantId}/`)) {
    return formatResponse(403, 'Invalid photo key for this tenant');
  }

  // Check if the file exists before attempting deletion
  try {
    await s3.send(new HeadObjectCommand({
      Bucket: process.env.HOSTING_BUCKET_NAME,
      Key: key
    }));
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return formatResponse(404, 'Photo not found');
    }
    throw error; // Re-throw other S3 errors
  }

  // Delete the object from S3
  await s3.send(new DeleteObjectCommand({
    Bucket: process.env.HOSTING_BUCKET_NAME,
    Key: key
  }));

  return formatResponse(200, {
    message: 'Brand photo deleted successfully',
    key: key
  });
};
