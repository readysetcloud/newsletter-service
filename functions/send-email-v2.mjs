import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { SchedulerClient, CreateScheduleCommand } from "@aws-sdk/client-scheduler";
import { DynamoDBClient, QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { encrypt, sendWithRetry } from './utils/helpers.mjs';
import { listSubscribers } from './utils/subscriber.mjs';

// Key patterns for DynamoDB (previously from ./senders/types.mjs)
const KEY_PATTERNS = {
  SENDER: (senderId) => `sender#${senderId}`,
  SENDER_GSI1PK: (tenantId) => `sender#${tenantId}`
};

const ses = new SESv2Client();
const scheduler = new SchedulerClient();
const ddb = new DynamoDBClient();

const tpsLimit = parseInt(process.env.SES_TPS_LIMIT || "14", 10);
const delayMs = Math.ceil(1000 / tpsLimit);

/**
 * Execute a phase with logging
 * @param {string} phaseName - Name of the phase
 * @param {Function} phaseFunction - Async function to execute
 * @returns {Promise<any>} Result of the phase function
 */
const executePhase = async (phaseName, phaseFunction) => {
  const startTime = Date.now();
  console.log(`[PHASE START] ${phaseName}`);
  try {
    const result = await phaseFunction();
    const duration = Date.now() - startTime;
    console.log(`[PHASE COMPLETE] ${phaseName} (${duration}ms)`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[PHASE ERROR] ${phaseName} (${duration}ms)`, error);
    throw error;
  }
};

/**
 * Get sender email by email address for a tenant
 * @param {string} tenantId - Tenant identifier
 * @param {string} email - Email address to find
 * @returns {Promise<Object|null>} Sender record or null if not found
 */
const getSenderByEmail = async (tenantId, email) => {
  try {
    const result = await sendWithRetry(async () => {
      return await ddb.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk',
        ExpressionAttributeValues: marshall({
          ':gsi1pk': KEY_PATTERNS.SENDER_GSI1PK(tenantId),
          ':gsi1sk': email
        })
      }));
    }, 'Query sender by email');

    if (result.Items && result.Items.length > 0) {
      return unmarshall(result.Items[0]);
    }
    return null;
  } catch (error) {
    console.error('Error querying sender by email:', error);
    throw new Error('Failed to query sender email');
  }
};

/**
 * Get default sender for a tenant
 * @param {string} tenantId - Tenant identifier
 * @returns {Promise<Object|null>} Default sender record or null if not found
 */
const getDefaultSender = async (tenantId) => {
  try {
    const result = await sendWithRetry(async () => {
      return await ddb.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gsi1pk',
        FilterExpression: 'isDefault = :isDefault AND verificationStatus = :verified',
        ExpressionAttributeValues: marshall({
          ':gsi1pk': KEY_PATTERNS.SENDER_GSI1PK(tenantId),
          ':isDefault': true,
          ':verified': 'verified'
        })
      }));
    }, 'Query default sender');

    if (result.Items && result.Items.length > 0) {
      return unmarshall(result.Items[0]);
    }
    return null;
  } catch (error) {
    console.error('Error querying default sender:', error);
    throw new Error('Failed to query default sender');
  }
};

/**
 * Update sender metrics after sending emails (Phase 4)
 * @param {string} tenantId - Tenant identifier
 * @param {string} senderId - Sender identifier
 * @param {number} emailCount - Number of emails sent
 */
const updateMetricsPhase = async (tenantId, senderId, emailCount) => {
  console.log(`[METRICS] Starting update - senderId: ${senderId}, emailCount: ${emailCount}`);

  try {
    await sendWithRetry(async () => {
      return await ddb.send(new UpdateItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({
          pk: tenantId,
          sk: KEY_PATTERNS.SENDER(senderId)
        }),
        UpdateExpression: 'ADD emailsSent :count SET lastSentAt = :timestamp',
        ExpressionAttributeValues: marshall({
          ':count': emailCount,
          ':timestamp': new Date().toISOString()
        })
      }));
    }, 'Update sender metrics');

    console.log(`[METRICS] Update complete`);
  } catch (error) {
    console.error('[METRICS] Error updating sender metrics:', error);
    // Don't throw error here as it shouldn't fail the email send
  }
};

/**
 * Validate and select sender email for the tenant
 * @param {string} tenantId - Tenant identifier
 * @param {string|null} fromEmail - Optional specific sender email to use
 * @returns {Promise<Object>} Sender record with email and senderId
 */
const validateSenderPhase = async (tenantId, fromEmail) => {
  console.log(`[SENDER] Starting validation - tenantId: ${tenantId}, requested: ${fromEmail || 'default'}`);

  let senderRecord = null;
  const queryStart = Date.now();

  if (fromEmail) {
    // Query by specific email
    console.log(`[SENDER] Querying by email: ${fromEmail}`);
    senderRecord = await getSenderByEmail(tenantId, fromEmail);
    const queryDuration = Date.now() - queryStart;
    console.log(`[SENDER] Query completed in ${queryDuration}ms`);

    if (!senderRecord) {
      throw new Error(`From email '${fromEmail}' is not configured for this tenant`);
    }
    if (senderRecord.verificationStatus !== 'verified') {
      throw new Error(`From email '${fromEmail}' is not verified`);
    }
  } else {
    // Query for default sender
    console.log(`[SENDER] Querying default sender`);
    senderRecord = await getDefaultSender(tenantId);
    const queryDuration = Date.now() - queryStart;
    console.log(`[SENDER] Query completed in ${queryDuration}ms`);

    if (!senderRecord) {
      throw new Error('No default sender configured for this tenant');
    }
  }

  console.log(`[SENDER] Selected: ${senderRecord.email}, status: ${senderRecord.verificationStatus}`);
  return senderRecord;
};

/**
 * Retrieve subscribers for a tenant from Subscribers table
 * @param {string} tenantId - Tenant identifier
 * @returns {Promise<string[]>} Array of email addresses
 */
const retrieveSubscribersPhase = async (tenantId) => {
  console.log(`[SUBSCRIBERS] Starting retrieval - tenantId: ${tenantId}`);

  const emailAddresses = [];
  let lastEvaluatedKey = undefined;
  let pageNum = 0;

  do {
    pageNum++;
    const pageStart = Date.now();
    console.log(`[SUBSCRIBERS] Query page ${pageNum}`);

    const result = await listSubscribers(tenantId, { exclusiveStartKey: lastEvaluatedKey });

    const pageDuration = Date.now() - pageStart;
    console.log(`[SUBSCRIBERS] Page ${pageNum} completed in ${pageDuration}ms - received ${result.subscribers.length} subscribers`);

    if (result.subscribers.length > 0) {
      emailAddresses.push(...result.subscribers.map(s => s.email));
    }

    lastEvaluatedKey = result.lastEvaluatedKey;
  } while (lastEvaluatedKey);

  if (emailAddresses.length === 0) {
    throw new Error(`No subscribers found for tenant: ${tenantId}`);
  }

  console.log(`[SUBSCRIBERS] Retrieval complete - total subscribers: ${emailAddresses.length}`);
  return emailAddresses;
};

/**
 * Send emails to recipients with personalization and TPS throttling
 * @param {string[]} emailAddresses - Array of recipient email addresses
 * @param {Object} emailConfig - Email configuration object
 * @param {string} emailConfig.subject - Email subject line
 * @param {string} emailConfig.html - Email HTML body
 * @param {Object} emailConfig.replacements - Replacement tokens for personalization
 * @param {string} emailConfig.referenceNumber - Optional reference number for tracking
 * @param {string} senderEmail - Sender email address
 * @returns {Promise<number>} Number of emails sent
 */
const sendEmailsPhase = async (emailAddresses, emailConfig, senderEmail) => {
  console.log(`[SENDING] Starting - recipients: ${emailAddresses.length}, TPS: ${tpsLimit}, sender: ${senderEmail}`);

  let sentCount = 0;
  const totalCount = emailAddresses.length;

  // Calculate progress logging interval: every 10% or every 50 emails, whichever is smaller
  const logInterval = Math.min(50, Math.ceil(totalCount / 10));

  for (const email of emailAddresses) {
    await sendWithRetry(async () => {
      // Apply personalization replacements
      let personalizedHtml = emailConfig.html;

      if (emailConfig.replacements?.emailAddress) {
        personalizedHtml = personalizedHtml.replace(
          new RegExp(emailConfig.replacements.emailAddress, 'g'),
          email
        );
      }

      if (emailConfig.replacements?.emailAddressHash) {
        const emailHash = encrypt(email);
        personalizedHtml = personalizedHtml.replace(
          new RegExp(emailConfig.replacements.emailAddressHash, 'g'),
          emailHash
        );
      }

      await ses.send(new SendEmailCommand({
        FromEmailAddress: senderEmail,
        Destination: { ToAddresses: [email] },
        Content: {
          Simple: {
            Subject: { Data: emailConfig.subject },
            Body: { Html: { Data: personalizedHtml } }
          }
        },
        ...emailConfig.referenceNumber && {
          EmailTags: [{ Name: 'referenceNumber', Value: emailConfig.referenceNumber }]
        },
        ConfigurationSetName: process.env.CONFIGURATION_SET
      }));
    }, `Send email to ${email}`);

    sentCount++;

    // Log progress at intervals or when complete
    if (sentCount % logInterval === 0 || sentCount === totalCount) {
      console.log(`[SENDING] Progress: ${sentCount}/${totalCount} (${Math.round(sentCount / totalCount * 100)}%)`);
    }

    // TPS throttling delay
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  console.log(`[SENDING] Complete - sent ${sentCount} emails`);
  return sentCount;
};

export const handler = async (event) => {
  const executionStart = Date.now();
  console.log('[EXECUTION START] Send Email v2 handler invoked');

  try {
    if (!event?.detail) {
      throw new Error('Missing event detail');
    }

    const { detail: data } = event;
    const { subject, html, to, sendAt, replacements, from, tenantId } = data;

    if (!subject || !html || !to) {
      throw new Error('Missing required fields: subject, html, or to');
    }

    if (!to.email && !to.list) {
      throw new Error('Must specify either to.email or to.list');
    }

    if (!tenantId) {
      throw new Error('Missing required field: tenantId');
    }

    // Phase 1: Sender Validation
    const senderRecord = await executePhase('Sender Validation', async () => {
      return await validateSenderPhase(tenantId, from);
    });
    const senderEmail = senderRecord.email;

    console.log(`Using sender email: ${senderEmail} for tenant: ${tenantId}`);

    if (sendAt) {
      const sendAtDate = new Date(sendAt);
      const now = new Date();

      if (sendAtDate > now) {
        // Schedule for future, but remove sendAt property
        delete data.sendAt;
        await sendWithRetry(async () => {
          return await scheduler.send(new CreateScheduleCommand({
            ActionAfterCompletion: 'DELETE',
            FlexibleTimeWindow: { Mode: 'OFF' },
            GroupName: 'newsletter',
            Name: `email-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            ScheduleExpression: `at(${sendAtDate.toISOString().slice(0, 19)})`,
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
        }, 'Schedule future email send');
        return { scheduled: true, sendAt: sendAtDate.toISOString() };
      }
    }

    let emailAddresses = [];
    if (to.email) {
      emailAddresses = [to.email];
    } else if (to.list) {
      // Phase 2: Subscriber Retrieval
      emailAddresses = await executePhase('Subscriber Retrieval', async () => {
        return await retrieveSubscribersPhase(tenantId);
      });
    }

    // Phase 3: Email Sending
    const sentCount = await executePhase('Email Sending', async () => {
      return await sendEmailsPhase(emailAddresses, {
        subject,
        html,
        replacements,
        referenceNumber: data.referenceNumber
      }, senderEmail);
    });

    // Phase 4: Metrics Update
    if (senderRecord) {
      await executePhase('Metrics Update', async () => {
        return await updateMetricsPhase(tenantId, senderRecord.senderId, sentCount);
      });
    }

    const executionDuration = Date.now() - executionStart;
    console.log(`[EXECUTION COMPLETE] Total sent: ${sentCount}, Duration: ${executionDuration}ms, Sender: ${senderEmail}`);

    return {
      sent: true,
      recipients: sentCount,
      senderEmail: senderEmail,
      senderId: senderRecord?.senderId
    };
  } catch (err) {
    const executionDuration = Date.now() - executionStart;
    console.error(`[EXECUTION ERROR] Duration: ${executionDuration}ms`, {
      error: err.message,
      stack: err.stack,
      event: JSON.stringify(event, null, 2)
    });
    throw err;
  }
};
