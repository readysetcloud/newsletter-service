import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { getTenant, sendWithRetry, throttle } from "../utils/helpers.mjs";
import { getMostRecentPublishedIssue, incrementIssueCounter } from "../utils/issue-attribution.mjs";
import { removeSubscriberAndDecrement } from "../utils/subscriber.mjs";

const ddb = new DynamoDBClient();
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

    // Get tenant information
    const tenant = await getTenant(tenantId.id);

    // Look up the most recently published issue for attribution (once, before the loop)
    let attributionIssue = null;
    try {
      attributionIssue = await getMostRecentPublishedIssue(tenantId.id);
      if (!attributionIssue) {
        console.warn('No published issue found for tenant, cleaned counts will not be attributed');
      }
    } catch (err) {
      console.warn('Failed to look up most recent published issue for attribution:', err);
    }

    // Remove each persistent failure from Subscribers table using throttle to avoid rate limits
    let successfulRemovals = 0;
    const removedAddresses = [];
    const removeTasks = persistentFailures.map((emailAddress) => async () => {
      try {
        // Shared with the unsubscribe path: the row and the tenant count
        // commit together. This used to delete rows and then recount the whole
        // partition and overwrite `tenant.subscribers` with an absolute total —
        // a read followed by a write, which erased every signup that landed
        // between the two. The same defect the import recount was removed for.
        const removed = await sendWithRetry(() => removeSubscriberAndDecrement(
          tenantId.id,
          emailAddress.toLowerCase()
        ));

        if (removed) {
          successfulRemovals++;
          removedAddresses.push(emailAddress);
          console.log(`Successfully removed ${emailAddress} from Subscribers table`);

          // Increment cleaned counter on the attributed issue
          if (attributionIssue) {
            try {
              await incrementIssueCounter(attributionIssue.pk, 'cleaned');
            } catch (err) {
              console.warn(`Failed to increment cleaned counter for ${emailAddress}:`, err);
            }
          }
        } else {
          console.log(`Skipped ${emailAddress}; address was already absent from Subscribers table`);
        }
        return true;
      } catch (error) {
        console.error(`Failed to remove ${emailAddress} from Subscribers table:`, error);
        return false;
      }
    });

    await throttle(removeTasks, 5);

    console.log(`Successfully removed ${successfulRemovals}/${persistentFailures.length} addresses`);

    // Read for the notification email only — the count itself was already
    // maintained by each removal above. Consistent so the operator's mail
    // quotes the number the removals actually produced.
    const subscriberCount = await readSubscriberCount(tenantId.id);

    // Send notification email to tenant if any subscribers were removed
    if (successfulRemovals > 0) {
      await sendNotificationEmail(tenant, removedAddresses, successfulRemovals, subscriberCount, tenantId.id);
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

/**
 * The tenant's current subscriber count, for display in the operator's
 * notification email.
 *
 * A read, never a write. The previous version recounted the partition and
 * overwrote `tenant.subscribers` with the total, which raced with every live
 * signup and unsubscribe — a signup committing between the count and the write
 * was simply erased. Each removal above now maintains the count atomically, so
 * there is nothing left for this to repair and nothing it should overwrite.
 */
const readSubscriberCount = async (tenantId) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: tenantId, sk: 'tenant' }),
      ProjectionExpression: '#subscribers',
      ExpressionAttributeNames: { '#subscribers': 'subscribers' },
      ConsistentRead: true
    }));

    const { subscribers } = result.Item ? unmarshall(result.Item) : {};
    return typeof subscribers === 'number' ? subscribers : null;
  } catch (error) {
    // The cleanup itself already succeeded; a failed read here should not fail
    // it. The email says "unknown" rather than a wrong number.
    console.error('Error reading subscriber count for notification:', error);
    return null;
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

              <p>${typeof subscriberCount === 'number'
    ? `Your subscriber count is now ${subscriberCount}.`
    : 'Your subscriber count has been updated to reflect the removals.'}</p>
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
