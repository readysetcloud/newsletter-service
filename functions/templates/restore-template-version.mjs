import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { marshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, formatAuthError } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';

const ddb = new DynamoDBClient();
const s3 = new S3Client();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId, userId } = userContext;

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

    // Get the specific version content from S3
    const getObjectCommand = new GetObjectCommand({
      Bucket: process.env.TEMPLATES_BUCKET_NAME,
      Key: s3Key,
      VersionId: versionId
    });

    const versionResult = await s3.send(getObjectCommand);

    if (!versionResult.Body) {
      return formatResponse(404, 'Template version not found');
    }

    const content = await versionResult.Body.transformToString();

    // Upload the version content as the new current version
    const putObjectCommand = new PutObjectCommand({
      Bucket: process.env.TEMPLATES_BUCKET_NAME,
      Key: s3Key,
      Body: content,
      ContentType: 'text/plain',
      Metadata: {
        templateId,
        tenantId,
        restoredFrom: versionId,
        restoredBy: userId || 'api-key',
        restoredAt: new Date().toISOString()
      }
    });

    const uploadResult = await s3.send(putObjectCommand);

    // Update the DynamoDB record with new version info
    const timestamp = new Date().toISOString();
    const updateCommand = new UpdateItemCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      Key: marshall({
        PK: `${tenantId}#${templateId}`,
        SK: 'template'
      }),
      UpdateExpression: 'SET s3VersionId = :versionId, updatedAt = :timestamp, version = version + :inc',
      ExpressionAttributeValues: marshall({
        ':versionId': uploadResult.VersionId,
        ':timestamp': timestamp,
        ':inc': 1
      }),
      ReturnValues: 'ALL_NEW'
    });

    await ddb.send(updateCommand);

    const response = {
      templateId,
      restoredFromVersion: versionId,
      newVersionId: uploadResult.VersionId,
      restoredAt: timestamp,
      restoredBy: userId
    };

    return formatResponse(200, response);

  } catch (error) {
    console.error('Restore template version error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.name === 'NoSuchBucket' || error.name === 'NoSuchKey' || error.name === 'NoSuchVersion') {
      return formatResponse(404, 'Template version not found');
    }

    return formatResponse(500, 'Failed to restore template version');
  }
};
