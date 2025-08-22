# Sender Email Setup Monitoring and Alerting

This document outlines the monitoring and alerting configuration for the sender email setup feature.

## CloudWatch Metrics to Monitor

### Lambda Funcn Metrics

Monitor the following metrics for all sender email Lambda functions:

- **Duration**: Function execution time
- **Errors**: Function errors and failures
- **Invocations**: Number of function invocations
- **Throttles**: Function throttling events
- **ConcurrentExecutions**: Concurrent executions

**Functions to monitor:**
- `GetSendersFunction`
- `CreateSenderFunction`
- `UpdateSenderFunction`
- `DeleteSenderFunction`
- `VerifyDomainFunction`
- `GetDomainVerificationFunction`
- `HandleSESEventFunction`

### SES Metrics

Monitor SES-specific metrics:

- **Send**: Email send attempts
- **Bounce**: Email bounces
- **Complaint**: Email complaints
- **Delivery**: Successful email deliveries
- **Reject**: Email rejections

### DynamoDB Metrics

Monitor DynamoDB table metrics:

- **ConsumedReadCapacityUnits**: Read capacity consumption
- **ConsumedWriteCapacityUnits**: Write capacity consumption
- **ThrottledRequests**: Throttled requests
- **SystemErrors**: System errors
- **UserErrors**: User errors

### API Gateway Metrics

Monitor API Gateway metrics for sender endpoints:

- **Count**: Number of API calls
- **Latency**: API response latency
- **4XXError**: Client errors
- **5XXError**: Server errors

## CloudWatch Alarms

### Critical Alarms

#### Lambda Function Errors
```yaml
AlarmName: SenderEmailFunctionErrors
MetricName: Errors
Namespace: AWS/Lambda
Statistic: Sum
Period: 300
EvaluationPeriods: 2
Threshold: 5
ComparisonOperator: GreaterThanThreshold
AlarmActions:
  - SNS Topic for critical alerts
```

#### SES Bounce Rate
```yaml
AlarmName: SESBounceRateHigh
MetricName: Bounce
Namespace: AWS/SES
Statistic: Average
Period: 900
EvaluationPeriods: 2
Threshold: 0.05  # 5% bounce rate
ComparisonOperator: GreaterThanThreshold
```

#### API Gateway 5XX Errors
```yaml
AlarmName: SenderAPIServerErrors
MetricName: 5XXError
Namespace: AWS/ApiGateway
Statistic: Sum
Period: 300
EvaluationPeriods: 2
Threshold: 10
ComparisonOperator: GreaterThanThreshold
```

### Warning Alarms

#### Lambda Function Duration
```yaml
AlarmName: SenderEmailFunctionDuration
MetricName: Duration
Namespace: AWS/Lambda
Statistic: Average
Period: 300
EvaluationPeriods: 3
Threshold: 10000  # 10 seconds
ComparisonOperator: GreaterThanThreshold
```

#### DynamoDB Throttling
```yaml
AlarmName: DynamoDBThrottling
MetricName: ThrottledRequests
Namespace: AWS/DynamoDB
Statistic: Sum
Period: 300
EvaluationPeriods: 2
Threshold: 1
ComparisonOperator: GreaterThanThreshold
```

## CloudWatch Dashboards

### Sender Email Setup Dashboard

Create a dashboard with the following widgets:

1. **Lambda Functions Overview**
   - Invocations, Errors, Duration for all sender functions
   - Time range: Last 24 hours

2. **SES Metrics**
   - Send, Bounce, Complaint, Delivery rates
   - Time range: Last 7 days

3. **API Gateway Performance**
   - Request count, latency, error rates for sender endpoints
   - Time range: Last 24 hours

4. **DynamoDB Performance**
   - Read/Write capacity utilization
   - Throttling events
   - Time range: Last 24 hours

5. **Error Logs**
   - Recent error logs from all sender functions
   - Filter: ERROR level logs

## Log Monitoring

### CloudWatch Logs Insights Queries

#### Recent Errors in Sender Functions
```sql
fields @timestamp, @message, @logStream
| filter @message like /ERROR/
| filter @logStream like /senders/
| sort @timestamp desc
| limit 100
```

#### SES Verification Events
```sql
fields @timestamp, @message
| filter @message like /verification/
| filter @logStream like /HandleSESEventFunction/
| sort @timestamp desc
| limit 50
```

#### API Gateway Errors
```sql
fields @timestamp, @message, @requestId
| filter @message like /ERROR/ or @message like /5XX/
| filter @logStream like /senders/
| sort @timestamp desc
| limit 100
```

### Log Retention

Set appropriate log retention periods:

- **Production**: 30 days
- **Stage**: 14 days
- **Sandbox**: 7 days

## SNS Topics for Alerts

