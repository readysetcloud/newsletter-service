# My Profile API

The My Profile API provides separate endpoints for managing brand details and personal information, with emphasis on brand-focused operations.

## Endpoints

### Get Complete Profile
```
GET /me
```

### Update Brand Details (Primary)
```
PUT /me/brand
```

### Update Personal Profile (Secondary)
```
PUT /me/profile
```

## Authentication

This endpoint requires authentication via Cognito JWT token. The user ID is automatically extracted from the Lambda authorizer context.

## Request Bodies

### Brand Update (`PUT /me/brand`)
Focus on brand and business details - most frequently used endpoint.

```json
{
  "brandName": "Acme Newsletter",
  "company": "Acme Corp",
  "website": "https://acme.com",
  "industry": "Technology",
  "brandDescription": "Weekly insights on tech trends and innovations",
  "brandLogo": "https://acme.com/logo.png"
}
```

### Personal Profile Update (`PUT /me/profile`)
Focus on personal details and preferences - less frequently updated.

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "jobTitle": "Content Director",
  "phoneNumber": "+1-555-123-4567",
  "timezone": "America/New_York",
  "locale": "en-US"
}
```

### Field Validation

#### Brand & Business Details (Primary Focus)
- **brandName**: String, max 100 characters - Brand or business name
- **company**: String, max 100 characters - Legal company name
- **website**: String, max 200 characters - Must be valid HTTP/HTTPS URL
- **industry**: String, max 100 characters - Industry or business category
- **brandDescription**: String, max 500 characters - Brand description or mission
- **brandLogo**: String, max 500 characters - Must be valid HTTP/HTTPS URL

#### Personal Details (Secondary)
- **firstName**: String, max 50 characters
- **lastName**: String, max 50 characters
- **jobTitle**: String, max 100 characters - User's role or position
- **phoneNumber**: String, max 20 characters, must contain only digits, spaces, hyphens, parentheses, and plus signs

#### Preferences
- **timezone**: String, max 50 characters (e.g., "America/New_York")
- **locale**: String, max 10 characters, must be in format "en" or "en-US"

## Response

### Success (200)

```json
{
  "message": "Profile updated successfully",
  "profile": {
    "userId": "user-uuid",
    "email": "user@example.com",
    "brandName": "Acme Newsletter",
    "company": "Acme Corp",
    "website": "https://acme.com",
    "industry": "Technology",
    "brandDescription": "Weekly insights on tech trends and innovations",
    "brandLogo": "https://acme.com/logo.png",
    "firstName": "John",
    "lastName": "Doe",
    "jobTitle": "Content Director",
    "phoneNumber": "+1-555-123-4567",
    "timezone": "America/New_York",
    "locale": "en-US",
    "profileUpdatedAt": "2024-01-15T10:30:00.000Z",
    "lastModified": "2024-01-15T10:30:00.000Z"
  }
}
```

### Error Responses

#### 400 Bad Request
```json
{
  "message": "Validation error: firstName must be a string with max 50 characters"
}
```

#### 403 Forbidden
```json
{
  "message": "Authentication required"
}
```

#### 404 Not Found
```json
{
  "message": "User not found"
}
```

#### 500 Internal Server Error
```json
{
  "message": "Failed to update profile"
}
```

## Cognito Attribute Mapping

The function maps request fields to Cognito User Pool attributes:

| Request Field | Cognito Attribute | Type |
|---------------|-------------------|------|
| brandName | custom:brand_name | Custom |
| company | custom:company | Custom |
| website | website | Standard |
| industry | custom:industry | Custom |
| brandDescription | custom:brand_description | Custom |
| brandLogo | custom:brand_logo | Custom |
| firstName | given_name | Standard |
| lastName | family_name | Standard |
| jobTitle | custom:job_title | Custom |
| phoneNumber | phone_number | Standard |
| timezone | zoneinfo | Standard |
| locale | locale | Standard |
| - | custom:profile_updated_at | Custom (auto-set) |

## Usage Examples

### Update brand details
```bash
curl -X PUT https://api.example.com/me \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "brandName": "Tech Weekly",
    "brandDescription": "Your weekly dose of tech insights",
    "website": "https://techweekly.com",
    "industry": "Technology Media"
  }'
```

### Update personal info
```bash
curl -X PUT https://api.example.com/me \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Jane",
    "lastName": "Smith",
    "jobTitle": "Chief Editor"
  }'
```

### Update preferences
```bash
curl -X PUT https://api.example.com/me \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "timezone": "America/Los_Angeles",
    "locale": "en-US"
  }'
```

## Security Notes

- Users can only update their own profile (user ID extracted from JWT)
- All input is validated and sanitized
- Phone numbers are validated for basic format
- Locale codes are validated against standard format
- Profile update timestamp is automatically maintained
- The function uses AdminUpdateUserAttributes for secure updates
