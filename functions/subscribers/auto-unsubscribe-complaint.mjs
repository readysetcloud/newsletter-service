import { getTenant } from '../utils/helpers.mjs';
import { unsubscribeUser } from '../utils/subscriber.mjs';

export const handler = async (event) => {
  try {
    const { detail } = event;
    console.log(JSON.stringify(detail));

    if (!detail.complaint?.complainedRecipients?.length) {
      return false;
    }

    // Process each complained recipient
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

  // Use the subscriber utility to handle unsubscribe
  const success = await unsubscribeUser(tenantId, emailAddress);

  if (success) {
    console.log(`Auto-unsubscribed ${emailAddress} from ${tenantId} due to complaint`);
  } else {
    console.error(`Failed to auto-unsubscribe ${emailAddress} from ${tenantId}`);
  }
};




