import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { unsubscribeUser } from "../utils/subscriber.mjs";
import { getTenant } from "../utils/helpers.mjs";

const eventBridge = new EventBridgeClient();

export const handler = async (event) => {
  let tenant;
  let tenantId;
  let emailAddress;

  try {
    tenantId = event.pathParameters?.tenant;

    if (!tenantId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Missing tenant parameter' })
      };
    }

    try {
      tenant = await getTenant(tenantId);
    } catch (err) {
      console.error('Tenant not found:', { tenantId, error: err.message });
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Tenant not found' })
      };
    }

    const body = JSON.parse(event.body || '{}');
    emailAddress = body.email;

    if (!emailAddress) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Missing email parameter' })
      };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailAddress)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Invalid email format' })
      };
    }

    const ipAddress = event.requestContext?.identity?.sourceIp ||
                      event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() ||
                      'unknown';

    const userAgent = event.headers?.['User-Agent'] || event.headers?.['user-agent'] || 'unknown';

    const metadata = {
      ipAddress,
      userAgent
    };

    const success = await unsubscribeUser(tenantId, emailAddress, 'manual-form', metadata);

    if (!success) {
      await notifyAdminOfFailure(tenant, emailAddress, 'manual-form', metadata);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Successfully unsubscribed' })
    };

  } catch (err) {
    console.error('Manual unsubscribe error:', err);

    if (tenant && emailAddress) {
      try {
        await notifyAdminOfFailure(tenant, emailAddress, 'manual-form', { error: err.message });
      } catch (notifyErr) {
        console.error('Failed to notify admin of unsubscribe failure:', notifyErr);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Successfully unsubscribed' })
    };
  }
};

const notifyAdminOfFailure = async (tenant, emailAddress, method, metadata = {}) => {
  try {
    if (!tenant?.createdBy) {
      console.error('No admin email found for tenant:', { tenantId: tenant?.pk });
      return;
    }

    const subject = `[Alert] Unsubscribe Request Failed - ${tenant.name || tenant.brandName || tenant.pk}`;
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
          tenantId: tenant.pk,
          to: { email: tenant.createdBy },
          subject,
          html
        })
      }]
    }));

    console.log('Admin notified of unsubscribe failure:', { tenantId: tenant.pk, adminEmail: tenant.createdBy });
  } catch (err) {
    console.error('Failed to notify admin:', err);
    throw err;
  }
};
