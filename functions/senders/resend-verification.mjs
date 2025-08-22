import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { formatResponse } from '../utils/helpers.mjs';
import { getUserContext, formatAuthError } from '../auth/get-user-context.mjs';
import { sendVerificationEmail, getBrandInfo } from './send-verification-email.mjs';
import { KEY_PATTERNS } from './types.mjs';

const ddb = new DynamoDBClient();

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

    // Get user profile for personalization
    const userProfile = await getUserProfile(tenantId);
    const userName = userProfile ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim() : null;

    // Get brand information
    const brandInfo = await getBrandInfo(tenantId);

    // Send verification email
    const emailResult = await sendVerificationEmail({
      tenantId,
      senderId,
      senderEmail: senderRecord.email,
      senderName: senderRecord.name,
      userName,
      brandInfo
    });

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

    console.log('Verification email resent successfully:', {
      tenantId,
      senderId,
      email: senderRecord.email,
      messageId: emailResult.messageId
    });

    return formatResponse(200, {
      message: 'Verification email sent successfully',
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

/**
 * Get user profile information
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object|null>} User profile or null
 */
const getUserProfile = async (tenantId) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: 'PROFILE'
      })
    }));

    if (result.Item) {
      const profile = unmarshall(result.Item);
      return profile.personal || null;
    }

    return null;
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }
};

export default handler;
