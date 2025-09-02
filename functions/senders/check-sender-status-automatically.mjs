import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SESv2Client, GetEmailIdentityCommand, DeleteEmailIdentityCommand, DeleteTenantResourceAssociationCommand } from "@aws-sdk/client-sesv2";
import { SchedulerClient, CreateScheduleCommand } from "@aws-sdk/client-scheduler";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { KEY_PATTERNS } from './types.mjs';

const ddb = new DynamoDBClient();
const ses = new SESv2Client();
const scheduler = new SchedulerClient();

export const handler = async (event) => {
  console.log('Sender status check triggered:', { event });

  try {
    // Extract sender details from event
    const { tenantId, senderId, retryCount = 0, expiresAt } = event.detail;

    if (!tenantId || !senderId) {
      console.error('Missing required fields in event:', { tenantId, senderId });
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing tenant Id or sender Id' })
      };
    }

    // Check if we've exceeded the 24-hour limit
    const now = new Date();
    const expirationTime = new Date(expiresAt);

    if (now >= expirationTime) {
      console.log('Sender verification expired, marking as timed out:', {
        senderId,
        expiresAt,
        hoursElapsed: (now - expirationTime) / (1000 * 60 * 60)
      });

      // Get sender details for cleanup
      const sender = await getSenderById(tenantId, senderId);
      if (sender) {
        // Clean up SES identity before marking as timed out
        try {
          await cleanupExpiredSESIdentity(sender, tenantId);
          console.log('Successfully cleaned up expired SES identity:', {
            senderId,
            identity: sender.verificationType === 'domain' ? sender.domain : sender.email,
            verificationType: sender.verificationType
          });
        } catch (cleanupError) {
          console.error('Failed to cleanup expired SES identity (continuing with status update):', {
            senderId,
            identity: sender.verificationType === 'domain' ? sender.domain : sender.email,
            error: cleanupError.message
          });
          // Continue with status update even if cleanup fails
        }
      } else {
        console.log('Sender not found during timeout cleanup:', { senderId });
      }

      await updateSenderStatus(tenantId, senderId, 'verification_timed_out', 'Verification timed out after 24 hours');

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Sender verification timed out',
          senderId,
          action: 'timed_out'
        })
      };
    }

    // Get current sender status
    const sender = await getSenderById(tenantId, senderId);
    if (!sender) {
      console.log('Sender not found, stopping checks:', { senderId });
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Sender not found' })
      };
    }

    // Skip if already in final state
    if (['verified', 'failed', 'verification_timed_out'].includes(sender.verificationStatus)) {
      console.log('Sender already in final state, stopping checks:', {
        senderId,
        status: sender.verificationStatus
      });
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Sender already in final state',
          senderId,
          status: sender.verificationStatus,
          action: 'stopped'
        })
      };
    }

    // Check current verification status in SES
    const sesStatus = await checkSESVerificationStatus(sender.email);

    if (!sesStatus) {
      console.log('Could not check SES status, scheduling retry:', { senderId, retryCount });
      await scheduleNextCheck(tenantId, senderId, retryCount + 1, expiresAt);

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'SES check failed, retry scheduled',
          senderId,
          retryCount: retryCount + 1,
          action: 'retry_scheduled'
        })
      };
    }

    // Map SES status to internal status
    const newStatus = mapSESStatusToInternal(sesStatus.verificationStatus);

    if (newStatus && newStatus !== sender.verificationStatus) {
      console.log('Updating sender status:', {
        senderId,
        oldStatus: sender.verificationStatus,
        newStatus,
        sesStatus: sesStatus.verificationStatus
      });

      await updateSenderStatus(tenantId, senderId, newStatus);

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Sender status updated',
          senderId,
          oldStatus: sender.verificationStatus,
          newStatus,
          action: 'status_updated'
        })
      };
    }

    // No status change, schedule next check
    console.log('No status change, scheduling next check:', {
      senderId,
      currentStatus: sender.verificationStatus,
      retryCount
    });

    await scheduleNextCheck(tenantId, senderId, retryCount + 1, expiresAt);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'No status change, next check scheduled',
        senderId,
        currentStatus: sender.verificationStatus,
        retryCount: retryCount + 1,
        action: 'next_check_scheduled'
      })
    };

  } catch (error) {
    console.error('Sender status check failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to check sender status automatically'
      })
    };
  }
};

