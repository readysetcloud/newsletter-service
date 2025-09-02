# Sender Email Setup Environment Configuration

This document outlines the environment configuration requirements for the sender email setup feature.

## Environment Variables

### Required Environment Variables

The following environment variables are automatically configured in the SAM template for all sender email Lambda functions:

#### `TABLE_NAME`
- **Description**: DynamoDB table name for storing sender email data
- **Value**: Automatically set to the NewsletterTable resource reference
- **Usage**: Used by all sender functions for data persistence

#### `SES_CONFIGURATION_SET`
- **Description**: SES Configuration Set name for email sending
- **Value**: Automatically set to the ConfigurationSet resource reference
- **Usage**: Used by CreateSenderFunction and VerifyDomainFunction for SES integration

#### `MOMENTO_API_KEY`
- **Description**: Momento API key for real-time notifications
- **Value**: Passed from SAM template parameters
- **Usage**: Used by HandleSESEventFunction for real-time status updates

#### `MOMENTO_CACHE_NAME`
- **Description**: Momento cache name for notifications
- **Value**: Passed from SAM template parameters
- **Usage**: Used by HandleSESEventFunction for caching verification status

### Global Environment Variables

These are set at the SAM template level and inherited by all functions
# `AWS_NODEJS_CONNECTION_REUSE_ENABLED`
- **Value**: `1`
- **Purpose**: Enables connection reuse for better performance

#### `SECRET_ID`
- **Value**: `{{resolve:ssm:/readysetcloud/secrets}}`
- **Purpose**: SSM parameter for accessing secrets

#### `ORIGIN`
- **Value**: Varies by environment (localhost for dev, production URL for prod)
- **Purpose**: CORS configuration and callback URLs

#### `EVENT_BUS_NAME`
- **Value**: `newsletter-events`
- **Purpose**: EventBridge bus for custom events

## SAM Template Parameters

### Required Parameters

#### `Environment`
- **Type**: String
- **AllowedValues**: `[sandbox, stage, production]`
- **Description**: Deployment environment
- **Usage**: Controls conditional resource creation and configuration

#### `EncryptionKey`
- **Type**: String
- **Description**: Used to hash email addresses and encrypt sensitive data
- **Required**: Yes for all environments

#### `MomentoApiKey`
- **Type**: String
- **Description**: Super user API key for Momento real-time notifications
- **Required**: Yes for all environments

#### `MomentoCacheName`
- **Type**: String
- **Description**: Momento cache name for real-time notifications
- **Default**: `newsletter-dev` (sandbox), `newsletter` (stage/prod)

### Optional Parameters

#### `Origin`
- **Type**: String
- **Default**: `https://www.readysetcloud.io`
- **Description**: Frontend origin for CORS configuration

#### `HostedZoneId`
- **Type**: String
- **Default**: `""`
- **Description**: Route53 Hosted Zone ID for custom domain (optional)

#### `DomainName`
- **Type**: String
- **Default**: `""`
- **Description**: Custom domain name (optional)

#### `RedirectCustomDomain`
- **Type**: String
- **Default**: `""`
- **Description**: Custom domain for link redirects

## SES Configuration

### Configuration Set

The sender email setup feature uses the existing SES Configuration Set with the following enhancements:

#### Event Destinations
```yaml
ConfigurationSetDestination:
  Type: AWS::SES::ConfigurationSetEventDestination
  Properties:
    ConfigurationSetName: !Ref ConfigurationSet
    EventDestination:
      Enabled: true
      EventBridgeDestination:
        EventBusArn: !Sub arn:aws:events:${AWS::Region}:${AWS::AccountId}:event-bus/default
      MatchingEventTypes:
        - SEND
        - REJECT
        - BOUNCE
        - COMPLAINT
        - DELIVERY
        - OPEN
        - CLICK
```

### Required SES Permissions

The sender email functions require the following SES permissions:

#### CreateSenderFunction & VerifyDomainFunction
```yaml
- ses:VerifyEmailIdentity
- ses:VerifyDomainIdentity
- ses:GetIdentityVerificationAttributes
- ses:PutEmailIdentity
- ses:GetIdentityDkimAttributes
```

#### DeleteSenderFunction
```yaml
- ses:DeleteIdentity
- ses:GetIdentityVerificationAttributes
```

#### GetDomainVerificationFunction
```yaml
- ses:GetIdentityVerificationAttributes
- ses:GetIdentityDkimAttributes
```

## EventBridge Configuration

### Event Rules

#### SES Verification Events
```yaml
HandleSESEventFunction:
  Events:
    SESVerificationEvent:
      Type: EventBridgeRule
      Properties:
        Pattern:
          source: ["aws.ses"]
          detail-type: ["SES Identity Verification Result"]
```

### Custom Event Bus

The feature uses the existing custom EventBridge bus:

```yaml
NewsletterEventBus:
  Type: AWS::Events::EventBus
  Properties:
    Name: newsletter-events
    Description: Custom EventBridge bus for newsletter notification events
```

## DynamoDB Configuration

### Table Schema

The sender email feature uses the existing NewsletterTable with the following data patterns:

#### Sender Email Records
```
PK: {tenantId}
SK: sender#{senderId}
GSI1PK: sender#{tenantId}
GSI1SK: {email}
```

