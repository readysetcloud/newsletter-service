import Handlebars from 'handlebars';
import template from '../templates/newsletter.hbs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { getTenant } from './utils/helpers.mjs';
import { marshall } from '@aws-sdk/util-dynamodb';

const eventBridge = new EventBridgeClient();
const ddb = new DynamoDBClient();

export const handler = async (state) => {
  try {
    const template = getTemplate(state.data);

    if (state.isPreview) {
      await sendEmail({
        subject: `[Preview] ${state.subject}`,
        html: template,
        to: { email: state.email }
      });
    } else {
      const tenant = await getTenant(state.tenantId);
      await setupIssueStats(tenant, state.data.metadata.number);
      await sendEmail({
        subject: state.subject,
        html: template,
        to: { list: tenant.list },
        sendAt: state.sendAtDate
      });

      return state;
    }
  } catch (err) {
    console.error(err);
    throw err;
  }
};

const getTemplate = (data) => {
  const htmlTemplate = Handlebars.compile(template);
  const result = htmlTemplate(data);

  return result;
};

/**
 * Sends an email via the newsletter service
 * @param {Object} params - Email parameters
 * @param {string} params.subject - Email subject line
 * @param {string} params.html - HTML content of the email
 * @param {Object} params.to - Recipient configuration
 * @param {string} [params.to.email] - Individual recipient email address
 * @param {string} [params.to.list] - SES list name for bulk sending
 * @param {string} [params.sendAt] - ISO date string for scheduled sending
 */
const sendEmail = async (params) => {
  await eventBridge.send(new PutEventsCommand({
    Entries: [{
      Source: 'newsletter-service',
      DetailType: 'Send Email v2',
      Detail: JSON.stringify({
        subject: params.subject,
        to: {
          ...params.to.email && { email: params.to.email },
          ...params.to.list && { list: params.to.list }
        },
        html: params.html,
        ...params.sendAt && { sendAt: params.sendAt },
        replacements: {
          emailAddress: "<<EMAIL>",
          emailAddressHash: "<<EMAIL_HASH>>"
        }
      })
    }]
  }));
};

const setupIssueStats = async (tenant, slug) => {
  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall({
      pk: `${tenant.pk}#${slug}`,
      sk: 'stats',
      totalOpens: 0,
      uniqueOpens: 0,
      bounces: 0,
      rejects: 0,
      complaints: 0,
      deliveries: 0,
      sends: 0,
      subscribers: tenant.subscribers,
      failedAddresses: []
    })
  }))
}