/**
 * Schedule the next status check for a sender
 * @param {string} tenantId - Tenant identifier
 * @param {string} senderId - Sender identifier
 * @param {number} retryCount - Current retry count
 * @param {string} expiresAt - ISO string of when to stop checking
 */
const scheduleNextCheck = async (tenantId, senderId, retryCount, expiresAt) => {
  try {
    // Schedule next check in 1 hour
    const nextCheckTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const expirationTime = new Date(expiresAt);

    // Don't schedule if next check would be after expiration
    if (nextCheckTime >= expirationTime) {
      console.log('Next check would exceed expiration time, not scheduling:', {
        senderId,
        nextCheckTime: nextCheckTime.toISOString(),
        expiresAt
      });
      return;
    }

    const scheduleName = `sender-status-check-${senderId}-${Date.now()}`;

    await scheduler.send(new CreateScheduleCommand({
      ActionAfterCompletion: 'DELETE',
      FlexibleTimeWindow: { Mode: 'OFF' },
      GroupName: 'newsletter',
      Name: scheduleName,
      ScheduleExpression: `at(${nextCheckTime.toISOString().slice(0, 19)})`,
      Target: {
        Arn: 'arn:aws:scheduler:::aws-sdk:eventbridge:putEvents',
        RoleArn: process.env.SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({
          Entries: [{
            EventBusName: 'default',
            Detail: JSON.stringify({
              tenantId,
              senderId,
              retryCount,
              expiresAt
            }),
            DetailType: 'Check Sender Status',
            Source: 'newsletter-service'
          }]
        })
      }
    }));

    console.log('Next status check scheduled:', {
      senderId,
      scheduleName,
      nextCheckTime: nextCheckTime.toISOString(),
      retryCount
    });

  } catch (error) {
    console.error('Failed to schedule next status check:', error);
    throw error;
  }
};

/**
 * Get sender by ID from DynamoDB
 * @param {string} tenantId - Tenant identifier
 * @param {string} senderId - Sender identifier
 * @returns {Promise<Object|null>} Sender record or null if not found
 */
const getSenderById = async (tenantId, senderId) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: KEY_PATTERNS.SENDER(senderId)
      })
    }));

    return result.Item ? unmarshall(result.Item) : null;
  } catch (error) {
    console.error('Error getting sender by ID:', error);
    throw new Error('Failed to retrieve sender');
  }
};

/**
 * Check verification status in SES
 * @param {string} email - Email address to check
 * @returns {Promise<Object|null>} SES status or null if error
 */
const checkSESVerificationStatus = async (email) => {
  try {
    const command = new GetEmailIdentityCommand({
      EmailIdentity: email
    });

    const response = await ses.send(command);

    return {
      verificationStatus: response.VerificationStatus?.toLowerCase() || 'unknown',
      dkimStatus: response.DkimAttributes?.Status?.toLowerCase() || 'unknown',
      identityType: response.IdentityType?.toLowerCase() || 'unknown'
    };
  } catch (error) {
    console.error('Error checking SES verification status:', { email, error: error.message });

    if (error.name === 'NotFoundException') {
      return {
        verificationStatus: 'not_found',
        error: 'Identity not found in SES'
      };
    }

    // Return null to indicate we couldn't check status
    return null;
  }
};

/**
 * Map SES verification status to internal status
 * @param {string} sesStatus - SES verification status
 * @returns {string|null} Internal status or null if no mapping needed
 */
const mapSESStatusToInternal = (sesStatus) => {
  switch (sesStatus) {
    case 'success':
      return 'verified';
    case 'failed':
      return 'failed';
    case 'pending':
      return 'pending';
    case 'not_found':
      // Don't update status when identity is not found in SES
      // This could be a temporary issue or the identity was removed
      return null;
    default:
      return null;
  }
};

/**
 * Update sender verification status in DynamoDB
 * @param {string} tenantId - Tenant identifier
 * @param {string} senderId - Sender identifier
 * @param {string} newStatus - New verification status
 * @param {string} [failureReason] - Optional failure reason
 * @returns {Promise<void>}
 */
