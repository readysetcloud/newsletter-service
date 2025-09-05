/**
 * @fileoverview Simplified Dead Letter Queue message processor for failed Stripe events
 * Logs DLQ messages and sends alerts for manual review - no reprocessing attempts
 */

import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const sqsClient = new SQSClient({});
const cloudWatchClient = new CloudWatchClient({});

const DLQ_URL = process.env.DLQ_URL;
const ALERT_TOPIC_ARN = process.env.ALERT_TOPIC_ARN;

/**
 * Publishes metrics to CloudWatch
 */
async function publishMetric(metricName, value, unit = 'Count') {
  try {
    const command = new PutMetricDataCommand({
      Namespace: 'Newsletter/Billing/DLQ',
      MetricData: [{
        MetricName: metricName,
        Value: value,
        Unit: unit,
        Timestamp: new Date()
      }]
    });
    await cloudWatchClient.send(command);
  } catch (error) {
    console.error(`Failed to publish metric ${metricName}:`, error);
  }
}

/**
 * Sends alert notification (placeholder - SNS client not available)
 */
async function sendAlert(subject, message) {
  if (!ALERT_TOPIC_ARN) {
    console.warn('No alert topic configured, skipping notification');
    return;
  }

  // TODO: Add @aws-sdk/client-sns to dependencies and implement SNS publishing
  console.log('=== ALERT NOTIFICATION ===');
  console.log(`Subject: ${subject}`);
  console.log(`Message: ${message}`);
  console.log('=========================');
  console.warn('SNS client not available - alert logged to console only');
}

/**
 * Extracts key information from DLQ message for logging
 */
function extractMessageInfo(message) {
  try {
    const eventData = JSON.parse(message.Body);

    return {
      messageId: message.MessageId,
      eventType: eventData.detail?.type || 'unknown',
      eventId: eventData.detail?.id || 'unknown',
      customerId: eventData.detail?.data?.object?.customer || 'unknown',
      subscriptionId: eventData.detail?.data?.object?.subscription || eventData.detail?.data?.object?.id || 'unknown',
      receivedCount: message.Attributes?.ApproximateReceiveCount || '1',
      firstReceived: message.Attributes?.ApproximateFirstReceiveTimestamp || Date.now(),
      messageBody: message.Body
    };
  } catch (error) {
    return {
      messageId: message.MessageId,
      eventType: 'parse_error',
      eventId: 'unknown',
      customerId: 'unknown',
      subscriptionId: 'unknown',
      receivedCount: message.Attributes?.ApproximateReceiveCount || '1',
      firstReceived: message.Attributes?.ApproximateFirstReceiveTimestamp || Date.now(),
      parseError: error.message,
      messageBody: message.Body
    };
  }
}

/**
 * Logs DLQ message details for manual review
 */
function logDLQMessage(messageInfo) {
  console.log('=== DLQ MESSAGE REQUIRES MANUAL REVIEW ===');
  console.log(`Message ID: ${messageInfo.messageId}`);
  console.log(`Event Type: ${messageInfo.eventType}`);
  console.log(`Event ID: ${messageInfo.eventId}`);
  console.log(`Customer ID: ${messageInfo.customerId}`);
  console.log(`Subscription ID: ${messageInfo.subscriptionId}`);
  console.log(`Receive Count: ${messageInfo.receivedCount}`);
  console.log(`First Received: ${new Date(parseInt(messageInfo.firstReceived)).toISOString()}`);

  if (messageInfo.parseError) {
    console.log(`Parse Error: ${messageInfo.parseError}`);
  }

  console.log('Message Body:', messageInfo.messageBody);
  console.log('==========================================');
}

/**
 * Gets DLQ statistics
 */
async function getDLQStats() {
  try {
    const command = new GetQueueAttributesCommand({
      QueueUrl: DLQ_URL,
      AttributeNames: [
        'ApproximateNumberOfMessages',
        'ApproximateNumberOfMessagesNotVisible',
        'ApproximateAgeOfOldestMessage'
      ]
    });

    const result = await sqsClient.send(command);
    const attributes = result.Attributes || {};

    return {
      totalMessages: parseInt(attributes.ApproximateNumberOfMessages || '0'),
      messagesInFlight: parseInt(attributes.ApproximateNumberOfMessagesNotVisible || '0'),
      oldestMessageAge: parseInt(attributes.ApproximateAgeOfOldestMessage || '0')
    };
  } catch (error) {
    console.error('Failed to get DLQ stats:', error);
    return {
      totalMessages: 0,
      messagesInFlight: 0,
      oldestMessageAge: 0,
      error: error.message
    };
  }
}

/**
 * Processes DLQ messages for logging and alerting only
 */
