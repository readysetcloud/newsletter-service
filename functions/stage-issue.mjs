import Handlebars from 'handlebars';
import sendgrid from '@sendgrid/client';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

let apiKey;
const eventBridge = new EventBridgeClient();

export const handler = async (state) => {
  try {
    if (!apiKey) {
      const secrets = await getSecret(process.env.SECRET_ID, { transform: 'json' });
      apiKey = secrets.sendgrid;
    }

    sendgrid.setApiKey(apiKey);

    const template = await getNewsletterTemplate();
    const newsletter = enrichTemplate(template, state.data);

    if (state.isPreview) {
      await sendPreview(newsletter, state.subject, state.email);
    } else {
      const singleSendId = await createSingleSend(newsletter, state.subject, state.sendAtDate);

      return { id: singleSendId };
    }
  } catch (err) {
    console.error(err);
    throw err;
  }
};

const getNewsletterTemplate = async () => {
  const request = {
    url: `/v3/templates/${process.env.TEMPLATE_ID}/versions/${process.env.VERSION_ID}`,
    method: 'GET'
  };

  const [response, body] = await sendgrid.request(request);
  const html = response.body.html_content;
  const plain = response.body.plain_content;

  return { html, plain };
};

const enrichTemplate = (template, data) => {
  const htmlTemplate = Handlebars.compile(template.html);
  const plainTemplate = Handlebars.compile(template.plain);
  const htmlResult = htmlTemplate(data);
  const plainResult = plainTemplate(data);

  return { html: htmlResult, plain: plainResult };
};

const createSingleSend = async (newsletter, subject, sendAtDate) => {
  const campaign = {
    name: subject,
    categories: ['newsletter'],
    send_at: sendAtDate,
    send_to: {
      list_ids: [process.env.LIST_ID],
    },
    email_config: {
      subject: subject,
      html_content: newsletter.html,
      plain_content: newsletter.plain,
      sender_id: Number(process.env.SENDER_ID),
      suppression_group_id: 24351
    }
  };

  const request = {
    url: `/v3/marketing/singlesends`,
    method: 'POST',
    body: campaign
  };

  const [response, body] = await sendgrid.request(request);

  return response.body.id;
};

const sendPreview = async (newsletter, subject, email) => {
  await eventBridge.send(new PutEventsCommand({
    Entries: [{
      Source: 'newsletter-service',
      DetailType: 'Send Email',
      Detail: JSON.stringify({
        subject: `[Preview] ${subject}`,
        to: email,
        html: newsletter.html
      })
    }]
  }));
};
