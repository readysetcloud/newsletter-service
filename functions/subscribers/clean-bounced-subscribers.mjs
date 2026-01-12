import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SESv2Client, DeleteContactCommand, ListContactsCommand } from "@aws-sdk/client-sesv2";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { getTenant, sendWithRetry, throttle } from "../utils/helpers.mjs";

const ddb = new DynamoDBClient();
const ses = new SESv2Client();
const eventBridge = new EventBridgeClient();

export const handler = async (event) => {
  try {
    console.log('Processing clean bounced subscribers event:', JSON.stringify(event, null, 2));

    const { currentIssue, previousIssue, tenantId } = event.detail;

    if (!currentIssue || !previousIssue) {
      console.warn('Missing currentIssue or previousIssue in event detail');
      return;
    }

    if (currentIssue === previousIssue) {
      console.warn('currentIssue and previousIssue are the same, skipping cleanup');
      return;
    }

    const [currentRecord, previousRecord] = await Promise.all([
      loadStatsRecord(currentIssue),
      loadStatsRecord(previousIssue)
    ]);

    if (!currentRecord || !previousRecord) {
      console.warn('Could not load one or both stats records');
      return;
    }

    // Check if cleanup already ran for this issue (idempotency)
    if (currentRecord.cleaned !== undefined) {
      console.log(`Cleanup already completed for issue ${currentIssue}, skipping`);
      return;
    }

    const currentFailedAddresses = currentRecord.failedAddresses || [];
    const lastFailedAddresses = previousRecord.failedAddresses || [];

    // Find addresses that appear in both records
    const persistentFailures = currentFailedAddresses.filter(address =>
      lastFailedAddresses.includes(address)
    );

    if (persistentFailures.length === 0) {
      console.log('No address to remove');
      return;
    }

    console.log(`Found ${persistentFailures.length} addresses to clean up:`, persistentFailures);

    // Get tenant information to determine which SES contact list to use
    const tenant = await getTenant(tenantId.id);

    // Remove each persistent failure from SES using throttle to avoid rate limits
    let successfulRemovals = 0;
    const removeTasks = persistentFailures.map((emailAddress) => async () => {
      try {
        await sendWithRetry(() => ses.send(new DeleteContactCommand({
          ContactListName: tenant.list,
          EmailAddress: emailAddress
        })));
        successfulRemovals++;
        console.log(`Successfully removed ${emailAddress} from contact list`);
        return true;
      } catch (error) {
        console.error(`Failed to remove ${emailAddress} from contact list:`, error);
        return false;
      }
    });

    await throttle(removeTasks, 5);

    console.log(`Successfully removed ${successfulRemovals}/${persistentFailures.length} addresses`);

    // Update subscriber count by getting actual count from SES
    const subscriberCount = await updateSubscriberCount(tenant);

    // Update the current issue stats record with cleaned count (use actual successful removals)
    await updateCleanedCount(currentIssue, successfulRemovals);

    // Send notification email to tenant if any subscribers were removed
    if (successfulRemovals > 0) {
      await sendNotificationEmail(tenant, persistentFailures, successfulRemovals, subscriberCount, tenantId.id);
    }

    console.log(`Successfully cleaned up ${successfulRemovals} bounced subscribers`);

  } catch (error) {
    console.error('Error cleaning bounced subscribers:', error);
    throw error;
  }
};

const loadStatsRecord = async (issueId) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: issueId,
        sk: 'stats'
      })
    }));

    return result.Item ? unmarshall(result.Item) : null;
  } catch (error) {
    console.error(`Error loading stats record for ${issueId}:`, error);
    return null;
  }
};

const updateSubscriberCount = async (tenant) => {
  try {
    let totalCount = 0;
    let nextToken;

    do {
      const contacts = await sendWithRetry(() => ses.send(new ListContactsCommand({
        ContactListName: tenant.list,
        NextToken: nextToken
      })));

      if (contacts.Contacts?.length) {
        totalCount += contacts.Contacts.length;
      }
      nextToken = contacts.NextToken;
    } while (nextToken);

    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenant.pk,
        sk: 'tenant'
      }),
      UpdateExpression: 'SET #subscribers = :count',
      ExpressionAttributeNames: {
        '#subscribers': 'subscribers'
      },
      ExpressionAttributeValues: {
        ':count': { N: totalCount.toString() }
      }
    }));

    console.log(`Updated subscriber count to actual count: ${totalCount}`);
    return totalCount;
  } catch (error) {
    console.error('Error updating subscriber count:', error);
    return '???';
  }
};

const updateCleanedCount = async (issueId, cleanedCount) => {
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: issueId,
        sk: 'stats'
      }),
      UpdateExpression: 'SET cleaned = :count',
      ExpressionAttributeValues: {
        ':count': { N: cleanedCount.toString() }
      }
    }));

    console.log(`Updated issue ${issueId} stats with cleaned count: ${cleanedCount}`);
  } catch (error) {
    console.error(`Error updating cleaned count for issue ${issueId}:`, error);
  }
};

const sendNotificationEmail = async (tenant, removedAddresses, successfulRemovals, subscriberCount, tenantId) => {
  try {
    const subject = `Subscriber Cleanup Report - ${successfulRemovals} addresses removed`;

    const html = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            .content { background-color: #ffffff; padding: 20px; border: 1px solid #dee2e6; border-radius: 8px; }
            .email-list { background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 15px 0; }
            .email-item { font-family: monospace; font-size: 14px; margin: 5px 0; }
            .summary { background-color: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 4px; margin: 20px 0; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; font-size: 12px; color: #6c757d; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>🧹 Subscriber Cleanup Report</h2>
              <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
            </div>

            <div class="content">
              <h3>Automatic Cleanup Summary</h3>
              <p>We've automatically removed <strong>${successfulRemovals}</strong> email addresses from your subscriber list due to persistent delivery failures.</p>

              <div class="summary">
                <h4>Why were these addresses removed?</h4>
                <ul>
                  <li>These email addresses failed to receive your newsletter in both the current and previous issues</li>
                  <li>Persistent failures typically indicate invalid email addresses, full mailboxes, or blocked domains</li>
                  <li>Removing these addresses helps maintain your sender reputation and improves deliverability</li>
                  <li>This cleanup happens automatically to keep your list healthy</li>
                </ul>
              </div>

              <h4>Removed Email Addresses:</h4>
              <div class="email-list">
                ${removedAddresses.map(email => `<div class="email-item">${email}</div>`).join('')}
              </div>

              <h4>What happens next?</h4>
              <p>These addresses have been permanently removed from your contact list. If any of these were legitimate subscribers who want to continue receiving your newsletter, they can re-subscribe through your normal signup process.</p>

              <p>Your subscriber count (${subscriberCount}) has been updated to reflect the current accurate number of active subscribers.</p>
            </div>

            <div class="footer">
              <p>This is an automated notification from your newsletter service. If you have questions about this cleanup, please contact support.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const emailEvent = {
      subject,
      html,
      to: {
        email: tenant.email
      },
      tenantId
    };

    await eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: 'newsletter-service',
        DetailType: 'Send Email v2',
        Detail: JSON.stringify(emailEvent)
      }]
    }));

    console.log(`Sent cleanup notification email to ${tenant.email}`);
  } catch (error) {
    console.error('Error sending notification email:', error);
    // Don't throw - email notification failure shouldn't fail the cleanup
  }
};