#### Domain Verification Records
```
PK: {tenantId}
SK: domain#{domain}
GSI1PK: domain#{tenantId}
GSI1SK: {domain}
```

### Required Permissions

```yaml
- dynamodb:PutItem
- dynamodb:GetItem
- dynamodb:UpdateItem
- dynamodb:DeleteItem
- dynamodb:Query
- dynamodb:Scan
```

## API Gateway Configuration

### Endpoints

All sender email endpoints are added to the existing DashboardApi:

```yaml
/senders:
  - GET: List sender emails
  - POST: Create sender email

/senders/{senderId}:
  - PUT: Update sender email
  - DELETE: Delete sender email

/senders/verify-domain:
  - POST: Initiate domain verification

/senders/domain-verification/{domain}:
  - GET: Get domain verification status
```

### Authentication

All endpoints use the existing Lambda authorizer:

```yaml
Auth:
  DefaultAuthorizer: LambdaAuthorizer
  Authorizers:
    LambdaAuthorizer:
      FunctionPayloadType: REQUEST
      FunctionArn: !GetAtt LambdaAuthorizerFunction.Arn
```

## Environment-Specific Configurations

### Sandbox Environment
```yaml
Environment: sandbox
EncryptionKey: "voldemort"  # Development key
Origin: "http://localhost:3000"
MomentoCacheName: "newsletter-dev"
```

### Stage Environment
```yaml
Environment: stage
EncryptionKey: ${ENCRYPTION_KEY}  # From environment variable
Origin: "https://stage.example.com"
MomentoCacheName: "newsletter"
```

### Production Environment
```yaml
Environment: production
EncryptionKey: ${ENCRYPTION_KEY}  # From environment variable
Origin: "https://www.readysetcloud.io"
MomentoCacheName: "newsletter"
RedirectCustomDomain: "rdyset.click"
```

## Security Configuration

### IAM Roles

Each Lambda function has a dedicated IAM role with least-privilege permissions:

#### Example: CreateSenderFunction Role
```yaml
Policies:
  - AWSLambdaBasicExecutionRole
  - Version: 2012-10-17
    Statement:
      - Effect: Allow
        Action:
          - dynamodb:PutItem
          - dynamodb:Query
        Resource:
          - !GetAtt NewsletterTable.Arn
          - !Sub "${NewsletterTable.Arn}/index/GSI1"
      - Effect: Allow
        Action:
          - ses:VerifyEmailIdentity
          - ses:VerifyDomainIdentity
          - ses:GetIdentityVerificationAttributes
          - ses:PutEmailIdentity
        Resource: "*"
```

### Encryption

#### Data at Rest
- DynamoDB: Encrypted using AWS managed keys
- Lambda environment variables: Encrypted using AWS KMS

#### Data in Transit
- API Gateway: HTTPS only
- SES: TLS required
- DynamoDB: TLS connections

## Monitoring Configuration

### CloudWatch Logs

Log groups are automatically created for each Lambda function:
- `/aws/lambda/newsletter-service-GetSendersFunction`
- `/aws/lambda/newsletter-service-CreateSenderFunction`
- `/aws/lambda/newsletter-service-UpdateSenderFunction`
- `/aws/lambda/newsletter-service-DeleteSenderFunction`
- `/aws/lambda/newsletter-service-VerifyDomainFunction`
- `/aws/lambda/newsletter-service-GetDomainVerificationFunction`
- `/aws/lambda/newsletter-service-HandleSESEventFunction`

### X-Ray Tracing

All Lambda functions have X-Ray tracing enabled:
```yaml
Globals:
  Function:
    Tracing: Active
```

## Configuration Validation

### Pre-Deployment Checks

The deployment scripts validate:
1. Required environment variables are set
2. AWS credentials are configured
3. Required tools are installed
4. Tests pass
5. Linting passes

### Post-Deployment Verification

The deployment scripts verify:
1. All Lambda functions are created
2. API Gateway endpoints are accessible
3. EventBridge rules are configured
4. SES configuration is updated
5. Basic functionality works

## Troubleshooting Configuration Issues

### Common Issues

#### Missing Environment Variables
```
Error: Environment variable MOMENTO_API_KEY is not set
```
**Solution**: Set the required environment variable before deployment

#### SES Permissions
```
Error: User is not authorized to perform: ses:VerifyEmailIdentity
```
**Solution**: Ensure AWS credentials have SES permissions

#### DynamoDB Access
```
Error: User is not authorized to perform: dynamodb:PutItem
```
**Solution**: Verify DynamoDB permissions in IAM role

#### EventBridge Configuration
```
Error: Events are not being processed
```
**Solution**: Check EventBridge rule configuration and permissions

### Configuration Validation Commands

```bash
# Check environment variables
echo $ENCRYPTION_KEY
echo $MOMENTO_API_KEY
echo $MOMENTO_CACHE_NAME

# Validate AWS credentials
aws sts get-caller-identity

# Check SES configuration
aws ses get-configuration-set --configuration-set-name newsletter-service-ConfigurationSet

# Verify EventBridge rules
aws events list-rules --name-prefix newsletter-service

# Test DynamoDB access
aws dynamodb describe-table --table-name newsletter-service-NewsletterTable
```

This configuration ensures that the sender email setup feature integrates seamlessly with the existing infrastructure while maintaining security, performance, and reliability standards.
