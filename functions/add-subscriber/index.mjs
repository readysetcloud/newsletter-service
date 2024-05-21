import sendgrid from '@sendgrid/client';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';

let apiKey;

export const handler = async (event) => {
  try {
    if (!apiKey) {
      const secrets = await getSecret(process.env.SECRET_ID, { transform: 'json' });
      apiKey = secrets.sendgrid;
    }

    const contact = JSON.parse(event.body);
    await addContact(apiKey, contact);

    return {
      statusCode: 201,
      body: JSON.stringify({ message: 'Contact added' }),
      headers: { 'Access-Control-Allow-Origin': 'https://www.readysetcloud.io' }
    };
  }
  catch (err) {
    console.error(JSON.stringify(err));
    console.error(event.body);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Something went wrong' }),
      headers: { 'Access-Control-Allow-Origin': 'https://www.readysetcloud.io' }
    };
  }
};

const addContact = async (apiKey, contact) => {
  sendgrid.setApiKey(apiKey);
  const contactData = {
    list_ids: [process.env.LIST_ID],
    contacts: [
      {
        email: contact.email,
        ...contact.firstName && { first_name: contact.firstName },
        ...contact.lastName && { last_name: contact.lastName }
      }
    ]
  };

  const request = {
    url: `/v3/marketing/contacts`,
    method: 'PUT',
    body: contactData
  };

  await sendgrid.request(request);
};


