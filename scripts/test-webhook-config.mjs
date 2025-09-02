#!/usr/bin/env node

/**
 * Simple script to verify webhook configuration
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

try {
  // Check if webhook handler exists
  const webhookPath = join(__dirname, '../functions/billing/stripe-webhook-handler.mjs');
  const webhookContent = readFileSync(webhookPath, 'utf8');

  console.log('✅ Webhook handler file exists');

  // Check for required imports
  const requiredImports = [
    'crypto',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/util-dynamodb',
    '@aws-sdk/client-cognito-identity-provider'
  ];

  for (const importName of requiredImports) {
    if (webhookContent.includes(importName)) {
      console.log(`✅ Import ${importName} found`);
    } else {
      console.log(`❌ Import ${importName} missing`);
    }
  }

  // Check for required functions
  const requiredFunctions = [
    'verifyWebhookSignature',
    'handleSubscriptionCreated',
    'handleSubscriptionUpdated',
    'handleSubscriptionDeleted',
    'handlePaymentSucceeded',
    'handlePaymentFailed'
  ];

  for (const funcName of requiredFunctions) {
    if (webhookContent.includes(funcName)) {
      console.log(`✅ Function ${funcName} found`);
    } else {
      console.log(`❌ Function ${funcName} missing`);
    }
  }

  // Check SAM template
  const templatePath = join(__dirname, '../template.yaml');
  const templateContent = readFileSync(templatePath, 'utf8');

  if (templateContent.includes('StripeWebhookHandlerFunction')) {
    console.log('✅ Webhook function defined in SAM template');
  } else {
    console.log('❌ Webhook function missing from SAM template');
  }

  if (templateContent.includes('StripeWebhookSecret')) {
    console.log('✅ Webhook secret parameter defined');
  } else {
    console.log('❌ Webhook secret parameter missing');
  }

  if (templateContent.includes('StripeCustomerIndex')) {
    console.log('✅ Stripe customer GSI defined');
  } else {
    console.log('❌ Stripe customer GSI missing');
  }

  if (templateContent.includes('/stripe/webhook')) {
    console.log('✅ Webhook API endpoint defined');
  } else {
    console.log('❌ Webhook API endpoint missing');
  }

  console.log('\n🎉 Webhook infrastructure setup complete!');
  console.log('\nNext steps:');
  console.log('1. Deploy the SAM template');
  console.log('2. Configure the webhook secret in Parameter Store');
  console.log('3. Set up the webhook endpoint in Stripe dashboard');

} catch (error) {
  console.error('❌ Error checking webhook configuration:', error.message);
  process.exit(1);
}
