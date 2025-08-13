import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationService } from '../notificationService';
import * as jwtUtils from '../../utils/jwtUtils';

// Mock the Momento SDK
vi.mock('@gomomento/sdk-web', () => ({
  TopicClient: vi.fn().mockImplementation(() => ({
    subscribe: vi.fn()
  })),
  CredentialProvider: {
    fromString: vi.fn()
  },
  Configurations: {
    Browser: {
      v1: vi.fn()
    }
  },
  TopicSubscribe: {
    Error: class MockError {
      message() { return 'Mock error'; }
    }
  }
}));

// Mock JWT utilities
vi.mock('../../utils/jwtUtils', () => ({
  extractMomentoTokenFromJWT: vi.fn(),
  validateMomentoTokenInfo: vi.fn(),
  extractTenantIdFromJWT: vi.fn()
}));

describe('NotificationService', () => {
  let service: NotificationService;
  const mockConfig = {
    jwtToken: 'mock-jwt-token',
    tenantId: 'test-tenant',
    userId: 'test-user'
  };

  const mockMomentoTokenInfo = {
    token: 'mock-momento-token',
    cacheName: 'test-cache',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    isValid: true,
    isExpired: false
  };

  beforeEach(() => {
    service = new NotificationService();
    vi.clearAllMocks();

    // Setup default mocks
    vi.mocked(jwtUtils.extractMomentoTokenFromJWT).mockReturnValue(mockMomentoTokenInfo);
    vi.mocked(jwtUtils.validateMomentoTokenInfo).mockReturnValue({
      isValid: true,
      errors: []
    });
  });

  afterEach(() => {
    service.destroy();
  });

  describe('initialize', () => {
    it('should initialize successfully with valid JWT token', async () => {
      await expect(service.initialize(mockConfig)).resolves.not.toThrow();
    });

    it('should throw error when no Momento token found in JWT', async () => {
      vi.mocked(jwtUtils.extractMomentoTokenFromJWT).mockReturnValue(null);

      await expect(service.initialize(mockConfig)).rejects.toThrow('No Momento token found in JWT');
    });

    it('should throw error when Momento token is invalid', async () => {
      vi.mocked(jwtUtils.validateMomentoTokenInfo).mockReturnValue({
        isValid: false,
        errors: ['Token expired', 'Invalid format']
      });

      await expect(service.initialize(mockConfig)).rejects.toThrow('Invalid Momento token: Token expired, Invalid format');
    });
  });

  describe('subscribe', () => {
    beforeEach(async () => {
      await service.initialize(mockConfig);
    });

    it('should throw error when not initialized', async () => {
      const uninitializedService = new NotificationService();
      await expect(uninitializedService.subscribe()).rejects.toThrow('NotificationService not initialized');
    });

    it('should not subscribe twice', async () => {
      // Mock successful subscription
      const mockSubscribe = vi.fn().mockResolvedValue({ unsubscribe: vi.fn() });
      (service as any).topicClient = { subscribe: mockSubscribe };

      await service.subscribe();
      await service.subscribe(); // Second call should not subscribe again

      expect(mockSubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('message handling', () => {
    beforeEach(async () => {
      await service.initialize(mockConfig);
    });

    it('should add and remove message handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      service.addMessageHandler(handler1);
      service.addMessageHandler(handler2);

      // Simulate incoming message
      const mockItem = {
        valueString: () => JSON.stringify({
          id: 'test-1',
          type: 'info',
          title: 'Test',
          message: 'Test message',
          timestamp: new Date().toISOString()
        })
      };

      (service as any).handleIncomingMessage(mockItem);

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();

      service.removeMessageHandler(handler1);

      (service as any).handleIncomingMessage(mockItem);

      expect(handler1).toHaveBeenCalledTimes(1); // Should not be called again
      expect(handler2).toHaveBeenCalledTimes(2); // Should be called again
    });

    it('should handle malformed messages gracefully', () => {
      const handler = vi.fn();
      service.addMessageHandler(handler);

      const mockItem = {
        valueString: () => 'invalid-json'
      };

      expect(() => {
        (service as any).handleIncomingMessage(mockItem);
      }).not.toThrow();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('connection status', () => {
    beforeEach(async () => {
      await service.initialize(mockConfig);
    });

    it('should return correct connection status', () => {
      const status = service.getConnectionStatus();

      expect(status).toEqual({
        isSubscribed: false,
        isTokenExpired: false,
        reconnectAttempts: 0,
        tenantId: 'test-tenant'
      });
    });

    it('should detect expired tokens', () => {
      // Mock expired token
      const expiredTokenInfo = {
        ...mockMomentoTokenInfo,
        isExpired: true
      };
      (service as any).momentoTokenInfo = expiredTokenInfo;

      const status = service.getConnectionStatus();
      expect(status.isTokenExpired).toBe(true);
    });
  });

  describe('token refresh', () => {
    beforeEach(async () => {
      await service.initialize(mockConfig);
    });

    it('should refresh token successfully', async () => {
      const newJwtToken = 'new-jwt-token';
      const newMomentoTokenInfo = {
        ...mockMomentoTokenInfo,
        token: 'new-momento-token'
      };

      vi.mocked(jwtUtils.extractMomentoTokenFromJWT).mockReturnValue(newMomentoTokenInfo);

      await expect(service.refreshToken(newJwtToken)).resolves.not.toThrow();
    });

    it('should throw error when refreshing uninitialized service', async () => {
      const uninitializedService = new NotificationService();
      await expect(uninitializedService.refreshToken('new-token')).rejects.toThrow('Service not initialized');
    });
  });

  describe('cleanup', () => {
    it('should clean up resources on destroy', async () => {
      await service.initialize(mockConfig);

      const handler = vi.fn();
      service.addMessageHandler(handler);

      service.destroy();

      const status = service.getConnectionStatus();
      expect(status.tenantId).toBeUndefined();
    });
  });
});
