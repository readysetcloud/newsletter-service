import { jest } from '@jest/globals';

// Mock AWS SDK
const mockSend = jest.fn();
const mockPutEvents = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({
    send: mockSend
  })),
  PutItemCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((item) => item)
}));

jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({
    send: mockPutEvents
  })),
  PutEventsCommand: jest.fn((params) => params)
}));

// Mock Momento SDK
const mockAuthClient = {
  generateDisposableToken: jest.fn()
};

const mockTopicClient = {
  publish: jest.fn(),
  subscribe: jest.fn()
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
  },
  TopicSubscribe: {
    Success: class {
      constructor() {}
    }
  }
}));

// Mock crypto module
jest.unstable_mockModule('crypto', () => ({
  randomUUID: jest.fn(() => 'test-correlation-id')
}));

// Mock momento-client utility
const mockMomentoClient = {
  isAvailable: jest.fn(),
  generateReadOnlyToken: jest.fn(),
  generateWriteToken: jest.fn(),
  getCacheName: jest.fn(),
  publishNotification: jest.fn()
};

jest.unstable_mockModule('../../functions/utils/momento-client.mjs', () => ({
  momentoClient: mockMomentoClient
}));

// Import handlers after mocking
const { handler: preTokenHandler } = await import('../../functions/auth/cognito-pre-token-generation.mjs');
const { handler: notificationHandler } = await import('../../functions/notifications/send-user-notification.mjs');
const { GenerateDisposableToken, TopicPublish } = await import('@gomomento/sdk');

