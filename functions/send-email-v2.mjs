import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { SchedulerClient, CreateScheduleCommand } from "@aws-sdk/client-scheduler";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { DynamoDBClient, QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { encrypt, sendWithRetry } from './utils/helpers.mjs';
import { listSubscribers, getSubscriberByEmail, updateSubscriberSendMetadata } from './utils/subscriber.mjs';
import { splitRecipients, selectHoldoutSample } from './utils/ab-variants.mjs';
import { extractSections, prepareAssembly, assembleForSubscriber } from './utils/interest-assembly.mjs';

// Key patterns for DynamoDB (previously from ./senders/types.mjs)
const KEY_PATTERNS = {
  SENDER: (senderId) => `sender#${senderId}`,
  SENDER_GSI1PK: (tenantId) => `sender#${tenantId}`
};

const ses = new SESv2Client();
const scheduler = new SchedulerClient();
const eventBridge = new EventBridgeClient();
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
 * @returns {Promise<object[]>} Array of subscriber objects
 */
const retrieveSubscribersPhase = async (tenantId) => {
  console.log(`[SUBSCRIBERS] Starting retrieval - tenantId: ${tenantId}`);

  const subscribers = [];
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
      subscribers.push(...result.subscribers);
    }

    lastEvaluatedKey = result.lastEvaluatedKey;
  } while (lastEvaluatedKey);

  if (subscribers.length === 0) {
    throw new Error(`No subscribers found for tenant: ${tenantId}`);
  }

  console.log(`[SUBSCRIBERS] Retrieval complete - total subscribers: ${subscribers.length}`);
  return subscribers;
};



/**
 * Filter recipients to avoid duplicate sends for an issue reference.
 * @param {string} tenantId - Tenant identifier
 * @param {object[]} subscribers - Subscriber records
 * @param {string|undefined} issueIdentifier - Issue identifier/reference
 * @returns {Promise<{recipients: string[], skippedCount: number}>}
 */
const filterIdempotentRecipientsPhase = async (tenantId, subscribers, issueIdentifier) => {
  if (!issueIdentifier) {
    return { recipients: subscribers.map(subscriber => subscriber.email), skippedCount: 0 };
  }

  const recipients = subscribers
    .filter(subscriber => subscriber.lastIssueSent !== issueIdentifier)
    .map(subscriber => subscriber.email);

  const skippedCount = subscribers.length - recipients.length;
  console.log(`[IDEMPOTENCY] Filtered recipients for issue ${issueIdentifier} - send: ${recipients.length}, skipped: ${skippedCount}`);

  return { recipients, skippedCount };
};
/**
 * Prepares interest-aware assembly (contentAssembly) for a send. Runs ONCE per
 * send: extracts the marker-delimited sections from the rendered HTML, batch
 * loads the issue's LLM-classified `link#` records to assign each section a
 * topic (majority of primaryTopic among the section's links), and indexes the
 * already-in-memory subscriber list's interest data by email. Per-recipient
 * work later is pure string reassembly.
 *
 * Fail-open by design: returns null (canonical HTML for everyone) when markers
 * are absent/malformed (e.g. JSON-template issues, custom templates without
 * markers), when no section has classified links, or on any error. Assembly
 * must never break or block a send.
 *
 * @param {string} html - Rendered email HTML (potentially marker-tagged)
 * @param {object[]} subscribers - Subscriber records already loaded for this send
 * @param {string|undefined} referenceNumber - `${tenantId}_${issueNumber}`
 * @returns {Promise<{prepared: object, interestByEmail: Map}|null>}
 */
