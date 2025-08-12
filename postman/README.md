# Newsletter Admin API - Postman Collections

This directory contains comprehensive Postman collections for testing the Newsletter Admin API, covering all authentication flows, profile management, brand management, API key operations, and dashboard endpoints.

## Files

- **`Newsletter-Admin-API.postman_collection.json`** - Comprehensive admin API testing collection with full test coverage
- **`Newsletter-Public-API.postman_collection.json`** - Public API testing collection for subscription, voting, and tracking
- **`Newsletter-Admin-Environment.postman_environment.json`** - Environment variables and configuration for both collections
- **`README.md`** - This documentation file

> **Note**: These collections provide comprehensive test coverage for both admin and public APIs with detailed assertions, error handling, and complete workflow documentation.

## Quick Setup

### 1. Import Collections

1. Open Postman
2. Click **Import** button
3. Select all JSON files:
   - `Newsletter-Admin-API.postman_collection.json`
   - `Newsletter-Public-API.postman_collection.json`
   - `Newsletter-Admin-Environment.postman_environment.json`
4. Click **Import**

### 2. Configure Environment

1. Select the **Newsletter Admin Environment** from the environment dropdown
2. Click the **eye icon** to view/edit environment variables
3. Update the following required variables:

### Admin API Variables
| Variable | Description | Example |
|----------|-------------|---------|
| `api_url` | Your API Gateway base URL | `https://abc123.execute-api.us-east-1.amazonaws.com/dev` |
| `jwt_token` | JWT Bearer token (see Authentication section) | `Bearer eyJhbGciOiJSUzI1NiIs...` |
| `api_key` | API key for testing (optional) | `ak_eyJ1IjoidXNlci0xMjMi...` |

### Public API Variables
| Variable | Description | Example |
|----------|-------------|---------|
| `public_api_url` | Your Public API Gateway base URL | `https://def456.execute-api.us-east-1.amazonaws.com/dev` |
| `tenant_id` | Tenant ID for public API testing | `tenant-123` |
| `issue_slug` | Issue slug for voting/tracking tests | `weekly-update-2024-01` |
| `hashed_email` | Hashed email for unsubscribe testing | `abc123def456...` |

## Authentication Setup

### Method 1: JWT Token Authentication (Recommended)

1. **Configure Login Script**:
   ```bash
   cd scripts
   cp .env.example .env
   # Edit .env with your Cognito configuration
   ```

2. **Get JWT Token**:
   ```bash
   node scripts/login.mjs
   ```
   This will copy the Bearer token to your clipboard.

3. **Set Token in Postman**:
   - Paste the token into the `jwt_token` environment variable
   - The token format should be: `Bearer eyJhbGciOiJSUzI1NiIs...`

### Method 2: API Key Authentication

1. **Create API Key** (requires JWT token first):
   - Run the "Create API Key" request with JWT authentication
   - Copy the returned `keyValue` to the `api_key` environment variable

2. **Test API Key**:
   - Use the "Test API Key Authentication" request

## Collection Structure

### 🔐 Authentication
- **Get JWT Token (Manual)** - Verify JWT token is working
- **Test API Key Authentication** - Test API key authentication

### 👤 Profile Management
- **Get Complete Profile** - Retrieve user's complete profile
- **Update Personal Profile** - Update personal information and preferences
- **Update Profile - Validation Error** - Test validation errors

### 🏢 Brand Management
- **Update Brand Details** - Update brand information
- **Generate Brand Photo Upload URL** - Get presigned S3 upload URL
- **Confirm Brand Photo Upload** - Confirm successful photo upload
- **Brand Update - Validation Error** - Test validation errors

### 🔑 API Key Management
- **Create API Key** - Create new API key (shows key value once)
- **List API Keys** - List all user's API keys (values hidden)
- **Get API Key Details** - Get specific API key details
- **Revoke API Key** - Revoke API key (keeps record)
- **Delete API Key** - Permanently delete API key
- **Create API Key - Validation Error** - Test validation errors
- **Get Non-existent API Key** - Test 404 error handling

### 📊 Dashboard
- **Get Dashboard Data** - Retrieve dashboard metrics and data

### ❌ Error Scenarios
- **Unauthorized Request (No Token)** - Test unauthorized access
- **Invalid JWT Token** - Test invalid token handling
- **Invalid API Key** - Test invalid API key handling

## Public API Collection Structure

### 📧 Subscription Management
- **Add Subscriber** - Add new newsletter subscriber
- **Add Subscriber - Validation Error** - Test validation errors
- **Unsubscribe from Newsletter** - Unsubscribe using hashed email

### 🗳️ Engagement & Voting
- **Submit Vote** - Submit vote for newsletter issue
- **Submit Vote - Invalid Choice** - Test validation errors
- **Submit Vote - Non-existent Issue** - Test 404 error handling

### 📊 Email Tracking
- **Track Email Open** - Track email open events
- **Track Email Open - Non-existent Issue** - Test 404 error handling

### ❌ Error Scenarios
- **Invalid Tenant ID** - Test invalid tenant handling
- **Malformed JSON Request** - Test malformed request handling

## Usage Workflows

### Complete Testing Workflow

1. **Setup Authentication**:
   ```
   Authentication → Get JWT Token (Manual)
   ```

2. **Test Profile Management**:
   ```
   Profile Management → Get Complete Profile
   Profile Management → Update Personal Profile
   ```

