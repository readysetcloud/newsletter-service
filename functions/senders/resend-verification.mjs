import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SESv2Client, SendCustomVerificationEmailCommand, CreateEmailIdentityCommand } from "@aws-sdk/client-sesv2";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { formatResponse } from '../utils/helpers.mjs';
import { getUserContext, formatAuthError } from '../auth/get-user-context.mjs';
import { KEY_PATTERNS } from './types.mjs';

const ddb = new DynamoDBClient();
const ses = new SESv2Client();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId, userId } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    // Get sender ID from path parameters
    const senderId = event.pathParameters?.senderId;

    if (!senderId) {
      return formatResponse(400, 'Sender ID is required');
    }

    // Get sender record
    const senderRecord = await getSenderRecord(tenantId, senderId);

    if (!senderRecord) {
      return formatResponse(404, 'Sender not found');
    }

    // Check if sender belongs to this tenant
    if (senderRecord.tenantId !== tenantId) {
      return formatResponse(403, 'Access denied');
    }

    // Check if already verified
    if (senderRecord.verificationStatus === 'verified') {
      return formatResponse(400, {
        error: 'Email already verified',
        message: 'This sender email is already verified and ready to use.'
      });
    }

    // Only allow resending for mailbox verification
    if (senderRecord.verificationType !== 'mailbox') {
      return formatResponse(400, {
        error: 'Resend not supported',
        message: 'Verification email resend is only available for mailbox verification.'
      });
    }

    // Check rate limiting - prevent spam
    const lastVerificationSent = senderRecord.lastVerificationSent;
    if (lastVerificationSent) {
      const timeSinceLastSent = Date.now() - new Date(lastVerificationSent).getTime();
      const minInterval = 5 * 60 * 1000; // 5 minutes

      if (timeSinceLastSent < minInterval) {
        const remainingTime = Math.ceil((minInterval - timeSinceLastSent) / 1000 / 60);
        return formatResponse(429, {
          error: 'Rate limit exceeded',
          message: `Please wait ${remainingTime} minute(s) before requesting another verification email.`,
          retryAfter: remainingTime
        });
      }
    }

    const environment = process.env.ENVIRONMENT || 'production';
    const isProduction = environment === 'production';

    let emailResult = null;
    let message;

    if (isProduction) {
      const templateName = process.env.SES_VERIFY_TEMPLATE_NAME;

      if (!templateName) {
        return formatResponse(500, {
          error: 'Configuration error',
          message: 'Verification email template not configured.'
        });
      }

      const sendCommand = new SendCustomVerificationEmailCommand({
        EmailAddress: senderRecord.email,
        TemplateName: templateName
      });

      emailResult = await ses.send(sendCommand);

      console.log('Verification email resent successfully:', {
        tenantId,
        senderId,
        email: senderRecord.email,
        messageId: emailResult.MessageId
      });

      message = 'Verification email sent successfully';
    } else {
      // Use standard AWS verification email for non-production environments
      const createIdentityCommand = new CreateEmailIdentityCommand({
        EmailIdentity: senderRecord.email,
        ConfigurationSetName: process.env.SES_CONFIGURATION_SET
      });

      emailResult = await ses.send(createIdentityCommand);

      console.log('Standard AWS verification email sent successfully:', {
        tenantId,
        senderId,
        email: senderRecord.email,
        environment,
        identityArn: emailResult.IdentityArn
      });

      message = 'AWS verification email sent successfully';
    }

    // Update sender record with last verification sent timestamp
    const now = new Date().toISOString();
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: KEY_PATTERNS.SENDER(senderId)
      }),
      UpdateExpression: 'SET lastVerificationSent = :timestamp, updatedAt = :updatedAt',
      ExpressionAttributeValues: marshall({
        ':timestamp': now,
        ':updatedAt': now
      })
    }));

    return formatResponse(200, {
      message,
      senderId,
      email: senderRecord.email,
      sentAt: now
    });

  } catch (error) {
    console.error('Resend verification error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, {
      error: 'Failed to send verification email',
      message: 'An error occurred while sending the verification email. Please try again.'
    });
  }
};

/**
 * Get sender record from database
 * @param {string} tenantId - Tenant ID
 * @param {string} senderId - Sender ID
 * @returns {Promise<Object|null>} Sender record or null
 */
const getSenderRecord = async (tenantId, senderId) => {
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
    console.error('Error fetching sender record:', error);
    throw new Error('Failed to fetch sender record');
  }
};


export default handler;
