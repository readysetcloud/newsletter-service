import { jest } from '@jest/globals';

// Mock AWS SDK
const mockSend = jest.fn();
jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({
    send: mockSend
  })),
  PutItemCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((item) => item)
}));

// Mock Momento SDK
const mockAuthClient = {
  generateDisposableToken: jest.fn()
};

const mockTopicClient = {
  publish: jest.fn()
};

jest.unstable_mockModule('@gomomento/sdk', () => ({
  AuthClient: jest.fn(() => mockAuthClient),
  TopicClient: jest.fn(() => mockTopicClient),
  CredentialProvider: {
    fromString: jest.fn((key) => ({ key }))
  },
  ExpiresIn: {
    hours: jest.fn((hours) => ({ hours }))
  },
  GenerateDisposableToken: {
    Success: class {
      constructor(authToken) {
        this.authToken = authToken;
      }
    }
  },
  TopicPublish: {
    Success: class {
      constructor() {}
    }
  }
}));

// Mock crypto module
jest.unstable_mockModule('crypto', () => ({
  randomUUID: jest.fn(() => 'test-notification-id')
}));

// Import the handler after mocking
const { handler } = await import('../functions/notifications/send-user-notification.mjs');
const { GenerateDisposableToken, TopicPublish } = await import('@gomomento/sdk');

