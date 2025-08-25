import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { SESv2Client, CreateEmailIdentityCommand, SendCustomVerificationEmailCommand } from "@aws-sdk/client-sesv2";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from 'crypto';
import { formatResponse } from '../utils/helpers.mjs';
import { getUserContext, formatAuthError } from '../auth/get-user-context.mjs';
import { TIER_LIMITS, KEY_PATTERNS } from './types.mjs';

const ddb = new DynamoDBClient();
const ses = new SESv2Client();

export const handler = async (event) => {
  try {
    const userContext = getUserContext(event);
    const { tenantId, userId } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { email, name, verificationType = 'mailbox' } = body;

    // Validate input
    const validationError = validateCreateSenderRequest(body);
    if (validationError) {
      return formatResponse(400, validationError);
    }

    // Get user tier and validate limits
    const tier = event.requestContext?.authorizer?.tier || 'free-tier';
    const tierConfig = TIER_LIMITS[tier] || TIER_LIMITS['free-tier'];

    // Check if verification type is allowed for tier
    if (verificationType === 'domain' && !tierConfig.canUseDNS) {
      return formatResponse(400, {
        error: 'DNS verification not available for your tier',
        upgradeRequired: true,
        currentTier: tier
      });
    }

    // Check current sender count against tier limits
    const currentSenders = await getSendersByTenant(tenantId);
    if (currentSenders.length >= tierConfig.maxSenders) {
      return formatResponse(400, {
        error: `Maximum sender limit reached (${tierConfig.maxSenders})`,
        upgradeRequired: true,
        currentTier: tier,
        currentCount: currentSenders.length,
        maxSenders: tierConfig.maxSenders
      });
    }

    // Check if email already exists for this tenant
    const existingSender = currentSenders.find(sender => sender.email === email);
    if (existingSender) {
      return formatResponse(409, 'Email address already configured');
    }

    // Create sender record
    const senderId = randomUUID();
    const now = new Date().toISOString();

    const senderRecord = {
      pk: tenantId,
      sk: KEY_PATTERNS.SENDER(senderId),
      GSI1PK: KEY_PATTERNS.SENDER_GSI1PK(tenantId),
      GSI1SK: email,
      senderId,
      tenantId,
      email,
      name: name || null,
      verificationType,
      verificationStatus: 'pending',
      isDefault: currentSenders.length === 0, // First sender is default
      domain: verificationType === 'domain' ? extractDomain(email) : null,
      createdAt: now,
      updatedAt: now,
      lastVerificationSent: now
    };

    // For domain verification, create SES identity immediately since DNS verification is handled by SES
    if (verificationType === 'domain') {
      try {
        const sesResponse = await initiateEmailVerification(email, verificationType);
        senderRecord.sesIdentityArn = sesResponse.identityArn;
      } catch (sesError) {
        console.error('SES domain verification initiation failed:', sesError);
        return formatResponse(500, 'Failed to initiate domain verification');
      }
    }
    // For mailbox verification, we DON'T create SES identity yet
    // We'll create it only after our custom verification succeeds

    // Save to DynamoDB
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall(senderRecord, { removeUndefinedValues: true, convertEmptyValues: true }),
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
    }));

    // Send verification email for mailbox verification
    if (verificationType === 'mailbox') {
      try {
        // Use SES custom verification email template
        const templateName = process.env.SES_VERIFY_TEMPLATE_NAME;

        if (!templateName) {
          throw new Error('SES_VERIFY_TEMPLATE_NAME environment variable is required for custom verification');
        }

        const sendCommand = new SendCustomVerificationEmailCommand({
          EmailAddress: email,
          TemplateName: templateName
        });

        const result = await ses.send(sendCommand);

        console.log('Custom verification email sent successfully:', {
          tenantId,
          senderId,
          email,
          messageId: result.MessageId
        });

      } catch (emailError) {
        console.error('Failed to send verification email:', emailError);
        // Don't fail the entire operation if email sending fails
        // The sender is created, they can resend verification later
      }
    }

    return formatResponse(201, {
      senderId,
      email,
      name: name || null,
      verificationType,
      verificationStatus: 'pending',
      isDefault: senderRecord.isDefault,
      domain: senderRecord.domain,
      createdAt: now,
      updatedAt: now,
      message: verificationType === 'mailbox'
        ? 'Verification email sent. Please check your inbox and click the verification link.'
        : 'Domain verification initiated. DNS records will be provided separately.'
    });

  } catch (error) {
    console.error('Create sender error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.name === 'ConditionalCheckFailedException') {
      return formatResponse(409, 'Sender already exists');
    }

    return formatResponse(500, 'Failed to create sender email');
  }
};

/**
 * Validate create sender request
 * @param {Object} body - Request body
 * @returns {string|null} Error message or null if valid
 */
const validateCreateSenderRequest = (body) => {
  const { email, verificationType } = body;

  if (!email) {
    return 'Email address is required';
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return 'Invalid email address format';
  }

  if (verificationType && !['mailbox', 'domain'].includes(verificationType)) {
    return 'Verification type must be either "mailbox" or "domain"';
  }

  return null;
};

/**
 * Query all sender emails for a tenant
 * @param {string} tenantId - Tenant identifier
 * @returns {Promise<Array>} Array of sender records
 */
const getSendersByTenant = async (tenantId) => {
  try {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: marshall({
        ':gsi1pk': KEY_PATTERNS.SENDER_GSI1PK(tenantId)
      })
    }));

    return result.Items ? result.Items.map(item => unmarshall(item)) : [];
  } catch (error) {
    console.error('Error querying senders:', error);
    throw new Error('Failed to query sender emails');
  }
};

/**
 * Initiate email verification with SES
 * @param {string} email - Email address to verify
 * @param {string} verificationType - Type of verification
 * @returns {Promise<Object>} SES response
 */
const initiateEmailVerification = async (email, verificationType) => {
  const identity = verificationType === 'domain' ? extractDomain(email) : email;

  const command = new CreateEmailIdentityCommand({
    EmailIdentity: identity,
    ConfigurationSetName: process.env.SES_CONFIGURATION_SET
  });

  return await ses.send(command);
};

/**
 * Extract domain from email address
 * @param {string} email - Email address
 * @returns {string} Domain part
 */
const extractDomain = (email) => {
  return email.split('@')[1];
};

