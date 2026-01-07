import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getTenant } from '../utils/helpers.mjs';
import { unsubscribeUser } from '../utils/subscriber.mjs';

const eventBridge = new EventBridgeClient();

export const handler = async (event) => {
  try {
    const { detail } = event;
    console.log(JSON.stringify(detail));

    if (!detail.complaint?.complainedRecipients?.length) {
      return false;
    }

    for (const recipient of detail.complaint.complainedRecipients) {
      const emailAddress = recipient.emailAddress;
      if (!emailAddress) continue;

      await processComplaintUnsubscribe(emailAddress, detail);
    }

    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
};

const processComplaintUnsubscribe = async (emailAddress, detail) => {
  const referenceNumber = detail.mail?.tags?.referenceNumber;
  if (!referenceNumber?.length) {
    console.log(`No reference number found for complaint from ${emailAddress}`);
    return;
  }

  const issueId = referenceNumber[0].replace(/_/g, '#');
  const tenantId = issueId.split('#')[0];

  const tenant = await getTenant(tenantId);
  if (!tenant) {
    console.log(`Tenant ${tenantId} not found`);
    return;
  }

  const metadata = {
    complaintFeedbackType: detail.complaint?.complaintFeedbackType || 'unknown',
    userAgent: detail.complaint?.userAgent || 'ses-complaint'
  };

  const success = await unsubscribeUser(tenantId, emailAddress, 'complaint', metadata);

  if (success) {
    console.log(`Auto-unsubscribed ${emailAddress} from ${tenantId} due to complaint`);
  } else {
    console.error(`Failed to auto-unsubscribe ${emailAddress} from ${tenantId}`);
    await notifyAdminOfFailure(tenantId, emailAddress, 'complaint', metadata, tenant);
  }
};

const notifyAdminOfFailure = async (tenantId, emailAddress, method, metadata = {}, tenant = null) => {
  try {
    if (!tenant) {
      tenant = await getTenant(tenantId);
    }

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
        <li><strong>Email:</strong> ${emailAddress}</li>
        <li><strong>Method:</strong> ${method}</li>
        <li><strong>Time:</strong> ${new Date().toISOString()}</li>
        ${metadata.error ? `<li><strong>Error:</strong> ${metadata.error}</li>` : ''}
        ${metadata.complaintFeedbackType ? `<li><strong>Complaint Type:</strong> ${metadata.complaintFeedbackType}</li>` : ''}
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
  }
};




