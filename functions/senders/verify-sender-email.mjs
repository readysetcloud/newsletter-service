import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { SESv2Client, CreateEmailIdentityCommand, PutEmailIdentityConfigurationSetAttributesCommand } from "@aws-sdk/client-sesv2";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { formatResponse } from '../utils/helpers.mjs';
import { decrypt } from '../utils/helpers.mjs';
import { KEY_PATTERNS } from './types.mjs';

const ddb = new DynamoDBClient();
const ses = new SESv2Client();

export const handler = async (event) => {
  try {
    // Parse verification token from query parameters
    const token = event.queryStringParameters?.token;

    if (!token) {
      return formatResponse(400, {
        error: 'Verification token is required',
        message: 'Please use the verification link from your email.'
      });
    }

    // Decrypt and validate token
    let tokenData;
    try {
      const decryptedToken = decrypt(token);
      tokenData = JSON.parse(decryptedToken);
    } catch (error) {
      console.error('Token decryption failed:', error);
      return formatResponse(400, {
        error: 'Invalid verification token',
        message: 'The verification link is invalid or corrupted.'
      });
    }

    // Validate token structure and type
    if (!tokenData.tenantId || !tokenData.senderId || !tokenData.email || tokenData.type !== 'sender-verification') {
      return formatResponse(400, {
        error: 'Invalid token format',
        message: 'The verification link is invalid.'
      });
    }

    // Check token expiration (24 hours)
    const tokenAge = Date.now() - tokenData.timestamp;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    if (tokenAge > maxAge) {
      return formatResponse(400, {
        error: 'Verification token expired',
        message: 'This verification link has expired. Please request a new verification email.',
        expired: true
      });
    }

    const { tenantId, senderId, email } = tokenData;

    // Get sender record from database
    const senderRecord = await getSenderRecord(tenantId, senderId);

    if (!senderRecord) {
      return formatResponse(404, {
        error: 'Sender not found',
        message: 'The sender email configuration was not found.'
      });
    }

    // Verify the email matches
    if (senderRecord.email !== email) {
      return formatResponse(400, {
        error: 'Email mismatch',
        message: 'The verification token does not match the sender email.'
      });
    }

    // Check if already verified
    if (senderRecord.verificationStatus === 'verified') {
      return formatResponse(200, {
        message: 'Email address is already verified',
        senderId,
        email,
        verificationStatus: 'verified',
        alreadyVerified: true
      });
    }

    // Update sender status to verified
    const now = new Date().toISOString();

    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: KEY_PATTERNS.SENDER(senderId)
      }),
      UpdateExpression: 'SET verificationStatus = :status, verifiedAt = :verifiedAt, updatedAt = :updatedAt',
      ExpressionAttributeValues: marshall({
        ':status': 'verified',
        ':verifiedAt': now,
        ':updatedAt': now
      }),
      ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)'
    }));

    // Create and configure SES identity for sending (if not domain verification)
    let sesIdentityArn = null;
    if (senderRecord.verificationType === 'mailbox') {
      try {
        const sesResult = await configureSESIdentity(email);
        sesIdentityArn = sesResult?.identityArn || null;

        // Update the sender record with SES identity ARN if we got one
        if (sesIdentityArn) {
          await ddb.send(new UpdateItemCommand({
            TableName: process.env.TABLE_NAME,
            Key: marshall({
              pk: tenantId,
              sk: KEY_PATTERNS.SENDER(senderId)
            }),
            UpdateExpression: 'SET sesIdentityArn = :arn',
            ExpressionAttributeValues: marshall({
              ':arn': sesIdentityArn
            })
          }));
        }

      } catch (sesError) {
        console.error('SES identity creation failed:', sesError);
        // Don't fail the verification if SES configuration fails
        // The email is still verified in our system, just log the error
      }
    }

    console.log('Sender email verified successfully:', {
      tenantId,
      senderId,
      email,
      verificationType: senderRecord.verificationType
    });

    return formatResponse(200, {
      message: 'Email address verified successfully!',
      senderId,
      email,
      verificationStatus: 'verified',
      verificationType: senderRecord.verificationType,
      verifiedAt: now
    });

  } catch (error) {
    console.error('Sender verification error:', error);

    if (error.name === 'ConditionalCheckFailedException') {
      return formatResponse(404, {
        error: 'Sender not found',
        message: 'The sender email configuration was not found.'
      });
    }

    return formatResponse(500, {
      error: 'Verification failed',
      message: 'An error occurred while verifying your email address. Please try again.'
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
 * Create and configure SES identity for sending emails
 * This creates the SES identity AFTER our custom verification succeeds
 * @param {string} email - Email address
 * @returns {Promise<Object>} SES creation result
 */
const configureSESIdentity = async (email) => {
  try {
    // First, create the email identity in SES
    const createCommand = new CreateEmailIdentityCommand({
      EmailIdentity: email,
      ConfigurationSetName: process.env.SES_CONFIGURATION_SET
    });

    const createResult = await ses.send(createCommand);
    console.log('SES identity created successfully:', email, createResult.IdentityType);

    // Then associate it with our configuration set (if not already done in create)
    try {
      await ses.send(new PutEmailIdentityConfigurationSetAttributesCommand({
        EmailIdentity: email,
        ConfigurationSetName: process.env.SES_CONFIGURATION_SET
      }));
      console.log('SES identity configuration set applied:', email);
    } catch (configError) {
      // This might fail if already configured, which is fine
      console.log('SES configuration set already applied or not needed:', email);
    }

    return createResult;

  } catch (error) {
    // If identity already exists, that's fine
    if (error.name === 'AlreadyExistsException') {
      console.log('SES identity already exists:', email);
      return { identityArn: null }; // Return something so we don't break the flow
    }

    console.error('SES identity creation/configuration failed:', error);
    throw error;
  }
};

export default handler;
