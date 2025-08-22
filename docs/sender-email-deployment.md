# Sender Email Setup Deployment Guide

This document provides comprehensive deployment insuctions for the sender email setup feature.

## Prerequisites

### Required Tools

1. **AWS CLI** (v2.0 or later)
   ```bash
   aws --version
   ```

2. **SAM CLI** (v1.50 or later)
   ```bash
   sam --version
   ```

3. **Node.js** (v18 or later)
   ```bash
   node --version
   ```

4. **esbuild** (for Lambda bundling)
   ```bash
   npm install -g esbuild
   ```

### AWS Permissions

Ensure your AWS credentials have the following permissions:

- CloudFormation: Full access
- Lambda: Full access
- API Gateway: Full access
- DynamoDB: Full access
- SES: Full access
- EventBridge: Full access
- IAM: Create/update roles and policies
- S3: Create/manage deployment buckets

### Environment Variables

Set the following environment variables before deployment:

#### Required for Stage/Production
```bash
export ENCRYPTION_KEY="your-encryption-key"
export MOMENTO_API_KEY="your-momento-api-key"
export MOMENTO_CACHE_NAME="newsletter"
```

#### Optional
```bash
export REDIRECT_CUSTOM_DOMAIN="your-redirect-domain.com"
```

## Deployment Methods

### Method 1: Using Deployment Scripts (Recommended)

#### Linux/macOS
```bash
# Make scripts executable
chmod +x scripts/deploy-sender-email-setup.sh

# Deploy to sandbox
./scripts/deploy-sender-email-setup.sh sandbox

# Deploy to stage
./scripts/deploy-sender-email-setup.sh stage

# Deploy to production
./scripts/deploy-sender-email-setup.sh production
```

#### Windows PowerShell
```powershell
# Deploy to sandbox
.\scripts\deploy-sender-email-setup.ps1 -Environment sandbox

# Deploy to stage
.\scripts\deploy-sender-email-setup.ps1 -Environment stage

# Deploy to production
.\scripts\deploy-sender-email-setup.ps1 -Environment production
```

### Method 2: Manual SAM Deployment

#### 1. Install Dependencies
```bash
npm ci
```

#### 2. Run Tests
```bash
npm run test
npm run lint
```

#### 3. Build Application
```bash
sam build --parallel
```

#### 4. Deploy

##### Sandbox Environment
```bash
sam deploy --config-env default --no-fail-on-empty-changeset
```

##### Stage Environment
```bash
sam deploy \
  --stack-name newsletter-service \
  --resolve-s3 \
  --no-fail-on-empty-changeset \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    Environment=stage \
    EncryptionKey=$ENCRYPTION_KEY \
    MomentoCacheName=$MOMENTO_CACHE_NAME \
    MomentoApiKey=$MOMENTO_API_KEY
```

##### Production Environment
```bash
sam deploy \
  --stack-name newsletter-service \
  --resolve-s3 \
  --no-fail-on-empty-changeset \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    Environment=production \
    EncryptionKey=$ENCRYPTION_KEY \
    MomentoCacheName=$MOMENTO_CACHE_NAME \
    MomentoApiKey=$MOMENTO_API_KEY \
    RedirectCustomDomain=$REDIRECT_CUSTOM_DOMAIN
```

### Method 3: CI/CD Pipeline

The feature is automatically deployed through GitHub Actions:

#### Stage Deployment
- Triggered on pull requests to `main` branch
- Uses `.github/workflows/pull-request.yaml`

#### Production Deployment
- Triggered on push to `main` branch
- Uses `.github/workflows/deploy.yaml`

## Infrastructure Changes

### New Resources Created

1. **Lambda Functions**
   - `GetSendersFunction`
   - `CreateSenderFunction`
   - `UpdateSenderFunction`
   - `DeleteSenderFunction`
   - `VerifyDomainFunction`
   - `GetDomainVerificationFunction`
   - `HandleSESEventFunction`

2. **API Gateway Endpoints**
   - `GET /senders`
   - `POST /senders`
   - `PUT /senders/{senderId}`
   - `DELETE /senders/{senderId}`
   - `POST /senders/verify-domain`
   - `GET /senders/domain-verification/{domain}`

3. **EventBridge Rules**
   - SES Identity Verification Result events

4. **IAM Roles and Policies**
   - SES permissions for sender functions
   - DynamoDB permissions for data access
   - EventBridge permissions for event handling

### Modified Resources

1. **DynamoDB Table**
   - No schema changes (uses existing flexible schema)
   - New data patterns for sender emails and domain verification

2. **SES Configuration Set**
   - Enhanced with sender email management
   - EventBridge integration for verification events

## Environment-Specific Configuration

### Sandbox Environment
- Uses local development settings
- Minimal resource allocation
- Debug logging enabled

### Stage Environment
- Production-like configuration
- Moderate resource allocation
- Standard logging

### Production Environment
- Full resource allocation
- Optimized performance settings
- Minimal logging for security

## Post-Deployment Verification

### 1. Infrastructure Verification

Check that all resources are created:

