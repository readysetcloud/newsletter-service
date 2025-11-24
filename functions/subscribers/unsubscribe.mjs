import Handlebars from 'handlebars';
import unsubscribeTemplate from '../../templates/unsubscribe-success.hbs';
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { decrypt, getTenant } from "../utils/helpers.mjs";
import { unsubscribeUser } from "../utils/subscriber.mjs";

const ddb = new DynamoDBClient();
const eventBridge = new EventBridgeClient();
const unsubscribeHtml = Handlebars.compile(unsubscribeTemplate);

export const handler = async (event) => {
  let emailAddress = null;
  let tenantId = null;
  let success = false;

  try {
    tenantId = event.pathParameters.tenant;

    if (!tenantId) {
      throw new Error('Missing tenant parameter');
    }

    const email = event.queryStringParameters?.email;
    if (!email) {
      throw new Error('Missing email parameter');
    }

    try {
      emailAddress = decrypt(email);
    } catch (decryptErr) {
      console.error('Email decryption failed:', {
        error: decryptErr.message,
        tenantId,
        emailParamLength: email ? email.length : 0,
        emailParamFormat: email ? email.includes(':') : false
      });
      throw new Error('Invalid or expired unsubscribe link');
    }

    const ipAddress = event.requestContext?.identity?.sourceIp ||
                      event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() ||
                      'unknown';

    const userAgent = event.headers?.['User-Agent'] || event.headers?.['user-agent'] || 'unknown';

    const metadata = {
      ipAddress,
      userAgent
    };

    success = await unsubscribeUser(tenantId, emailAddress, 'encrypted-link', metadata);

    if (!success) {
      await notifyAdminOfFailure(tenantId, emailAddress, 'encrypted-link', metadata);
    }
  } catch (err) {
    console.error('Unsubscribe error:', {
      error: err.message,
      tenantId,
      emailAddress: emailAddress ? '[REDACTED]' : null,
      stack: err.stack
    });

    if (tenantId && emailAddress) {
      try {
        await notifyAdminOfFailure(tenantId, emailAddress, 'encrypted-link', { error: err.message });
      } catch (notifyErr) {
        console.error('Failed to notify admin of unsubscribe failure:', notifyErr);
      }
    }
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html'
    },
    body: await getUnsubscribePage(tenantId, success, emailAddress)
  };
};

const notifyAdminOfFailure = async (tenantId, emailAddress, method, metadata = {}) => {
  try {
    const tenant = await getTenant(tenantId);
    if (!tenant?.createdBy) {
      console.error('No admin email found for tenant:', { tenantId });
      return;
    }

    const subject = `[Alert] Unsubscribe Request Failed - ${tenant.brandName || tenantId}`;
    const html = `
      <h2>Unsubscribe Request Failed</h2>
      <p>An unsubscribe request could not be processed for your newsletter.</p>

      <h3>Details:</h3>
      <ul>
        <li><strong>Email:</strong> ${emailAddress}</li>
        <li><strong>Method:</strong> ${method}</li>
        <li><strong>Time:</strong> ${new Date().toISOString()}</li>
        ${metadata.error ? `<li><strong>Error:</strong> ${metadata.error}</li>` : ''}
        ${metadata.ipAddress ? `<li><strong>IP Address:</strong> ${metadata.ipAddress}</li>` : ''}
        ${metadata.userAgent ? `<li><strong>User Agent:</strong> ${metadata.userAgent}</li>` : ''}
      </ul>

      <p>The user was shown a success message for privacy and UX reasons, but the unsubscribe did not complete successfully.</p>
      <p>Please manually verify and remove this email address from your contact list if needed.</p>
    `;

    await eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: 'newsletter-service',
        DetailType: 'Send Email v2',
        Detail: JSON.stringify({
          tenantId,
          to: { email: tenant.createdBy },
          subject,
          html
        })
      }]
    }));

    console.log('Admin notified of unsubscribe failure:', { tenantId, adminEmail: tenant.createdBy });
  } catch (err) {
    console.error('Failed to notify admin:', err);
    throw err;
  }
};

/**
 * Get unsubscribe page template for tenant
 */
const getUnsubscribeTemplate = async (tenantId) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: `${tenantId}#unsubscribe`,
        sk: 'templates'
      })
    }));

    if (result.Item) {
      return unmarshall(result.Item);
    }

    return {};
  } catch (error) {
    console.error('Error fetching unsubscribe template:', error);
    return {};
  }
};

/**
 * Generate unsubscribe page HTML using tenant template
 * Always shows the form for security/UX - users can always unsubscribe manually
 */
const getUnsubscribePage = async (tenantId, wasSuccessful, emailAddress) => {
  const template = await getUnsubscribeTemplate(tenantId);

  // Use custom template if tenant has one, otherwise use default
  if (template.success) {
    return template.success;
  }

  return unsubscribeHtml({
    tenantId,
    wasSuccessful,
    emailAddress: emailAddress || ''
  });
};
