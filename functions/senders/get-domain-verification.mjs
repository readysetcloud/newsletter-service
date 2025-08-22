import { DynamoDBClient, QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
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

    // Extract domain from path parameters
    const domain = event.pathParameters?.domain;

    if (!domain) {
      return formatResponse(400, {
        error: 'Domain parameter is required'
      });
    }

    // Validate domain format
    const validationError = validateDomain(domain);
    if (validationError) {
      return formatResponse(400, {
        error: validationError
      });
    }

    // Get domain verification record from DynamoDB
    const domainRecord = await getDomainByTenant(tenantId, domain);

    if (!domainRecord) {
      return formatResponse(404, {
        error: 'Domain verification not found',
        message: 'Please initiate domain verification first'
      });
    }

    // Get current verification status from SES
    let currentStatus = domainRecord.verificationStatus;
    let sesVerificationDetails = null;

    try {
      const getCommand = new GetEmailIdentityCommand({
        EmailIdentity: domain
      });

      const sesResponse = await ses.send(getCommand);
      sesVerificationDetails = sesResponse;

      // Update status based on SES response
      if (sesResponse.VerifiedForSendingStatus) {
        currentStatus = 'verified';
      } else if (sesResponse.VerificationStatus === 'Failed') {
        currentStatus = 'failed';
      } else {
        currentStatus = 'pending';
      }

    } catch (sesError) {
      console.error('SES verification status check failed:', sesError);
      // Continue with stored status if SES check fails
    }

    // Generate user-friendly DNS setup instructions
    const instructions = generateDNSInstructions(domain, domainRecord.dnsRecords);

    // Prepare response with enhanced DNS records including descriptions
    const enhancedDnsRecords = domainRecord.dnsRecords.map(record => ({
      name: record.name,
      type: record.type,
      value: record.value,
      description: record.description || getRecordDescription(record.type)
    }));

    const response = {
      domain,
      verificationStatus: currentStatus,
      dnsRecords: enhancedDnsRecords,
      instructions,
      estimatedVerificationTime: getEstimatedVerificationTime(currentStatus),
      troubleshooting: getTroubleshootingTips(currentStatus),
      createdAt: domainRecord.createdAt,
      updatedAt: domainRecord.updatedAt,
      verifiedAt: domainRecord.verifiedAt || null
    };

    // If status changed, update the record in DynamoDB
    if (currentStatus !== domainRecord.verificationStatus) {
      await updateDomainVerificationStatus(tenantId, domain, currentStatus);
      response.updatedAt = new Date().toISOString();
      if (currentStatus === 'verified' && !domainRecord.verifiedAt) {
        response.verifiedAt = response.updatedAt;
      }
    }

    return formatResponse(200, response);

  } catch (error) {
    console.error('Get domain verification error:', error);

    if (error.message === 'Invalid authorization context') {
      return formatAuthError('Authentication required');
    }

    return formatResponse(500, {
      error: 'Failed to retrieve domain verification details',
      message: 'Please try again later'
    });
  }
};

/**
 * Validate domain format
 * @param {string} domain - Domain to validate
 * @returns {string|null} Error message or null if valid
 */
const validateDomain = (domain) => {
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

/**
 * Update domain verification status in DynamoDB
 * @param {string} tenantId - Tenant identifier
 * @param {string} domain - Domain name
 * @param {string} status - New verification status
 */
const updateDomainVerificationStatus = async (tenantId, domain, status) => {
  try {
    const now = new Date().toISOString();
    let updateExpression = 'SET verificationStatus = :status, updatedAt = :updatedAt';
    const expressionAttributeValues = {
      ':status': status,
      ':updatedAt': now
    };

    // Add verifiedAt timestamp if status is verified
    if (status === 'verified') {
      updateExpression += ', verifiedAt = :verifiedAt';
      expressionAttributeValues[':verifiedAt'] = now;
    }

    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: KEY_PATTERNS.DOMAIN(domain)
      }),
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: marshall(expressionAttributeValues)
    }));
  } catch (error) {
    console.error('Error updating domain verification status:', error);
    // Don't throw - this is a background update
  }
};

/**
 * Generate user-friendly DNS setup instructions
 * @param {string} domain - Domain name
 * @param {Array} dnsRecords - DNS records to add
 * @returns {Array<string>} Step-by-step instructions
 */
const generateDNSInstructions = (domain, dnsRecords) => {
  const instructions = [
    "To verify your domain ownership, you need to add DNS records to your domain's DNS settings.",
    "Follow these steps:",
    "",
    "1. Log in to your domain registrar or DNS hosting provider (e.g., GoDaddy, Namecheap, Cloudflare, Route 53).",
    "2. Navigate to the DNS management section for your domain.",
    "3. Add the following DNS records exactly as shown:",
    ""
  ];

  // Add specific record instructions
  dnsRecords.forEach((record, index) => {
    instructions.push(`   Record ${index + 1}:`);
    instructions.push(`   • Type: ${record.type}`);
    instructions.push(`   • Name: ${record.name}`);
    instructions.push(`   • Value: ${record.value}`);
    instructions.push(`   • Purpose: ${record.description}`);
    instructions.push("");
  });

  instructions.push(
    "4. Save your DNS changes.",
    "5. DNS propagation can take up to 72 hours, but typically completes within 15-30 minutes.",
    "6. Return to this page to check your verification status.",
    "",
    "💡 Tip: You can use online DNS lookup tools to verify your records are properly configured before checking verification status."
  );

  return instructions;
};

/**
 * Get description for DNS record type
 * @param {string} recordType - DNS record type
 * @returns {string} User-friendly description
 */
const getRecordDescription = (recordType) => {
  const descriptions = {
    'TXT': 'Domain ownership verification',
    'CNAME': 'Email authentication (DKIM)',
    'MX': 'Mail server routing'
  };

  return descriptions[recordType] || 'Email service configuration';
};

/**
 * Get estimated verification time based on current status
 * @param {string} status - Current verification status
 * @returns {string} Estimated time message
 */
const getEstimatedVerificationTime = (status) => {
  switch (status) {
    case 'pending':
      return 'Verification typically completes within 15-30 minutes after DNS records are added, but can take up to 72 hours.';
    case 'verified':
      return 'Domain is verified and ready for sending emails.';
    case 'failed':
      return 'Verification failed. Please check your DNS records and try again.';
    default:
      return 'Status unknown. Please refresh to get the latest information.';
  }
};

/**
 * Get troubleshooting tips based on verification status
 * @param {string} status - Current verification status
 * @returns {Array<string>} Troubleshooting tips
 */
const getTroubleshootingTips = (status) => {
  const commonTips = [
    "Ensure DNS records are added exactly as shown, including any trailing dots",
    "Check that there are no extra spaces in the record values",
    "DNS changes can take time to propagate - wait at least 15 minutes before checking again"
  ];

  switch (status) {
    case 'pending':
      return [
        ...commonTips,
        "Use a DNS lookup tool to verify your records are visible",
        "Contact your DNS provider if you're having trouble adding records"
      ];
    case 'failed':
      return [
        "Double-check that all DNS records are correctly configured",
        "Remove any duplicate or conflicting DNS records",
        "Ensure you have the correct permissions to modify DNS settings",
        "Try removing and re-adding the DNS records",
        "Contact support if the issue persists after verifying your DNS configuration"
      ];
    case 'verified':
      return [
        "Your domain is successfully verified!",
        "You can now add email addresses under this domain",
        "Keep your DNS records in place to maintain verification status"
      ];
    default:
      return commonTips;
  }
};