const prepareAssemblyPhase = async (html, subscribers, referenceNumber) => {
  try {
    // Cheap early exit before any I/O: JSON-template issues and custom
    // templates are rendered without markers, so there is nothing to reorder.
    if (!extractSections(html)) {
      console.warn('[ASSEMBLY] No section markers in rendered HTML (JSON-template issue or custom template) - sending canonical order');
      return null;
    }

    if (!referenceNumber || !referenceNumber.includes('_')) {
      console.warn('[ASSEMBLY] Skipping - missing referenceNumber to locate link records');
      return null;
    }

    const separatorIndex = referenceNumber.lastIndexOf('_');
    const issuePk = `${referenceNumber.slice(0, separatorIndex)}#${referenceNumber.slice(separatorIndex + 1)}`;

    // Batch-read the issue's link# records once for the whole send.
    const linkRecords = [];
    let lastEvaluatedKey;
    do {
      const result = await sendWithRetry(async () => {
        return await ddb.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :linkPrefix)',
          ExpressionAttributeValues: marshall({
            ':pk': issuePk,
            ':linkPrefix': 'link#'
          }),
          ...lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }
        }));
      }, 'Query issue link records');

      linkRecords.push(...(result.Items ?? []).map(item => unmarshall(item)));
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    const prepared = prepareAssembly(html, linkRecords);
    if (!prepared) {
      // No markers (JSON-template issue or custom template without markers) or
      // no classified links matched any section.
      console.warn('[ASSEMBLY] No reorderable sections with classified topics - sending canonical order');
      return null;
    }

    const interestByEmail = new Map();
    for (const subscriber of subscribers) {
      if (subscriber?.email && (subscriber.interestScores || subscriber.excludedTopics)) {
        interestByEmail.set(subscriber.email, {
          interestScores: subscriber.interestScores,
          excludedTopics: subscriber.excludedTopics
        });
      }
    }

    console.log(`[ASSEMBLY] Prepared ${prepared.sections.length} sections (${prepared.sections.filter(s => s.topic).length} with topics), interest data for ${interestByEmail.size}/${subscribers.length} subscribers`);
    return { prepared, interestByEmail };
  } catch (error) {
    console.error('[ASSEMBLY] Preparation failed - sending canonical order', error);
    return null;
  }
};

/**
 * Send emails to recipients with personalization and TPS throttling
 * @param {string[]} emailAddresses - Array of recipient email addresses
 * @param {Object} emailConfig - Email configuration object
 * @param {string} emailConfig.subject - Email subject line
 * @param {string} emailConfig.html - Email HTML body
 * @param {Object} emailConfig.replacements - Replacement tokens for personalization
 * @param {string} emailConfig.referenceNumber - Optional reference number for tracking
 * @param {string} [emailConfig.variant] - Optional A/B variant id ("a"/"b") tagged on the send
 * @param {Object} [emailConfig.assembly] - Optional prepared interest assembly ({ prepared, interestByEmail }) from prepareAssemblyPhase
 * @param {string} senderEmail - Sender email address
 * @returns {Promise<{sentCount: number, sentRecipients: string[]}>} Send stats and sent recipients
 */
const sendEmailsPhase = async (emailAddresses, emailConfig, senderEmail) => {
  console.log(`[SENDING] Starting - recipients: ${emailAddresses.length}, TPS: ${tpsLimit}, sender: ${senderEmail}${emailConfig.variant ? `, variant: ${emailConfig.variant}` : ''}`);

  let sentCount = 0;
  const sentRecipients = [];
  const totalCount = emailAddresses.length;

  // Calculate progress logging interval: every 10% or every 50 emails, whichever is smaller
  const logInterval = Math.min(50, Math.ceil(totalCount / 10));

  for (const email of emailAddresses) {
    await sendWithRetry(async () => {
      // Apply personalization replacements
      let personalizedHtml = emailConfig.html;

      // Interest-aware assembly: reorder the marker-delimited sections for this
      // recipient. Pure string reassembly, O(sections) per recipient — the
      // section extraction and topic lookup already happened once per send in
      // prepareAssemblyPhase. Recipients without interest data receive the
      // canonical order.
      if (emailConfig.assembly) {
        personalizedHtml = assembleForSubscriber(
          emailConfig.assembly.prepared,
          emailConfig.assembly.interestByEmail.get(email)
        );
      }

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

      const emailTags = [];
      if (emailConfig.referenceNumber) {
        emailTags.push({ Name: 'referenceNumber', Value: emailConfig.referenceNumber });
      }
      if (emailConfig.variant) {
        emailTags.push({ Name: 'variant', Value: emailConfig.variant });
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
        ...emailTags.length > 0 && { EmailTags: emailTags },
        ConfigurationSetName: process.env.CONFIGURATION_SET
      }));
    }, `Send email to ${email}`);

    sentCount++;
    sentRecipients.push(email);

    // Log progress at intervals or when complete
    if (sentCount % logInterval === 0 || sentCount === totalCount) {
      console.log(`[SENDING] Progress: ${sentCount}/${totalCount} (${Math.round(sentCount / totalCount * 100)}%)`);
    }

    // TPS throttling delay
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  console.log(`[SENDING] Complete - sent ${sentCount} emails`);
  return { sentCount, sentRecipients };
};

