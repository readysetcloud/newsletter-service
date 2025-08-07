# Lambda Authorizer

The Lambda Authorizer validates Cognito JWT tokens and passes user context to downstream Lambda functions through API Gateway's authorization context.

## Overview

This authorizer replaces the built-in Cognito authorizer with a custom Lambda function that:

1. **Validates JWT tokens** using `aws-jwt-verify` library
2. **Looks up user data** in DynamoDB for additional context
3. **Merges token claims** with DynamoDB user information
4. **Returns cached policy** covering all API endpoints
5. **Passes rich context** to downstream functions via API Gateway

## Dual Authentication Support

The authorizer supports two authentication methods with priority order:

### 1. JWT Token Authentication (Primary)
- **Token Source**: `Authorization: Bearer <jwt-token>` header
- **Validation**: Signature, expiration, and issuer verification using `aws-jwt-verify`
- **Token Type**: Access tokens (not ID tokens)
- **User Context**: Full user profile with DynamoDB enhancement

### 2. API Key Authentication (Fallback)
- **Key Source**: `x-api-key` header
- **Validation**: Decode key, direct DynamoDB lookup, hash verification
- **User Context**: Limited context with `api_user` role
- **Usage Tracking**: Automatically updates last used time and usage count

**Authentication Flow**:
1. Check for JWT token in `Authorization` header first
2. If no JWT token found, check for API key in `x-api-key` header
3. If neither found, deny access

## User Context Extraction

The authorizer extracts and passes different context based on authentication method:

### JWT Token Context
| Context Field | Primary Source | Fallback Source | Description |
|---------------|----------------|-----------------|-------------|
| `userId` | `sub` claim | - | Unique user identifier |
| `email` | `email` claim | - | User's email address |
| `username` | `username` claim | - | Cognito username |
| `tenantId` | DynamoDB `tenantId` | `custom:tenant_id` claim | Optional tenant ID |
| `role` | DynamoDB `role` | `custom:role` claim | User role (default: 'user') |
| `authType` | - | - | Always 'jwt' |
| `name` | DynamoDB `name` | - | User's full name |
| `company` | DynamoDB `company` | - | User's company |
| `isAdmin` | Derived from role | - | Boolean: role === 'admin' |
| `isTenantAdmin` | Derived from role | - | Boolean: role === 'tenant_admin' |

### API Key Context
| Context Field | Source | Description |
|---------------|--------|-------------|
| `userId` | Decoded from key | Unique user identifier |
| `tenantId` | DynamoDB lookup | Optional tenant ID |
| `keyId` | Decoded from key | API key identifier |
| `authType` | - | Always 'api_key' |
| `role` | - | Always 'api_user' |
| `email` | - | Always null |
| `username` | - | Always null |
| `isAdmin` | - | Always false |
| `isTenantAdmin` | - | Always false |

## Authorization Policy

The authorizer returns an IAM policy covering all API endpoints (for caching efficiency):

- **Resource Pattern**: `arn:aws:execute-api:region:account:api-id/stage/*/*`
- **Allow**: Valid token with user context
- **Deny**: Invalid token, expired token, or missing token

### Policy Caching

API Gateway caches authorization policies by token, so the policy covers all endpoints to maximize cache efficiency. This means:

- One successful authorization allows access to all API endpoints
- Policy is cached for the lifetime of the JWT token
- Reduces Lambda authorizer invocations

## Usage in Downstream Functions

Downstream Lambda functions can access user context via:

```javascript
import { getUserContext } from '../auth/get-user-context.mjs';

export const handler = async (event) => {
  const userContext = getUserContext(event);

  console.log('User ID:', userContext.userId);
  console.log('Email:', userContext.email);
  console.log('Tenant ID:', userContext.tenantId); // May be null
  console.log('Is Admin:', userContext.isAdmin);
};
```

## User Roles

### Admin (`admin`)
- **Tenant Access**: All tenants
- **Permissions**: Full system access
- **Tenant ID**: Usually null/undefined

### Tenant Admin (`tenant_admin`)
- **Tenant Access**: Own tenant only
- **Permissions**: Full access within tenant
- **Tenant ID**: Required

### User (`user`)
- **Tenant Access**: Own tenant only (if assigned)
- **Permissions**: Limited access within tenant
- **Tenant ID**: Optional

## Error Handling

The authorizer handles various error scenarios:

| Scenario | Response | Policy Effect |
|----------|----------|---------------|
| Valid token | User context | Allow |
| Invalid token | No context | Deny |
| Expired token | No context | Deny |
| Missing token | No context | Deny |
| Malformed header | No context | Deny |

## Configuration

The authorizer requires these environment variables:

- `USER_POOL_ID`: Cognito User Pool ID
- `USER_POOL_CLIENT_ID`: Cognito User Pool Client ID
- `TABLE_NAME`: DynamoDB table name for user lookup

## DynamoDB Schema

The authorizer looks up users with:

- **Primary Key**: `pk = userId` (from JWT `sub` claim)
- **Sort Key**: `sk = "user"`
- **Attributes**: `tenantId`, `role`, `name`, `company`, `status`

If the user is not found in DynamoDB, the authorizer falls back to JWT token claims only.

## API Gateway Integration

The authorizer is configured in the SAM template as:

```yaml
Auth:
  DefaultAuthorizer: LambdaTokenAuthorizer
  Authorizers:
    LambdaTokenAuthorizer:
      FunctionArn: !GetAtt LambdaAuthorizerFunction.Arn
      Identity:
        Header: Authorization
```

## Security Considerations

1. **Token Validation**: Uses AWS's official JWT verification library
2. **Context Sanitization**: All context values converted to strings
3. **Error Handling**: No sensitive information in error responses
4. **Caching**: API Gateway caches authorization results by token
5. **Least Privilege**: Only validates tokens, doesn't access other AWS services

## Testing

The authorizer includes comprehensive tests covering:

- Valid token scenarios
- Invalid token scenarios
- Different user roles
- Missing/malformed headers
- Error conditions

## Migration from Cognito Authorizer

When migrating from the built-in Cognito authorizer:

1. **Context Access**: Change from `event.requestContext.authorizer.claims` to `event.requestContext.authorizer`
2. **Field Names**: Update field access (e.g., `claims.sub` → `authorizer.userId`)
3. **Type Conversion**: Context values are now strings (e.g., `isAdmin === 'true'`)
4. **Optional Fields**: Handle null/undefined tenant IDs gracefully

## Performance

- **Cold Start**: ~100-200ms for JWT verification setup
- **Warm Execution**: ~10-50ms for token validation
- **Caching**: API Gateway caches results for identical tokens
- **Memory**: Minimal memory footprint (~64MB sufficient)
