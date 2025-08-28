import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { SESv2Client, CreateEmailIdentityCommand, GetEmailIdentityCommand } from "@aws-sdk/client-sesv2";
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
    const { tenantId } = userContext;

    if (!tenantId) {
      return formatAuthError('Tenant access required');
    }

    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { domain } = body;

    // Validate input
    const validationError = validateVerifyDomainRequest(body);
    if (validationError) {
      return formatResponse(400, validationError);
    }

    // Get user tier and validate DNS verification is allowed
    const tier = event.requestContext?.authorizer?.tier || 'free-tier';
    const tierConfig = TIER_LIMITS[tier] || TIER_LIMITS['free-tier'];

    if (!tierConfig.canUseDNS) {
      return formatResponse(400, {
        error: 'DNS verification not available for your tier',
        upgradeRequired: true,
        currentTier: tier
      });
    }

    // Check if domain already exists for this tenant
    const existingDomain = await getDomainByTenant(tenantId, domain);
    if (existingDomain) {
      return formatResponse(409, {
        error: 'Domain already configured',
        domain,
        verificationStatus: existingDomain.verificationStatus
      });
    }

    const now = new Date().toISOString();

    // Initiate SES domain verification
    let sesResponse;
    let dnsRecords = [];

    try {
      // Create domain identity in SES
      const createCommand = new CreateEmailIdentityCommand({
        EmailIdentity: domain,
        ConfigurationSetName: process.env.SES_CONFIGURATION_SET
      });

      sesResponse = await ses.send(createCommand);

      // Note: SES tenant association is not available in the current AWS SDK
      // Identity isolation is handled at the application level through tenantId
      console.log('SES domain identity created:', { domain, tenantId });

      // Get DNS records for verification
      try {
        const getCommand = new GetEmailIdentityCommand({
          EmailIdentity: domain
        });

        const identityResponse = await ses.send(getCommand);

        // Extract DNS records from SES response
        if (identityResponse.DkimAttributes?.Tokens) {
          // DKIM records
          identityResponse.DkimAttributes.Tokens.forEach((token, index) => {
            dnsRecords.push({
              name: `${token}._domainkey.${domain}`,
              type: 'CNAME',
              value: `${token}.dkim.amazonses.com`,
              description: `DKIM record ${index + 1} for email authentication`
            });
          });
        }

        // Add verification record if present
        if (identityResponse.VerificationStatus === 'Pending') {
          // For domain verification, SES typically requires a TXT record
          // The exact record is provided in the SES console or via API
          dnsRecords.push({
            name: `_amazonses.${domain}`,
            type: 'TXT',
            value: 'amazonses-verification-record-placeholder',
            description: 'Domain ownership verification record'
          });
        }
      } catch (getError) {
        console.error('SES domain verification initiation failed:', getError);
        // Continue with empty DNS records if GetEmailIdentity fails
        // This allows the domain to be tracked even if SES is temporarily unavailable
      }

    } catch (sesError) {
      console.error('SES domain verification initiation failed:', sesError);
      return formatResponse(500, {
        error: 'Failed to initiate domain verification',
        details: sesError.message
      });
    }

    // Create domain verification record
    const domainRecord = {
      pk: tenantId,
      sk: KEY_PATTERNS.DOMAIN(domain),
      domain,
      tenantId,
      verificationStatus: 'pending',
      dnsRecords,
      sesIdentityArn: sesResponse?.identityArn || null,
      createdAt: now,
      updatedAt: now
    };

    // Save to DynamoDB
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall(domainRecord),
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
    }));

    return formatResponse(201, {
      domain,
      verificationStatus: 'pending',
      dnsRecords: dnsRecords.map(record => ({
        name: record.name,
        type: record.type,
        value: record.value,
        description: record.description
      })),
      createdAt: now,
      message: 'Domain verification initiated. Please add the DNS records to complete verification.'
    });

  } catch (error) {
    console.error('Verify domain error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    if (error.name === 'ConditionalCheckFailedException') {
      return formatResponse(409, 'Domain verification already exists');
    }

    return formatResponse(500, 'Failed to initiate domain verification');
  }
};

/**
 * Validate verify domain request
 * @param {Object} body - Request body
 * @returns {string|null} Error message or null if valid
 */
const validateVerifyDomainRequest = (body) => {
  const { domain } = body;

  if (!domain) {
    return 'Domain is required';
  }

  // Ensure domain doesn't contain protocol or path first
  if (domain.includes('://') || domain.includes('/')) {
    return 'Domain should not include protocol or path';
  }

  // Basic domain validation
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!domainRegex.test(domain)) {
    return 'Invalid domain format';
  }

  return null;
};

/**
 * Query domain verification record for a tenant
 * @param {string} tenantId - Tenant identifier
 * @param {string} domain - Domain name
 * @returns {Promise<Object|null>} Domain record or null if not found
 */
const getDomainByTenant = async (tenantId, domain) => {
  try {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: marshall({
        ':pk': tenantId,
        ':sk': KEY_PATTERNS.DOMAIN(domain)
      })
    }));

    return result.Items && result.Items.length > 0 ? unmarshall(result.Items[0]) : null;
  } catch (error) {
    console.error('Error querying domain:', error);
    throw new Error('Failed to query domain verification');
  }
};
