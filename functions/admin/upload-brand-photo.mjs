import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { marshall } from "@aws-sdk/util-dynamodb";
import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';

const s3 = new S3Client();
const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId } = userContext;

    if (!tenantId) {
      return formatResponse(400, 'Tenant ID is required. Please complete brand setup first.');
    }

    const method = event.httpMethod;
    const body = event.body ? JSON.parse(event.body) : {};

    if (method === 'POST') {
      return await generateUploadUrl(tenantId, body);
    } else if (method === 'PUT') {
      return await confirmUpload(tenantId, body);
    } else {
      return formatResponse(405, 'Method not allowed');
    }

  } catch (error) {
    console.error('Brand photo upload error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Something went wrong');
  }
};

/**
 * Generates a presigned URL for uploading a brand logo
 * @param {string} tenantId - Tenant ID
 * @param {Object} body - Request body with fileName and contentType
 * @returns {Object} Response with presigned URL
 */
const generateUploadUrl = async (tenantId, body) => {
  const { fileName, contentType } = body;

  // Validate required fields
  if (!fileName || typeof fileName !== 'string' || fileName.trim().length === 0) {
    return formatResponse(400, '"fileName" is required and must be a non-empty string');
  }

  if (!contentType || typeof contentType !== 'string') {
    return formatResponse(400, '"contentType" is required and must be a string');
  }

  // Validate content type (only allow images)
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(contentType.toLowerCase())) {
    return formatResponse(400, 'Only image files are allowed (JPEG, PNG, GIF, WebP)');
  }

  // Validate file extension matches content type
  const fileExtension = fileName.toLowerCase().split('.').pop();
  const validExtensions = {
    'image/jpeg': ['jpg', 'jpeg'],
    'image/jpg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/gif': ['gif'],
    'image/webp': ['webp']
  };

  if (!validExtensions[contentType.toLowerCase()]?.includes(fileExtension)) {
    return formatResponse(400, 'File extension does not match content type');
  }

  // Generate unique file name to prevent conflicts
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const key = `brand-logos/${tenantId}/${timestamp}-${sanitizedFileName}`;

  // Create presigned URL for upload
  const command = new PutObjectCommand({
    Bucket: process.env.HOSTING_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    ContentLengthRange: [1, 2 * 1024 * 1024], // 1 byte to 2MB
    Metadata: {
      tenantId: tenantId,
      uploadedAt: new Date().toISOString()
    }
  });

  const presignedUrl = await getSignedUrl(s3, command, {
    expiresIn: 300 // 5 minutes
  });

  return formatResponse(200, {
    uploadUrl: presignedUrl,
    key: key,
    expiresIn: 300,
    maxSize: 2 * 1024 * 1024, // 2MB in bytes
    publicUrl: `https://${process.env.HOSTING_BUCKET_NAME}.s3.amazonaws.com/${key}`
  });
};

/**
 * Confirms the upload and updates the tenant record with the logo information
 * @param {string} tenantId - Tenant ID
 * @param {Object} body - Request body with key and other logo details
 * @returns {Object} Response confirming the update
 */
const confirmUpload = async (tenantId, body) => {
  const { key, fileName } = body;

  // Validate required fields
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    return formatResponse(400, '"key" is required and must be a non-empty string');
  }

  // Verify the key belongs to this tenant (security check)
  if (!key.startsWith(`brand-logos/${tenantId}/`)) {
    return formatResponse(403, 'Invalid logo key for this tenant');
  }

  // Check if the file actually exists in S3
  try {
    await s3.send(new HeadObjectCommand({
      Bucket: process.env.HOSTING_BUCKET_NAME,
      Key: key
    }));
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return formatResponse(404, 'Photo not found in storage. Upload may have failed.');
    }
    throw error; // Re-throw other S3 errors
  }

  // Check if tenant exists
  const tenantResponse = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: 'tenant'
    })
  }));

  if (!tenantResponse.Item) {
    return formatResponse(404, 'Tenant not found');
  }

  // Update tenant record with logo information
  const publicUrl = `https://${process.env.HOSTING_BUCKET_NAME}.s3.amazonaws.com/${key}`;

  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: 'tenant'
    }),
    UpdateExpression: 'SET brandPhoto = :photo, brandPhotoKey = :key, updatedAt = :updatedAt',
    ExpressionAttributeValues: marshall({
      ':photo': publicUrl,
      ':key': key,
      ':updatedAt': new Date().toISOString()
    })
  }));

  // For onboarding users, we just return the URL - it will be saved when they complete the brand setup

  return formatResponse(200, {
    message: 'Brand logo updated successfully',
    photoUrl: publicUrl,
    key: key
  });
};