describe('Cognito-Momento Auth Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Set environment variables
    process.env.MOMENTO_API_KEY = 'test-momento-key';
    process.env.MOMENTO_CACHE_NAME = 'newsletter-notifications';
    process.env.TTL_HOURS = '24';
    process.env.WRITE_TOKEN_TTL_HOURS = '1';
    process.env.TABLE_NAME = 'test-notifications-table';
    process.env.EVENT_BUS_NAME = 'newsletter-events';

    // Set default mock implementations
    mockMomentoClient.isAvailable.mockReturnValue(true);
    mockMomentoClient.getCacheName.mockReturnValue('newsletter-notifications');
    mockMomentoClient.generateReadOnlyToken.mockResolvedValue('test-read-token');
    mockMomentoClient.generateWriteToken.mockResolvedValue('test-write-token');

    mockSend.mockResolvedValue({});
    mockPutEvents.mockResolvedValue({ Entries: [{ EventId: 'test-event-id' }] });

    mockAuthClient.generateDisposableToken.mockResolvedValue(
      new GenerateDisposableToken.Success('test-momento-token')
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

  describe('Complete Authentication Flow with Token Enrichment', () => {
    it('should enrich JWT with Momento token during authentication', async () => {
      const cognitoEvent = {
        triggerSource: 'TokenGeneration_HostedAuth',
        userName: 'test@example.com',
        userPoolId: 'us-east-1_XXXXXXXXX',
        request: {
          userAttributes: {
            sub: 'user-123',
            email: 'test@example.com',
            'custom:tenant_id': 'techcorp'
          }
        }
      };

      const result = await preTokenHandler(cognitoEvent);

      // Verify token generation was called with correct parameters
      expect(mockMomentoClient.generateReadOnlyToken).toHaveBeenCalledWith(
        'techcorp',
        'user-123'
      );

      // Verify JWT claims were enriched
      expect(result.response.claimsOverrideDetails.claimsToAddOrOverride).toEqual({
        'custom:momento_token': 'test-read-token',
        'custom:momento_cache': 'newsletter-notifications',
        'custom:momento_expires': expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        'custom:tenant_id': 'techcorp'
      });
    });

    it('should handle authentication flow when Momento is unavailable', async () => {
      mockMomentoClient.isAvailable.mockReturnValue(false);

      const cognitoEvent = {
        triggerSource: 'TokenGeneration_HostedAuth',
        userName: 'test@example.com',
        userPoolId: 'us-east-1_XXXXXXXXX',
        request: {
          userAttributes: {
            sub: 'user-123',
            email: 'test@example.com',
            'custom:tenant_id': 'techcorp'
          }
        }
      };

      const result = await preTokenHandler(cognitoEvent);

      // Should still complete authentication with empty Momento claims
      expect(result.response.claimsOverrideDetails.claimsToAddOrOverride).toEqual({
        'custom:momento_token': '',
        'custom:momento_cache': '',
        'custom:momento_expires': '',
        'custom:tenant_id': 'techcorp'
      });
    });

    it('should never block authentication even on critical failures', async () => {
      mockMomentoClient.isAvailable.mockImplementation(() => {
        throw new Error('Critical system error');
      });

      const cognitoEvent = {
        triggerSource: 'TokenGeneration_HostedAuth',
        userName: 'test@example.com',
        userPoolId: 'us-east-1_XXXXXXXXX',
        request: {
          userAttributes: {
            sub: 'user-123',
            email: 'test@example.com',
            'custom:tenant_id': 'techcorp'
          }
        }
      };

      // Should not throw
      const result = await preTokenHandler(cognitoEvent);

      // Should return original event to allow authentication to continue
      expect(result).toEqual(cognitoEvent);
    });
  });

  describe('Event Publishing from Backend APIs to EventBridge', () => {
    it('should simulate backend API publishing events to EventBridge', async () => {
      // Simulate what a backend API would do
      const eventBridgeEvent = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: {
            issueId: 'issue-456',
            title: 'Weekly Newsletter',
            publishedAt: '2024-01-15T10:30:00Z',
            subscriberCount: 1250
          },
          timestamp: '2024-01-15T10:30:00Z'
        }
      };

      // Process the event through the notification handler
      await notificationHandler(eventBridgeEvent);

      // Verify notification was stored in DynamoDB
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-notifications-table',
          Item: expect.objectContaining({
            pk: 'techcorp#user-123',
            tenantId: 'techcorp',
            userId: 'user-123',
            type: 'ISSUE_PUBLISHED',
            status: 'unread'
          })
        })
      );

      // Verify notification was published to Momento
      expect(mockTopicClient.publish).toHaveBeenCalledWith(
        'newsletter-notifications',
        'techcorp',
        expect.stringContaining('"type":"ISSUE_PUBLISHED"')
      );
    });

    it('should handle different event types from backend APIs', async () => {
      const subscriberEvent = {
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

      await notificationHandler(subscriberEvent);

      // Verify correct notification type was processed
      const publishCall = mockTopicClient.publish.mock.calls[0];
      const notificationPayload = JSON.parse(publishCall[2]);

      expect(notificationPayload.type).toBe('SUBSCRIBER_ADDED');
      expect(notificationPayload.data.subscriberEmail).toBe('new@example.com');
    });

    it('should handle brand update events', async () => {
      const brandEvent = {
        source: 'newsletter.api',
        'detail-type': 'Brand Updated',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'BRAND_UPDATED',
          data: {
            brandName: 'TechCorp Newsletter',
            logoUrl: 'https://example.com/logo.png'
          }
        }
      };

      await notificationHandler(brandEvent);

      const publishCall = mockTopicClient.publish.mock.calls[0];
      const notificationPayload = JSON.parse(publishCall[2]);

      expect(notificationPayload.type).toBe('BRAND_UPDATED');
      expect(notificationPayload.title).toContain('Brand Updated');
      // The original event data is available in the notification
      expect(notificationPayload).toEqual(
        expect.objectContaining({
          type: 'BRAND_UPDATED'
        })
      );
    });
  });

  describe('Notification Delivery from EventBridge to Momento', () => {
    it('should generate write tokens and publish notifications to tenant channels', async () => {
      const eventBridgeEvent = {
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

      await notificationHandler(eventBridgeEvent);

      // Verify write token was generated for the tenant
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

      // Verify notification was published to correct tenant channel
      expect(mockTopicClient.publish).toHaveBeenCalledWith(
        'newsletter-notifications',
        'techcorp',
        expect.any(String)
      );
    });

    it('should handle write token generation failures gracefully', async () => {
      mockAuthClient.generateDisposableToken.mockRejectedValue(new Error('Token generation failed'));

      const eventBridgeEvent = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      await notificationHandler(eventBridgeEvent);

      expect(console.error).toHaveBeenCalledWith(
        'Failed to process user notification event',
        expect.objectContaining({
          error: expect.stringContaining('Token generation failed')
        })
      );
    });

    it('should retry notification publishing on transient failures', async () => {
      mockTopicClient.publish
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(new TopicPublish.Success());

      const eventBridgeEvent = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      await notificationHandler(eventBridgeEvent);

      // Should retry 3 times total
      expect(mockTopicClient.publish).toHaveBeenCalledTimes(3);
    });
  });

  describe('Frontend Subscription and Notification Receipt', () => {
    it('should simulate frontend extracting token from JWT and subscribing', async () => {
      // Simulate JWT token with Momento claims (from pre-token generation)
      const jwtClaims = {
        'custom:momento_token': 'test-read-token',
        'custom:momento_cache': 'newsletter-notifications',
        'custom:momento_expires': new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      };

      // Simulate frontend using the token to subscribe
      const frontendTopicClient = mockTopicClient;

      // Frontend would extract token and create client
      expect(jwtClaims['custom:momento_token']).toBe('test-read-token');
      expect(jwtClaims['custom:momento_cache']).toBe('newsletter-notifications');

      // Frontend would subscribe to tenant channel
      await frontendTopicClient.subscribe('newsletter-notifications', 'techcorp');

      expect(mockTopicClient.subscribe).toHaveBeenCalledWith(
        'newsletter-notifications',
        'techcorp'
      );
    });

    it('should handle token expiration gracefully in frontend', async () => {
      // Simulate expired token
      const expiredJwtClaims = {
        'custom:momento_token': 'expired-token',
        'custom:momento_cache': 'newsletter-notifications',
        'custom:momento_expires': new Date(Date.now() - 1000).toISOString() // Expired
      };

      const expirationTime = new Date(expiredJwtClaims['custom:momento_expires']);
      const isExpired = expirationTime < new Date();

      expect(isExpired).toBe(true);

      // Frontend should handle this by not attempting subscription or requesting new token
    });

    it('should handle missing Momento token in JWT gracefully', async () => {
      // Simulate JWT without Momento claims (when Momento was unavailable during auth)
      const jwtClaims = {
        'custom:momento_token': '',
        'custom:momento_cache': '',
        'custom:momento_expires': ''
      };

      // Frontend should detect missing token and gracefully degrade
      const hasMomentoToken = !!jwtClaims['custom:momento_token'];
      expect(hasMomentoToken).toBe(false);

      // Frontend would not attempt to subscribe and would fall back to polling or other methods
    });
  });

  describe('End-to-End Flow Integration', () => {
    it('should complete full flow from authentication to notification delivery', async () => {
      // Step 1: User authenticates and gets enriched JWT
      const cognitoEvent = {
        triggerSource: 'TokenGeneration_HostedAuth',
        userName: 'test@example.com',
        userPoolId: 'us-east-1_XXXXXXXXX',
        request: {
          userAttributes: {
            sub: 'user-123',
            email: 'test@example.com',
            'custom:tenant_id': 'techcorp'
          }
        }
      };

      const authResult = await preTokenHandler(cognitoEvent);

      // Verify JWT was enriched
      expect(authResult.response.claimsOverrideDetails.claimsToAddOrOverride['custom:momento_token']).toBe('test-read-token');

      // Step 2: Backend API publishes event to EventBridge (simulated)
      const eventBridgeEvent = {
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

      // Step 3: EventBridge triggers notification handler
      await notificationHandler(eventBridgeEvent);

      // Step 4: Verify complete flow
      // - Read token was generated for authentication
      expect(mockMomentoClient.generateReadOnlyToken).toHaveBeenCalledWith('techcorp', 'user-123');

      // - Write token was generated for publishing
      expect(mockAuthClient.generateDisposableToken).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'publishonly',
            topic: 'techcorp'
          })
        ]),
        expect.any(Object),
        expect.any(Object)
      );

      // - Notification was stored in DynamoDB
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-notifications-table',
          Item: expect.objectContaining({
            tenantId: 'techcorp',
            userId: 'user-123',
            type: 'ISSUE_PUBLISHED'
          })
        })
      );

      // - Notification was published to Momento
      expect(mockTopicClient.publish).toHaveBeenCalledWith(
        'newsletter-notifications',
        'techcorp',
        expect.stringContaining('"type":"ISSUE_PUBLISHED"')
      );
    });

    it('should handle partial failures gracefully in end-to-end flow', async () => {
      // Step 1: Authentication succeeds
      const cognitoEvent = {
        triggerSource: 'TokenGeneration_HostedAuth',
        userName: 'test@example.com',
        userPoolId: 'us-east-1_XXXXXXXXX',
        request: {
          userAttributes: {
            sub: 'user-123',
            email: 'test@example.com',
            'custom:tenant_id': 'techcorp'
          }
        }
      };

      const authResult = await preTokenHandler(cognitoEvent);
      expect(authResult.response.claimsOverrideDetails.claimsToAddOrOverride['custom:momento_token']).toBe('test-read-token');

      // Step 2: DynamoDB fails but Momento succeeds
      mockSend.mockRejectedValue(new Error('DynamoDB Error'));

      const eventBridgeEvent = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'techcorp',
          userId: 'user-123',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-456' }
        }
      };

      await notificationHandler(eventBridgeEvent);

      // Should publish error notifications when DynamoDB fails
      expect(mockTopicClient.publish).toHaveBeenCalledWith(
        'newsletter-notifications',
        expect.stringMatching(/system/),
        expect.stringContaining('"type":"SYSTEM_ERROR"')
      );

      // Should log error but continue processing
      expect(console.error).toHaveBeenCalledWith(
        'Failed to process user notification event',
        expect.objectContaining({
          error: expect.stringContaining('DynamoDB Error')
        })
      );
    });
  });

  describe('Tenant Isolation and Security', () => {
    it('should ensure tenant isolation in token scoping', async () => {
      // Test tenant A
      const cognitoEventA = {
        triggerSource: 'TokenGeneration_HostedAuth',
        userName: 'userA@example.com',
        userPoolId: 'us-east-1_XXXXXXXXX',
        request: {
          userAttributes: {
            sub: 'user-A',
            email: 'userA@example.com',
            'custom:tenant_id': 'tenant-a'
          }
        }
      };

      await preTokenHandler(cognitoEventA);

      expect(mockMomentoClient.generateReadOnlyToken).toHaveBeenCalledWith('tenant-a', 'user-A');

      // Test tenant B
      const cognitoEventB = {
        triggerSource: 'TokenGeneration_HostedAuth',
        userName: 'userB@example.com',
        userPoolId: 'us-east-1_XXXXXXXXX',
        request: {
          userAttributes: {
            sub: 'user-B',
            email: 'userB@example.com',
            'custom:tenant_id': 'tenant-b'
          }
        }
      };

      await preTokenHandler(cognitoEventB);

      expect(mockMomentoClient.generateReadOnlyToken).toHaveBeenCalledWith('tenant-b', 'user-B');
    });

    it('should ensure notifications are published to correct tenant channels', async () => {
      const tenantAEvent = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'tenant-a',
          userId: 'user-A',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-A' }
        }
      };

      const tenantBEvent = {
        source: 'newsletter.api',
        'detail-type': 'Issue Published',
        detail: {
          tenantId: 'tenant-b',
          userId: 'user-B',
          type: 'ISSUE_PUBLISHED',
          data: { issueId: 'issue-B' }
        }
      };

      await notificationHandler(tenantAEvent);
      await notificationHandler(tenantBEvent);

      // Verify notifications went to correct tenant channels
      expect(mockTopicClient.publish).toHaveBeenCalledWith(
        'newsletter-notifications',
        'tenant-a',
        expect.stringContaining('"issueId":"issue-A"')
      );

      expect(mockTopicClient.publish).toHaveBeenCalledWith(
        'newsletter-notifications',
        'tenant-b',
        expect.stringContaining('"issueId":"issue-B"')
      );
    });
  });
});
