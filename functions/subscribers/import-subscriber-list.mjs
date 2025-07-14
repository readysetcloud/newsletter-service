import { SESv2Client, CreateContactCommand } from "@aws-sdk/client-sesv2";
const ses = new SESv2Client();

export const handler = async (event) => {
  try {
    const { list } = event;
    await Promise.all(list.items.map(addContact));
    console.log(`Added ${list.length} contacts`);
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
};

const addContact = async (contact) => {
  const contactData = {
    ContactListName: process.env.LIST,
    EmailAddress: contact.address
  };

  if (contact.firstName || contact.lastName) {
    contactData.AttributesData = JSON.stringify({
      ...contact.firstName && { firstName: contact.firstName },
      ...contact.lastName && { lastName: contact.lastName }
    });
  }

  await ses.send(new CreateContactCommand(contactData));
};