/**
 * Update subscriber tracking fields (lastSentAt, lastIssueSent) after send completes.
 * Throws when subscriber metadata persistence fails for known subscribers.
 * @param {string} tenantId - Tenant identifier
 * @param {string[]} sentRecipients - Recipients that were successfully sent
 * @param {string|undefined} issueIdentifier - Issue identifier/reference that was sent
 */
const updateSubscriberTrackingPhase = async (tenantId, sentRecipients, issueIdentifier) => {
  if (!tenantId || sentRecipients.length === 0) {
    return;
  }

  const results = await Promise.allSettled(
    sentRecipients.map((email) => sendWithRetry(
      () => updateSubscriberSendMetadata(tenantId, email, issueIdentifier),
      `Update subscriber tracking for ${email}`
    ))
  );

  const nonSubscriberSkips = [];
  const failedUpdates = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      return;
    }

    const email = sentRecipients[index];
    const error = result.reason;

    if (error?.name === 'ConditionalCheckFailedException') {
      nonSubscriberSkips.push(email);
      return;
    }

    failedUpdates.push({
      email,
      error: error?.message || 'Unknown error'
    });
  });

  if (failedUpdates.length > 0) {
    console.error('[SUBSCRIBER TRACKING] Failed updates detected', {
      tenantId,
      failedCount: failedUpdates.length,
      failedUpdates
    });

    throw new Error(
      `Failed to persist subscriber tracking for ${failedUpdates.length} recipient(s)`
    );
  }

  const updatedCount = sentRecipients.length - nonSubscriberSkips.length;
  console.log(
    `[SUBSCRIBER TRACKING] Updated ${updatedCount} subscriber records` +
    (nonSubscriberSkips.length > 0
      ? `, skipped ${nonSubscriberSkips.length} non-subscriber recipient(s)`
      : '')
  );
};

/**
 * Schedule the A/B winner evaluation as a one-shot EventBridge Scheduler event,
 * firing `evaluateAfterMinutes` after the test-sample send. The scheduled event
 * carries everything evaluate-ab-winner needs to send the winner to the hold-out
 * remainder (the rendered html travels in sendPayload, mirroring the future-send
 * scheduling pattern used for delayed sends).
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.referenceNumber - `${tenantId}_${issueNumber}`
 * @param {Object} params.abTest - Normalized A/B config (variants, evaluateAfterMinutes, ...)
 * @param {string} params.html - Rendered email HTML (with personalization placeholders)
 * @param {Object} [params.replacements] - Personalization replacement tokens
 * @param {string} [params.from] - Optional sender email
 * @param {Object} params.to - Recipient config ({ list })
 */
