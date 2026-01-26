import { SESv2Client, SendEmailCommand, ListContactsCommand } from "@aws-sdk/client-sesv2";
import { SchedulerClient, CreateScheduleCommand } from "@aws-sdk/client-scheduler";
import { DynamoDBClient, QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { encrypt } from './utils/helpers.mjs';

// Key patterns for DynamoDB (previously from ./senders/types.mjs)
const KEY_PATTERNS = {
  SENDER: (senderId) => `sender#${senderId}`,
  SENDER_GSI1PK: (tenantId) => `sender#${tenantId}`
};

const ses = new SESv2Client();
const scheduler = new SchedulerClient();
const ddb = new DynamoDBClient();

const tpsLimit = parseInt(process.env.SES_TPS_LIMIT || "14", 10);
const delayMs = Math.ceil(1000 / tpsLimit);

const sendWithRetry = async (sendFn, maxRetries = 3) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await sendFn();
    } catch (err) {
      if (err.name === 'Throttling' || err.name === 'TooManyRequestsException') {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.log(`Throttled, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Max retries exceeded');
};

/**
 * Get sender email by email address for a tenant
 * @param {string} tenantId - Tenant identifier
 * @param {string} email - Email address to find
 * @returns {Promise<Object|null>} Sender record or null if not found
 */
const getSenderByEmail = async (tenantId, email) => {
  try {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk',
      ExpressionAttributeValues: marshall({
        ':gsi1pk': KEY_PATTERNS.SENDER_GSI1PK(tenantId),
        ':gsi1sk': email
      })
    }));

    if (result.Items && result.Items.length > 0) {
      return unmarshall(result.Items[0]);
    }
    return null;
  } catch (error) {
    console.error('Error querying sender by email:', error);
    throw new Error('Failed to query sender email');
  }
};

/**
 * Get default sender for a tenant
 * @param {string} tenantId - Tenant identifier
 * @returns {Promise<Object|null>} Default sender record or null if not found
 */
const getDefaultSender = async (tenantId) => {
  try {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      FilterExpression: 'isDefault = :isDefault AND verificationStatus = :verified',
      ExpressionAttributeValues: marshall({
        ':gsi1pk': KEY_PATTERNS.SENDER_GSI1PK(tenantId),
        ':isDefault': true,
        ':verified': 'verified'
      })
    }));

    if (result.Items && result.Items.length > 0) {
      return unmarshall(result.Items[0]);
    }
    return null;
  } catch (error) {
    console.error('Error querying default sender:', error);
    throw new Error('Failed to query default sender');
  }
};

/**
 * Update sender metrics after sending emails
 * @param {string} tenantId - Tenant identifier
 * @param {string} senderId - Sender identifier
 * @param {number} emailCount - Number of emails sent
 */
const updateSenderMetrics = async (tenantId, senderId, emailCount) => {
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: KEY_PATTERNS.SENDER(senderId)
      }),
      UpdateExpression: 'ADD emailsSent :count SET lastSentAt = :timestamp',
      ExpressionAttributeValues: marshall({
        ':count': emailCount,
        ':timestamp': new Date().toISOString()
      })
    }));
  } catch (error) {
    console.error('Error updating sender metrics:', error);
    // Don't throw error here as it shouldn't fail the email send
  }
};

/**
 * Filter out recently unsubscribed emails to handle SES propagation delays
 * @param {string} tenantId - Tenant identifier
 * @param {string[]} emailAddresses - List of email addresses to filter
 * @returns {Promise<string[]>} Filtered list excluding recently unsubscribed emails
 */
const filterRecentlyUnsubscribed = async (tenantId, emailAddresses) => {
  try {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: marshall({
        ':pk': `${tenantId}#recent-unsubscribes`
      })
    }));

    if (!result.Items || result.Items.length === 0) {
      return emailAddresses; // No recent unsubscribes
    }

    // Extract recently unsubscribed emails
    const recentlyUnsubscribed = new Set();
    for (const item of result.Items) {
      const record = unmarshall(item);
      if (record.email) {
        recentlyUnsubscribed.add(record.email.toLowerCase());
      }
    }

    // Filter out recently unsubscribed emails
    return emailAddresses.filter(email =>
      !recentlyUnsubscribed.has(email.toLowerCase())
    );
  } catch (error) {
    console.error('Error filtering recently unsubscribed emails:', error);
    // If filtering fails, return original list to avoid blocking email sends
    return emailAddresses;
  }
};

