import Handlebars from 'handlebars';
import defaultTemplate from '../templates/newsletter.hbs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { getTenant } from './utils/helpers.mjs';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { publishIssueEvent, EVENT_TYPES } from './utils/event-publisher.mjs';
import { renderWithSnippets } from './utils/render-template.mjs';

const eventBridge = new EventBridgeClient();
const ddb = new DynamoDBClient();

export const handler = async (state) => {
  try {
    const html = await renderTemplate(state.data, state.tenantId, state.templateId);

    if (state.isPreview) {
      await sendEmail({
        subject: `[Preview] ${state.subject}`,
        html,
        to: { email: state.email },
        sendAt: state.sendAtDate,
        tenantId: state.tenantId
      });
    } else {
      const tenant = await getTenant(state.tenantId);
      const publishedAt = new Date().toISOString();
      await setupIssueStats(tenant, state.data.metadata.number, state.subject, publishedAt);
      await sendEmail({
        subject: state.subject,
        html,
        to: { list: tenant.list },
        sendAt: state.sendAtDate,
        referenceNumber: `${tenant.pk}_${state.data.metadata.number}`,
        tenantId: state.tenantId
      });

      await publishIssueEvent(
        state.tenantId,
        state.tenant?.id || 'system',
        EVENT_TYPES.ISSUE_PUBLISHED,
        {
          issueId: `${state.tenantId}#${state.data.metadata.number}`,
          issueNumber: state.data.metadata.number,
          subject: state.subject,
          publishedAt,
          subscriberCount: tenant.subscribers,
          metadata: state.data.metadata
        }
      );
    }

    return { success: true };
  } catch (err) {
    console.error(err);
    return { success: false };
  }
};

/**
 * Renders the issue data into HTML.
 *
 * When a templateId is supplied, the tenant's selected template is loaded from
 * DynamoDB along with the tenant's snippets (registered as Handlebars partials).
 * Any partial referenced by the template that is missing is registered as an
 * empty string so a missing snippet never fails the send.
 *
 * When no templateId is supplied, the static default newsletter template is used.
 *
 * @param {Object} data - Issue data to render against.
 * @param {string} [tenantId] - Tenant identifier (required when templateId is set).
 * @param {string} [templateId] - Optional selected template identifier.
 * @returns {Promise<string>} Rendered HTML.
 */
const renderTemplate = async (data, tenantId, templateId) => {
  if (!templateId) {
    return Handlebars.compile(defaultTemplate)(data);
  }

  const templateContent = await getTemplateContent(tenantId, templateId);
  if (!templateContent) {
    console.warn(`Template '${templateId}' not found for tenant '${tenantId}', falling back to default template`);
    return Handlebars.compile(defaultTemplate)(data);
  }

  const snippets = await getSnippets(tenantId);
  // Delegate to the shared renderer so the send path and the conformance test
  // exercise identical logic (snippets as partials, missing partial -> empty,
  // noEscape to mirror the Rust preview renderer in template_render.rs).
  return renderWithSnippets(templateContent, data, snippets);
};

/**
 * Loads a template's Handlebars content for a tenant.
 * @param {string} tenantId - Tenant identifier.
 * @param {string} templateId - Template identifier.
 * @returns {Promise<string|null>} Template content, or null if not found.
 */
const getTemplateContent = async (tenantId, templateId) => {
  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: `template#${templateId}`
    })
  }));

  if (!result.Item) {
    return null;
  }

  const template = unmarshall(result.Item);
  return template.content ?? null;
};

/**
 * Loads all snippets for a tenant via GSI1.
 * @param {string} tenantId - Tenant identifier.
 * @returns {Promise<Array<{name: string, content: string}>>} List of snippets.
 */
const getSnippets = async (tenantId) => {
  const result = await ddb.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :gsi1pk',
    ExpressionAttributeValues: marshall({
      ':gsi1pk': `snippet#${tenantId}`
    })
  }));

  return (result.Items ?? []).map(item => unmarshall(item));
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
        ...params.referenceNumber && { referenceNumber: params.referenceNumber },
        ...params.tenantId && { tenantId: params.tenantId },
        replacements: {
          emailAddress: "__EMAIL__",
          emailAddressHash: "__EMAIL_HASH__"
        }
      })
    }]
  }));
};

const padIssueNumber = (issueNumber) => {
  return String(issueNumber).padStart(5, '0');
};

const setupIssueStats = async (tenant, issueNumber, subject, publishedAt) => {
  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall({
      pk: `${tenant.pk}#${issueNumber}`,
      sk: 'stats',
      GSI1PK: `${tenant.pk}#issue`,
      GSI1SK: padIssueNumber(issueNumber),
      subject,
      publishedAt,
      opens: 0,
      bounces: 0,
      rejects: 0,
      complaints: 0,
      deliveries: 0,
      sends: 0,
      subscribers: tenant.subscribers,
      failedAddresses: [],
      statsPhase: 'realtime'
    })
  }));
};
