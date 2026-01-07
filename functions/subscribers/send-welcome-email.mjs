import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import Handlebars from 'handlebars';
import welcomeTemplate from '../../templates/welcome.hbs';
import { encrypt } from '../utils/helpers.mjs';
import { KEY_PATTERNS } from '../senders/types.mjs';

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

    const emailHash = encrypt(email);
    const unsubscribeUrl = `${process.env.ORIGIN}/${tenantId}/unsubscribe?email=${emailHash}`;

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

    await eventBridge.send(new PutEventsCommand({
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
          }
        })
      }]
    }));

    console.log('Welcome email event published:', { tenantId, email });

  } catch (error) {
    console.error('Send welcome email error:', {
      error: error.message,
      stack: error.stack
    });
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

