# Aervice Layer

This directory contains the comprehensive API service layer for the Newsletter Admin UI. The service layer provides a clean, type-safe interface for interacting with the backend APIs with built-in error handling, retry logic, and loading state management.

## Architecture

### Core Components

1. **API Client (`api.ts`)** - Centralized HTTP client with authentication and error handling
2. **Service Classes** - Domain-specific service classes for different API endpoints
3. **Error Handling (`utils/errorHandling.ts`)** - Comprehensive error parsing and user-friendly messages
4. **Loading State Management (`hooks/useApiCall.ts`)** - React hooks for managing API call states

### Service Classes

- **ProfileService** - User profile and brand management
- **ApiKeyService** - API key creation, listing, and management
- **DashboardService** - Dashboard data and metrics

## Features

### ✅ Authentication Integration
- Automatic JWT token injection from AWS Amplify
- Token refresh handling
- Authentication error detection and handling

### ✅ Comprehensive Error Handling
- Network error detection and retry logic
- HTTP status code parsing with user-friendly messages
- Validation error extraction
- Server error handling with appropriate retry strategies

### ✅ Retry Logic with Exponential Backoff
- Configurable retry attempts (default: 3)
- Exponential backoff with jitter
- Smart retry logic based on error type
- Maximum retry delay cap (30 seconds)

### ✅ Loading State Management
- React hooks for individual API calls
- Group API call management
- Optimistic UI updates
- Loading, error, and success states

### ✅ Type Safety
- Full TypeScript support
- Strongly typed API responses
- Type-safe service methods
- Comprehensive type definitions

## Usage Examples

### Basic API Call with Loading States

```typescript
import { useApiCall } from '@/hooks/useApiCall';
import { profileService } from '@/services';

function ProfileComponent() {
  const {
    data: profile,
    isLoading,
    error,
    execute: loadProfile,
    reset,
  } = useApiCall(profileService.getProfile, {
    onSuccess: (data) => console.log('Profile loaded:', data),
    onError: (error) => console.error('Failed to load profile:', error),
  });

  useEffect(() => {
    loadProfile();
  }, []);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!profile) return <div>No profile data</div>;

  return (
    <div>
      <h1>{profile.profile.firstName} {profile.profile.lastName}</h1>
      <p>{profile.email}</p>
      <button onClick={() => loadProfile()}>Refresh</button>
      <button onClick={reset}>Reset</button>
    </div>
  );
}
```

### Multiple API Calls

```typescript
import { useApiCallGroup } from '@/hooks/useApiCall';
import { profileService, apiKeyService, dashboardService } from '@/services';

function DashboardComponent() {
  const { isLoading, errors, executeGroup, hasErrors } = useApiCallGroup();

  const loadAllData = async () => {
    const results = await executeGroup([
      {
        key: 'profile',
        apiFunction: () => profileService.getProfile(),
      },
      {
        key: 'apiKeys',
        apiFunction: () => apiKeyService.listApiKeys(),
      },
      {
        key: 'dashboard',
        apiFunction: () => dashboardService.getDashboardData(),
      },
    ]);

    console.log('All data loaded:', results);
  };

  return (
    <div>
      <button onClick={loadAllData} disabled={isLoading}>
        {isLoading ? 'Loading...' : 'Load All Data'}
      </button>
      {hasErrors && (
        <div>
          {Object.entries(errors).map(([key, error]) => (
            <p key={key}>Error loading {key}: {error}</p>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Profile Management

```typescript
import { profileService } from '@/services';
import { getUserFriendlyErrorMessage } from '@/utils/errorHandling';

// Update profile
const updateProfile = async (data: { firstName: string; lastName: string }) => {
  try {
    const response = await profileService.updateProfile(data);

    if (response.success) {
      console.log('Profile updated:', response.data);
    } else {
      const errorMessage = getUserFriendlyErrorMessage(response.error, 'profile');
      console.error('Update failed:', errorMessage);
    }
  } catch (error) {
    const errorMessage = getUserFriendlyErrorMessage(error, 'profile');
    console.error('Update error:', errorMessage);
  }
};

// Update brand
const updateBrand = async (data: { brandName: string; website: string }) => {
  const response = await profileService.updateBrand(data);
  // Handle response...
};

// Upload brand photo
const uploadPhoto = async (file: File) => {
  const response = await profileService.uploadBrandPhoto(file);
  if (response.success) {
    console.log('Photo uploaded to:', response.data);
  }
};
```

### API Key Management

```typescript
import { apiKeyService } from '@/services';

