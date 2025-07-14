import { SESv2Client, CreateContactCommand } from '@aws-sdk/client-sesv2';
import { formatResponse } from '../utils/helpers.mjs';

const ses = new SESv2Client();

export const handler = async (event) => {
  try {
    if (!event.body) {
      return formatResponse(400, 'Missing request body');
    }

    const contact = JSON.parse(event.body);

    if (!contact.email) {
      return formatResponse(400, 'Email is required');
    }

    await addContact(contact);

    return formatResponse(201, 'Contact added');
  }
  catch (err) {
    console.error('Add subscriber error:', err);
    return formatResponse(500, 'Something went wrong');
  }
};

const addContact = async (contact) => {
  const contactData = {
    ContactListName: process.env.LIST,
    EmailAddress: contact.email
  };

  if (contact.firstName || contact.lastName) {
    contactData.AttributesData = JSON.stringify({
      ...contact.firstName && { firstName: contact.firstName },
      ...contact.lastName && { lastName: contact.lastName }
    });
  }

  await ses.send(new CreateContactCommand(contactData));
};


