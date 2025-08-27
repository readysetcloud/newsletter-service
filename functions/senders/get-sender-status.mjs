import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SESv2Client, GetEmailIdentityCommand } from "@aws-sdk/client-sesv2";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { formatResponse } from '../utils/helpers.mjs';
import { getUserContext, formatAuthError } from '../auth/get-user-context.mjs';
import { KEY_PATTERNS } from './types.mjs';

const ddb = new DynamoDBClient();
const ses = new SESv2Client();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    // Extract sender ID from path parameters
    const senderId = event.pathParameters?.senderId;
    if (!senderId) {
      return formatResponse(400, 'Missing senderId parameter');
    }

    // Get sender from DynamoDB
    const sender = await getSenderById(tenantId, senderId);
    if (!sender) {
      return formatResponse(404, 'Sender not found');
    }

    // If status is already verified, return current status without SES check
    if (sender.verificationStatus === 'verified') {
      return formatResponse(200, formatSenderStatusResponse(sender, false));
    }

    // Check current verification status in SES
    const sesStatus = await checkSESVerificationStatus(sender.email);

    // Determine if status needs to be updated
    const newStatus = mapSESStatusToInternal(sesStatus?.verificationStatus);
    let statusChanged = false;
    let updatedSender = { ...sender };

    if (newStatus && newStatus !== sender.verificationStatus) {
      // Update the database with the new status
      await updateSenderVerificationStatus(tenantId, senderId, newStatus);
      updatedSender.verificationStatus = newStatus;
      updatedSender.updatedAt = new Date().toISOString();

      if (newStatus === 'verified') {
        updatedSender.verifiedAt = updatedSender.updatedAt;
      }

      statusChanged = true;
    }

    return formatResponse(200, formatSenderStatusResponse(updatedSender, statusChanged, sesStatus));

  } catch (error) {
    console.error('Get sender status error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, 'Failed to get sender status');
  }
};

/**
 * Get sender by ID from DynamoDB
 * @param {string} tenantId - Tenant identifier
 * @param {string} senderId - Sender identifier
 * @returns {Promise<Object|null>} Sender record or null if not found
 */
const getSenderById = async (tenantId, senderId) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: KEY_PATTERNS.SENDER(senderId)
      })
    }));

    return result.Item ? unmarshall(result.Item) : null;
  } catch (error) {
    console.error('Error getting sender by ID:', error);
    throw new Error('Failed to retrieve sender');
  }
};

/**
 * Check verification status in SES
 * @param {string} email - Email address to check
 * @returns {Promise<Object|null>} SES status or null if error
 */
const checkSESVerificationStatus = async (email) => {
  try {
    const command = new GetEmailIdentityCommand({
      EmailIdentity: email
    });

    const response = await ses.send(command);

    return {
      verificationStatus: response.VerificationStatus?.toLowerCase() || 'unknown',
      dkimStatus: response.DkimAttributes?.Status?.toLowerCase() || 'unknown',
      identityType: response.IdentityType?.toLowerCase() || 'unknown'
    };
  } catch (error) {
    console.error('Error checking SES verification status:', error);

    if (error.name === 'NotFoundException') {
      return {
        verificationStatus: 'not_found',
        error: 'Identity not found in SES'
      };
    }

    return {
      verificationStatus: 'unknown',
      error: 'Failed to check SES status'
    };
  }
};

/**
 * Map SES verification status to internal status
 * @param {string} sesStatus - SES verification status
 * @returns {string|null} Internal status or null if no mapping needed
 */
const mapSESStatusToInternal = (sesStatus) => {
  switch (sesStatus) {
    case 'success':
      return 'verified';
    case 'failed':
      return 'failed';
    case 'pending':
      return 'pending';
    case 'not_found':
      // Don't update status when identity is not found in SES
      // This could be a temporary issue or the identity was removed
      return null;
    default:
      return null;
  }
};

/**
 * Update sender verification status in DynamoDB
 * @param {string} tenantId - Tenant identifier
 * @param {string} senderId - Sender identifier
 * @param {string} newStatus - New verification status
 * @returns {Promise<void>}
 */
const updateSenderVerificationStatus = async (tenantId, senderId, newStatus) => {
  try {
    const now = new Date().toISOString();
    let updateExpression = 'SET verificationStatus = :status, updatedAt = :updatedAt';
    const expressionAttributeValues = {
      ':status': newStatus,
      ':updatedAt': now
    };

    // Add verifiedAt if status is verified
    if (newStatus === 'verified') {
      updateExpression += ', verifiedAt = :verifiedAt';
      expressionAttributeValues[':verifiedAt'] = now;
    }

    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: KEY_PATTERNS.SENDER(senderId)
      }),
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: marshall(expressionAttributeValues),
      ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)'
    }));

    console.log('Updated sender verification status:', {
      tenantId,
      senderId,
      newStatus,
      updatedAt: now
    });
  } catch (error) {
    console.error('Error updating sender verification status:', error);
    throw new Error('Failed to update sender status');
  }
};

/**
 * Format sender status response
 * @param {Object} sender - Sender record
 * @param {boolean} statusChanged - Whether status was updated
 * @param {Object} sesStatus - SES status information
 * @returns {Object} Formatted response
 */
const formatSenderStatusResponse = (sender, statusChanged = false, sesStatus = null) => {
  return {
    senderId: sender.senderId,
    email: sender.email,
    name: sender.name || null,
    verificationType: sender.verificationType,
    verificationStatus: sender.verificationStatus,
    isDefault: sender.isDefault || false,
    domain: sender.domain || null,
    createdAt: sender.createdAt,
    updatedAt: sender.updatedAt,
    verifiedAt: sender.verifiedAt || null,
    failureReason: sender.failureReason || null,
    emailsSent: sender.emailsSent || 0,
    lastSentAt: sender.lastSentAt || null,
    statusChanged,
    sesStatus,
    lastChecked: new Date().toISOString()
  };
};
