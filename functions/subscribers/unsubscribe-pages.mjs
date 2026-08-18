import Handlebars from 'handlebars';
import unsubscribeTemplate from '../../templates/unsubscribe-success.hbs';
import confirmTemplate from '../../templates/unsubscribe-confirm.hbs';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();
const unsubscribeHtml = Handlebars.compile(unsubscribeTemplate);
const confirmHtml = Handlebars.compile(confirmTemplate);

/**
 * Page rendering shared by the two halves of the unsubscribe flow: the GET
 * handler (which shows the confirmation page) and the POST handler (which
 * performs the removal and shows the result). Lived in unsubscribe.mjs while
 * the GET did everything; split out when the destructive step moved to POST.
 */

export const htmlResponse = (body) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/html' },
  body
});

/**
 * Tenant-specific page overrides ({tenantId}#unsubscribe / templates record).
 */
const getUnsubscribeTemplate = async (tenantId) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: `${tenantId}#unsubscribe`,
        sk: 'templates'
      })
    }));

    if (result.Item) {
      return unmarshall(result.Item);
    }

    return {};
  } catch (error) {
    console.error('Error fetching unsubscribe template:', error);
    return {};
  }
};

/**
 * The confirmation page: states what is about to happen and puts the removal
 * behind a POST. The form carries no action attribute on purpose — it submits
 * back to the page's own URL, token-bearing query string included, so the
 * token never has to be re-interpolated into markup.
 */
export const getConfirmationPage = (tenantId, emailAddress) => {
  return confirmHtml({ tenantId, emailAddress });
};

/**
 * Result page, for a removal that succeeded or one that did not.
 *
 * A tenant's custom `success` page is used only when the unsubscribe actually
 * succeeded. It used to be returned for both outcomes, so any tenant with a
 * custom page told people with an expired token or a failed delete that they
 * had been unsubscribed when they had not — and skipped the stock failure
 * page, whose manual form is the only way back for someone holding a dead
 * link. A tenant may also configure a `failure` page; without one, the stock
 * failure page (with the form) is used.
 */
export const getUnsubscribePage = async (tenantId, wasSuccessful, emailAddress) => {
  const template = await getUnsubscribeTemplate(tenantId);

  if (wasSuccessful && template.success) {
    return template.success;
  }

  if (!wasSuccessful && template.failure) {
    return template.failure;
  }

  return unsubscribeHtml({
    tenantId,
    wasSuccessful,
    emailAddress: emailAddress || ''
  });
};