const updateSenderStatus = async (tenantId, senderId, newStatus, failureReason = null) => {
  try {
    const now = new Date().toISOString();
    let updateExpression = 'SET verificationStatus = :status, updatedAt = :updatedAt';
    const expressionAttributeValues = {
      ':status': newStatus,
      ':updatedAt': now
    };

    // Add verifiedAt if status is verified
    if (newStatus === 'verified') {
      updateExpression += ', verifiedAt = :verifiedAt';
      expressionAttributeValues[':verifiedAt'] = now;
    }

    // Add failure reason if provided
    if (failureReason) {
      updateExpression += ', failureReason = :failureReason';
      expressionAttributeValues[':failureReason'] = failureReason;
    }

    await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: tenantId,
        sk: KEY_PATTERNS.SENDER(senderId)
      }),
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: marshall(expressionAttributeValues),
      ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)'
    }));

    console.log('Updated sender verification status:', {
      tenantId,
      senderId,
      newStatus,
      failureReason,
      updatedAt: now
    });
  } catch (error) {
    console.error('Error updating sender verification status:', error);
    throw new Error('Failed to update sender status');
  }
};

/**
 * Clean up expired SES identity with proper tenant cleanup sequence
 * @param {Object} sender - Sender record
 * @param {string} tenantId - Tenant identifier
 * @returns {Promise<void>}
 */
const cleanupExpiredSESIdentity = async (sender, tenantId) => {
  try {
    const identity = sender.verificationType === 'domain' ? sender.domain : sender.email;

    if (!identity) {
      console.log('No identity to cleanup for sender:', { senderId: sender.senderId });
      return;
    }

    console.log('Starting SES identity cleanup for expired sender:', {
      senderId: sender.senderId,
      identity,
      verificationType: sender.verificationType
    });

    await ses.send(new DeleteTenantResourceAssociationCommand({
      TenantName: tenantId,
      ResourceArn: `${process.env.RESOURCE_ARN_PREFIX}${identity}`
    }));

    // Delete the SES identity
    await ses.send(new DeleteEmailIdentityCommand({
      EmailIdentity: identity
    }));
    console.log(`Cleaned up expired SES identity: ${identity}`);

  } catch (error) {
    console.error('Failed to cleanup expired SES identity:', {
      senderId: sender.senderId,
      identity: sender.verificationType === 'domain' ? sender.domain : sender.email,
      error: error.message
    });

    // Re-throw to allow caller to handle appropriately
    throw new Error(`SES identity cleanup failed: ${error.message}`);
  }
};

/**
 * Helper function to schedule the initial status check for a new sender
 * This should be called from the create-sender function
 * @param {string} tenantId - Tenant identifier
 * @param {string} senderId - Sender identifier
 * @returns {Promise<void>}
 */
export const scheduleInitialStatusCheck = async (tenantId, senderId) => {
  try {
    // Schedule first check in 1 hour
    const firstCheckTime = new Date(Date.now() + 60 * 60 * 1000);
    // Set expiration to 24 hours from now
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const scheduleName = `sender-status-check-${senderId}-${Date.now()}`;

    await scheduler.send(new CreateScheduleCommand({
      ActionAfterCompletion: 'DELETE',
      FlexibleTimeWindow: { Mode: 'OFF' },
      GroupName: 'newsletter',
      Name: scheduleName,
      ScheduleExpression: `at(${firstCheckTime.toISOString().slice(0, 19)})`,
      Target: {
        Arn: 'arn:aws:scheduler:::aws-sdk:eventbridge:putEvents',
        RoleArn: process.env.SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({
          Entries: [{
            EventBusName: 'default',
            Detail: JSON.stringify({
              tenantId,
              senderId,
              retryCount: 0,
              expiresAt
            }),
            DetailType: 'Check Sender Status',
            Source: 'newsletter-service'
          }]
        })
      }
    }));

    console.log('Initial status check scheduled:', {
      senderId,
      scheduleName,
      firstCheckTime: firstCheckTime.toISOString(),
      expiresAt
    });

  } catch (error) {
    console.error('Failed to schedule initial status check:', error);
    throw error;
  }
};
