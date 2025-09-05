# EventBridge Monitoring and Alerting

This document describes the simplified monitoring and alerting setup for the EventBridge-based Stripe billing system.

## Overview

The monitoring system has been simplified to focus on essential alerts only, removing complex reconciliation metrics and dashboards in favor of EventBridge's built-in reliability mechanisms.

## Key Principles

1. **Essential Alerts Only** - Only alert on issues requiring human intervention
2. **Actionable Notifications** - Every alert should have a clear action to take
3. **Self-Healing System** - EventBridge handles retries automatically
4. **Minimal Maintenance** - Designed for solo developer operation

## Monitoring Components

### CloudWatch Alarms

#### 1. DLQ Messages Alert
- **Name**: `{stack}-dlq-messages-require-action`
- **Purpose**: Alert when any failed events require manual investigation
- **Threshold**: ≥1 message in DLQ
- **Action**: Immediate investigation required

#### 2. High Error Rate Alert
- **Name**: `{stack}-high-error-rate`
- **Purpose**: Alert when system has high error rate indicating system issues
- **Threshold**: >10 errors per hour
- **Action**: Check system health and recent deployments

#### 3. Processing Delays Alert
- **Name**: `{stack}-processing-delays`
- **Purpose**: Alert when processing is slow indicating performance issues
- **Threshold**: >30s average processing time over 15 minutes
- **Action**: Check Lambda performance and DynamoDB throttling

#### 4. No Events Processed Alert
- **Name**: `{stack}-no-events-24h`
- **Purpose**: Alert when no events processed indicating broken integration
- **Threshold**: <1 event in 24 hours
- **Action**: Check Stripe EventBridge configuration

### CloudWatch Dashboard

The simplified dashboard shows:
- **Subscription Events**: Hourly invocations, errors, and duration
- **Payment Events**: Hourly invocations, errors, and duration
- **DLQ Messages**: Current message count with alert threshold
- **Error Rate**: Combined error rate across all functions

### SNS Notifications

- **Topic**: `{stack}-billing-critical-alerts`
- **Subscribers**: Developer email from SSM parameter `/readysetcloud/admin-email`
- **Encryption**: KMS encrypted for security

## DLQ Processing

### Simplified DLQ Processor
- **Function**: `ProcessDLQMessagesFunction`
- **Purpose**: Log failed events and send alerts (no reprocessing)
- **Trigger**: Manual or scheduled (not automatic)
- **Actions**:
  1. Log message details for manual review
  2. Send alert notification
  3. Remove logged messages from DLQ

### DLQ Message Handling
1. **Automatic Retry**: EventBridge retries failed events 3 times with exponential backoff
2. **DLQ Storage**: Failed events stored for 14 days
3. **Alert Generation**: Immediate alert when messages appear in DLQ
4. **Manual Review**: Developer investigates and resolves data issues

## Metrics Published

### Essential Metrics Only
- `Newsletter/EventBridge/EventProcessingSuccess` - Successful event processing
- `Newsletter/EventBridge/EventProcessingFailure` - Failed event processing
- `Newsletter/Billing/SubscriptionCreated` - Subscription events processed
- `Newsletter/Billing/PaymentSucceeded` - Payment events processed
- `Newsletter/Billing/PaymentFailed` - Failed payment events

### Removed Complex Metrics
- Reconciliation metrics (no longer needed)
- Detailed processing breakdowns (simplified)
- Heavy CloudWatch metrics publishing (optimized)

## Validation

### Monitoring Validation Script
```bash
npm run validate:monitoring
```

This script validates:
- ✅ CloudWatch alarms are configured correctly
- ✅ SNS topic has active subscriptions
- ✅ DLQ is properly configured
- ✅ DLQ processor function is deployed
- ✅ Recent metrics are being published

### Environment Variables Required
```bash
export STACK_NAME="your-stack-name"
export AWS_REGION="us-east-1"
export AWS_ACCOUNT_ID="123456789012"
export FUNCTION_SUFFIX="ABC123DEF456"  # Optional, for DLQ processor validation
```

## Troubleshooting

### Common Issues

#### No Alerts Received
1. Check SNS subscription confirmation
2. Verify email address in SSM parameter
3. Check spam folder

#### False Positive Alerts
1. **DLQ Messages**: Check if legitimate failures (data issues)
2. **High Error Rate**: Check for deployment issues or AWS service problems
3. **Processing Delays**: Check Lambda cold starts or DynamoDB throttling

#### Missing Metrics
1. Verify EventBridge functions are being invoked
2. Check CloudWatch metrics publishing permissions
3. Validate Stripe EventBridge integration is active

### Manual DLQ Processing
```bash
# Invoke DLQ processor manually
aws lambda invoke \
  --function-name {stack}-ProcessDLQMessagesFunction-{suffix} \
  --payload '{"maxMessages": 10}' \
  response.json
```

### Checking Alarm States
```bash
# List all alarms for the stack
aws cloudwatch describe-alarms \
  --alarm-name-prefix {stack}
```

## Migration Benefits

### Removed Complexity
- ❌ Heavy subscription reconciliation function (400+ lines)
- ❌ Complex reconciliation metrics and dashboards
- ❌ Manual DLQ reprocessing logic
- ❌ Webhook signature verification complexity

### Added Simplicity
- ✅ EventBridge built-in retry mechanisms
- ✅ Essential alerts only (4 alarms vs 10+)
- ✅ Simple DLQ logging and alerting
- ✅ Focused dashboard with actionable metrics
- ✅ Automated validation script

### Operational Benefits
- **Reduced Maintenance**: 70% less monitoring code to maintain
- **Better Reliability**: EventBridge handles retries automatically
- **Clearer Alerts**: Only actionable alerts that require human intervention
- **Easier Debugging**: Simplified event flow with clear error handling
- **Lower Costs**: Reduced CloudWatch metrics and Lambda execution time

## Best Practices

1. **Monitor the Monitors**: Regularly run validation script
2. **Test Alerts**: Periodically test SNS notifications
3. **Review DLQ**: Check DLQ messages weekly for patterns
4. **Update Thresholds**: Adjust alarm thresholds based on actual usage
5. **Document Issues**: Keep track of common DLQ message causes

## Support

For issues with the monitoring system:
1. Run the validation script first
2. Check CloudWatch logs for the specific functions
3. Review recent deployments for configuration changes
4. Check AWS service health dashboard for regional issues
