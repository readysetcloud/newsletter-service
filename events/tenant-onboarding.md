# Tenant Onboarding Workflow

This Step Function workflow handles the complete tenant onboarding process, triggered automatically when a new user signs up via Cognito:

1. Creating a DynamoDB record for the tenant
2. Creating a Stripe customer using the Stripe API (if configured)
3. Creating a SES contact list for the tenant
4. Waiting for manual approval/rejection via callback
5. Finalizing the onboarding status

## Cognito Integration

The workflow is automatically triggered by Cognito post-confirmation events when users sign up. The system uses:

- **Tenant User Pool**: Dedicated Cognito User Pool for tenant signups
- **Post-Confirmation Trigger**: Lambda function that starts the onboarding workflow
- **User Attributes**: Email and name are extracted from Cognito user attributes

### User Signup Flow
1. User signs up via Cognito (email + password + name)
2. User confirms email address
3. Cognito triggers post-confirmation Lambda
4. Lambda starts the tenant onboarding Step Function
5. Workflow creates tenant record and Stripe customer
6. Admin receives notification to approve/reject tenant

### Finalize Onboarding
```
POST /tenant/finalize
```

**Request Body:**
```json
{
  "taskToken": "task-token-from-step-function",
  "status": "approved", // or "rejected"
  "reason": "Optional rejection reason"
}
```

**Response:**
```json
{
  "message": "Tenant onboarding approved successfully",
  "status": "approved"
}
```

## Workflow States

1. **Create Tenant Record** - Creates initial DDB record with "onboarding" status
2. **Create Stripe Customer** - Calls Stripe API to create customer
3. **Update Tenant With Stripe ID** - Updates DDB record with Stripe customer ID
4. **Create Contact List** - Creates SES contact list for the tenant
5. **Wait For Callback** - Waits up to 24 hours for approval/rejection
6. **Process Callback Result** - Routes based on approval status
7. **Update Status & Notify** - Updates final status and sends notifications

## Event Notifications

The workflow publishes EventBridge events for different outcomes:

- `Tenant Onboarding Complete` - When approved
- `Tenant Onboarding Rejected` - When rejected
- `Tenant Onboarding Failed` - When technical failure occurs
- `Tenant Onboarding Timeout` - When callback timeout (24 hours)

## DynamoDB Schema

The tenant record includes:
- `pk`: tenantId
- `sk`: "tenant"
- `status`: "onboarding" | "active" | "rejected" | "failed" | "timeout"
- `email`: tenant email
- `name`: tenant name
- `stripeCustomerId`: Stripe customer ID (after creation)
- `list`: SES contact list name (after creation)
- `createdAt`: timestamp
- `updatedAt`: timestamp
- `subscribers`: count (starts at 0)

## Usage Example

1. User signs up via Cognito User Pool with email, password, and name
2. User confirms their email address
3. Cognito automatically triggers the onboarding workflow
4. Admin monitors Step Function executions for new tenant requests
5. Admin extracts the task token from the Step Function execution
6. Admin calls the finalize endpoint with approval/rejection decision
7. The workflow completes and publishes the appropriate event

## Cognito Configuration

The template creates:
- `TenantUserPool`: Cognito User Pool for tenant signups
- `TenantUserPoolClient`: Client for frontend integration
- Required user attributes: email (verified), name
- Post-confirmation trigger to start onboarding workflow

## Frontend Integration

Use the Cognito User Pool for tenant signup:
```javascript
import { CognitoUserPool, CognitoUser } from 'amazon-cognito-identity-js';

const userPool = new CognitoUserPool({
  UserPoolId: 'your-tenant-user-pool-id',
  ClientId: 'your-tenant-user-pool-client-id'
});

// Sign up new tenant
userPool.signUp(email, password, [
  { Name: 'email', Value: email },
  { Name: 'name', Value: companyName }
], null, callback);
```
