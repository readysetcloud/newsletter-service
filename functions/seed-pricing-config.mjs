#!/usr/bin/env node

/**
 * Seed script for the system pricing configuration record.
 *
 * Writes the default pricing-config to DynamoDB (NewsletterTable).
 * Idempotent — uses PutItem which overwrites any existing record.
 *
 * Usage:
 *   TABLE_NAME=my-table node functions/seed-pricing-config.mjs
 *   node functions/seed-pricing-config.mjs my-table
 */

import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

const tableName = process.argv[2] || process.env.TABLE_NAME;

if (!tableName) {
  console.error('Error: TABLE_NAME is required. Provide it as an environment variable or CLI argument.');
  console.error('Usage: TABLE_NAME=my-table node functions/seed-pricing-config.mjs');
  console.error('   or: node functions/seed-pricing-config.mjs my-table');
  process.exit(1);
}

const pricingConfig = {
  pk: 'system',
  sk: 'pricing-config',
  cpmRate: 5,
  multiplierMin: 0.5,
  multiplierMax: 3.0,
  smoothingCapPct: 0.20,
  significantSubscriberChangePct: 0.25,
  significantOpenRateChangePts: 10,
  minPublishedIssues: 3,
  weeklyJobConcurrency: 5,
  llmMaxRetries: 3,
  asyncLatencyThresholdMs: 5000,
};

const ddb = new DynamoDBClient();

async function seed() {
  console.log(`Seeding pricing config to table "${tableName}"...`);
  console.log('Record:', JSON.stringify(pricingConfig, null, 2));

  await ddb.send(new PutItemCommand({
    TableName: tableName,
    Item: marshall(pricingConfig),
  }));

  console.log(`Successfully wrote pricing-config (pk="system", sk="pricing-config") to ${tableName}.`);
}

seed().catch((err) => {
  console.error('Failed to seed pricing config:', err);
  process.exit(1);
});
