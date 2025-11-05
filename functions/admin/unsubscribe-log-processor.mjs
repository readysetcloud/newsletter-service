import { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { unsubscribeUser } from "../utils/subscriber.mjs";

const cloudWatchLogs = new CloudWatchLogsClient();

export const handler = async (event = {}) => {
  try {
    const timeRange = createTimeRange();
    const targetLogGroup = process.env.UNSUBSCRIBE_LOG_GROUP_NAME;

    console.log('Processing unsubscribe logs from', timeRange.startTimeISO, 'to', timeRange.endTimeISO);

    // Query CloudWatch logs for unsubscribe events
    const logEvents = await queryUnsubscribeLogs(targetLogGroup, timeRange.startTime, timeRange.endTime);

    // Parse log events to extract email addresses and tenant information
    const unsubscribeEvents = parseUnsubscribeEvents(logEvents);

    // Verify subscriber status in DynamoDB and remove if still active
    const processingResults = await processUnsubscribeEvents(unsubscribeEvents);

    const report = {
      processedAt: new Date().toISOString(),
      timeRange,
      totalLogEvents: logEvents.length,
      uniqueUnsubscribeAttempts: unsubscribeEvents.length,
      successful: processingResults.successful.length,
      failed: processingResults.failed.length
    };

    console.log('Processing completed:', report);

    return {
      statusCode: 200,
      body: JSON.stringify(report)
    };

  } catch (error) {
    console.error('Processing failed:', error.message);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to process unsubscribe logs',
        message: error.message
      })
    };
  }
};

const createTimeRange = () => {
  const end = new Date();
  const start = new Date(end.getTime() - (7 * 24 * 60 * 60 * 1000)); // 7 days ago

  return {
    startTime: Math.floor(start.getTime() / 1000),
    endTime: Math.floor(end.getTime() / 1000),
    startTimeISO: start.toISOString(),
    endTimeISO: end.toISOString()
  };
};

/**
 * Query CloudWatch Logs for unsubscribe events
 * @param {string} logGroupName - CloudWatch log group name
 * @param {number} startTime - Start time (Unix timestamp in seconds)
 * @param {number} endTime - End time (Unix timestamp in seconds)
 * @returns {Array} Array of log events
 */
const queryUnsubscribeLogs = async (logGroupName, startTime, endTime) => {
  const query = `
    fields @timestamp, @message
    | filter @message like /tenantId/ and @message like /emailAddress/
    | sort @timestamp desc
    | limit 10000
  `;

  try {
    // Start the query
    const startQueryResponse = await cloudWatchLogs.send(new StartQueryCommand({
      logGroupName,
      startTime,
      endTime,
      queryString: query,
      limit: 10000
    }));

    const queryId = startQueryResponse.queryId;
    let allResults = [];
    let nextToken = null;

    // Poll for query results with pagination support
    let queryStatus = 'Running';
    let pollAttempts = 0;
    const maxPollAttempts = 60; // Maximum 60 seconds of polling

    while (queryStatus === 'Running' && pollAttempts < maxPollAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      pollAttempts++;

      const getResultsParams = { queryId };
      if (nextToken) {
        getResultsParams.nextToken = nextToken;
      }

      const getResultsResponse = await cloudWatchLogs.send(new GetQueryResultsCommand(getResultsParams));

      queryStatus = getResultsResponse.status;

      if (queryStatus === 'Complete') {
        const results = getResultsResponse.results || [];
        allResults = allResults.concat(results);

        // Handle pagination if there are more results
        if (getResultsResponse.nextToken) {
          nextToken = getResultsResponse.nextToken;
          // Continue polling to get more results
          queryStatus = 'Running';
        } else {
          break;
        }
      } else if (queryStatus === 'Failed' || queryStatus === 'Cancelled') {
        throw new Error(`CloudWatch Logs query ${queryStatus.toLowerCase()}`);
      }
    }

    if (pollAttempts >= maxPollAttempts) {
      throw new Error('CloudWatch Logs query timed out after 60 seconds');
    }

    console.log(`Found ${allResults.length} log events`);

    return allResults;

  } catch (error) {
    console.error('CloudWatch Logs query failed:', error);
    throw new Error(`Failed to query CloudWatch logs: ${error.message}`);
  }
};

/**
 * Parse log events to extract unsubscribe information
 * @param {Array} logEvents - Raw log events from CloudWatch
 * @returns {Array} Array of parsed unsubscribe events
 */
