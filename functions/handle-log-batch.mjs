import { CloudWatchLogsClient, GetQueryResultsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient, UpdateItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { createHash } from 'crypto';

const cloudWatchLogs = new CloudWatchLogsClient();
const ddb = new DynamoDBClient();

export const handler = async (state) => {
  const { queryId } = state;

  try {
    const queryResults = await cloudWatchLogs.send(new GetQueryResultsCommand({ queryId }));

    // If query is still running, return status without processing
    if (queryResults.Status === 'Running') {
      return {
        status: 'Running',
        message: 'Query still in progress'
      };
    }

    // If query failed, return error
    if (queryResults.Status === 'Failed') {
      return {
        status: 'Failed',
        message: 'CloudWatch query failed'
      };
    }

    // If no results, return success
    if (!queryResults.Results || queryResults.Results.length === 0) {
      return {
        status: 'Complete',
        processedCount: 0,
        message: 'No results to process'
      };
    }

    // Process and deduplicate results
    const { keyCounts, processedCount } = await processQueryResults(queryResults.Results);

    // Update counts in DynamoDB if we have data
    if (Object.keys(keyCounts).length > 0) {
      await updateKeyCounts(keyCounts);
    }

    // Store processing audit record
    await storeProcessingAudit(queryId, keyCounts, processedCount);

    return {
      status: 'Complete',
      processedCount: processedCount,
      uniqueKeys: Object.keys(keyCounts).length,
      keyCounts: keyCounts
    };

  } catch (error) {
    console.error('Error processing query results:', error);
    throw error;
  }
};

const processQueryResults = async (results) => {
  const keyCounts = {};
  const processedEntries = new Set();

  console.log(`Processing ${results.length} log entries`);

  for (const result of results) {
    const messageField = result.find(r => r.field === '@message');
    const timestampField = result.find(r => r.field === '@timestamp');

    if (!messageField || !timestampField) {
      console.warn('Missing message or timestamp field in result');
      continue;
    }

    const message = messageField.value;
    const timestamp = timestampField.value;

    // Create unique identifier for deduplication
    const entryHash = createHash('sha256')
      .update(timestamp + message)
      .digest('hex');

    // Skip if we've already processed this entry
    if (processedEntries.has(entryHash)) {
      console.log(`Skipping duplicate entry: ${entryHash.substring(0, 8)}...`);
      continue;
    }
    processedEntries.add(entryHash);

    // Extract key from message
    const keyMatch = message.match(/"key":"([^"]+)"/);
    if (keyMatch) {
      const key = keyMatch[1];
      keyCounts[key] = (keyCounts[key] || 0) + 1;
    } else {
      console.warn('No key found in message:', message);
    }
  }

  console.log(`Processed ${processedEntries.size} unique entries`);
  console.log('Key counts:', JSON.stringify(keyCounts, null, 2));

  return {
    keyCounts,
    processedCount: processedEntries.size
  };
};

const updateKeyCounts = async (keyCounts) => {
  const updatePromises = Object.entries(keyCounts).map(async ([key, count]) => {
    try {
      await ddb.send(new UpdateItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({
          pk: key,
          sk: 'link'
        }),
        UpdateExpression: 'ADD #count :count SET #lastUpdated = :timestamp',
        ExpressionAttributeNames: {
          "#count": "count",
          "#lastUpdated": "lastUpdated"
        },
        ExpressionAttributeValues: marshall({
          ":count": count,
          ":timestamp": new Date().toISOString()
        })
      }));
      console.log(`Updated count for key ${key}: +${count}`);
    } catch (error) {
      console.error(`Failed to update count for key ${key}:`, error);
      throw error;
    }
  });

  await Promise.all(updatePromises);
};

const storeProcessingAudit = async (queryId, keyCounts, processedCount) => {
  try {
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        pk: `audit-${queryId}`,
        sk: 'processing-log',
        timestamp: new Date().toISOString(),
        keyCounts: keyCounts,
        processedCount: processedCount,
        ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
      })
    }));
  } catch (error) {
    console.error('Failed to store audit record:', error);
  }
};
