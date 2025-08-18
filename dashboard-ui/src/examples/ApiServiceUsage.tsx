import { useEffect } from 'react';
import { useApiCall, useApiCallGroup } from '@/hooks/useApiCall';
import { profileService, apiKeyService, dashboardService } from '@/services';
import { getUserFriendlyErrorMessage } from '@/utils/errorHandling';

/**
 * Example component demonstrating how to use the API services with loading states
 */
export function ApiServiceUsageExample() {
  // Single API call example - Profile
  const {
    data: profile,
    isLoading: profileLoading,
    error: profileError,
    execute: loadProfile,
    reset: resetProfile,
  } = useApiCall(profileService.getProfile, {
    onSuccess: (data) => {
      console.log('Profile loaded successfully:', data);
    },
    onError: (error) => {
      console.error('Failed to load profile:', error);
    },
  });

  // Single API call example - API Keys
  const {
    data: apiKeys,
    isLoading: apiKeysLoading,
    error: apiKeysError,
    execute: loadApiKeys,
  } = useApiCall(apiKeyService.listApiKeys);

  // Single API call example - Dashboard
  const {
    data: dashboard,
    isLoading: dashboardLoading,
    error: dashboardError,
    execute: loadDashboard,
  } = useApiCall(dashboardService.getDashboardData);

  // Multiple API calls example
  const {
    isLoading: groupLoading,
    errors: groupErrors,
    executeGroup,
    clearError,
    hasErrors,
  } = useApiCallGroup();

  // Load all data at once
  const loadAllData = async () => {
    const results = await executeGroup([
      {
        key: 'profile',
        apiFunction: () => profileService.getProfile(),
        onSuccess: (data) => console.log('Profile loaded:', data),
        onError: (error) => console.error('Profile error:', error),
      },
      {
        key: 'apiKeys',
        apiFunction: () => apiKeyService.listApiKeys(),
        onSuccess: (data) => console.log('API keys loaded:', data),
        onError: (error) => console.error('API keys error:', error),
      },
      {
        key: 'dashboard',
        apiFunction: () => dashboardService.getDashboardData(),
        onSuccess: (data) => console.log('Dashboard loaded:', data),
        onError: (error) => console.error('Dashboard error:', error),
      },
    ]);

    console.log('All results:', results);
  };

  // Profile update example with error handling
  const updateProfile = async (data: { firstName: string; lastName: string }) => {
    try {
      const response = await profileService.updateProfile(data);

      if (response.success) {
        console.log('Profile updated successfully:', response.data);
        // Reload profile to get updated data
        await loadProfile();
      } else {
        const errorMessage = getUserFriendlyErrorMessage(response.error, 'profile');
        console.error('Profile update failed:', errorMessage);
      }
    } catch (error) {
      const errorMessage = getUserFriendlyErrorMessage(error, 'profile');
      console.error('Profile update error:', errorMessage);
    }
  };

  // API key creation example
  const createApiKey = async (name: string, description?: string) => {
    try {
      const response = await apiKeyService.createApiKey({ name, description });

      if (response.success && response.data) {
        console.log('API key created:', response.data);
        // Show the key value to user (only time it's visible)
        alert(`API Key created: ${response.data.value}`);
        // Reload API keys list
        await loadApiKeys();
      } else {
        const errorMessage = getUserFriendlyErrorMessage(response.error, 'apikey');
        console.error('API key creation failed:', errorMessage);
      }
    } catch (error) {
      const errorMessage = getUserFriendlyErrorMessage(error, 'apikey');
      console.error('API key creation error:', errorMessage);
    }
  };

  // Brand photo upload example
  const uploadBrandPhoto = async (file: File) => {
    try {
      const response = await profileService.uploadBrandPhoto(file);

      if (response.success && response.data) {
        console.log('Brand photo uploaded:', response.data);
        // Reload profile to show updated photo
        await loadProfile();
      } else {
        const errorMessage = getUserFriendlyErrorMessage(response.error, 'upload');
        console.error('Brand photo upload failed:', errorMessage);
      }
    } catch (error) {
      const errorMessage = getUserFriendlyErrorMessage(error, 'upload');
      console.error('Brand photo upload error:', errorMessage);
    }
  };

  // Load initial data
  useEffect(() => {
    loadProfile();
    loadApiKeys();
    loadDashboard();
  }, []);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">API Service Usage Examples</h1>

      {/* Individual Loading States */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Profile Section */}
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-2">Profile</h2>
          {profileLoading && <p className="text-blue-600">Loading profile...</p>}
          {profileError && (
            <div className="text-red-600">
              <p>Error: {profileError}</p>
              <button
                onClick={() => loadProfile()}
                className="mt-2 px-3 py-1 bg-red-100 text-red-700 rounded text-sm"
              >
                Retry
              </button>
            </div>
          )}
          {profile && (
            <div className="space-y-2">
              <p><strong>Email:</strong> {profile.email}</p>
              <p><strong>Name:</strong> {profile.profile.firstName} {profile.profile.lastName}</p>
              <p><strong>Brand:</strong> {profile.brand.brandName || 'Not set'}</p>
              <button
                onClick={() => updateProfile({ firstName: 'John', lastName: 'Updated' })}
                className="mt-2 px-3 py-1 bg-blue-100 text-blue-700 rounded text-sm"
              >
                Update Profile
              </button>
            </div>
          )}
        </div>

        {/* API Keys Section */}
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-2">API Keys</h2>
          {apiKeysLoading && <p className="text-blue-600">Loading API keys...</p>}
          {apiKeysError && (
            <div className="text-red-600">
              <p>Error: {apiKeysError}</p>
              <button
                onClick={() => loadApiKeys()}
                className="mt-2 px-3 py-1 bg-red-100 text-red-700 rounded text-sm"
              >
                Retry
              </button>
            </div>
          )}
          {apiKeys && (
            <div className="space-y-2">
              <p><strong>Total Keys:</strong> {apiKeys.count}</p>
              {apiKeys.apiKeys.map((key) => (
                <div key={key.keyId} className="text-sm">
                  <p><strong>{key.name}</strong></p>
                  <p>Status: {key.status}</p>
                  <p>Usage: {key.usageCount}</p>
                </div>
              ))}
              <button
                onClick={() => createApiKey('Test Key', 'Created from example')}
                className="mt-2 px-3 py-1 bg-green-100 text-green-700 rounded text-sm"
              >
                Create API Key
              </button>
            </div>
          )}
        </div>

        {/* Dashboard Section */}
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-2">Dashboard</h2>
          {dashboardLoading && <p className="text-blue-600">Loading dashboard...</p>}
          {dashboardError && (
            <div className="text-red-600">
              <p>Error: {dashboardError}</p>
              <button
                onClick={() => loadDashboard()}
                className="mt-2 px-3 py-1 bg-red-100 text-red-700 rounded text-sm"
              >
                Retry
              </button>
            </div>
          )}
          {dashboard && (
            <div className="space-y-2">
              <p><strong>Subscribers:</strong> {dashboardService.formatMetrics(dashboard).totalSubscribers}</p>
              <p><strong>Recent Issues:</strong> {dashboard.tenant.totalIssues}</p>
              <p><strong>Open Rate:</strong> {dashboardService.formatMetrics(dashboard).openRate}</p>
              <p><strong>Click Rate:</strong> {dashboardService.formatMetrics(dashboard).clickRate}</p>
              <div className="mt-2">
                {dashboardService.calculateEngagementScore(dashboard.performanceOverview.avgOpenRate, dashboard.performanceOverview.avgClickRate).score}% engagement
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Group Loading Example */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h2 className="text-lg font-semibold mb-2">Group Loading Example</h2>
        <div className="flex gap-4 items-center">
          <button
            onClick={loadAllData}
            disabled={groupLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          >
            {groupLoading ? 'Loading All Data...' : 'Load All Data'}
          </button>

          {hasErrors && (
            <div className="text-red-600">
              <p>Some requests failed:</p>
              {Object.entries(groupErrors).map(([key, error]) => (
                <div key={key} className="text-sm">
                  <span className="font-medium">{key}:</span> {error}
                  <button
                    onClick={() => clearError(key)}
                    className="ml-2 text-xs underline"
                  >
                    Clear
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* File Upload Example */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h2 className="text-lg font-semibold mb-2">File Upload Example</h2>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              uploadBrandPhoto(file);
            }
          }}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
      </div>

      {/* Reset Example */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h2 className="text-lg font-semibold mb-2">Reset State Example</h2>
        <button
          onClick={() => {
            resetProfile();
            console.log('Profile state reset');
          }}
          className="px-4 py-2 bg-gray-600 text-white rounded"
        >
          Reset Profile State
        </button>
      </div>
    </div>
  );
}
