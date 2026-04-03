#!/usr/bin/env node

/**
 * Seed script and CloudFormation custom resource handler for the system pricing
 * configuration record.
 *
 * CLI usage:
 *   TABLE_NAME=my-table node functions/seed-pricing-config.mjs
 *   node functions/seed-pricing-config.mjs my-table
 *
 * Custom resource behavior:
 *   - Create: seed the record only if it does not exist
 *   - Update: no-op to preserve manual tuning in DynamoDB
 *   - Delete: no-op
 */

import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

export const defaultPricingConfig = {
  pk: 'system',
  sk: 'pricing-config',
  cpmRate: 5,
  multiplierMin: 0.5,
  multiplierMax: 3.0,
  clickWeight: 2.0,
  smoothingCapPct: 0.20,
  significantSubscriberChangePct: 0.25,
  significantOpenRateChangePts: 10,
  minPublishedIssues: 3,
  cadenceRegularityThreshold: 3,
  dataRecencyThresholdDays: 30,
  industryAvgOpenRate: 0.21,
  industryAvgClickRate: 0.025,
  weeklyJobConcurrency: 5,
  llmMaxRetries: 3,
  asyncLatencyThresholdMs: 5000
};

async function getExistingPricingConfig(tableName) {
  const result = await ddb.send(new GetItemCommand({
    TableName: tableName,
    Key: marshall({
      pk: defaultPricingConfig.pk,
      sk: defaultPricingConfig.sk
    })
  }));

  return result.Item ? unmarshall(result.Item) : null;
}

async function seedPricingConfig(tableName, { overwrite = false, mergeMissing = false } = {}) {
  const existing = mergeMissing ? await getExistingPricingConfig(tableName) : null;
  const item = mergeMissing && existing
    ? { ...defaultPricingConfig, ...existing }
    : defaultPricingConfig;
  const shouldOverwrite = overwrite || (mergeMissing && existing != null);

  const command = new PutItemCommand({
    TableName: tableName,
    Item: marshall(item),
    ...(shouldOverwrite ? {} : {
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
    })
  });

  try {
    await ddb.send(command);
    return { action: overwrite ? 'upserted' : (mergeMissing && existing ? 'merged-missing-defaults' : 'created') };
  } catch (error) {
    if (!overwrite && error.name === 'ConditionalCheckFailedException') {
      return { action: 'preserved-existing' };
    }
    throw error;
  }
}

async function sendCloudFormationResponse(event, context, status, data = {}, physicalResourceId) {
  const body = JSON.stringify({
    Status: status,
    Reason: `See CloudWatch Log Stream: ${context.logStreamName || context.awsRequestId}`,
    PhysicalResourceId: physicalResourceId || event.PhysicalResourceId || 'pricing-config',
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data
  });

  const response = await fetch(event.ResponseURL, {
    method: 'PUT',
    headers: {
      'content-type': ''
    },
    body
  });

  if (!response.ok) {
    throw new Error(`CloudFormation response failed with status ${response.status}`);
  }
}

export async function handler(event, context) {
  const tableName = process.env.TABLE_NAME;

  if (!tableName) {
    throw new Error('TABLE_NAME is required');
  }

  let responseData = { action: 'noop' };
  const physicalResourceId = 'pricing-config';

  try {
    switch (event.RequestType) {
      case 'Create':
        responseData = await seedPricingConfig(tableName, { overwrite: false });
        break;
      case 'Update':
        responseData = await seedPricingConfig(tableName, { overwrite: false, mergeMissing: true });
        break;
      case 'Delete':
        responseData = { action: 'deleted-noop' };
        break;
      default:
        throw new Error(`Unsupported RequestType: ${event.RequestType}`);
    }

    console.log('[PRICING-CONFIG] Custom resource result', {
      requestType: event.RequestType,
      tableName,
      ...responseData
    });

    await sendCloudFormationResponse(event, context, 'SUCCESS', responseData, physicalResourceId);
  } catch (error) {
    console.error('[PRICING-CONFIG] Custom resource failed', {
      requestType: event.RequestType,
      tableName,
      error: error.message
    });

    await sendCloudFormationResponse(
      event,
      context,
      'FAILED',
      { error: error.message },
      physicalResourceId
    );
  }
}

async function runCli() {
  const tableName = process.argv[2] || process.env.TABLE_NAME;

  if (!tableName) {
    console.error('Error: TABLE_NAME is required. Provide it as an environment variable or CLI argument.');
    console.error('Usage: TABLE_NAME=my-table node functions/seed-pricing-config.mjs');
    console.error('   or: node functions/seed-pricing-config.mjs my-table');
    process.exit(1);
  }

  console.log(`Seeding pricing config to table "${tableName}"...`);
  console.log('Record:', JSON.stringify(defaultPricingConfig, null, 2));

  const result = await seedPricingConfig(tableName, { overwrite: true });
  console.log(`Successfully ${result.action} pricing-config (pk="system", sk="pricing-config") in ${tableName}.`);
}

if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  // Lambda runtime loads the exported handler.
} else {
  runCli().catch((error) => {
    console.error('Failed to seed pricing config:', error);
    process.exit(1);
  });
}
