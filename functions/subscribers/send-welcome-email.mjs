import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import Handlebars from 'handlebars';
import welcomeTemplate from '../../templates/welcome.hbs';
import { mintSubscriberToken } from '../utils/subscriber-token.mjs';
import { assertEventsPublished } from '../utils/eventbridge.mjs';

// Key patterns for DynamoDB (previously from ../senders/types.mjs)
const KEY_PATTERNS = {
  SENDER: (senderId) => `sender#${senderId}`,
  SENDER_GSI1PK: (tenantId) => `sender#${tenantId}`
};

const ddb = new DynamoDBClient();
const eventBridge = new EventBridgeClient();
const template = Handlebars.compile(welcomeTemplate);


export const handler = async (event) => {
  try {
    if (!event?.detail) {
      console.error('Missing event detail');
      return;
    }

    const { tenantId, data } = event.detail;

    if (!tenantId || !data?.email) {
      console.error('Missing required fields:', { tenantId, email: data?.email });
      return;
    }

    const { email, firstName } = data;

    const tenantResult = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: 'tenant'
      })
    }));

    if (!tenantResult.Item) {
      console.error('Tenant not found:', tenantId);
      return;
    }

    const tenant = unmarshall(tenantResult.Item);

    const defaultSender = await getDefaultSender(tenantId);
    if (!defaultSender) {
      console.error('No default sender configured for tenant:', tenantId);
      return;
    }

    // Percent-encoded: `encrypt` emits standard base64, and a `+` in a query
    // value decodes to a space, which corrupts the token past repair by the
    // time the unsubscribe handler decodes it.
    const emailHash = encodeURIComponent(mintSubscriberToken(tenantId, email));
    // API_BASE_URL, not ORIGIN: the unsubscribe route lives on the public API.
    // ORIGIN is the marketing site, which has no such path — every welcome
    // email's unsubscribe link 404'd (when welcome emails sent at all).
    const unsubscribeUrl = `${process.env.API_BASE_URL}/${tenantId}/unsubscribe?email=${emailHash}`;

    const templateData = {
      brandName: tenant.name || tenant.brandName || 'Our Newsletter',
      brandLogo: tenant.brandLogo || null,
      brandColor: tenant.brandColor || null,
      brandDescription: tenant.brandDescription || null,
      subscriberFirstName: firstName || null,
      subscriberEmail: email,
      unsubscribeUrl
    };

    const html = template(templateData);

    const putResult = await eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: 'newsletter-service',
        DetailType: 'Send Email v2',
        Detail: JSON.stringify({
          tenantId,
          from: defaultSender.email,
          subject: `Welcome to ${tenant.name || tenant.brandName || 'our newsletter'}!`,
          html,
          to: {
            email
          },
          // Welcome emails are marketing mail to a subscriber, so they carry
          // the one-click unsubscribe headers like an issue does. Admin alerts
          // ride the same event type and must not — hence an explicit flag
          // rather than "every send with a tenantId".
          listUnsubscribe: true
        })
      }]
    }));

    // Ignoring per-entry failures meant a rejected entry looked exactly like a
    // delivered welcome email.
    assertEventsPublished(putResult, 'Welcome email event');

    console.log('Welcome email event published:', { tenantId, email });

  } catch (error) {
    // Rethrow. This is an async invocation, so returning normally is a
    // successful one and Lambda never retries — a transient EventBridge
    // failure would leave a subscriber who was added with no welcome email and
    // nothing to try again. Throwing is what reaches the retry and the DLQ.
    //
    // The earlier hop is not covered by this: `publishSubscriberEvent` in
    // add-subscriber still swallows its own EventBridge failures, so a signup
    // can lose the `Subscriber Added` event before this function is ever
    // invoked. Closing that needs a durable outbox and is deliberately not in
    // this change — this handler is retryable, the handoff into it is not yet.
    console.error('Send welcome email error:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

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

