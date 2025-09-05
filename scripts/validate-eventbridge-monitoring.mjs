#!/usr/bin/env node

/**
 * EventBridge Monitoring Validation Script
 *
 * Validates that the simplified EventBridge monitoring setup is working correctly:
 * - Checks CloudWatch alarms are configured
 * - Validates SNS topic subscriptions
 * - Tests metric publishing
 * - Verifies DLQ processor configuration
 */

import { CloudWatchClient, DescribeAlarmsCommand, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { SNSClient, ListSubscriptionsByTopicCommand } from '@aws-sdk/client-sns';
import { SQSClient, GetQueueAttributesCond } from '@aws-sdk/client-sqs';
import { LambdaClient, GetFunctionCommand } from '@aws-sdk/client-lambda';

const cloudwatch = new CloudWatchClient({});
const sns = new SNSClient({});
const sqs = new SQSClient({});
const lambda = new LambdaClient({});

const STACK_NAME = process.env.STACK_NAME || 'newsletter-service';

/**
 * Validate CloudWatch alarms are configured correctly
 */
async function validateAlarms() {
  console.log('🔍 Validating CloudWatch alarms...');

  const expectedAlarms = [
    `${STACK_NAME}-dlq-messages-require-action`,
    `${STACK_NAME}-high-error-rate`,
    `${STACK_NAME}-processing-delays`,
    `${STACK_NAME}-no-events-24h`
  ];

  try {
    const command = new DescribeAlarmsCommand({
      AlarmNames: expectedAlarms
    });

    const response = await cloudwatch.send(command);
    const foundAlarms = response.MetricAlarms?.map(alarm => alarm.AlarmName) || [];

    console.log(`✅ Found ${foundAlarms.length}/${expectedAlarms.length} expected alarms`);

    for (const alarmName of expectedAlarms) {
      const found = foundAlarms.includes(alarmName);
      console.log(`  ${found ? '✅' : '❌'} ${alarmName}`);
    }

    // Check alarm states
    for (const alarm of response.MetricAlarms || []) {
      const state = alarm.StateValue;
      const stateIcon = state === 'OK' ? '✅' : state === 'ALARM' ? '🚨' : '⚠️';
      console.log(`  ${stateIcon} ${alarm.AlarmName}: ${state}`);
    }

    return foundAlarms.length === expectedAlarms.length;
  } catch (error) {
    console.error('❌ Failed to validate alarms:', error.message);
    return false;
  }
}

/**
 * Validate SNS topic and subscriptions
 */
async function validateSNSNotifications() {
  console.log('📧 Validating SNS notifications...');

  const topicArn = `arn:aws:sns:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:${STACK_NAME}-billing-critical-alerts`;

  try {
    const command = new ListSubscriptionsByTopicCommand({
      TopicArn: topicArn
    });

    const response = await sns.send(command);
    const subscriptions = response.Subscriptions || [];

    console.log(`✅ Found ${subscriptions.length} subscription(s) to critical alerts topic`);

    for (const subscription of subscriptions) {
      const confirmed = subscription.SubscriptionArn !== 'PendingConfirmation';
      console.log(`  ${confirmed ? '✅' : '⚠️'} ${subscription.Protocol}: ${subscription.Endpoint} (${subscription.SubscriptionArn})`);
    }

    return subscriptions.length > 0;
  } catch (error) {
    console.error('❌ Failed to validate SNS notifications:', error.message);
    return false;
  }
}

/**
 * Validate DLQ configuration
 */
async function validateDLQ() {
  console.log('📥 Validating DLQ configuration...');

  const queueUrl = `https://sqs.${process.env.AWS_REGION}.amazonaws.com/${process.env.AWS_ACCOUNT_ID}/${STACK_NAME}-stripe-events-dlq`;

  try {
    const command = new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['All']
    });

    const response = await sqs.send(command);
    const attributes = response.Attributes || {};

    console.log('✅ DLQ Configuration:');
    console.log(`  Messages: ${attributes.ApproximateNumberOfMessages || 0}`);
    console.log(`  Retention: ${Math.floor(attributes.MessageRetentionPeriod / 86400)} days`);
    console.log(`  Encryption: ${attributes.KmsMasterKeyId ? 'Enabled' : 'Disabled'}`);

    return true;
  } catch (error) {
    console.error('❌ Failed to validate DLQ:', error.message);
    return false;
  }
}