const scheduleAbEvaluation = async ({ tenantId, referenceNumber, abTest, subject, html, replacements, from, to }) => {
  if (!referenceNumber) {
    console.warn('[A/B] Skipping evaluation schedule - missing referenceNumber');
    return;
  }

  const evaluateAfterMinutes = typeof abTest.evaluateAfterMinutes === 'number' ? abTest.evaluateAfterMinutes : 240;
  const issueNumber = referenceNumber.slice(referenceNumber.lastIndexOf('_') + 1);
  // For send-time tests the variants are delivered at different times, so the
  // evaluation window starts after the LAST candidate send time, not now.
  const candidateTimes = abTest.dimension === 'sendTime'
    ? (abTest.variants || [])
      .map(variant => new Date(variant.sendAt).getTime())
      .filter(time => !Number.isNaN(time))
    : [];
  const baseMs = Math.max(Date.now(), ...candidateTimes);
  const evalAt = new Date(baseMs + evaluateAfterMinutes * 60 * 1000);
  const scheduleName = `AB-EVAL-${referenceNumber}-${Date.now()}`.replace(/[^0-9a-zA-Z-_.]/g, '-').slice(0, 64);

  const detail = {
    tenantId,
    issueNumber,
    referenceNumber,
    sendPayload: {
      subject,
      html,
      to: { list: to.list },
      tenantId,
      referenceNumber,
      ...replacements && { replacements },
      ...from && { from }
    }
  };

  await sendWithRetry(async () => {
    return await scheduler.send(new CreateScheduleCommand({
      ActionAfterCompletion: 'DELETE',
      FlexibleTimeWindow: { Mode: 'OFF' },
      GroupName: 'newsletter',
      Name: scheduleName,
      ScheduleExpression: `at(${evalAt.toISOString().slice(0, 19)})`,
      Target: {
        Arn: 'arn:aws:scheduler:::aws-sdk:eventbridge:putEvents',
        RoleArn: process.env.SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({
          Entries: [{
            EventBusName: 'default',
            Detail: JSON.stringify(detail),
            DetailType: 'Evaluate AB Test',
            Source: 'newsletter-service'
          }]
        })
      }
    }));
  }, 'Schedule A/B winner evaluation');

  console.log(`[A/B] Scheduled winner evaluation at ${evalAt.toISOString()} (${evaluateAfterMinutes}m) for ${referenceNumber}`);
};

/**
 * Transitions a managed A/B test from `pending` to `testing` the moment the test
 * sample has actually gone out (subject tests) or the per-variant sends have been
 * fanned out (send-time tests). Without this the test stays `pending` for the
 * entire hold-out window, so the dashboard shows an inert "Pending" badge with
 * zero variant stats from publish until evaluation — indistinguishable, to the
 * user, from the test never having been picked up at all.
 *
 * Both the embedded `abTest.status` (what the dashboard reads) and the top-level
 * `abTestStatus` CAS mirror (what evaluate-ab-winner claims on) are written
 * together, mirroring how finalizeEvaluation keeps the two in sync. The write is
 * conditional on the test still being unset/`pending` so a redelivery can never
 * regress a test that has already been claimed (`evaluating`) or finalized
 * (`sent`/`inconclusive`). Best-effort: a failure here is logged, not thrown, so
 * it never fails an otherwise-successful send.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.referenceNumber - `${tenantId}_${issueNumber}`
 * @param {Object} params.abTest - The managed A/B config; its status is set to 'testing'.
 */
const markAbTestTesting = async ({ tenantId, referenceNumber, abTest }) => {
  if (!referenceNumber) {
    console.warn('[A/B] Skipping testing-status transition - missing referenceNumber');
    return;
  }

  const issueNumber = referenceNumber.slice(referenceNumber.lastIndexOf('_') + 1);
  const issueId = `${tenantId}#${issueNumber}`;
  const updatedAbTest = { ...abTest, status: 'testing' };

  try {
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: issueId, sk: 'newsletter' }),
      UpdateExpression: 'SET abTest = :ab, abTestStatus = :testing, updatedAt = :now',
      ConditionExpression: 'attribute_not_exists(abTestStatus) OR abTestStatus = :pending',
      ExpressionAttributeValues: marshall({
        ':ab': JSON.stringify(updatedAbTest),
        ':testing': 'testing',
        ':pending': 'pending',
        ':now': new Date().toISOString()
      })
    }));
    console.log(`[A/B] Marked test as testing for ${referenceNumber}`);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      // Already claimed, finalized, or marked testing by a prior delivery.
      console.log('[A/B] Test already past pending, leaving status unchanged', { issueId });
      return;
    }
    console.error('[A/B] Failed to mark test as testing', { issueId, error: err.message });
  }
};

/**
 * Fan out a send-time A/B test: emit one `Send Email v2` event per variant, each
 * carrying a `variantFilter` and the variant's `sendAt`. The existing future-send
 * scheduling defers each event to its send time; when it fires, the handler sends
 * only that variant's bucket of the test sample. The subject/content is identical
 * across variants — only the send time differs.
 * @param {Object} params
 * @param {Object} params.data - The original event detail (for referenceNumber).
 * @param {string} params.subject - The shared subject line.
 * @param {string} params.html - Rendered email HTML.
 * @param {Object} params.to - Recipient config ({ list }).
 * @param {string} params.tenantId
 * @param {Object} [params.replacements]
 * @param {string} [params.from]
 * @param {Object} params.abTest - Normalized A/B config (dimension 'sendTime').
 */
