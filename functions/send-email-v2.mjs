import { SESv2Client, SendEmailCommand, ListContactsCommand } from "@aws-sdk/client-sesv2";
import { SchedulerClient, CreateScheduleCommand } from "@aws-sdk/client-scheduler";
import { encrypt} from './utils/helpers.mjs'

const ses = new SESv2Client();
const scheduler = new SchedulerClient();

const tpsLimit = parseInt(process.env.SES_TPS_LIMIT || "14", 10);
const delayMs = Math.ceil(1000 / tpsLimit);

const sendWithRetry = async (sendFn, maxRetries = 3) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await sendFn();
    } catch (err) {
      if (err.name === 'Throttling' || err.name === 'TooManyRequestsException') {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.log(`Throttled, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Max retries exceeded');
};

export const handler = async (event) => {
  try {
    // Input validation
    if (!event?.detail) {
      throw new Error('Missing event detail');
    }

    const { detail: data } = event;
    const { subject, html, to, sendAt, replacements } = data;

    if (!subject || !html || !to) {
      throw new Error('Missing required fields: subject, html, or to');
    }

    if (!to.email && !to.list) {
      throw new Error('Must specify either to.email or to.list');
    }

    if (sendAt) {
      const sendAtDate = new Date(sendAt);
      const now = new Date();

      if (sendAtDate > now) {
        // Schedule for future, but remove sendAt property
        delete data.sendAt;
        await scheduler.send(new CreateScheduleCommand({
          ActionAfterCompletion: 'DELETE',
          FlexibleTimeWindow: { Mode: 'OFF' },
          GroupName: 'newsletter',
          Name: `email-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          ScheduleExpression: `at(${sendAtDate.toISOString().slice(0, 19)})`,
          ScheduleExpressionTimezone: 'America/Chicago',
          Target: {
            Arn: 'arn:aws:scheduler:::aws-sdk:eventbridge:putEvents',
            RoleArn: process.env.SCHEDULER_ROLE_ARN,
            Input: JSON.stringify({
              Entries: [{
                EventBusName: 'default',
                Detail: JSON.stringify(data),
                DetailType: 'Send Email v2',
                Source: 'newsletter-service'
              }]
            })
          },

        }));
        return { scheduled: true, sendAt: sendAtDate.toISOString() };
      }
    }

    let emailAddresses = [];
    if (to.email) {
      emailAddresses = [to.email];
    } else if (to.list) {
      let nextToken;
      do {
        const contacts = await ses.send(new ListContactsCommand({
          ContactListName: to.list,
          NextToken: nextToken
        }));
        if (contacts.Contacts?.length) {
          emailAddresses.push(...contacts.Contacts.map(c => c.EmailAddress));
        }
        nextToken = contacts.NextToken;
      } while (nextToken);

      if (emailAddresses.length === 0) {
        throw new Error(`No contacts found in list: ${to.list}`);
      }
    }

    console.log(`Sending to ${emailAddresses.length} recipients with TPS limit ${tpsLimit}`);

    // Send each email with retry and TPS throttle
    for (const email of emailAddresses) {
      await sendWithRetry(async () => {
        let personalizedEmail = html;
        if(replacements?.emailAddress){
          personalizedEmail = personalizedEmail.replace(new RegExp(replacements.emailAddress, 'g'), email);
        }
        if(replacements?.emailAddressHash){
          const emailHash = encrypt(email);
          personalizedEmail = personalizedEmail.replace(new RegExp(replacements.emailAddressHash, 'g'), emailHash);
        }

        await ses.send(new SendEmailCommand({
          FromEmailAddress: process.env.FROM_EMAIL,
          Destination: { ToAddresses: [email] },
          Content: {
            Simple: {
              Subject: { Data: subject },
              Body: { Html: { Data: personalizedEmail } }
            }
          }
        }));
      });

      // Make sure we don't send too quickly
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    return { sent: true, recipients: emailAddresses.length };
  } catch (err) {
    console.error('Send email error:', {
      error: err.message,
      stack: err.stack,
      event: JSON.stringify(event, null, 2)
    });
    throw err;
  }
};
