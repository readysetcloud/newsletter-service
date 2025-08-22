import { DynamoDBClient, QueryCommand, UpdateItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { momentoClient } from '../utils/momento-client.mjs';
import { KEY_PATTERNS } from './types.mjs';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  console.log('SES Event received:', JSON.stringify(event, null, 2));

  try {
    // Process each record in the event
    for (const record of event.Records || []) {
      await processSESEvent(record);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'SES events processed successfully' })
    };

  } catch (error) {
    console.error('Error processing SES events:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process SES events' })
    };
  }
};

/**
 * Process individual SES event record
 * @param {Object} record - EventBridge record containing SES event
 */
const processSESEvent = async (record) => {
  try {
    const detail = record.detail || {};
    const eventType = detail['event-type'];
    const identity = detail.identity;

    console.log(`Processing SES event: ${eventType} for identity: ${identity}`);

    if (!identity) {
      console.warn('No identity found in SES event, skipping');
      return;
    }

    // Determine if this is a domain or email verification event
    const isDomainEvent = !identity.includes('@');

    if (isDomainEvent) {
      await processDomainVerificationEvent(identity, eventType, detail);
    } else {
      await processSenderVerificationEvent(identity, eventType, detail);
    }

  } catch (error) {
    console.error('Error processing individual SES event:', error);
    throw error;
  }
};

/**
 * Process domain verification events
 * @param {string} domain - Domain identity
 * @param {string} eventType - SES event type
 * @param {Object} detail - Event detail
 */
const processDomainVerificationEvent = async (domain, eventType, detail) => {
  try {
    // Find all tenants that have this domain configured
    const domainRecords = await findDomainRecords(domain);

    for (const domainRecord of domainRecords) {
      const { tenantId } = domainRecord;
      let newStatus = domainRecord.verificationStatus;
      let failureReason = null;

      // Map SES event types to our verification status
      switch (eventType) {
        case 'domainVerification':
          if (detail.status === 'success') {
            newStatus = 'verified';
          } else if (detail.status === 'failure') {
            newStatus = 'failed';
            failureReason = detail.reason || 'Domain verification failed';
          }
          break;

        case 'identityVerificationSuccess':
          newStatus = 'verified';
          break;

        case 'identityVerificationFailure':
          newStatus = 'failed';
          failureReason = detail.reason || 'Domain verification failed';
          break;

        default:
          console.log(`Unhandled domain event type: ${eventType}`);
          continue;
      }

      // Update domain record if status changed
      if (newStatus !== domainRecord.verificationStatus) {
        await updateDomainVerificationStatus(tenantId, domain, newStatus, failureReason);

        // Publish real-time notification
        await publishVerificationNotification(tenantId, {
          type: 'domain-verification-update',
          domain,
          status: newStatus,
          failureReason,
          timestamp: new Date().toISOString()
        });

        console.log(`Updated domain ${domain} status to ${newStatus} for tenant ${tenantId}`);
      }
    }

  } catch (error) {
    console.error('Error processing domain verification event:', error);
    throw error;
  }
};

/**
 * Process sender email verification events
 * @param {string} email - Email identity
 * @param {string} eventType - SES event type
 * @param {Object} detail - Event detail
 */
const processSenderVerificationEvent = async (email, eventType, detail) => {
  try {
    // Find all tenants that have this email configured
    const senderRecords = await findSenderRecords(email);

    for (const senderRecord of senderRecords) {
      const { tenantId, senderId } = senderRecord;
      let newStatus = senderRecord.verificationStatus;
      let failureReason = null;

      // Map SES event types to our verification status
      switch (eventType) {
        case 'identityVerificationSuccess':
          newStatus = 'verified';
          break;

        case 'identityVerificationFailure':
          newStatus = 'failed';
          failureReason = detail.reason || 'Email verification failed';
          break;

        default:
          console.log(`Unhandled sender event type: ${eventType}`);
          continue;
      }

      // Update sender record if status changed
      if (newStatus !== senderRecord.verificationStatus) {
        await updateSenderVerificationStatus(tenantId, senderId, newStatus, failureReason);

        // Publish real-time notification
        await publishVerificationNotification(tenantId, {
          type: 'sender-verification-update',
          senderId,
          email,
          status: newStatus,
          failureReason,
          timestamp: new Date().toISOString()
        });

        console.log(`Updated sender ${email} status to ${newStatus} for tenant ${tenantId}`);
      }
    }

  } catch (error) {
    console.error('Error processing sender verification event:', error);
    throw error;
  }
};