### Critical Alerts Topic
- **Name**: `sender-email-critical-alerts`
- **Subscribers**:
  - Operations team email
  - PagerDuty integration
  - Slack webhook

### Warning Alerts Topic
- **Name**: `sender-email-warning-alerts`
- **Subscribers**:
  - Development team email
  - Slack webhook

## Custom Metrics

### Business Metrics

Track custom business metrics using CloudWatch custom metrics:

#### Sender Email Creation Rate
```javascript
// In CreateSenderFunction
await cloudwatch.putMetricData({
  Namespace: 'Newsletter/SenderEmail',
  MetricData: [{
    MetricName: 'SenderEmailCreated',
    Value: 1,
    Unit: 'Count',
    Dimensions: [{
      Name: 'Tier',
      Value: userTier
    }]
  }]
}).promise();
```

#### Verification Success Rate
```javascript
// In HandleSESEventFunction
await cloudwatch.putMetricData({
  Namespace: 'Newsletter/SenderEmail',
  MetricData: [{
    MetricName: 'VerificationSuccess',
    Value: verificationSuccessful ? 1 : 0,
    Unit: 'Count',
    Dimensions: [{
      Name: 'VerificationType',
      Value: verificationType // 'mailbox' or 'domain'
    }]
  }]
}).promise();
```

## Health Checks

### API Health Check Endpoint

Create a health check endpoint for sender email functionality:

```javascript
// GET /senders/health
export const handler = async (event) => {
  const checks = {
    dynamodb: await checkDynamoDBConnection(),
    ses: await checkSESConnection(),
    momento: await checkMomentoConnection()
  };

  const allHealthy = Object.values(checks).every(check => check.healthy);

  return {
    statusCode: allHealthy ? 200 : 503,
    body: JSON.stringify({
      status: allHealthy ? 'healthy' : 'unhealthy',
      checks,
      timestamp: new Date().toISOString()
    })
  };
};
```

### Synthetic Monitoring

Set up synthetic monitoring using CloudWatch Synthetics:

1. **API Endpoint Monitoring**
   - Test all sender email endpoints
   - Frequency: Every 5 minutes
   - Alert on failures

2. **End-to-End Flow Monitoring**
   - Create sender email
   - Verify status
   - Delete sender email
   - Frequency: Every 15 minutes

## Troubleshooting Runbook

### Common Issues and Solutions

#### High Error Rate in CreateSenderFunction
1. Check SES service limits
2. Verify DynamoDB write capacity
3. Check for malformed email addresses
4. Review tier limit validation logic

#### SES Verification Events Not Processing
1. Check EventBridge rule configuration
2. Verify HandleSESEventFunction permissions
3. Check SES configuration set event destination
4. Review function logs for processing errors

#### API Gateway Timeouts
1. Check Lambda function duration
2. Review DynamoDB query performance
3. Check SES API response times
4. Verify network connectivity

#### DynamoDB Throttling
1. Check read/write capacity settings
2. Review query patterns for hot partitions
3. Consider using DynamoDB auto-scaling
4. Optimize query filters

## Performance Baselines

### Expected Performance Metrics

- **Lambda Function Duration**: < 5 seconds (95th percentile)
- **API Gateway Latency**: < 2 seconds (95th percentile)
- **SES Verification Time**: < 5 minutes for mailbox, < 24 hours for domain
- **DynamoDB Query Latency**: < 100ms (95th percentile)

### Capacity Planning

- **Lambda Concurrency**: Reserve 10 concurrent executions for sender functions
- **DynamoDB Capacity**: Monitor and adjust based on usage patterns
- **SES Sending Limits**: Monitor daily sending quota and rate limits

## Security Monitoring

### Security Metrics to Monitor

1. **Unauthorized Access Attempts**
   - Failed authentication events
   - Cross-tenant access attempts

2. **Suspicious Activity**
   - Rapid sender email creation/deletion
   - Unusual verification patterns
   - High-frequency API calls from single source

3. **Data Access Patterns**
   - Unusual DynamoDB access patterns
   - Large data exports
   - Cross-region access attempts

### Security Alerts

Set up alerts for:
- Multiple failed authentication attempts
- Cross-tenant data access attempts
- Unusual API usage patterns
- SES reputation issues

## Maintenance Windows

### Scheduled Maintenance

- **Weekly**: Review and clean up old logs
- **Monthly**: Review and optimize CloudWatch alarms
- **Quarterly**: Review performance baselines and adjust thresholds

### Emergency Procedures

1. **Service Degradation**
   - Enable circuit breaker patterns
   - Scale up Lambda concurrency
   - Increase DynamoDB capacity

2. **Complete Service Outage**
   - Activate rollback procedures
   - Notify users of service disruption
   - Implement emergency fixes

This monitoring configuration ensures comprehensive observability of the sender email setup feature and enables proactive issue detection and resolution.