const parseUnsubscribeEvents = (logEvents) => {
  const unsubscribeEvents = [];
  const seenEmails = new Set();

  for (const logEvent of logEvents) {
    try {
      // Extract message from log event fields
      const messageField = logEvent.find(field => field.field === '@message');
      if (!messageField || !messageField.value) {
        continue;
      }

      const timestampField = logEvent.find(field => field.field === '@timestamp');
      const timestamp = timestampField ? timestampField.value : null;

      const message = messageField.value;

      // Look for the JSON part in the message
      const jsonStartIndex = message.indexOf('{');
      if (jsonStartIndex === -1) {
        continue;
      }

      // Extract and parse the JSON part
      const jsonPart = message.substring(jsonStartIndex);
      const logData = JSON.parse(jsonPart);

      // Validate log data structure
      if (!logData.emailAddress || !logData.tenantId) {
        continue;
      }

      const email = logData.emailAddress.toLowerCase();
      const tenantId = logData.tenantId;

      if (!isValidEmail(email)) {
        continue;
      }

      // Deduplicate by email within same tenant
      const emailKey = `${tenantId}:${email}`;
      if (seenEmails.has(emailKey)) {
        continue;
      }
      seenEmails.add(emailKey);

      unsubscribeEvents.push({
        email,
        tenantId,
        timestamp,
        sesRemovalSuccess: logData.sesRemoved
      });

    } catch (parseError) {
      console.warn('Failed to parse log entry:', parseError.message);
      continue;
    }
  }

  return unsubscribeEvents;
};

/**
 * Process unsubscribe events by verifying and removing subscribers
 * @param {Array} unsubscribeEvents - Parsed unsubscribe events
 * @returns {Object} Processing results with successful and failed operations
 */
const processUnsubscribeEvents = async (unsubscribeEvents) => {
  const results = {
    successful: [],
    failed: []
  };

  // Group events by tenant for efficient processing
  const eventsByTenant = {};
  for (const event of unsubscribeEvents) {
    if (!eventsByTenant[event.tenantId]) {
      eventsByTenant[event.tenantId] = [];
    }
    eventsByTenant[event.tenantId].push(event);
  }

  // Process each tenant's events
  for (const [tenantId, events] of Object.entries(eventsByTenant)) {
    const tenantResults = await processTenantUnsubscribes(tenantId, events);

    results.successful.push(...tenantResults.successful);
    results.failed.push(...tenantResults.failed);
  }

  return results;
};

/**
 * Process unsubscribe events for a specific tenant with enhanced batch processing
 * @param {string} tenantId - Tenant identifier
 * @param {Array} events - Unsubscribe events for this tenant
 * @returns {Object} Processing results for this tenant
 */
const processTenantUnsubscribes = async (tenantId, events) => {
  const results = {
    successful: [],
    failed: []
  };

  console.log(`Processing ${events.length} events for tenant ${tenantId}`);

  // Process events in batches to improve efficiency
  const batchSize = 10;
  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);

    // Process each event in the batch, continuing on individual failures
    const batchPromises = batch.map(async (event) => {
      try {
        return await processIndividualUnsubscribe(tenantId, event);
      } catch (error) {
        console.error(`Failed to process unsubscribe for ${tenantId}:`, error.message);

        return {
          type: 'failed',
          email: event.email,
          tenantId,
          error: error.message
        };
      }
    });

    // Wait for all batch operations to complete
    const batchResults = await Promise.allSettled(batchPromises);

    // Process batch results
    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        const processResult = result.value;

        if (processResult.type === 'successful') {
          results.successful.push(processResult);
        } else if (processResult.type === 'failed') {
          results.failed.push(processResult);
        }
      } else {
        console.error('Batch processing promise rejected:', result.reason);
        results.failed.push({
          type: 'failed',
          error: result.reason?.message || 'Unknown error'
        });
      }
    }

    // Small delay between batches to avoid overwhelming DynamoDB
    if (i + batchSize < events.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`Tenant ${tenantId}: ${results.successful.length} processed, ${results.failed.length} failed`);

  return results;
};

const processIndividualUnsubscribe = async (tenantId, event) => {
  try {
    // Store the recent unsubscribe record for tracking
    const success = await unsubscribeUser(tenantId, event.email);

    if (success) {
      return {
        type: 'successful',
        email: event.email,
        tenantId,
        removedAt: new Date().toISOString()
      };
    } else {
      throw new Error('Unsubscribe failed');
    }

  } catch (error) {
    throw new Error(`Processing failed: ${error.message}`);
  }
};







/**
 * Validate email format
 * @param {string} email - Email address to validate
 * @returns {boolean} True if email format is valid
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};


