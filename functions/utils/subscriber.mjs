import { DynamoDBClient, PutItemCommand, QueryCommand, DeleteItemCommand, UpdateItemCommand, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { isSubscriberRecord } from './subscriber-record.mjs';
import { recordSuppression } from './suppression.mjs';

const ddb = new DynamoDBClient();


/**
 * Get a subscriber by email for a tenant.
 * @param {string} tenantId - Tenant identifier
 * @param {string} emailAddress - Subscriber email address
 * @returns {Promise<object|null>} Subscriber object or null when not found
 */
export const getSubscriberByEmail = async (tenantId, emailAddress) => {
  const email = emailAddress.toLowerCase();

  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.SUBSCRIBERS_TABLE_NAME,
    Key: marshall({
      tenantId,
      email
    })
  }));

  if (!result.Item) {
    return null;
  }

  return unmarshall(result.Item);
};

/**
 * List all subscribers for a tenant
 * @param {string} tenantId - Tenant identifier
 * @param {object} options - Optional pagination options
 * @param {object} options.exclusiveStartKey - LastEvaluatedKey from previous query for pagination
 * @returns {Promise<{subscribers: Array, lastEvaluatedKey: object|undefined}>} Subscribers and pagination key
 */
export const listSubscribers = async (tenantId, options = {}) => {
  try {
    const queryParams = {
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      KeyConditionExpression: 'tenantId = :tenantId',
      ExpressionAttributeValues: marshall({
        ':tenantId': tenantId
      })
    };

    // Add pagination support
    if (options.exclusiveStartKey) {
      queryParams.ExclusiveStartKey = options.exclusiveStartKey;
    }

    const response = await ddb.send(new QueryCommand(queryParams));

    // Unmarshall items and extract subscriber data. The segments feature stores
    // its records under the same tenant partition with the sort key overloading
    // `email`; those must never be treated as sendable subscribers.
    const subscribers = (response.Items || [])
      .map(item => unmarshall(item))
      .filter(isSubscriberRecord)
      .map(subscriber => ({
        email: subscriber.email,
        firstName: subscriber.firstName || null,
        lastName: subscriber.lastName || null,
        addedAt: subscriber.addedAt,
        lastSentAt: subscriber.lastSentAt || null,
        lastIssueSent: subscriber.lastIssueSent || null,
        timeZone: subscriber.timeZone || null,
        // Open-hour histogram (activity-timeline.mjs) — drives peak-hour local sends.
        openHours: subscriber.openHours ?? null,
        openHourTotal: subscriber.openHourTotal ?? null,
        // Interest data used by the send path for interest-aware issue
        // assembly (contentAssembly). Omitted when absent so consumers can
        // cheaply distinguish "no data" subscribers.
        ...(subscriber.interestScores && { interestScores: subscriber.interestScores }),
        ...(subscriber.excludedTopics && { excludedTopics: subscriber.excludedTopics })
      }));

    return {
      subscribers,
      lastEvaluatedKey: response.LastEvaluatedKey
    };
  } catch (error) {
    console.error('List subscribers failed:', {
      tenantId,
      error: error.message
    });
    throw error;
  }
};

/**
 * Unsubscribe user from tenant's mailing list
 * @param {string} tenantId - Tenant identifier
 * @param {string} emailAddress - Email address to unsubscribe
 * @param {string} method - Unsubscribe method ('encrypted-link', 'manual-form', 'complaint')
 * @param {object} metadata - Optional metadata (ipAddress, userAgent, etc.)
 * @returns {Promise<{success: boolean, actuallyRemoved: boolean}>} success=true if no error, actuallyRemoved=true only when a subscriber record was deleted
 */
