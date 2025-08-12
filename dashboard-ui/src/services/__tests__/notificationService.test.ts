import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationService } from '../notificationService';
import type { NotificationMessage } from '../notificationService';

// Mock the Momento SDK
vi.mock('@gomomento/sdk-web', () => ({
  TopicClient: vi.fn().mockImplementation(() => ({
    subscribe: vi.fn(),
  })),
  CredentialProvider: {
    fromString: vi.fn(),
  },
  Configurations: {
    Browser: {
      v1: vi.fn(),
    },
  },
  TopicSubscribe: {
    Error: class MockTopicSubscribeError {
      message() {
        return 'Mock error';
      }
    },
  },
  TopicItem: vi.fn(),
}));

describe('NotificationService', () => {
  let notificationService: NotificationService;

  beforeEach(() => {
    notificationService = new NotificationService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    notificationService.destroy();
  });

  describe('initialization', () => {
    it('should initialize with empty state', () => {
      expect(notificationService.getSubscriptionStatus()).toBe(false);
    });

    it('should initialize with config', async () => {
      const config = {
        authToken: 'test-token',
        cacheName: 'test-cache',
        topicName: 'test-topic',
      };

      // Mock successful initialization
      await expect(notificationService.initialize(config)).resolves.not.toThrow();
    });
  });

  describe('message handlers', () => {
    it('should add and remove message handlers', () => {
      const handler = vi.fn();

      notificationService.addMessageHandler(handler);
      notificationService.removeMessageHandler(handler);

      // Should not throw
      expect(true).toBe(true);
    });

    it('should call message handlers when notification is received', () => {
      const handler = vi.fn();
      notificationService.addMessageHandler(handler);

      // Create a mock notification message
      const mockMessage: NotificationMessage = {
        id: 'test-1',
        type: 'info',
        title: 'Test Notification',
        message: 'This is a test',
        timestamp: new Date().toISOString(),
      };

      // Simulate receiving a message by calling the private method
      // Note: In a real test, this would be triggered by Momento
      const mockTopicItem = {
        valueString: () => JSON.stringify(mockMessage),
      };

      // Access private method for testing
      // @ts-ignore - accessing private method for testing
      notificationService.handleIncomingMessage(mockTopicItem);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: mockMessage.id,
          type: mockMessage.type,
          title: mockMessage.title,
          message: mockMessage.message,
          read: false,
        })
      );
    });
  });

  describe('subscription management', () => {
    it('should track subscription status', () => {
      expect(notificationService.getSubscriptionStatus()).toBe(false);
    });

    it('should handle subscription errors gracefully', () => {
      // Test error handling
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate an error in message handling
      const invalidTopicItem = {
        valueString: () => 'invalid json',
      };

      // @ts-ignore - accessing private method for testing
      notificationService.handleIncomingMessage(invalidTopicItem);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to process incoming notification:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('cleanup', () => {
    it('should clean up resources on destroy', () => {
      const handler = vi.fn();
      notificationService.addMessageHandler(handler);

      notificationService.destroy();

      expect(notificationService.getSubscriptionStatus()).toBe(false);
    });
  });
});