export const handler = async (event) => {
  try {

    if (!event?.detail) {
      throw new Error('Missing event detail');
    }

    const { detail: data } = event;
    const { subject, html, to, sendAt, replacements, from, tenantId } = data;

    if (!subject || !html || !to) {
      throw new Error('Missing required fields: subject, html, or to');
    }

    if (!to.email && !to.list) {
      throw new Error('Must specify either to.email or to.list');
    }

    if (!tenantId) {
      throw new Error('Missing required field: tenantId');
    }

    // Determine which sender email to use
    let senderEmail = null;
    let senderRecord = null;

    if (from) {
      // If from email is provided, verify it's configured for this tenant
      senderRecord = await getSenderByEmail(tenantId, from);
      if (!senderRecord) {
        throw new Error(`From email '${from}' is not configured for this tenant`);
      }
      if (senderRecord.verificationStatus !== 'verified') {
        throw new Error(`From email '${from}' is not verified`);
      }
      senderEmail = from;
    } else {
      // If no from email provided, use the default sender
      senderRecord = await getDefaultSender(tenantId);
      if (!senderRecord) {
        throw new Error('No default sender configured for this tenant');
      }
      senderEmail = senderRecord.email;
    }

    console.log(`Using sender email: ${senderEmail} for tenant: ${tenantId}`);

    if (sendAt) {
      const sendAtDate = new Date(sendAt);
      const now = new Date();

      if (sendAtDate > now) {
        // Schedule for future, but remove sendAt property
        delete data.sendAt;
        await scheduler.send(new CreateScheduleCommand({
          ActionAfterCompletion: 'DELETE',
          FlexibleTimeWindow: { Mode: 'OFF' },
          GroupName: 'newsletter',
          Name: `email-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          ScheduleExpression: `at(${sendAtDate.toISOString().slice(0, 19)})`,
          Target: {
            Arn: 'arn:aws:scheduler:::aws-sdk:eventbridge:putEvents',
            RoleArn: process.env.SCHEDULER_ROLE_ARN,
            Input: JSON.stringify({
              Entries: [{
                EventBusName: 'default',
                Detail: JSON.stringify(data),
                DetailType: 'Send Email v2',
                Source: 'newsletter-service'
              }]
            })
          },

        }));
        return { scheduled: true, sendAt: sendAtDate.toISOString() };
      }
    }

    let emailAddresses = [];
    if (to.email) {
      emailAddresses = [to.email];
    } else if (to.list) {
      let nextToken;
      do {
        const contacts = await ses.send(new ListContactsCommand({
          ContactListName: to.list,
          NextToken: nextToken
        }));
        if (contacts.Contacts?.length) {
          emailAddresses.push(...contacts.Contacts.map(c => c.EmailAddress));
        }
        nextToken = contacts.NextToken;
      } while (nextToken);

      if (emailAddresses.length === 0) {
        throw new Error(`No contacts found in list: ${to.list}`);
      }

      // Filter out recently unsubscribed emails (30-day buffer for safety)
      const filteredAddresses = await filterRecentlyUnsubscribed(tenantId, emailAddresses);
      const excludedCount = emailAddresses.length - filteredAddresses.length;
      if (excludedCount > 0) {
        console.log(`Excluded ${excludedCount} recently unsubscribed emails from send`);
      }
      emailAddresses = filteredAddresses;
    }

    console.log(`Sending to ${emailAddresses.length} recipients with TPS limit ${tpsLimit} from ${senderEmail}`);

    // Send each email with retry and TPS throttle
    for (const email of emailAddresses) {
      await sendWithRetry(async () => {
        let personalizedEmail = html;
        if (replacements?.emailAddress) {
          personalizedEmail = personalizedEmail.replace(new RegExp(replacements.emailAddress, 'g'), email);
        }
        if (replacements?.emailAddressHash) {
          const emailHash = encrypt(email);
          personalizedEmail = personalizedEmail.replace(new RegExp(replacements.emailAddressHash, 'g'), emailHash);
        }

        await ses.send(new SendEmailCommand({
          FromEmailAddress: senderEmail,
          Destination: { ToAddresses: [email] },
          Content: {
            Simple: {
              Subject: { Data: subject },
              Body: { Html: { Data: personalizedEmail } }
            }
          },
          ...data.referenceNumber && { EmailTags: [{ Name: 'referenceNumber', Value: data.referenceNumber }] },
          ConfigurationSetName: process.env.CONFIGURATION_SET
        }));
      });

      // Make sure we don't send too quickly
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    // Update sender metrics
    if (senderRecord) {
      await updateSenderMetrics(tenantId, senderRecord.senderId, emailAddresses.length);
    }

    return {
      sent: true,
      recipients: emailAddresses.length,
      senderEmail: senderEmail,
      senderId: senderRecord?.senderId
    };
  } catch (err) {
    console.error('Send email error:', {
      error: err.message,
      stack: err.stack,
      event: JSON.stringify(event, null, 2)
    });
    throw err;
  }
};
