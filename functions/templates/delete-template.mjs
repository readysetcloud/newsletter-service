import { DynamoDBClient, DeleteItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { formatResponse, formatAuthError, formatEmptyResponse } from '../utils/helpers.mjs';
import { getUserContext } from '../auth/get-user-context.mjs';
import { deleteTemplate as deleteFromS3 } from './utils/s3-storage.mjs';

const ddb = new DynamoDBClient();

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

    // Get existing template to verify access and get S3 key
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

    // Verify tenant access
    if (existingTemplate.tenantId !== tenantId) {
      return formatAuthError('Access denied');
    }

    // Delete from S3 (marks for deletion due to versioning)
    try {
      await deleteFromS3(existingTemplate.s3Key);
    } catch (error) {
      console.error('Failed to delete template from S3:', error);
      // Continue with DynamoDB deletion even if S3 fails
    }

    // Delete from DynamoDB
    await ddb.send(new DeleteItemCommand({
      TableName: process.env.TEMPLATES_TABLE_NAME,
      Key: marshall({
        PK: `${tenantId}#${templateId}`,
        SK: 'template'
      }),
      ConditionExpression: 'attribute_exists(PK)'
    }));

    return formatEmptyResponse();

  } catch (error) {
    console.error('Delete template error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.name === 'ConditionalCheckFailedException') {
      return formatResponse(404, 'Template not found');
    }

    return formatResponse(500, 'Failed to delete template');
  }
};
