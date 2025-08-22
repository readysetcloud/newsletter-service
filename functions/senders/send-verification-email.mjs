import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Handlebars from 'handlebars';
import { encrypt } from '../utils/helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ses = new SESv2Client();
const ddb = new DynamoDBClient();

/**
 * Send custom verification email for sender email verification
 * This uses regular email sending but integrates with our custom verification flow
 * @param {Object} params - Email parameters
 * @param {string} params.tenantId - Tenant ID
 * @param {string} params.senderId - Sender ID
 * @param {string} params.senderEmail - Email to verify
 * @param {string} params.senderName - Optional sender name
 * @param {string} params.userName - User's name
 * @param {Object} params.brandInfo - Brand information
 * @returns {Promise<Object>} Send result
 */
export const sendVerificationEmail = async ({
  tenantId,
  senderId,
  senderEmail,
  senderName,
  userName,
  brandInfo = {}
}) => {
  try {
    // Generate verification token
    const verificationToken = generateVerificationToken(tenantId, senderId, senderEmail);

    // Create verification URL
    const baseUrl = process.env.FRONTEND_URL || 'https://app.newsletter-service.com';
    const verificationUrl = `${baseUrl}/verify-sender?token=${verificationToken}`;

    // Load and compile email template
    const templatePath = join(__dirname, '../../templates/sender-verification.hbs');
    const templateSource = readFileSync(templatePath, 'utf8');
    const template = Handlebars.compile(templateSource);

    // Prepare template data
    const templateData = {
      senderEmail,
      senderName,
      userName,
      verificationUrl,
      brandName: brandInfo.brandName,
      brandLogo: brandInfo.brandLogo,
      brandWebsite: brandInfo.website
    };

    // Generate HTML content
    const htmlContent = template(templateData);

    // Generate plain text version
    const textContent = generatePlainTextContent(templateData);

    // Send email using SES
    const sendCommand = new SendEmailCommand({
      FromEmailAddress: process.env.SYSTEM_FROM_EMAIL || 'noreply@newsletter-service.com',
      Destination: {
        ToAddresses: [senderEmail]
      },
      Content: {
        Simple: {
          Subject: {
            Data: `Verify your sender email for ${brandInfo.brandName || 'Newsletter Service'}`,
            Charset: 'UTF-8'
          },
          Body: {
            Html: {
              Data: htmlContent,
              Charset: 'UTF-8'
            },
            Text: {
              Data: textContent,
              Charset: 'UTF-8'
            }
          }
        }
      },
      ConfigurationSetName: process.env.SES_CONFIGURATION_SET,
      Tags: [
        { Name: 'EmailType', Value: 'sender-verification' },
        { Name: 'TenantId', Value: tenantId },
        { Name: 'SenderId', Value: senderId }
      ]
    });

    const result = await ses.send(sendCommand);

    console.log('Verification email sent successfully:', {
      messageId: result.MessageId,
      senderEmail,
      tenantId,
      senderId
    });

    return {
      success: true,
      messageId: result.MessageId,
      verificationToken
    };

  } catch (error) {
    console.error('Failed to send verification email:', error);
    throw new Error(`Failed to send verification email: ${error.message}`);
  }
};


/**
 * Generate verification token
 * @param {string} tenantId - Tenant ID
 * @param {string} senderId - Sender ID
 * @param {string} email - Email address
 * @returns {string} Encrypted verification token
 */
const generateVerificationToken = (tenantId, senderId, email) => {
  const tokenData = {
    tenantId,
    senderId,
    email,
    timestamp: Date.now(),
    type: 'sender-verification'
  };

  return encrypt(JSON.stringify(tokenData));
};

/**
 * Generate plain text version of the email
 * @param {Object} data - Template data
 * @returns {string} Plain text content
 */
const generatePlainTextContent = (data) => {
  return `
Verify Your Sender Email

Hello${data.userName ? `, ${data.userName}` : ''}!

You've requested to add a new sender email address to your newsletter account. To complete the setup and start sending newsletters from this email, please verify your ownership.

Email to verify: ${data.senderEmail}
${data.senderName ? `Sender name: ${data.senderName}` : ''}

To verify your email address, please click the following link or copy and paste it into your browser:

${data.verificationUrl}

This verification link will expire in 24 hours for security reasons.

SECURITY NOTE: If you didn't request this verification, please ignore this email. No changes will be made to your account.

---
This email was sent by ${data.brandName || 'Newsletter Service'}
${data.brandWebsite ? `Visit our website: ${data.brandWebsite}` : ''}

This is an automated message. Please do not reply to this email.
`.trim();
};

/**
 * Get brand information for a tenant
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} Brand information
 */
export const getBrandInfo = async (tenantId) => {
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
      return profile.brand || {};
    }

    return {};
  } catch (error) {
    console.error('Error fetching brand info:', error);
    return {};
  }
};

export default sendVerificationEmail;