/**
 * Validate DLQ processor function
 */
async function validateDLQProcessor() {
  console.log('⚙️ Validating DLQ processor function...');

  const functionName = `${STACK_NAME}-ProcessDLQMessagesFunction-${process.env.FUNCTION_SUFFIX || 'XXXXXXXXXX'}`;

  try {
    // Try to find the function with a pattern since the suffix is auto-generated
    const command = new GetFunctionCommand({
      FunctionName: functionName
    });

    const response = await lambda.send(command);
    const config = response.Configuration;

    console.log('✅ DLQ Processor Configuration:');
    console.log(`  Runtime: ${config.Runtime}`);
    console.log(`  Timeout: ${config.Timeout}s`);
    console.log(`  Memory: ${config.MemorySize}MB`);
    console.log(`  Handler: ${config.Handler}`);

    return true;
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      console.log('⚠️ DLQ processor function not found (may need function suffix)');
      console.log('   Use: FUNCTION_SUFFIX=<suffix> npm run validate:monitoring');
    } else {
      console.error('❌ Failed to validate DLQ processor:', error.message);
    }
    return false;
  }
}

/**
 * Check recent EventBridge metrics
 */
async function validateMetrics() {
  console.log('📊 Checking recent EventBridge metrics...');

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // Last 24 hours

  const metricsToCheck = [
    { namespace: 'Newsletter/EventBridge', metricName: 'EventProcessingSuccess' },
    { namespace: 'Newsletter/EventBridge', metricName: 'EventProcessingFailure' },
    { namespace: 'Newsletter/Billing', metricName: 'SubscriptionCreated' },
    { namespace: 'Newsletter/Billing', metricName: 'PaymentSucceeded' }
  ];

  try {
    for (const metric of metricsToCheck) {
      const command = new GetMetricStatisticsCommand({
        Namespace: metric.namespace,
        MetricName: metric.metricName,
        StartTime: startTime,
        EndTime: endTime,
        Period: 3600, // 1 hour
        Statistics: ['Sum']
      });

      const response = await cloudwatch.send(command);
      const datapoints = response.Datapoints || [];
      const total = datapoints.reduce((sum, dp) => sum + dp.Sum, 0);

      console.log(`  📈 ${metric.metricName}: ${total} events (24h)`);
    }

    return true;
  } catch (error) {
    console.error('❌ Failed to check metrics:', error.message);
    return false;
  }
}

/**
 * Main validation function
 */
async function main() {
  console.log('🚀 EventBridge Monitoring Validation');
  console.log('=====================================');
  console.log(`Stack: ${STACK_NAME}`);
  console.log(`Region: ${process.env.AWS_REGION}`);
  console.log('');

  const results = {
    alarms: await validateAlarms(),
    sns: await validateSNSNotifications(),
    dlq: await validateDLQ(),
    processor: await validateDLQProcessor(),
    metrics: await validateMetrics()
  };

  console.log('');
  console.log('📋 Validation Summary');
  console.log('====================');

  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;

  for (const [check, result] of Object.entries(results)) {
    console.log(`${result ? '✅' : '❌'} ${check.toUpperCase()}`);
  }

  console.log('');
  console.log(`Result: ${passed}/${total} checks passed`);

  if (passed === total) {
    console.log('🎉 All monitoring components are configured correctly!');
    process.exit(0);
  } else {
    console.log('⚠️ Some monitoring components need attention.');
    process.exit(1);
  }
}

// Handle CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('💥 Validation failed:', error);
    process.exit(1);
  });
}

export { main as validateEventBridgeMonitoring };