3. **Test Brand Management**:
   ```
   Brand Management → Update Brand Details
   Brand Management → Generate Brand Photo Upload URL
   Brand Management → Confirm Brand Photo Upload
   ```

4. **Test API Key Management**:
   ```
   API Key Management → Create API Key
   API Key Management → List API Keys
   API Key Management → Get API Key Details
   API Key Management → Revoke API Key
   ```

5. **Test Dashboard**:
   ```
   Dashboard → Get Dashboard Data
   ```

6. **Test Error Scenarios**:
   ```
   Error Scenarios → [Run all error tests]
   ```

### Public API Testing Workflow

1. **Test Subscription Management**:
   ```
   Subscription Management → Add Subscriber
   Subscription Management → Unsubscribe from Newsletter
   ```

2. **Test Engagement Features**:
   ```
   Engagement & Voting → Submit Vote
   ```

3. **Test Email Tracking**:
   ```
   Email Tracking → Track Email Open
   ```

4. **Test Error Scenarios**:
   ```
   Error Scenarios → [Run all public API error tests]
   ```

### Brand Photo Upload Workflow

The brand photo upload requires a two-step process:

1. **Generate Upload URL**:
   ```
   Brand Management → Generate Brand Photo Upload URL
   ```
   This populates `upload_key`, `upload_url`, and `public_url` variables.

2. **Upload File to S3** (external step):
   ```bash
   curl -X PUT "{{upload_url}}" \
     -H "Content-Type: image/png" \
     --data-binary @your-image.png
   ```

3. **Confirm Upload**:
   ```
   Brand Management → Confirm Brand Photo Upload
   ```

## Environment Variables

### Required Variables
- `api_url` - API Gateway base URL
- `jwt_token` - JWT Bearer token for authentication

### Optional Variables
- `api_key` - API key for API key authentication testing

### Auto-populated Variables
These are automatically set by test scripts:
- `user_id` - Current user ID
- `user_email` - Current user email
- `test_key_id` - Test API key ID
- `test_api_key` - Test API key value
- `upload_key` - S3 upload key
- `upload_url` - Presigned S3 upload URL
- `public_url` - Public URL for uploaded files

## Test Assertions

Each request includes comprehensive test assertions:

### Success Tests
- Status code validation
- Response structure validation
- Data type validation
- Business logic validation

### Error Tests
- Error status code validation
- Error message validation
- Validation error testing

### Example Test Script
```javascript
pm.test('Status code is 200', function () {
    pm.response.to.have.status(200);
});

pm.test('Response has required fields', function () {
    const jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('userId');
    pm.expect(jsonData).to.have.property('email');
});

// Auto-populate environment variables
const jsonData = pm.response.json();
pm.environment.set('user_id', jsonData.userId);
```

## API Endpoints Covered

### Authentication Endpoints
- JWT token validation
- API key authentication

### Profile Endpoints
- `GET /me` - Get complete profile
- `PUT /me/profile` - Update personal profile

### Brand Endpoints
- `PUT /me/brand` - Update brand details
- `POST /brand/logo` - Generate upload URL
- `PUT /brand/logo` - Confirm upload

### API Key Endpoints
- `POST /api-keys` - Create API key
- `GET /api-keys` - List API keys
- `GET /api-keys/{keyId}` - Get API key details
- `DELETE /api-keys/{keyId}` - Delete API key
- `DELETE /api-keys/{keyId}?revoke=true` - Revoke API key

### Dashboard Endpoints
- `GET /dashboard` - Get dashboard data

## Public API Endpoints Covered

### Subscription Endpoints
- `POST /{tenant}/subscribers` - Add new subscriber
- `GET /{tenant}/unsubscribe` - Unsubscribe from newsletter

### Engagement Endpoints
- `POST /{tenant}/{slug}/votes` - Submit vote for issue

### Tracking Endpoints
- `GET /{tenant}/{slug}/opens` - Track email opens

## Troubleshooting

### Common Issues

1. **401/403 Errors**:
   - Verify JWT token is valid and not expired
   - Check token format includes "Bearer " prefix
   - Ensure API key format is correct (starts with "ak_")

2. **Environment Variables Not Set**:
   - Verify environment is selected in Postman
   - Check variable names match exactly
   - Ensure variables are enabled

3. **Token Expired**:
   - Run `node scripts/login.mjs` to get new token
   - Update `jwt_token` environment variable

4. **API Key Not Working**:
   - Create new API key using JWT authentication first
   - Verify API key format and value
   - Check API key hasn't been revoked or expired

### Debug Tips

1. **Check Console**:
   - Open Postman Console (View → Show Postman Console)
   - Review request/response details and test results

2. **Verify Environment**:
   - Click eye icon next to environment dropdown
   - Ensure all required variables are set

3. **Test Authentication First**:
   - Always test "Get JWT Token (Manual)" first
   - Verify profile can be retrieved before testing other endpoints

## Security Notes

- **JWT Tokens**: Tokens are temporary and expire (typically 1 hour)
- **API Keys**: Store securely, only shown once during creation
- **Environment Variables**: Use Postman's secret variable type for sensitive data
- **Testing**: Use separate test environment, not production

## Support

For issues with the API or these collections:

1. Check the API documentation in `docs/` directory
2. Review the OpenAPI specification in `openapi.yaml`
3. Test with the login script in `scripts/login.mjs`
4. Check AWS CloudWatch logs for detailed error information
