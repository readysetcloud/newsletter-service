import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getTenant } from '../utils/helpers.mjs';
import { unsubscribeUser } from '../utils/subscriber.mjs';
import { getMostRecentPublishedIssue, incrementIssueCounter } from '../utils/issue-attribution.mjs';

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
    // Rethrow. This is an async invocation, so returning normally counts as a
    // successful one and Lambda never retries — a transient outage would
    // silently leave someone who clicked "Report spam" subscribed. Throwing is
    // what hands the event to the platform's retry and DLQ.
    console.error(err);
    throw err;
  }
};

/**
 * The issue stats key a complaint's own reference tag points at, or null.
 *
 * SES tag values allow no `#`, so `publish-issue` emits `<tenantPk>_<number>`
 * and the stats key is the same string with the final separator swapped back.
 * Split on the LAST underscore: a tenant id may contain one, and splitting on
 * the first would truncate it.
 */
const issuePkFromReference = (referenceNumber) => {
  const separatorIndex = referenceNumber?.lastIndexOf('_') ?? -1;
  if (separatorIndex <= 0) {
    return null;
  }

  return `${referenceNumber.slice(0, separatorIndex)}#${referenceNumber.slice(separatorIndex + 1)}`;
};

/**
 * Which tenant a complained-about message belongs to.
 *
 * The `tenantId` tag is preferred because it is on every marketing send,
 * including welcome mail, which carries no issue reference — a "report spam" on
 * one used to resolve to nothing and be dropped, leaving the complainant
 * subscribed. `referenceNumber` remains the fallback for messages sent before
 * the tag existed.
 */
const resolveTenantId = (detail, emailAddress) => {
  const taggedTenant = detail.mail?.tags?.tenantId?.[0];
  if (taggedTenant) {
    return taggedTenant;
  }

  const referenceNumber = detail.mail?.tags?.referenceNumber;
  if (!referenceNumber?.length) {
    console.log(`No tenant tag or reference number found for complaint from ${emailAddress}`);
    return null;
  }

  const issuePk = issuePkFromReference(referenceNumber[0]);
  return issuePk ? issuePk.split('#')[0] : null;
};

const processComplaintUnsubscribe = async (emailAddress, detail) => {
  const tenantId = resolveTenantId(detail, emailAddress);
  if (!tenantId) {
    return;
  }

  const tenant = await getTenant(tenantId);
  if (!tenant) {
    console.log(`Tenant ${tenantId} not found`);
    return;
  }

  const metadata = {
    complaintFeedbackType: detail.complaint?.complaintFeedbackType || 'unknown',
    userAgent: detail.complaint?.userAgent || 'ses-complaint'
  };

  const result = await unsubscribeUser(tenantId, emailAddress, 'complaint', metadata);

  if (result.actuallyRemoved) {
    try {
      // The complaint names the message that produced it, so use that rather
      // than asking which issue is newest. "Most recent" is only ever a guess,
      // and it guesses wrong exactly when it matters: complaints can arrive
      // days late, so a complaint about issue 42 that lands after issue 43 has
      // gone out was being charged to 43 — the issue that did nothing wrong.
      // Falls back to the newest sent issue only for events with no reference
      // tag (welcome mail, and anything sent before the tag existed).
      const taggedIssuePk = issuePkFromReference(detail.mail?.tags?.referenceNumber?.[0]);
      const issuePk = taggedIssuePk ?? (await getMostRecentPublishedIssue(tenantId))?.pk;

      if (issuePk) {
        await incrementIssueCounter(issuePk, 'unsubscribes');
      } else {
        console.warn('No published issue found for unsubscribe attribution:', { tenantId });
      }
    } catch (attrErr) {
      console.warn('Failed to increment unsubscribe counter:', { tenantId, error: attrErr.message });
    }
    console.log(`Auto-unsubscribed ${emailAddress} from ${tenantId} due to complaint`);
  } else if (!result.success) {
    console.error(`Failed to auto-unsubscribe ${emailAddress} from ${tenantId}`);
    // Best-effort notification first, then throw: a complaint that could not be
    // honoured has to be retried, and only an error does that here.
    await notifyAdminOfFailure(tenantId, emailAddress, 'complaint', metadata, tenant);
    throw new Error(`Failed to auto-unsubscribe ${emailAddress} from ${tenantId}`);
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




