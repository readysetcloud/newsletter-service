# API Key Management

The API Key Management system allows authenticated users to create, list, and delete API keys for programmatic access to the API.

## Security Model

- **One-Time Viewing**: API key values are only shown once during creation
- **Secure Storage**: Keys are hashed using SHA-256 before storage
- **User Isolation**: Users can only manage their own API keys
- **Optional Expiration**: Keys can have expiration dates
- **Usage Tracking**: Track last used time and usage count

## Endpoints

### Create API Key
```
POST /api-keys
```

**Request Body:**
```json
{
  "name": "My API Key",
  "description": "For automated scripts",
  "expiresAt": "2024-12-31T23:59:59Z"
}
```

**Response (201):**
```json
{
  "message": "API key created successfully",
  "apiKey": {
    "keyId": "a1b2c3d4e5f6",
    "name": "My API Key",
    "description": "For automated scripts",
    "keyValue": "ak_base64url-encoded-key-value",
    "tenantId": "tenant-123",
    "createdAt": "2024-01-15T10:30:00Z",
    "expiresAt": "2024-12-31T23:59:59Z",
    "status": "active"
  }
}
```

**⚠️ Important**: The `keyValue` is only returned during creation and cannot be retrieved later.

### List API Keys
```
GET /api-keys
```

**Response (200):**
```json
{
  "apiKeys": [
    {
      "keyId": "a1b2c3d4e5f6",
      "name": "My API Key",
      "description": "For automated scripts",
      "keyValue": "***hidden***",
      "tenantId": "tenant-123",
      "createdAt": "2024-01-15T10:30:00Z",
      "lastUsed": "2024-01-20T14:22:00Z",
      "usageCount": 42,
      "expiresAt": "2024-12-31T23:59:59Z",
      "status": "active"
    }
  ],
  "count": 1
}
```

### Get API Key Details
```
GET /api-keys/{keyId}
```

**Response (200):**
```json
{
  "apiKey": {
    "keyId": "a1b2c3d4e5f6",
    "name": "My API Key",
    "description": "For automated scripts",
    "keyValue": "***hidden***",
    "tenantId": "tenant-123",
    "createdAt": "2024-01-15T10:30:00Z",
    "lastUsed": "2024-01-20T14:22:00Z",
    "usageCount": 42,
    "expiresAt": "2024-12-31T23:59:59Z",
    "status": "active"
  }
}
```

### Delete API Key
```
DELETE /api-keys/{keyId}
```

**Response (200):**
```json
{
  "message": "API key deleted successfully",
  "keyId": "a1b2c3d4e5f6"
}
```

## API Key Format

API keys follow this structured format for efficient lookups:
- **Prefix**: `ak_` (identifies as API key)
- **Payload**: Base64url-encoded JSON with user/key info
- **Secret**: 24 random bytes encoded as base64url
- **Format**: `ak_<payload>.<secret>`

**Example**: `ak_eyJ1IjoidXNlci0xMjMiLCJrIjoia2V5LTQ1NiIsInQiOjE2NDA5OTUyMDAwMDB9.dGVzdC1zZWNyZXQtdmFsdWU`

**Payload Structure**:
```json
{
  "u": "user-123",     // User ID
  "k": "key-456",      // Key ID
  "t": 1640995200000   // Timestamp
}
```

This format allows for direct database lookups without requiring a Global Secondary Index.

## Validation Rules

### Name
- **Required**: Yes
- **Type**: String
- **Max Length**: 100 characters
- **Must be non-empty** after trimming

### Description
- **Required**: No
- **Type**: String
- **Max Length**: 500 characters

### Expiration Date
- **Required**: No
- **Format**: ISO 8601 date-time string
- **Must be in the future** when creating

## DynamoDB Schema

API keys are stored with the following structure:

```json
{
  "pk": "user-id",
  "sk": "apikey#key-id",
  "keyId": "unique-key-identifier",
  "name": "Human readable name",
  "description": "Optional description",
  "hashedKey": "sha256-hash-of-key-value",
  "tenantId": "optional-tenant-id",
  "createdAt": "2024-01-15T10:30:00Z",
  "lastUsed": "2024-01-20T14:22:00Z",
  "usageCount": 42,
  "expiresAt": "2024-12-31T23:59:59Z",
  "status": "active",
  "ttl": 1735689599
}
```

### Global Secondary Index

An additional GSI `ApiKeyIndex` is created on `hashedKey` for efficient key validation:

- **Partition Key**: `hashedKey`
- **Purpose**: Fast lookup during API key validation
- **Projection**: ALL attributes

## Usage Tracking

When API keys are used:
1. `lastUsed` is updated to current timestamp
2. `usageCount` is incremented
3. Key expiration is checked
4. Key status is verified

## Security Considerations

### Key Generation
- Uses Node.js `crypto.randomBytes()` for secure random generation
- 32 bytes of entropy (256 bits)
- Base64url encoding for URL-safe usage

### Key Storage
- Original key values are never stored
- SHA-256 hash is stored for validation
- Hash is computed server-side during validation
- User/Key IDs are encoded in the key for direct lookup

### Access Control
- Users can only manage their own API keys
- Lambda authorizer validates user context
- Tenant isolation maintained

### Expiration
- Optional TTL support for automatic cleanup
- Expiration checked during validation
- Expired keys automatically denied

## Error Responses

### 400 Bad Request
```json
{
  "message": "Validation error: name is required and must be a non-empty string"
}
```

### 403 Forbidden
```json
{
  "message": "Authentication required"
}
```

### 404 Not Found
```json
{
  "message": "API key not found"
}
```

### 500 Internal Server Error
```json
{
  "message": "Failed to manage API key"
}
```

## Authentication with API Keys

API keys can be used for authentication by including them in the `x-api-key` header:

```bash
curl -X GET https://api.example.com/some-endpoint \
  -H "x-api-key: ak_eyJ1IjoidXNlci0xMjMi..."
```

The Lambda authorizer will:
1. Check for JWT token in `Authorization` header first
2. If no JWT token, check for `x-api-key` header
3. Decode the key to extract user/key IDs
4. Perform direct DynamoDB lookup
5. Validate key hash and status
6. Return user context to downstream functions

This prioritizes JWT tokens for user-facing operations while providing API key fallback for programmatic access.

## Usage Examples

### Create API Key with cURL
```bash
curl -X POST https://api.example.com/api-keys \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Scripts",
    "description": "For automated deployment scripts",
    "expiresAt": "2024-12-31T23:59:59Z"
  }'
```

### List API Keys
```bash
curl -X GET https://api.example.com/api-keys \
  -H "Authorization: Bearer <jwt-token>"
```

### Delete API Key
```bash
curl -X DELETE https://api.example.com/api-keys/a1b2c3d4e5f6 \
  -H "Authorization: Bearer <jwt-token>"
```

## Best Practices

1. **Store Keys Securely**: Save API key values in secure storage immediately after creation
2. **Use Descriptive Names**: Help identify the purpose of each key
3. **Set Expiration Dates**: Use expiration for temporary or time-limited access
4. **Monitor Usage**: Check `lastUsed` and `usageCount` for unused keys
5. **Rotate Regularly**: Delete old keys and create new ones periodically
6. **Limit Scope**: Create separate keys for different applications or purposes
