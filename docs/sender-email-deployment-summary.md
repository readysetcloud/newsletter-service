# Sender Email Setup Deployment Summary

This document provides a quick reference for deploying and managing the sender email setup feature.

## Quick DepCommands

### Using Deployment Scripts (Recommended)

#### Linux/macOS
```bash
# Deploy to sandbox
./scripts/deploy-sender-email-setup.sh sandbox

# Deploy to stage
./scripts/deploy-sender-email-setup.sh stage

# Deploy to production
./scripts/deploy-sender-email-setup.sh production

# Validate deployment
./scripts/validate-sender-email-deployment.sh [environment]

# Rollback if needed
./scripts/rollback-sender-email-setup.sh [environment]
```

#### Windows PowerShell
```powershell
# Deploy
.\scripts\deploy-sender-email-setup.ps1 -Environment [sandbox|stage|production]

# Validate
.\scripts\validate-sender-email-deployment.ps1 -Environment [environment]

# Rollback
.\scripts\rollback-sender-email-setup.ps1 -Environment [environment]
```

### Manual SAM Commands

```bash
# Build and deploy
npm ci
sam build --parallel
sam deploy --config-env [environment]

# Validate template
sam validate --template template.yaml
```

## Environment Variables Required

### For Stage/Production Deployments
```bash
export ENCRYPTION_KEY="your-encryption-key"
export MOMENTO_API_KEY="your-momento-api-key"
export MOMENTO_CACHE_NAME="newsletter"
export REDIRECT_CUSTOM_DOMAIN="your-domain.com"  # Optional
```

## Infrastructure Components

### New Lambda Functions
- `GetSendersFunction` - List sender emails
- `CreateSenderFunction` - Create new sender email
- `UpdateSenderFunction` - Update sender email properties
- `DeleteSenderFunction` - Delete sender email
- `VerifyDomainFunction` - Initiate domain verification
- `GetDomainVerificationFunction` - Get verification status
- `HandleSESEventFunction` - Process SES events

### New API Endpoints
- `GET /senders` - List sender emails
- `POST /senders` - Create sender email
- `PUT /senders/{senderId}` - Update sender email
- `DELETE /senders/{senderId}` - Delete sender email
- `POST /senders/verify-domain` - Verify domain
- `GET /senders/domain-verification/{domain}` - Get verification status

### Enhanced Resources
- SES Configuration Set with EventBridge integration
- EventBridge rules for SES verification events
- DynamoDB table with new data patterns
- IAM roles and policies for sender functions

## Deployment Checklist

### Pre-Deployment
- [ ] Environment variables set
- [ ] AWS credentials configured
- [ ] Tests passing (`npm run test`)
- [ ] Linting passing (`npm run lint`)
- [ ] SAM template validated

### Post-Deployment
- [ ] All Lambda functions created
- [ ] API Gateway endpoints accessible
- [ ] EventBridge rules configured
- [ ] SES configuration updated
- [ ] DynamoDB data patterns working
- [ ] CloudWatch logs created
- [ ] X-Ray tracing enabled
- [ ] Validation script passes

## Monitoring and Alerting

### Key Metrics to Monitor
- Lambda function errors and duration
- API Gateway 4XX/5XX errors
- SES bounce/complaint rates
- DynamoDB throttling
- EventBridge rule failures

### CloudWatch Dashboards
- Sender Email Setup Overview
- Lambda Functions Performance
- API Gateway Metrics
- SES Integration Status

### Log Groups
- `/aws/lambda/newsletter-service-*SenderFunction`
- API Gateway access logs
- EventBridge rule execution logs

## Troubleshooting Quick Reference

### Common Issues

#### Lambda Function Errors
1. Check CloudWatch logs
2. Verify environment variables
3. Check IAM permissions
4. Validate input parameters

#### SES Integration Issues
1. Verify SES service limits
2. Check configuration set settings
3. Validate EventBridge rules
4. Review SES identity status

#### API Gateway Errors
1. Check Lambda function logs
2. Verify authorizer configuration
3. Validate request format
4. Check CORS settings

#### DynamoDB Issues
1. Check read/write capacity
2. Verify GSI configuration
3. Review query patterns
4. Check for throttling

### Emergency Procedures

#### Service Degradation
1. Check CloudWatch alarms
2. Scale Lambda concurrency
3. Increase DynamoDB capacity
4. Enable circuit breaker patterns

#### Complete Outage
1. Run rollback script
2. Notify stakeholders
3. Implement emergency fixes
4. Monitor recovery

## Rollback Procedures

### Automated Rollback
```bash
# Quick rollback using script
./scripts/rollback-sender-email-setup.sh [environment]
```

### Manual Rollback
1. Revert to previous git commit
2. Deploy previous template version
3. Clean up orphaned resources
4. Verify application functionality

### Data Backup
- Sender email data automatically backed up during rollback
- Backup files: `sender-backup-YYYYMMDD-HHMMSS.json`
- Restore using DynamoDB import if needed

## Security Considerations

### Access Control
- All endpoints require authentication
- Tenant isolation enforced
- Least privilege IAM policies
- API rate limiting enabled

### Data Protection
- Encryption at rest and in transit
- Secure environment variable handling
- Audit logging enabled
- Regular security reviews

## Performance Optimization

### Lambda Functions
- ARM64 architecture for better performance
- Optimized memory allocation
- Connection reuse enabled
- Cold start minimization

### DynamoDB
- Efficient query patterns
- GSI for flexible access
- Auto-scaling enabled
- TTL for temporary data

### API Gateway
- Caching for read operations
- Request validation
- Throttling protection
- Monitoring and alerting

## Cost Optimization

### Resource Sizing
- Right-sized Lambda memory
- DynamoDB on-demand billing
- CloudWatch log retention policies
- S3 lifecycle policies

### Monitoring
- Cost allocation tags
- Usage metrics tracking
- Regular cost reviews
- Optimization recommendations

## Documentation References

- [Deployment Guide](./sender-email-deployment.md)
- [Environment Configuration](./sender-email-environment-config.md)
- [Monitoring Setup](./sender-email-monitoring.md)
- [API Documentation](../openapi.yaml)
- [Requirements](../.kiro/specs/sender-email-setup/requirements.md)
- [Design](../.kiro/specs/sender-email-setup/design.md)

## Support and Maintenance

### Regular Tasks
- Weekly log review
- Monthly performance analysis
- Quarterly security audit
- Dependency updates

### Contact Information
- Development Team: [team-email]
- Operations Team: [ops-email]
- Emergency Contact: [emergency-contact]

### Escalation Procedures
1. Check monitoring dashboards
2. Review recent deployments
3. Contact development team
4. Escalate to operations if needed
5. Implement emergency procedures

This summary provides quick access to all essential information for deploying and managing the sender email setup feature effectively.
