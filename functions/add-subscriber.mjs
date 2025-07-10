import sendgrid from '@sendgrid/client';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { formatResponse } from './utils/helpers.mjs';

let apiKey;

export const handler = async (event) => {
  try {
    if (!apiKey) {
      const secrets = await getSecret(process.env.SECRET_ID, { transform: 'json' });
      apiKey = secrets.sendgrid;
      if(!apiKey) {
        throw new Error('Missing sendgrid api key');
      }
    }

    const contact = JSON.parse(event.body);
    await addContact(apiKey, contact);

    return formatResponse(201, 'Contact added');
  }
  catch (err) {
    console.error(JSON.stringify(err));
    console.error(event.body);
    return formatResponse(500, 'Something went wrong');
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