async function processDLQMessages(maxMessages = 10) {
  const results = {
    messagesLogged: 0,
    messagesDeleted: 0,
    errors: [],
    messageDetails: []
  };

  try {
    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: DLQ_URL,
      MaxNumberOfMessages: maxMessages,
      WaitTimeSeconds: 5,
      MessageAttributeNames: ['All'],
      AttributeNames: ['All'],
      VisibilityTimeout: 60 // Short timeout since we're just logging
    });

    const response = await sqsClient.send(receiveCommand);

    if (!response.Messages || response.Messages.length === 0) {
      console.log('No messages found in DLQ');
      return results;
    }

    console.log(`Found ${response.Messages.length} messages in DLQ for logging`);

    for (const message of response.Messages) {
      try {
        // Extract message information
        const messageInfo = extractMessageInfo(message);

        // Log message details
        logDLQMessage(messageInfo);

        // Store for summary
        results.messageDetails.push({
          messageId: messageInfo.messageId,
          eventType: messageInfo.eventType,
          eventId: messageInfo.eventId,
          customerId: messageInfo.customerId,
          subscriptionId: messageInfo.subscriptionId,
          receivedCount: messageInfo.receivedCount
        });

        results.messagesLogged++;

        // Delete message after logging (prevents reprocessing)
        try {
          await sqsClient.send(new DeleteMessageCommand({
            QueueUrl: DLQ_URL,
            ReceiptHandle: message.ReceiptHandle
          }));
          results.messagesDeleted++;
          console.log(`Deleted logged message ${messageInfo.messageId} from DLQ`);
        } catch (deleteError) {
          console.error(`Failed to delete message ${messageInfo.messageId}:`, deleteError);
          results.errors.push({
            messageId: messageInfo.messageId,
            error: `Delete failed: ${deleteError.message}`
          });
        }

      } catch (error) {
        console.error(`Failed to process DLQ message ${message.MessageId}:`, error);
        results.errors.push({
          messageId: message.MessageId,
          error: error.message
        });
      }
    }

    return results;

  } catch (error) {
    console.error('Failed to process DLQ messages:', error);
    throw error;
  }
}

/**
 * Main DLQ processor handler - simplified for logging and alerting only
 */
export const handler = async (event) => {
  console.log('Simplified DLQ processor started');

  if (!DLQ_URL) {
    const error = 'DLQ_URL environment variable not configured';
    console.error(error);
    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error
      })
    };
  }

  const startTime = Date.now();

  try {
    // Get DLQ statistics
    const stats = await getDLQStats();
    console.log('DLQ stats:', stats);

    if (stats.totalMessages === 0) {
      console.log('No messages in DLQ');
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'No messages in DLQ',
          stats,
          duration: Date.now() - startTime
        })
      };
    }

    // Process messages for logging
    const maxMessages = Math.min(event.maxMessages || 10, 10); // Cap at 10 for simplicity
    const results = await processDLQMessages(maxMessages);

    // Publish metrics
    await publishMetric('DLQMessagesLogged', results.messagesLogged);
    await publishMetric('DLQMessagesDeleted', results.messagesDeleted);
    await publishMetric('DLQProcessingErrors', results.errors.length);

    // Send alert if messages were found
    if (results.messagesLogged > 0) {
      const alertSubject = `Stripe EventBridge DLQ Alert: ${results.messagesLogged} Failed Events`;
      const alertMessage = `
Failed Stripe events detected in Dead Letter Queue:

Messages Logged: ${results.messagesLogged}
Messages Deleted: ${results.messagesDeleted}
Processing Errors: ${results.errors.length}

Event Details:
${results.messageDetails.map(msg =>
  `- Event: ${msg.eventType} (${msg.eventId})
    Customer: ${msg.customerId}
    Subscription: ${msg.subscriptionId}
    Receive Count: ${msg.receivedCount}`
).join('\n')}

${results.errors.length > 0 ? `
Processing Errors:
${results.errors.map(err => `- ${err.messageId}: ${err.error}`).join('\n')}
` : ''}

These events have been logged and removed from the DLQ.
Manual review may be required to ensure data consistency.

Check CloudWatch logs for full event details.
      `;

      await sendAlert(alertSubject, alertMessage);
    }

    const duration = Date.now() - startTime;

    console.log('DLQ processing completed:', {
      ...results,
      stats,
      duration
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        results,
        stats,
        duration,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    console.error('DLQ processing failed:', error);

    await publishMetric('DLQProcessingFailed', 1);

    // Send critical alert
    await sendAlert(
      'Critical: DLQ Processor Failed',
      `The DLQ processor failed to run successfully:

Error: ${error.message}
Duration: ${duration}ms
Timestamp: ${new Date().toISOString()}

Manual intervention required.`
    );

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
        duration,
        timestamp: new Date().toISOString()
      })
    };
  }
};
