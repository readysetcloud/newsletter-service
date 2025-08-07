// auth/cognito-post-confirmation.mjs
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const eventBridge = new EventBridgeClient();

export const handler = async (event) => {
  try {
    await eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: 'newsletter-service',
        DetailType: 'Add User to Group',
        Detail: JSON.stringify({
          userPoolId: event.userPoolId,
          username: event.userName,
          userAttributes: event.request.userAttributes,
          groupName: 'free-tier'
        })
      }]
    }));

    return event; 
  } catch (error) {
    console.error('Failed to publish event:', error);
    throw error;
  }
};
