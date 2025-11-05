import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SESv2Client, DeleteContactCommand } from '@aws-sdk/client-sesv2';
import { marshall } from '@aws-sdk/util-dynamodb';
import { getTenant } from './helpers.mjs';

const ddb = new DynamoDBClient();
const ses = new SESv2Client();

/**
 * Unsubscribe user from tenant's mailing list
 * @param {string} tenantId - Tenant identifier
 * @param {string} emailAddress - Email address to unsubscribe
 * @returns {boolean} True if successful or already unsubscribed, false if unknown error
 */
export const unsubscribeUser = async (tenantId, emailAddress) => {
  try {
    // Get tenant info to find SES contact list
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      console.error('Tenant not found:', { tenantId });
      return false;
    }

    // Store recent unsubscribe FIRST to prevent re-sending
    const now = new Date();
    const ttl = Math.floor((now.getTime() + (30 * 24 * 60 * 60 * 1000)) / 1000); // 30 days TTL

    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        pk: `${tenantId}#recent-unsubscribes`,
        sk: emailAddress.toLowerCase(),
        email: emailAddress,
        unsubscribedAt: now.toISOString(),
        ttl: ttl
      })
    }));

    // Remove from SES contact list
    try {
      await ses.send(new DeleteContactCommand({
        ContactListName: tenant.list,
        EmailAddress: emailAddress
      }));
      console.log('Unsubscribe successful:', { tenantId, emailAddress, sesRemoved: true });
    } catch (sesError) {
      if (sesError.name === 'NotFoundException') {
        console.log('Unsubscribe successful:', { tenantId, emailAddress, sesRemoved: 'already_removed' });
      } else {
        console.error('SES removal failed but unsubscribe protected:', {
          tenantId,
          emailAddress,
          sesError: sesError.message
        });
      }
    }

    return true;

  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.log('Email already unsubscribed:', { tenantId, email: '[REDACTED]' });
      return true;
    }

    console.error('Unsubscribe failed:', {
      tenantId,
      email: '[REDACTED]',
      error: error.message
    });
    return false;
  }
};
