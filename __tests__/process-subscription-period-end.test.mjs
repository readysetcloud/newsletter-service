/**
 * @fileoverview Unit tests for process-subscription-perambda function
 */

import { jest } from '@jest/globals';

// Mock dependencies
const mockDynamoSend = jest.fn();
const mockCognitoSend = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({
    send: mockDynamoSend
  })),
  ScanCommand: jest.fn((params) => params),
  UpdateItemCommand: jest.fn((params) => params),
  QueryCommand: jest.fn((params) => params)
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj)
}));

jest.unstable_mockModule('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({
    send: mockCognitoSend
  })),
  AdminAddUserToGroupCommand: jest.fn((params) => params),
  AdminRemoveUserFromGroupCommand: jest.fn((params) => params),
  ListUsersCommand: jest.fn((params) => params)
}));

// Set environment variables before importing
process.env.TABLE_NAME = 'test-table';
process.env.USER_POOL_ID = 'test-pool';

// Import the handler after mocking and setting env vars
const { handler } = await import('../functions/billing/process-subscription-period-end.mjs');

describe('Process Subscription Period End', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Period End Processing', () => {
    test('should process expired cancelled subscriptions', async () => {
      const expiredSubscription = {
        pk: 'tenant_123',
        sk: 'subscription',
        status: 'cancelled',
        planId: 'price_creator_monthly',
        cancelAtPeriodEnd: true,
        accessEndsAt: '2024-01-01T00:00:00.000Z',
        stripeSubscriptionId: 'sub_test'
      };

      // Mock scan for expired subscriptions
      mockDynamoSend.mockResolvedValueOnce({
        Items: [expiredSubscription]
      });

      // Mock subscription update
      mockDynamoSend.mockResolvedValueOnce({});

      // Mock getting tenant users for downgrade
      mockDynamoSend.mockResolvedValueOnce({
        Items: [
          { pk: 'tenant_123#user1', sk: 'profile', username: 'user1' },
          { pk: 'tenant_123#user2', sk: 'profile', username: 'user2' }
        ]
      });

      const event = {};
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.processedCount).toBe(1);
      expect(body.successCount).toBe(1);
      expect(body.failureCount).toBe(0);
      expect(body.results[0].success).toBe(true);
      expect(body.results[0].tenantId).toBe('tenant_123');

      // Verify DynamoDB calls
      expect(mockDynamoSend).toHaveBeenCalledTimes(3); // scan, update, get users
    });

    test('should handle no expired subscriptions', async () => {
      // Mock scan returning no results
      mockDynamoSend.mockResolvedValueOnce({
        Items: []
      });

      const event = {};
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.message).toBe('No subscriptions to process');
      expect(body.processedCount).toBe(0);

      // Verify only scan was called
      expect(mockDynamoSend).toHaveBeenCalledTimes(1);
    });

    test('should handle multiple expired subscriptions', async () => {
      const expiredSubscriptions = [
        {
          pk: 'tenant_123',
          sk: 'subscription',
          status: 'cancelled',
          planId: 'price_creator_monthly',
          cancelAtPeriodEnd: true,
          accessEndsAt: '2024-01-01T00:00:00.000Z'
        },
        {
          pk: 'tenant_456',
          sk: 'subscription',
          status: 'cancelled',
          planId: 'price_pro_monthly',
          cancelAtPeriodEnd: true,
          accessEndsAt: '2024-01-01T00:00:00.000Z'
        }
      ];

      // Mock scan for expired subscriptions
      mockDynamoSend.mockResolvedValueOnce({
        Items: expiredSubscriptions
      });

      // Mock subscription updates (2 calls)
      mockDynamoSend.mockResolvedValueOnce({});
      mockDynamoSend.mockResolvedValueOnce({});

      // Mock getting tenant users for downgrades (2 calls)
      mockDynamoSend.mockResolvedValueOnce({
        Items: [{ pk: 'tenant_123#user1', sk: 'profile', username: 'user1' }]
      });
      mockDynamoSend.mockResolvedValueOnce({
        Items: [{ pk: 'tenant_456#user2', sk: 'profile', username: 'user2' }]
      });

      const event = {};
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.processedCount).toBe(2);
      expect(body.successCount).toBe(2);
      expect(body.failureCount).toBe(0);

      // Verify DynamoDB calls: 1 scan + 2 updates + 2 get users = 5
      expect(mockDynamoSend).toHaveBeenCalledTimes(5);
    });

    test('should handle processing errors gracefully', async () => {
      const expiredSubscription = {
        pk: 'tenant_123',
        sk: 'subscription',
        status: 'cancelled',
        planId: 'price_creator_monthly',
        cancelAtPeriodEnd: true,
        accessEndsAt: '2024-01-01T00:00:00.000Z'
      };

      // Mock scan for expired subscriptions
      mockDynamoSend.mockResolvedValueOnce({
        Items: [expiredSubscription]
      });

      // Mock subscription update failure
      mockDynamoSend.mockRejectedValueOnce(new Error('Database update failed'));

      const event = {};
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.processedCount).toBe(1);
      expect(body.successCount).toBe(0);
      expect(body.failureCount).toBe(1);
      expect(body.results[0].success).toBe(false);
      expect(body.results[0].error).toBe('Database update failed');
    });

    test('should handle scan errors', async () => {
      // Mock scan failure
      mockDynamoSend.mockRejectedValueOnce(new Error('Database scan failed'));

      const event = {};
      const response = await handler(event);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);

      expect(body.error).toBe('Internal server error');
      expect(body.message).toBe('Database scan failed');
    });

    test('should update subscription status to expired', async () => {
      const expiredSubscription = {
        pk: 'tenant_123',
        sk: 'subscription',
        status: 'cancelled',
        planId: 'price_creator_monthly',
        cancelAtPeriodEnd: true,
        accessEndsAt: '2024-01-01T00:00:00.000Z'
      };

      // Mock scan for expired subscriptions
      mockDynamoSend.mockResolvedValueOnce({
        Items: [expiredSubscription]
      });

      // Mock subscription update
      mockDynamoSend.mockResolvedValueOnce({});

      // Mock getting tenant users
      mockDynamoSend.mockResolvedValueOnce({
        Items: [{ pk: 'tenant_123#user1', sk: 'profile', username: 'user1' }]
      });

      const event = {};
      await handler(event);

      // Verify the subscription update call
      const updateCall = mockDynamoSend.mock.calls[1][0];
      expect(updateCall.Key).toEqual({ pk: 'tenant_123', sk: 'subscription' });
      expect(updateCall.ExpressionAttributeNames).toHaveProperty('#attr0', 'status');
      expect(updateCall.ExpressionAttributeNames).toHaveProperty('#attr1', 'expiredAt');
      expect(updateCall.ExpressionAttributeNames).toHaveProperty('#attr2', 'updatedAt');
    });

    test('should handle subscriptions without plan ID', async () => {
      const expiredSubscription = {
        pk: 'tenant_123',
        sk: 'subscription',
        status: 'cancelled',
        planId: null, // No plan ID
        cancelAtPeriodEnd: true,
        accessEndsAt: '2024-01-01T00:00:00.000Z'
      };

      // Mock scan for expired subscriptions
      mockDynamoSend.mockResolvedValueOnce({
        Items: [expiredSubscription]
      });

      // Mock subscription update
      mockDynamoSend.mockResolvedValueOnce({});

      const event = {};
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.successCount).toBe(1);

      // Should only call scan and update, not get users since no plan to downgrade from
      expect(mockDynamoSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('Filter Logic', () => {
    test('should use correct filter expression for expired subscriptions', async () => {
      // Mock scan returning no results
      mockDynamoSend.mockResolvedValueOnce({
        Items: []
      });

      const event = {};
      await handler(event);

      // Verify the scan was called with correct filter
      const scanCall = mockDynamoSend.mock.calls[0][0];
      expect(scanCall.FilterExpression).toBe('sk = :sk AND #status = :status AND cancelAtPeriodEnd = :cancelAtPeriodEnd AND accessEndsAt <= :now');
      expect(scanCall.ExpressionAttributeNames).toHaveProperty('#status', 'status');
      expect(scanCall.ExpressionAttributeValues).toHaveProperty(':sk', 'subscription');
      expect(scanCall.ExpressionAttributeValues).toHaveProperty(':status', 'cancelled');
      expect(scanCall.ExpressionAttributeValues).toHaveProperty(':cancelAtPeriodEnd', true);
      expect(scanCall.ExpressionAttributeValues).toHaveProperty(':now');
    });
  });
});
