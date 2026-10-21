import { unmarshall } from '@aws-sdk/util-dynamodb';
import { handler as screenSubscriber } from './screen-subscriber.mjs';
import { handler as sendWelcome } from './send-welcome-email.mjs';

// Share one shard reader for both lifecycle transitions. Screening persists its
// result; a later MODIFY record triggers welcome delivery even after a restart.
export const handler = async (event) => {
  for (const record of event.Records || []) {
    try {
      const after = unmarshall(record.dynamodb.NewImage || {});
      if (record.eventName === 'INSERT' && after.screening?.action === 'pending') {
        const result = await screenSubscriber({ Records: [record] });
        if (result.batchItemFailures.length) return result;
      } else if (record.eventName === 'MODIFY') {
        const before = unmarshall(record.dynamodb.OldImage || {});
        if (before.screening?.action === 'pending' && ['allow', 'watch'].includes(after.screening?.action)) {
          await sendWelcome({ Records: [record] });
        }
      }
    } catch (error) {
      console.error('Subscriber lifecycle failed', { eventId: record.eventID, error: error.name });
      return { batchItemFailures: [{ itemIdentifier: record.dynamodb.SequenceNumber }] };
    }
  }
  return { batchItemFailures: [] };
};
