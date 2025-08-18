import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { profileService } from '../profileService';
import { apiKeyService } from '../apiKeyService';
import { dashboardService } from '../dashboardService';

// Mock the API client
vi.mock('../api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock AWS Amplify
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: {
      accessToken: {
        toString: () => 'mock-access-token',
      },
      idToken: {
        toString: () => 'mock-id-token',
      },
    },
  }),
}));

// Mock fetch for file uploads
global.fetch = vi.fn();

describe('API Services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ProfileService', () => {
    it('should get user profile', async () => {
      const mockProfile = {
        userId: 'user-123',
        email: 'test@example.com',
        brand: { brandName: 'Test Brand' },
        profile: { firstName: 'John', lastName: 'Doe' },
        preferences: { timezone: 'UTC' },
        lastModified: '2024-01-01T00:00:00Z',
      };

      const { apiClient } = await import('../api');
      vi.mocked(apiClient.get).mockResolvedValue({
        success: true,
        data: mockProfile,
      });

      const result = await profileService.getProfile();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockProfile);
      expect(apiClient.get).toHaveBeenCalledWith('/me');
    });

    it('should update profile', async () => {
      const updateData = {
        firstName: 'Jane',
        lastName: 'Smith',
      };

      const mockResponse = {
        message: 'Profile updated successfully',
        profile: updateData,
      };

      const { apiClient } = await import('../api');
      vi.mocked(apiClient.put).mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await profileService.updateProfile(updateData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(apiClient.put).toHaveBeenCalledWith('/me/profile', updateData);
    });

    it('should update brand', async () => {
      const brandData = {
        brandName: 'New Brand',
        website: 'https://example.com',
      };

      const mockResponse = {
        message: 'Brand updated successfully',
        brand: brandData,
      };

      const { apiClient } = await import('../api');
      vi.mocked(apiClient.put).mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await profileService.updateBrand(brandData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(apiClient.put).toHaveBeenCalledWith('/me/brand', brandData);
    });

    it('should handle brand photo upload', async () => {
      const mockFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      const mockUploadResponse = {
        uploadUrl: 'https://s3.amazonaws.com/upload-url',
        publicUrl: 'https://s3.amazonaws.com/public-url',
      };

      const { apiClient } = await import('../api');

      // Mock presigned URL generation
      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: mockUploadResponse,
      });

      // Mock S3 upload
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

      // Mock confirmation
      vi.mocked(apiClient.put).mockResolvedValue({
        success: true,
        data: { message: 'Upload confirmed' },
      });

      const result = await profileService.uploadBrandPhoto(mockFile);

      expect(result.success).toBe(true);
      expect(result.data).toBe(mockUploadResponse.publicUrl);
      expect(apiClient.post).toHaveBeenCalledWith('/brand/logo', {
        fileName: 'test.jpg',
        contentType: 'image/jpeg',
      });
      expect(fetch).toHaveBeenCalledWith(mockUploadResponse.uploadUrl, {
        method: 'PUT',
        body: mockFile,
        headers: { 'Content-Type': 'image/jpeg' },
      });
      expect(apiClient.put).toHaveBeenCalledWith('/brand/logo', {
        photoUrl: mockUploadResponse.publicUrl,
      });
    });
  });

  describe('ApiKeyService', () => {
    it('should create API key', async () => {
      const createRequest = {
        name: 'Test Key',
        description: 'Test description',
      };

      const mockResponse = {
        message: 'API key created',
        apiKey: {
          keyId: 'key-123',
          name: 'Test Key',
          keyValue: 'sk-test-123456789',
          createdAt: '2024-01-01T00:00:00Z',
          status: 'active',
          usageCount: 0,
        },
      };

      const { apiClient } = await import('../api');
      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await apiKeyService.createApiKey(createRequest);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(apiClient.post).toHaveBeenCalledWith('/api-keys', createRequest);
    });

    it('should list API keys', async () => {
      const mockResponse = {
        apiKeys: [
          {
            keyId: 'key-123',
            name: 'Test Key',
            keyValue: '***hidden***',
            createdAt: '2024-01-01T00:00:00Z',
            status: 'active',
            usageCount: 5,
          },
        ],
        count: 1,
      };

      const { apiClient } = await import('../api');
      vi.mocked(apiClient.get).mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await apiKeyService.listApiKeys();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(apiClient.get).toHaveBeenCalledWith('/api-keys');
    });

    it('should delete API key', async () => {
      const keyId = 'key-123';
      const mockResponse = {
        message: 'API key deleted',
        keyId,
      };

      const { apiClient } = await import('../api');
      vi.mocked(apiClient.delete).mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await apiKeyService.deleteApiKey(keyId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(apiClient.delete).toHaveBeenCalledWith(`/api-keys/${keyId}`);
    });

    it('should revoke API key', async () => {
      const keyId = 'key-123';
      const mockResponse = {
        message: 'API key revoked',
        keyId,
        status: 'revoked',
        revokedAt: '2024-01-01T00:00:00Z',
      };

      const { apiClient } = await import('../api');
      vi.mocked(apiClient.delete).mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await apiKeyService.revokeApiKey(keyId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(apiClient.delete).toHaveBeenCalledWith(`/api-keys/${keyId}?revoke=true`);
    });

    it('should check if API key is expired', () => {
      const expiredKey = {
        keyId: 'key-123',
        name: 'Test Key',
        createdAt: '2024-01-01T00:00:00Z',
        status: 'active' as const,
        usageCount: 0,
        expiresAt: '2023-12-31T23:59:59Z', // Past date
      };

      const activeKey = {
        keyId: 'key-456',
        name: 'Active Key',
        createdAt: '2024-01-01T00:00:00Z',
        status: 'active' as const,
        usageCount: 0,
        expiresAt: '2025-12-31T23:59:59Z', // Future date
      };

      const noExpiryKey = {
        keyId: 'key-789',
        name: 'No Expiry Key',
        createdAt: '2024-01-01T00:00:00Z',
        status: 'active' as const,
        usageCount: 0,
      };

      expect(apiKeyService.isApiKeyExpired(expiredKey)).toBe(true);
      expect(apiKeyService.isApiKeyExpired(activeKey)).toBe(false);
      expect(apiKeyService.isApiKeyExpired(noExpiryKey)).toBe(false);
    });

    it('should format API key for display', () => {
      const longKey = 'sk-test-1234567890abcdef';
      const shortKey = 'short';
      const hiddenKey = '***hidden***';

      expect(apiKeyService.formatApiKeyForDisplay(longKey)).toBe('sk-test-...cdef');
      expect(apiKeyService.formatApiKeyForDisplay(shortKey)).toBe('***hidden***');
      expect(apiKeyService.formatApiKeyForDisplay(hiddenKey)).toBe('***hidden***');
    });
  });

  describe('DashboardService', () => {
    it('should get dashboard data', async () => {
      const mockDashboard = {
        totalSubscribers: 1500,
        recentIssues: 12,
        openRate: 0.25,
        clickRate: 0.05,
        recentActivity: [
          {
            id: 'activity-1',
            type: 'issue_sent',
            title: 'Newsletter sent',
            description: 'Weekly newsletter sent to subscribers',
            timestamp: '2024-01-01T00:00:00Z',
          },
        ],
      };

      const { apiClient } = await import('../api');
      vi.mocked(apiClient.get).mockResolvedValue({
        success: true,
        data: mockDashboard,
      });

      const result = await dashboardService.getDashboardData();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockDashboard);
      expect(apiClient.get).toHaveBeenCalledWith('/dashboard?timeframe=30d');
    });

    it('should format metrics correctly', () => {
      const mockData = {
        tenant: {
          name: 'Test Newsletter',
          subscribers: 1500,
          totalIssues: 12
        },
        issues: [],
        subscriberMetrics: {
          current: 1500,
          growth: { '7d': 10, '30d': 50, '90d': 150 },
          churnRate: 2.5,
          engagementRate: 35.0
        },
        performanceOverview: {
          avgOpenRate: 25.0,
          avgClickRate: 5.0,
          avgBounceRate: 2.0,
          totalSent: 18000,
          bestPerformingIssue: null
        },
        timeframe: '30d'
      };

      const formatted = dashboardService.formatMetrics(mockData);

      expect(formatted.totalSubscribers).toBe('1.5K');
      expect(formatted.recentIssues).toBe('12');
      expect(formatted.openRate).toBe('25.0%');
      expect(formatted.clickRate).toBe('5.0%');
    });

    it('should calculate engagement score', () => {
      const score1 = dashboardService.calculateEngagementScore(0.3, 0.1);
      expect(score1.score).toBe(24); // (0.3 * 0.7 + 0.1 * 0.3) * 100 = 24
      expect(score1.level).toBe('low');

      const score2 = dashboardService.calculateEngagementScore(0.6, 0.2);
      expect(score2.score).toBe(48); // (0.6 * 0.7 + 0.2 * 0.3) * 100 = 48
      expect(score2.level).toBe('medium');

      const score3 = dashboardService.calculateEngagementScore(0.8, 0.3);
      expect(score3.score).toBe(65); // (0.8 * 0.7 + 0.3 * 0.3) * 100 = 65
      expect(score3.level).toBe('high');

      const score4 = dashboardService.calculateEngagementScore(0.9, 0.4);
      expect(score4.score).toBe(75); // (0.9 * 0.7 + 0.4 * 0.3) * 100 = 75
      expect(score4.level).toBe('high');
    });

    it('should get activity type info', () => {
      const issueSent = dashboardService.getActivityTypeInfo('issue_sent');
      expect(issueSent.label).toBe('Issue Sent');
      expect(issueSent.icon).toBe('📧');

      const unknown = dashboardService.getActivityTypeInfo('unknown_type');
      expect(unknown.label).toBe('Activity');
      expect(unknown.icon).toBe('📝');
    });
  });
});