export const unsubscribeUser = async (tenantId, emailAddress, method = 'encrypted-link', metadata = {}) => {
  try {
    const email = emailAddress.toLowerCase();

    // Every method that reaches this function is the subscriber (or their mail
    // provider, for complaints) revoking consent, so record the suppression
    // first — and abort if it fails.
    //
    // Consent state fails closed. Deleting the subscriber after a failed
    // suppression write would report a successful unsubscribe while leaving no
    // durable record of it, and the next list import would put that person
    // straight back on — precisely the failure this record exists to prevent.
    // Aborting first instead leaves the subscriber in place and reports
    // failure, so the mail provider retries the one-click POST and the browser
    // flows show the manual form. Recorded even when the address is not
    // currently on the list: an unsubscribe click on an old email is still a
    // statement about future sends.
    try {
      await recordSuppression(tenantId, email, method, metadata);
    } catch (suppressionErr) {
      console.error('Aborting unsubscribe: consent record could not be written', {
        tenantId,
        method,
        error: suppressionErr.message
      });
      return { success: false, actuallyRemoved: false };
    }

    // The removal and the tenant count commit together.
    //
    // Deleting first and decrementing afterwards drifted permanently: if the
    // delete succeeded and the count update then failed, this returned
    // `success: false` for an unsubscribe that had in fact happened. The
    // provider's retry rewrote the suppression, found no subscriber to delete,
    // and so never attempted the decrement — the count stayed one too high
    // with no path back. Consent was honoured and the number was wrong forever.
    //
    // `attribute_exists` on the Delete replaces the `ReturnValues: ALL_OLD`
    // this used to read (transactions do not support it): if the subscriber is
    // already gone the transaction cancels at index 0, which tells us
    // `actuallyRemoved` just as well and leaves the count untouched.
    let actuallyRemoved;
    try {
      await ddb.send(new TransactWriteItemsCommand({
        TransactItems: [
          {
            Delete: {
              TableName: process.env.SUBSCRIBERS_TABLE_NAME,
              Key: marshall({ tenantId, email }),
              ConditionExpression: 'attribute_exists(tenantId)'
            }
          },
          {
            Update: {
              TableName: process.env.TABLE_NAME,
              Key: marshall({ pk: tenantId, sk: 'tenant' }),
              UpdateExpression: 'SET subscribers = if_not_exists(subscribers, :zero) - :dec',
              ExpressionAttributeValues: marshall({ ':dec': 1, ':zero': 0 }),
              // Keep the count off negative numbers.
              ConditionExpression: 'if_not_exists(subscribers, :zero) >= :dec'
            }
          }
        ]
      }));
      actuallyRemoved = true;
      console.log('Unsubscribe successful:', { tenantId, emailAddress });
    } catch (txErr) {
      if (txErr.name !== 'TransactionCanceledException') {
        throw txErr;
      }

      // Positions match TransactItems: [subscriber delete, tenant count].
      const codes = (txErr.CancellationReasons || []).map((reason) => reason.Code);

      if (codes[0] === 'ConditionalCheckFailed') {
        // Not on the list. The suppression above is the whole point of the
        // request — an unsubscribe click on an old email is still a statement
        // about future sends — so this is a success with nothing removed.
        console.log('Unsubscribe skipped - subscriber not found:', { tenantId, emailAddress });
        actuallyRemoved = false;
      } else if (codes[1] === 'ConditionalCheckFailed') {
        // The count is already at zero while a subscriber row exists, so the
        // stored number is wrong independently of this request. Removing the
        // person matters more than the counter, so retry the delete alone and
        // leave the count for reconciliation rather than refusing to
        // unsubscribe someone over a stale metric.
        console.warn('Subscriber count already at minimum; removing without decrementing', { tenantId });
        await ddb.send(new DeleteItemCommand({
          TableName: process.env.SUBSCRIBERS_TABLE_NAME,
          Key: marshall({ tenantId, email })
        }));
        actuallyRemoved = true;
      } else {
        throw txErr;
      }
    }

    return { success: true, actuallyRemoved };

  } catch (error) {
    console.error('Unsubscribe failed:', {
      tenantId,
      email: '[REDACTED]',
      error: error.message
    });
    return { success: false, actuallyRemoved: false };
  }
};

/**
 * Update subscriber delivery metadata after an email is sent.
 * @param {string} tenantId - Tenant identifier
 * @param {string} emailAddress - Subscriber email address
 * @param {string|undefined} issueIdentifier - Issue identifier/reference that was sent
 * @returns {Promise<void>}
 */
export const updateSubscriberSendMetadata = async (tenantId, emailAddress, issueIdentifier) => {
  try {
    const email = emailAddress.toLowerCase();
    const expressionAttributeNames = {};
    const expressionAttributeValues = {
      ':lastSentAt': new Date().toISOString()
    };

    let updateExpression = 'SET #lastSentAt = :lastSentAt';
    expressionAttributeNames['#lastSentAt'] = 'lastSentAt';

    if (issueIdentifier) {
      updateExpression += ', #lastIssueSent = :lastIssueSent';
      expressionAttributeNames['#lastIssueSent'] = 'lastIssueSent';
      expressionAttributeValues[':lastIssueSent'] = issueIdentifier;
    }

    await ddb.send(new UpdateItemCommand({
      TableName: process.env.SUBSCRIBERS_TABLE_NAME,
      Key: marshall({
        tenantId,
        email
      }),
      UpdateExpression: updateExpression,
      ConditionExpression: 'attribute_exists(tenantId) AND attribute_exists(email)',
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: marshall(expressionAttributeValues)
    }));
  } catch (error) {
    console.error('Update subscriber send metadata failed:', {
      tenantId,
      email: '[REDACTED]',
      issueIdentifier,
      error: error.message
    });
    throw error;
  }
};

