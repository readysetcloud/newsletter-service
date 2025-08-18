import { SESv2Client, CreateTenantCommand, CreateContactListCommand } from '@aws-sdk/client-sesv2';

const ses = new SESv2Client();

export const handler = async (event) => {
  try {
    const { tenantId, userId } = event;

    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    console.log(`Setting up email tenant for: ${tenantId}`);

    const tenantResult = await ses.send(new CreateTenantCommand({
      TenantName: tenantId,
      Tags: [
        { Key: 'type', Value: 'newsletter_tenant' },
        { Key: 'createdBy', Value: userId || 'system' },
        { Key: 'createdAt', Value: new Date().toISOString() }
      ]
    }));

    console.log(`SES tenant created: ${tenantResult.TenantArn}`);

    const contactListResult = await ses.send(new CreateContactListCommand({
      ContactListName: tenantId,
      Description: `Contact list for ${tenantId} newsletter`,
      Tags: [
        { Key: 'tenantId', Value: tenantId },
        { Key: 'type', Value: 'newsletter_contacts' }
      ]
    }));

    console.log(`Contact list created: ${contactListResult.ContactListArn}`);

    return {
        tenantArn: tenantResult.TenantArn,
        contactList: tenantId
    };
  } catch (error) {
    console.error('Setup email tenant error:', error);

    throw {
      error: error.name || 'SetupEmailTenantError',
      message: error.message || 'Failed to setup email tenant',
      details: error
    };
  }
};