// Create API key
const createKey = async () => {
  const response = await apiKeyService.createApiKey({
    name: 'My API Key',
    description: 'For external integrations',
    expiresAt: '2024-12-31T23:59:59Z', // Optional
  });

  if (response.success && response.data) {
    // Show key value to user (only time it's visible)
    alert(`Your API key: ${response.data.apiKey.keyValue}`);
  }
};

// List API keys
const listKeys = async () => {
  const response = await apiKeyService.listApiKeys();
  if (response.success && response.data) {
    console.log('API keys:', response.data.apiKeys);
    console.log('Total count:', response.data.count);
  }
};

// Revoke API key (soft delete)
const revokeKey = async (keyId: string) => {
  const response = await apiKeyService.revokeApiKey(keyId);
  if (response.success) {
    console.log('Key revoked:', response.data);
  }
};

// Delete API key (permanent)
const deleteKey = async (keyId: string) => {
  const response = await apiKeyService.deleteApiKey(keyId);
  if (response.success) {
    console.log('Key deleted:', response.data);
  }
};

// Check key status
const checkKeyStatus = (apiKey: any) => {
  const isExpired = apiKeyService.isApiKeyExpired(apiKey);
  const isActive = apiKeyService.isApiKeyActive(apiKey);

  console.log('Key expired:', isExpired);
  console.log('Key active:', isActive);
};
```

### Dashboard Data

```typescript
import { dashboardService } from '@/services';

// Get dashboard data
const loadDashboard = async () => {
  const response = await dashboardService.getDashboardData();

  if (response.success && response.data) {
    const formatted = dashboardService.formatMetrics(response.data);
    console.log('Formatted metrics:', formatted);

    const engagement = dashboardService.calculateEngagementScore(
      response.data.openRate,
      response.data.clickRate
    );
    console.log('Engagement score:', engagement);
  }
};

// Refresh dashboard (with cache busting)
const refreshDashboard = async () => {
  const response = await dashboardService.refreshDashboardData();
  // Handle response...
};
```

## Error Handling

The service layer includes comprehensive error handling with user-friendly messages:

```typescript
itUserFriendlyErrorMessage, parseApiError } from '@/utils/errorHandling';

// Get user-friendly error message
const handleError = (error: any, context?: string) => {
  const message = getUserFriendlyErrorMessage(error, context);
  console.error('User-friendly error:', message);
};

// Parse error details
const parseError = (error: any) => {
  const errorInfo = parseApiError(error);
  console.log('Error type:', errorInfo.type);
  console.log('Retryable:', errorInfo.retryable);
  console.log('User message:', errorInfo.userFriendly);
};
```

## Configuration

### API Client Configuration

```typescript
// Default configuration in api.ts
const DEFAULT_CONFIG: ApiClientConfig = {
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api',
  timeout: 10000,
  retries: 3,
  retryDelay: 1000,
};

// Custom configuration
const customApiClient = new ApiClient({
  baseURL: 'https://api.example.com',
  timeout: 15000,
  retries: 5,
  retryDelay: 2000,
});
```

### Environment Variables

```env
VITE_API_BASE_URL=https://your-api-domain.com/api
```

## Testing

The service layer includes comprehensive tests:

```bash
# Run service tests
npm run test:run -- services/__tests__/apiServices.test.ts

# Run all tests
npm run test

# Run tests with UI
npm run test:ui
```

## File Structure

```
src/services/
├── api.ts                    # Core API client
├── profileService.ts         # Profile and brand management
├── apiKeyService.ts         # API key management
├── dashboardService.ts      # Dashboard data
├── index.ts                 # Service exports
├── __tests__/
│   └── apiServices.test.ts  # Comprehensive tests
└── README.md               # This file

src/hooks/
└── useApiCall.ts           # Loading state management hooks

src/utils/
└── errorHandling.ts        # Error handling utilities

src/examples/
└── ApiServiceUsage.tsx     # Usage examples
```

## Best Practices

1. **Always handle errors** - Use try/catch blocks and check response.success
2. **Use loading states** - Provide feedback to users during API calls
3. **Implement retry logic** - Let the service layer handle retries automatically
4. **Type everything** - Use TypeScript interfaces for all API responses
5. **Context-aware errors** - Provide context when calling error handling utilities
6. **Test thoroughly** - Write tests for both success and error scenarios

## Contributing

When adding new API endpoints:

1. Add the endpoint to the appropriate service class
2. Add TypeScript types for request/response
3. Write comprehensive tests
4. Update this README with usage examples
5. Consider error scenarios and user experience