const fanOutSendTimeVariants = async ({ data, subject, html, to, tenantId, replacements, from, abTest }) => {
  for (const variant of abTest.variants) {
    const detail = {
      subject,
      html,
      to: { list: to.list },
      tenantId,
      referenceNumber: data.referenceNumber,
      ...replacements && { replacements },
      ...from && { from },
      abTest,
      variantFilter: variant.variantId,
      ...variant.sendAt && { sendAt: variant.sendAt }
    };

    await sendWithRetry(async () => {
      return await eventBridge.send(new PutEventsCommand({
        Entries: [{
          Source: 'newsletter-service',
          DetailType: 'Send Email v2',
          Detail: JSON.stringify(detail)
        }]
      }));
    }, `Fan out send-time variant ${variant.variantId}`);

    console.log(`[A/B] Fanned out send-time variant ${variant.variantId} at ${variant.sendAt || 'now'} for ${data.referenceNumber}`);
  }
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

    // Recognize a managed A/B test (subject-line or send-time dimension).
    const abTest = (data.abTest?.dimension === 'subject' || data.abTest?.dimension === 'sendTime')
      ? data.abTest
      : null;
    const variantFilter = data.variantFilter ?? null;

    // Initial send-time test: don't send anything now. Defer each variant to its
    // own send time via per-variant events, and schedule the winner evaluation.
    // Each per-variant event re-enters this handler with `variantFilter` set.
    if (abTest?.dimension === 'sendTime' && !variantFilter && to.list) {
      await executePhase('A/B Send-Time Fan-Out', async () => {
        await fanOutSendTimeVariants({ data, subject, html, to, tenantId, replacements, from, abTest });
        await scheduleAbEvaluation({ tenantId, referenceNumber: data.referenceNumber, abTest, subject, html, replacements, from, to });
        await markAbTestTesting({ tenantId, referenceNumber: data.referenceNumber, abTest });
      });
      console.log('[EXECUTION COMPLETE] Send-time A/B test fanned out to per-variant sends');
      return { sent: false, scheduled: true, abTest: 'sendTime', variants: abTest.variants.length };
    }

    let subscribers = [];
    if (to.email) {
      const subscriber = await getSubscriberByEmail(tenantId, to.email);
      if (subscriber) {
        subscribers = [subscriber];
      } else {
        subscribers = [{ email: to.email }];
      }
    } else if (to.list) {
      // Phase 2: Subscriber Retrieval
      subscribers = await executePhase('Subscriber Retrieval', async () => {
        return await retrieveSubscribersPhase(tenantId);
      });
    }

    const { recipients: emailAddresses, skippedCount } = await executePhase('Idempotency Filter', async () => {
      return await filterIdempotentRecipientsPhase(tenantId, subscribers, data.referenceNumber);
    });

    if (emailAddresses.length === 0) {
      console.log('[EXECUTION COMPLETE] No recipients to send after idempotency filtering');
      return {
        sent: true,
        recipients: 0,
        skipped: skippedCount,
        senderEmail,
        senderId: senderRecord?.senderId
      };
    }

    // Phase 2.5: Interest Assembly Preparation (opt-in per issue, list sends
    // only). Skipped whenever a managed A/B test is active — variants must be
    // byte-identical for measurement (publish-issue already refuses to flag
    // both, this is defense in depth). Uses the subscriber list already in
    // memory; never throws — a null result means everyone gets the event HTML.
    let assembly = null;
    if (data.contentAssembly?.enabled === true && to.list && !abTest) {
      assembly = await executePhase('Interest Assembly Preparation', async () => {
        return await prepareAssemblyPhase(html, subscribers, data.referenceNumber);
      });
    } else if (data.contentAssembly?.enabled === true) {
      console.warn('[ASSEMBLY] Skipping personalized section order - ' + (abTest ? 'A/B test active' : 'not a list send'));
    }

    // Phase 3: Email Sending
    // For a managed A/B test, only a deterministic hold-out *sample* receives the
    // variants; the winner is sent to the remainder later by evaluate-ab-winner.
    // The sample + variant split are derived from the FULL recipient list (not
    // the idempotency-filtered one) so the partition is identical across a
    // send-time test's staggered per-variant sends; already-sent recipients are
    // then filtered out per bucket. A legacy `data.variants` payload (no
    // hold-out) splits the eligible list directly. Otherwise a single send.
    const variants = abTest?.variants ?? (Array.isArray(data.variants) ? data.variants : null);
    const allEmails = subscribers.map(subscriber => subscriber.email);
    const eligibleSet = new Set(emailAddresses);
    const { sentCount, sentRecipients } = await executePhase('Email Sending', async () => {
      if (variants?.length && to.list) {
        const subjectByVariant = Object.fromEntries(
          variants.map(variant => [variant.variantId, variant.subject])
        );

        let buckets;
        if (abTest) {
          const testFraction = typeof abTest.testFraction === 'number' ? abTest.testFraction : 0.2;
          const { sample } = selectHoldoutSample(allEmails, data.referenceNumber, testFraction);
          buckets = splitRecipients(sample, data.referenceNumber);
          console.log(`[A/B] Test sample: ${sample.length}/${allEmails.length} (fraction ${testFraction})${variantFilter ? `, variant ${variantFilter}` : ''}`);
        } else {
          buckets = splitRecipients(emailAddresses, data.referenceNumber);
        }

        // A send-time per-variant fire targets only its own bucket.
        const variantIds = variantFilter ? [variantFilter] : Object.keys(buckets);

        let total = 0;
        const allRecipients = [];
        for (const variantId of variantIds) {
          let bucketRecipients = buckets[variantId] || [];
          if (abTest) {
            bucketRecipients = bucketRecipients.filter(email => eligibleSet.has(email));
          }
          if (!bucketRecipients.length) {
            continue;
          }

          const result = await sendEmailsPhase(bucketRecipients, {
            subject: subjectByVariant[variantId] ?? subject,
            html,
            replacements,
            referenceNumber: data.referenceNumber,
            variant: variantId,
            ...assembly && { assembly }
          }, senderEmail);

          total += result.sentCount;
          allRecipients.push(...result.sentRecipients);
        }

        return { sentCount: total, sentRecipients: allRecipients };
      }

      return await sendEmailsPhase(emailAddresses, {
        subject,
        html,
        replacements,
        referenceNumber: data.referenceNumber,
        ...assembly && { assembly }
      }, senderEmail);
    });

    // Phase 3.5: Subscriber Tracking Update (non-critical)
    await executePhase('Subscriber Tracking Update', async () => {
      return await updateSubscriberTrackingPhase(tenantId, sentRecipients, data.referenceNumber);
    });

    // Phase 4: Metrics Update
    if (senderRecord) {
      await executePhase('Metrics Update', async () => {
        return await updateMetricsPhase(tenantId, senderRecord.senderId, sentCount);
      });
    }

    // Phase 5: Schedule A/B winner evaluation (subject-line tests only here).
    // The test sample has now been sent; schedule the evaluation that picks a
    // winner and sends it to the hold-out remainder. Send-time tests schedule
    // their evaluation up front during fan-out, and their per-variant fires
    // (variantFilter set) must not schedule a duplicate.
    if (abTest && to.list && !variantFilter) {
      await executePhase('Schedule A/B Evaluation', async () => {
        await scheduleAbEvaluation({
          tenantId,
          referenceNumber: data.referenceNumber,
          abTest,
          html,
          replacements,
          from,
          to
        });
        await markAbTestTesting({ tenantId, referenceNumber: data.referenceNumber, abTest });
      });
    }

    const executionDuration = Date.now() - executionStart;
    console.log(`[EXECUTION COMPLETE] Total sent: ${sentCount}, Duration: ${executionDuration}ms, Sender: ${senderEmail}`);

    return {
      sent: true,
      recipients: sentCount,
      senderEmail: senderEmail,
      senderId: senderRecord?.senderId,
      skipped: skippedCount
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