describe('Send User Notification Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset environment variables
    delete process.env.TABLE_NAME;
    delete process.env.MOMENTO_API_KEY;
    delete process.env.MOMENTO_CACHE_NAME;
    delete process.env.WRITE_TOKEN_TTL_HOURS;

    // Set default environment variables
    process.env.TABLE_NAME = 'test-notifications-table';
    process.env.MOMENTO_API_KEY = 'test-momento-key';
    process.env.MOMENTO_CACHE_NAME = 'newsletter-notifications';
    process.env.WRITE_TOKEN_TTL_HOURS = '1';

    // Set default mock implementations
    mockSend.mockResolvedValue({});
    mockAuthClient.generateDisposableToken.mockResolvedValue(
      new GenerateDisposableToken.Success('test-write-token')
    );
    mockTopicClient.publish.mockResolvedValue(new TopicPublish.Success());

    // Mock console methods to avoid test output noise
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('EventBridge Event Parsing and Validation', () => {
    it('should parse valid EventBridge event successfully', async () => {
      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: {
            issueId: 'issue-456',
            title: 'Weekly Newsletter',
            publishedAt: '2024-01-15T10:30:00Z'
          },
          timestamp: '2024-01-15T10:30:00Z'
        }
      };

      await handler(event);

      expect(mockSend).toHaveBeenCalled();
      expect(mockAuthClient.generateDisposableToken).toHaveBeenCalled();
      expect(mockTopicClient.publish).toHaveBeenCalled();
    });

    it('should handle string-encoded event detail', async () => {
      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: JSON.stringify({
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: {
            issueId: 'issue-456',
            title: 'Weekly Newsletter'
          }
        })
      };

      await handler(event);

      expect(mockSend).toHaveBeenCalled();
      expect(mockAuthClient.generateDisposableToken).toHaveBeenCalled();
      expect(mockTopicClient.publish).toHaveBeenCalled();
    });

    it('should reject event with missing detail', async () => {
      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published'
        // Missing detail
      };

      await handler(event);

      expect(console.error).toHaveBeenCalledWith(
        'Failed to process user notification event',
        expect.objectContaining({
          error: 'Missing event detail in EventBridge event'
        })
      );
    });

    it('should reject event with missing tenantId', async () => {
      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          // Missing tenantId
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      await handler(event);

      expect(console.error).toHaveBeenCalledWith(
        'Failed to process user notification event',
        expect.objectContaining({
          error: 'Missing tenantId in event detail'
        })
      );
    });

    it('should reject event with missing type', async () => {
      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          // Missing type
          data: { issueId: 'issue-456' }
        }
      };

      await handler(event);

      expect(console.error).toHaveBeenCalledWith(
        'Failed to process user notification event',
        expect.objectContaining({
          error: 'Missing event type in event detail'
        })
      );
    });

    it('should reject event with missing data', async () => {
      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED'
          // Missing data
        }
      };

      await handler(event);

      expect(console.error).toHaveBeenCalledWith(
        'Failed to process user notification event',
        expect.objectContaining({
          error: 'Missing event data in event detail'
        })
      );
    });
  });

  describe('Momento Write Token Generation', () => {
    it('should generate write token with correct permissions', async () => {
      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      await handler(event);

      expect(mockAuthClient.generateDisposableToken).toHaveBeenCalledWith(
        [
          {
            role: 'publishonly',
            cache: 'newsletter-notifications',
            topic: 'techcorp'
          }
        ],
        { hours: 1 },
        { tokenId: 'techcorp' }
      );
    });

    it('should use custom TTL when WRITE_TOKEN_TTL_HOURS is set', async () => {
      process.env.WRITE_TOKEN_TTL_HOURS = '2';

      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      await handler(event);

      expect(mockAuthClient.generateDisposableToken).toHaveBeenCalledWith(
        expect.any(Array),
        { hours: 2 },
        expect.any(Object)
      );
    });

    it('should handle Momento token generation failure', async () => {
      mockAuthClient.generateDisposableToken.mockRejectedValue(new Error('Momento API Error'));

      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      await handler(event);

      expect(console.error).toHaveBeenCalledWith(
        'Failed to process user notification event',
        expect.objectContaining({
          error: expect.stringContaining('Momento API Error')
        })
      );
    });
  });

  describe('Notification Publishing to Momento', () => {
    it('should publish notification to correct tenant channel', async () => {
      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: {
            issueId: 'issue-456',
            title: 'Weekly Newsletter'
          }
        }
      };

      await handler(event);

      expect(mockTopicClient.publish).toHaveBeenCalledWith(
        'newsletter-notifications',
        'techcorp',
        expect.stringContaining('"type":"ISSUE_PUBLISHED"')
      );
    });

    it('should format notification correctly for different event types', async () => {
      const event = {
        source: 'newsletter.api',
        'detail-type': 'Subscriber Added',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'SUBSCRIBER_ADDED',
          data: {
            subscriberEmail: 'new@example.com',
            subscriberCount: 1251
          }
        }
      };

      await handler(event);

      const publishCall = mockTopicClient.publish.mock.calls[0];
      const notificationPayload = JSON.parse(publishCall[2]);

      expect(notificationPayload).toEqual(
        expect.objectContaining({
          type: 'SUBSCRIBER_ADDED',
          title: expect.stringContaining('New Subscriber'),
          data: expect.objectContaining({
            subscriberEmail: 'new@example.com'
          })
        })
      );
    });

    it('should handle Momento publish failure with retry', async () => {
      mockTopicClient.publish
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(new TopicPublish.Success());

      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      await handler(event);

      // Should retry 3 times total
      expect(mockTopicClient.publish).toHaveBeenCalledTimes(3);
    });

    it('should skip Momento publishing when API key not configured', async () => {
      delete process.env.MOMENTO_API_KEY;

      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      await handler(event);

      expect(mockAuthClient.generateDisposableToken).not.toHaveBeenCalled();
      expect(mockTopicClient.publish).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        'Momento not available, skipping real-time notification delivery',
        expect.objectContaining({
          tenantId: 'techcorp'
        })
      );
    });
  });

  describe('Error Handling and Error Notification Publishing', () => {
    it('should publish error notifications when processing fails', async () => {
      mockSend.mockRejectedValue(new Error('DynamoDB Error'));

      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      await handler(event);

      // Should attempt to publish error notification to system channels
      expect(mockTopicClient.publish).toHaveBeenCalledWith(
        'newsletter-notifications',
        expect.stringMatching(/system/),
        expect.stringContaining('"type":"SYSTEM_ERROR"')
      );
    });

    it('should handle error notification publishing failure gracefully', async () => {
      mockSend.mockRejectedValue(new Error('DynamoDB Error'));
      mockTopicClient.publish.mockRejectedValue(new Error('Momento Error'));

      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      // Should not throw even if error notification fails
      await handler(event);

      expect(console.error).toHaveBeenCalledWith(
        'Failed to process user notification event',
        expect.objectContaining({
          error: expect.stringContaining('DynamoDB Error')
        })
      );
    });

    it('should determine correct error severity levels', async () => {
      // Test critical error (missing API key)
      delete process.env.MOMENTO_API_KEY;
      mockSend.mockRejectedValue(new Error('MOMENTO_API_KEY not configured'));

      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      await handler(event);

      expect(console.error).toHaveBeenCalledWith(
        'Failed to process user notification event',
        expect.objectContaining({
          error: expect.stringContaining('MOMENTO_API_KEY')
        })
      );
    });
  });

  describe('Retry Logic for Transient Failures', () => {
    it('should retry DynamoDB operations on transient failures', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('ServiceUnavailable'))
        .mockRejectedValueOnce(new Error('ServiceUnavailable'))
        .mockResolvedValueOnce({});

      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      await handler(event);

      // Should retry 3 times total
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('should fail after maximum retries', async () => {
      mockSend.mockRejectedValue(new Error('Persistent Error'));

      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      await handler(event);

      // Should retry 3 times total
      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(console.error).toHaveBeenCalledWith(
        'Failed to process user notification event',
        expect.objectContaining({
          error: expect.stringContaining('Persistent Error')
        })
      );
    });
  });

  describe('DynamoDB Storage', () => {
    it('should store notification with correct TTL and structure', async () => {
      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456', title: 'Weekly Newsletter' }
        }
      };

      await handler(event);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-notifications-table',
          Item: expect.objectContaining({
            pk: 'techcorp#user-123',
            sk: expect.stringMatching(/^NOTIFICATION#.*#test-notification-id$/),
            tenantId: 'techcorp',
            userId: 'user-123',
            type: 'ISSUE_PUBLISHED',
            status: 'unread',
            ttl: expect.any(Number)
          })
        })
      );
    });

    it('should skip DynamoDB storage when TABLE_NAME not configured', async () => {
      delete process.env.TABLE_NAME;

      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      await handler(event);

      expect(mockSend).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        'DynamoDB not available or no userId provided, skipping notification storage',
        expect.objectContaining({
          tenantId: 'techcorp',
          userId: 'user-123',
          tableNameConfigured: false
        })
      );
    });

    it('should skip DynamoDB storage when userId not provided', async () => {
      const event = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          // Missing userId
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      await handler(event);

      expect(mockSend).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        'DynamoDB not available or no userId provided, skipping notification storage',
        expect.objectContaining({
          tenantId: 'techcorp',
          userId: undefined
        })
      );
    });
  });
});