```bash
# List Lambda functions
aws lambda list-functions --query 'Functions[?contains(FunctionName, `Sender`)].FunctionName'

# Check API Gateway endpoints
aws apigateway get-rest-apis --query 'items[?name==`newsletter-service-DashboardApi`]'

# Verify EventBridge rules
aws events list-rules --name-prefix "newsletter-service"
```

### 2. Functional Testing

#### Test API Endpoints

```bash
# Get API URL from stack outputs
API_URL=$(aws cloudformation describe-stacks \
  --stack-name newsletter-service \
  --query 'Stacks[0].Outputs[?OutputKey==`NewsletterApiUrl`].OutputValue' \
  --output text)

# Test health endpoint (if available)
curl -X GET "$API_URL/health"

# Test sender endpoints (requires authentication)
curl -X GET "$API_URL/senders" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Test SES Integration

1. Create a test sender email through the API
2. Verify that SES identity is created
3. Check EventBridge events are processed
4. Verify DynamoDB records are created

### 3. Monitoring Setup

1. **CloudWatch Dashboards**
   - Import dashboard configuration
   - Verify metrics are populating

2. **CloudWatch Alarms**
   - Check alarm states
   - Test notification channels

3. **Log Groups**
   - Verify log groups are created
   - Check log retention settings

## Rollback Procedures

### Automated Rollback

Use the rollback script for quick rollback:

```bash
# Linux/macOS
./scripts/rollback-sender-email-setup.sh production

# Windows PowerShell
.\scripts\rollback-sender-email-setup.ps1 -Environment production
```

### Manual Rollback

1. **Revert to Previous Template**
   ```bash
   git checkout previous-working-commit
   sam build && sam deploy
   ```

2. **Remove Specific Resources**
   - Delete Lambda functions manually
   - Remove API Gateway endpoints
   - Clean up EventBridge rules

3. **Data Cleanup**
   - Remove sender email records from DynamoDB
   - Clean up SES identities
   - Remove configuration set modifications

## Troubleshooting

### Common Deployment Issues

#### 1. Permission Errors
```
Error: User is not authorized to perform: lambda:CreateFunction
```
**Solution**: Ensure AWS credentials have sufficient permissions

#### 2. Resource Conflicts
```
Error: Resource already exists
```
**Solution**: Check for existing resources with same names

#### 3. Parameter Validation Errors
```
Error: Invalid parameter value
```
**Solution**: Verify all required environment variables are set

#### 4. Build Failures
```
Error: Build failed
```
**Solution**: Check Node.js version and dependencies

### Deployment Validation Checklist

- [ ] All prerequisites installed
- [ ] AWS credentials configured
- [ ] Environment variables set
- [ ] Tests passing
- [ ] Build successful
- [ ] Deployment completed without errors
- [ ] All Lambda functions created
- [ ] API Gateway endpoints accessible
- [ ] EventBridge rules configured
- [ ] SES configuration updated
- [ ] Monitoring configured
- [ ] Functional tests passing

## Security Considerations

### Deployment Security

1. **Credential Management**
   - Use IAM roles instead of access keys when possible
   - Rotate credentials regularly
   - Use least privilege principle

2. **Environment Separation**
   - Separate AWS accounts for different environments
   - Use different encryption keys per environment
   - Implement proper network isolation

3. **Secret Management**
   - Store sensitive values in AWS Systems Manager Parameter Store
   - Use encryption for sensitive parameters
   - Implement proper secret rotation

### Runtime Security

1. **API Security**
   - All endpoints require authentication
   - Implement rate limiting
   - Use HTTPS only

2. **Data Security**
   - Encrypt data at rest and in transit
   - Implement proper tenant isolation
   - Regular security audits

## Performance Optimization

### Lambda Optimization

1. **Memory Allocation**
   - Monitor memory usage
   - Adjust based on performance metrics
   - Use provisioned concurrency for critical functions

2. **Cold Start Reduction**
   - Keep functions warm with scheduled invocations
   - Optimize bundle size
   - Use ARM64 architecture

### DynamoDB Optimization

1. **Capacity Planning**
   - Monitor read/write capacity utilization
   - Use auto-scaling
   - Optimize query patterns

2. **Cost Optimization**
   - Use on-demand billing for variable workloads
   - Implement TTL for temporary data
   - Regular capacity reviews

## Maintenance

### Regular Maintenance Tasks

1. **Weekly**
   - Review CloudWatch logs for errors
   - Check performance metrics
   - Update dependencies

2. **Monthly**
   - Review and optimize costs
   - Update documentation
   - Security patch updates

3. **Quarterly**
   - Performance baseline review
   - Capacity planning review
   - Security audit

### Upgrade Procedures

1. **Minor Updates**
   - Test in sandbox environment
   - Deploy to stage for validation
   - Deploy to production during maintenance window

2. **Major Updates**
   - Create detailed migration plan
   - Implement blue-green deployment
   - Have rollback plan ready
   - Coordinate with stakeholders

This deployment guide ensures a smooth and reliable deployment of the sender email setup feature across all environments.