/**
 * Find all domain records for a given domain across all tenants
 * @param {string} domain - Domain to search for
 * @returns {Promise<Array>} Array of domain records
 */
const findDomainRecords = async (domain) => {
  try {
    // Since we need to search across all tenants, we'll use a scan operation
    // In a production system, you might want to use a GSI for this
    const result = await ddb.send(new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'sk = :sk AND attribute_exists(domain)',
      ExpressionAttributeValues: marshall({
        ':sk': KEY_PATTERNS.DOMAIN(domain)
      })
    }));

    return result.Items ? result.Items.map(item => unmarshall(item)) : [];
  } catch (error) {
    console.error('Error finding domain records:', error);
    throw error;
  }
};

/**
 * Find all sender records for a given email across all tenants
 * @param {string} email - Email to search for
 * @returns {Promise<Array>} Array of sender records
 */
const findSenderRecords = async (email) => {
  try {
    // Use GSI1 to find senders by email
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1SK = :email',
      FilterExpression: 'begins_with(sk, :senderPrefix)',
      ExpressionAttributeValues: marshall({
        ':email': email,
        ':senderPrefix': 'sender#'
      })
    }));

    return result.Items ? result.Items.map(item => unmarshall(item)) : [];
  } catch (error) {
    console.error('Error finding sender records:', error);
    throw error;
  }
};

/**
 * Update domain verification status in DynamoDB
 * @param {string} tenantId - Tenant identifier
 * @param {string} domain - Domain name
 * @param {string} status - New verification status
 * @param {string|null} failureReason - Failure reason if applicable
 */
const updateDomainVerificationStatus = async (tenantId, domain, status, failureReason = null) => {
  try {
    const now = new Date().toISOString();
    let updateExpression = 'SET verificationStatus = :status, updatedAt = :updatedAt';
    const expressionAttributeValues = {
      ':status': status,
      ':updatedAt': now
    };

    // Add verifiedAt timestamp if status is verified
    if (status === 'verified') {
      updateExpression += ', verifiedAt = :verifiedAt';
      expressionAttributeValues[':verifiedAt'] = now;
    }

    // Add failure reason if provided
    if (failureReason) {
      updateExpression += ', failureReason = :failureReason';
      expressionAttributeValues[':failureReason'] = failureReason;
    } else if (status === 'verified') {
      // Remove failure reason if verification succeeded
      updateExpression += ' REMOVE failureReason';
    }

    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: KEY_PATTERNS.DOMAIN(domain)
      }),
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: marshall(expressionAttributeValues)
    }));

  } catch (error) {
    console.error('Error updating domain verification status:', error);
    throw error;
  }
};

/**
 * Update sender verification status in DynamoDB
 * @param {string} tenantId - Tenant identifier
 * @param {string} senderId - Sender identifier
 * @param {string} status - New verification status
 * @param {string|null} failureReason - Failure reason if applicable
 */
const updateSenderVerificationStatus = async (tenantId, senderId, status, failureReason = null) => {
  try {
    const now = new Date().toISOString();
    let updateExpression = 'SET verificationStatus = :status, updatedAt = :updatedAt';
    const expressionAttributeValues = {
      ':status': status,
      ':updatedAt': now
    };

    // Add verifiedAt timestamp if status is verified
    if (status === 'verified') {
      updateExpression += ', verifiedAt = :verifiedAt';
      expressionAttributeValues[':verifiedAt'] = now;
    }

    // Add failure reason if provided
    if (failureReason) {
      updateExpression += ', failureReason = :failureReason';
      expressionAttributeValues[':failureReason'] = failureReason;
    } else if (status === 'verified') {
      // Remove failure reason if verification succeeded
      updateExpression += ' REMOVE failureReason';
    }

    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: KEY_PATTERNS.SENDER(senderId)
      }),
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: marshall(expressionAttributeValues)
    }));

  } catch (error) {
    console.error('Error updating sender verification status:', error);
    throw error;
  }
};

/**
 * Publish real-time verification notification via Momento
 * @param {string} tenantId - Tenant identifier
 * @param {Object} notification - Notification payload
 */
const publishVerificationNotification = async (tenantId, notification) => {
  try {
    if (!momentoClient.isAvailable()) {
      console.log('Momento not available, skipping notification');
      return;
    }

    // Generate write token for publishing
    const authToken = await momentoClient.generateWriteToken(tenantId);

    // Publish notification to tenant-specific channel
    await momentoClient.publishNotification(authToken, tenantId, notification);

  } catch (error) {
    console.error('Error publishing verification notification:', error);
    // Don't throw error - notification failure shouldn't break the main flow
  }
};
