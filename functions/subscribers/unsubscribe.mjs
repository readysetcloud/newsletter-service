import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { decrypt, getTenant } from "../utils/helpers.mjs";
import { htmlResponse, getConfirmationPage, getUnsubscribePage } from "./unsubscribe-pages.mjs";

const eventBridge = new EventBridgeClient();

/**
 * GET /{tenant}/unsubscribe — the footer link's landing page.
 *
 * Renders and nothing else. This handler used to delete the subscriber during
 * the GET, which meant anyone who *fetched* the link unsubscribed — and
 * corporate mail security (Outlook SafeLinks, Proofpoint, Mimecast) fetches
 * every link in a message before the recipient sees it, exactly the behaviour
 * this codebase's own scanner-clicks module documents. Subscribers behind
 * those gateways were being silently removed without ever opening the email,
 * indistinguishably from a real unsubscribe.
 *
 * The removal now lives behind POST on the same path (manual-unsubscribe.mjs):
 * the confirmation form here posts to it, the RFC 8058 List-Unsubscribe header
 * posts to it, and scanners — which only GET — can no longer touch the list.
 */
export const handler = async (event) => {
  let emailAddress = null;
  let tenantId = null;

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

    return htmlResponse(getConfirmationPage(tenantId, emailAddress));
  } catch (err) {
    console.error('Unsubscribe error:', {
      error: err.message,
      tenantId,
      emailAddress: emailAddress ? '[REDACTED]' : null,
      stack: err.stack
    });

    if (tenantId) {
      try {
        await notifyAdminOfFailure(tenantId, emailAddress, 'encrypted-link', { error: err.message });
      } catch (notifyErr) {
        console.error('Failed to notify admin of unsubscribe failure:', notifyErr);
      }
    }

    // The error page carries the manual unsubscribe form, so a dead link still
    // leaves the person a way off the list.
    return htmlResponse(await getUnsubscribePage(tenantId, false, emailAddress));
  }
};

const notifyAdminOfFailure = async (tenantId, emailAddress, method, metadata = {}) => {
  try {
    const tenant = await getTenant(tenantId);
    if (!tenant?.createdBy) {
      console.error('No admin email found for tenant:', { tenantId });
      return;
    }

    const subject = `[Alert] Unsubscribe Request Failed - ${tenant.name || tenant.brandName || tenantId}`;
    const html = `
      <h2>Unsubscribe Request Failed</h2>
      <p>An unsubscribe request could not be processed for your newsletter.</p>

      <h3>Details:</h3>
      <ul>
        <li><strong>Email:</strong> ${emailAddress || 'could not be determined'}</li>
        <li><strong>Method:</strong> ${method}</li>
        <li><strong>Time:</strong> ${new Date().toISOString()}</li>
        ${metadata.error ? `<li><strong>Error:</strong> ${metadata.error}</li>` : ''}
      </ul>

      <p>The user was shown the manual unsubscribe form, so they can still remove themselves.</p>
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
