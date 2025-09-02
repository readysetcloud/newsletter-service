/**
 * @fileoverview Unit tests for DynamoDB subscription record management
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

let storeSubscriptionRecord;
let getSubscriptionRecord;
let updateSubscriptionStatus;
let deleteSubscriptionRecord;
let batchGetSubscriptionRecords;
let ddbSend;
let marshall;
let unmarshall;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    // Mock DynamoDB client
    ddbSend = jest.fn();

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
      PutItemCommand: jest.fn((params) => ({ __type: 'PutItem', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
      DeleteItemCommand: jest.fn((params) => ({ __type: 'DeleteItem', ...params })),
      BatchGetItemCommand: jest.fn((params) => ({ __type: 'BatchGetItem', ...params }))
    }));

    // Mock util-dynamodb
    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((item) => item)
    }));

    // Import the functions after mocking
    const module = await import('../functions/billing/subscription-data.mjs');
    const utilModule = await import('@aws-sdk/util-dynamodb');

    storeSubscriptionRecord = module.storeSubscriptionRecord;
    getSubscriptionRecord = module.getSubscriptionRecord;
    updateSubscriptionStatus = module.updateSubscriptionStatus;
    deleteSubscriptionRecord = module.deleteSubscriptionRecord;
    batchGetSubscriptionRecords = module.batchGetSubscriptionRecords;
    marshall = utilModule.marshall;
    unmarshall = utilModule.unmarshall;
  });
}

describe('Subscription Data Management', () => {
  beforeEach(async () => {
    await loadIsolated();
    // Set environment variables
    process.env.TABLE_NAME = 'test-table';
    process.env.AWS_REGION = 'us-east-1';
    // Reset mock calls
    ddbSend.mockClear();
    marshall.mockClear();
    unmarshall.mockClear();
  });

  describe('storeSubscriptionRecord', () => {
    const validSubscriptionData = {
      tenantId: 'tenant123',
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_123',
      status: 'active',
      planId: 'pro',
      currentPeriodStart: '2024-01-01T00:00:00Z',
      currentPeriodEnd: '2024-02-01T00:00:00Z'
    };

    it('should store a valid subscription record', async () => {
      ddbSend.mockResolvedValue({});

      const result = await storeSubscriptionRecord(validSubscriptionData);

      expect(result.pk).toBe('tenant123');
      expect(result.sk).toBe('subscription');
      expect(result.stripeSubscriptionId).toBe('sub_123');
      expect(result.status).toBe('active');
      expect(result.planId).toBe('pro');
      expect(result.cancelAtPeriodEnd).toBe(false);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();

      expect(ddbSend).toHaveBeenCalledTimes(1);
      const putCall = ddbSend.mock.calls[0][0];
      expect(putCall.__type).toBe('PutItem');
      expect(marshall).toHaveBeenCalledWith(result);
    });

    it('should throw error for invalid subscription data', async () => {
      const invalidData = { ...validSubscriptionData };
      delete invalidData.tenantId;

      await expect(storeSubscriptionRecord(invalidData)).rejects.toThrow('Invalid subscription record');
    });

    it('should handle conditional check failure (record already exists)', async () => {
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      ddbSend.mockRejectedValue(error);

      await expect(storeSubscriptionRecord(validSubscriptionData))
        .rejects.toThrow('Subscription record already exists for tenant: tenant123');
    });

    it('should handle other DynamoDB errors', async () => {
      const error = new Error('DynamoDB error');
      ddbSend.mockRejectedValue(error);

      await expect(storeSubscriptionRecord(validSubscriptionData))
        .rejects.toThrow('Failed to store subscription record: DynamoDB error');
    });
  });

  describe('getSubscriptionRecord', () => {
    it('should retrieve an existing subscription record', async () => {
      const mockRecord = {
        pk: 'tenant123',
        sk: 'subscription',
        stripeSubscriptionId: 'sub_123',
        status: 'active',
        planId: 'pro'
      };

      ddbSend.mockResolvedValue({ Item: mockRecord });
      unmarshall.mockReturnValue(mockRecord);

      const result = await getSubscriptionRecord('tenant123');

      expect(result).toEqual(mockRecord);
      expect(ddbSend).toHaveBeenCalledTimes(1);

      const getCall = ddbSend.mock.calls[0][0];
      expect(getCall.__type).toBe('GetItem');
      expect(marshall).toHaveBeenCalledWith({
        pk: 'tenant123',
        sk: 'subscription'
      });
      expect(unmarshall).toHaveBeenCalledWith(mockRecord);
    });

    it('should return null for non-existent record', async () => {
      ddbSend.mockResolvedValue({});

      const result = await getSubscriptionRecord('nonexistent');

      expect(result).toBeNull();
      expect(unmarshall).not.toHaveBeenCalled();
    });

    it('should throw error for missing tenant ID', async () => {
      await expect(getSubscriptionRecord('')).rejects.toThrow('Tenant ID is required');
      await expect(getSubscriptionRecord(null)).rejects.toThrow('Tenant ID is required');
      await expect(getSubscriptionRecord(undefined)).rejects.toThrow('Tenant ID is required');
    });

    it('should handle DynamoDB errors', async () => {
      const error = new Error('DynamoDB error');
      ddbSend.mockRejectedValue(error);

      await expect(getSubscriptionRecord('tenant123'))
        .rejects.toThrow('Failed to retrieve subscription record: DynamoDB error');
    });
  });

  describe('updateSubscriptionStatus', () => {
    it('should update subscription status successfully', async () => {
      const updatedRecord = {
        pk: 'tenant123',
        sk: 'subscription',
        status: 'cancelled',
        cancelAtPeriodEnd: true,
        updatedAt: '2024-01-02T00:00:00Z'
      };

      ddbSend.mockResolvedValue({ Attributes: updatedRecord });
      unmarshall.mockReturnValue(updatedRecord);

      const updates = {
        status: 'cancelled',
        cancelAtPeriodEnd: true
      };

      const result = await updateSubscriptionStatus('tenant123', updates);

      expect(result).toEqual(updatedRecord);
      expect(ddbSend).toHaveBeenCalledTimes(1);

      const updateCall = ddbSend.mock.calls[0][0];
      expect(updateCall.__type).toBe('UpdateItem');
      expect(marshall).toHaveBeenCalledTimes(2); // Key and ExpressionAttributeValues
      expect(unmarshall).toHaveBeenCalledWith(updatedRecord);
    });

    it('should throw error for missing tenant ID', async () => {
      await expect(updateSubscriptionStatus('', { status: 'cancelled' }))
        .rejects.toThrow('Tenant ID is required');
    });

    it('should throw error for empty updates', async () => {
      await expect(updateSubscriptionStatus('tenant123', {}))
        .rejects.toThrow('Updates object is required and cannot be empty');

      await expect(updateSubscriptionStatus('tenant123', null))
        .rejects.toThrow('Updates object is required and cannot be empty');
    });

    it('should handle conditional check failure (record not found)', async () => {
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      ddbSend.mockRejectedValue(error);

      await expect(updateSubscriptionStatus('tenant123', { status: 'cancelled' }))
        .rejects.toThrow('Subscription record not found for tenant: tenant123');
    });

    it('should handle other DynamoDB errors', async () => {
      const error = new Error('DynamoDB error');
      ddbSend.mockRejectedValue(error);

      await expect(updateSubscriptionStatus('tenant123', { status: 'cancelled' }))
        .rejects.toThrow('Failed to update subscription status: DynamoDB error');
    });
  });

  describe('deleteSubscriptionRecord', () => {
    it('should delete subscription record successfully', async () => {
      ddbSend.mockResolvedValue({});

      await deleteSubscriptionRecord('tenant123');

      expect(ddbSend).toHaveBeenCalledTimes(1);
      const deleteCall = ddbSend.mock.calls[0][0];
      expect(deleteCall.__type).toBe('DeleteItem');
      expect(marshall).toHaveBeenCalledWith({
        pk: 'tenant123',
        sk: 'subscription'
      });
    });

    it('should throw error for missing tenant ID', async () => {
      await expect(deleteSubscriptionRecord('')).rejects.toThrow('Tenant ID is required');
    });

    it('should handle conditional check failure (record not found)', async () => {
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      ddbSend.mockRejectedValue(error);

      await expect(deleteSubscriptionRecord('tenant123'))
        .rejects.toThrow('Subscription record not found for tenant: tenant123');
    });

    it('should handle other DynamoDB errors', async () => {
      const error = new Error('DynamoDB error');
      ddbSend.mockRejectedValue(error);

      await expect(deleteSubscriptionRecord('tenant123'))
        .rejects.toThrow('Failed to delete subscription record: DynamoDB error');
    });
  });

  describe('batchGetSubscriptionRecords', () => {
    it('should batch get subscription records successfully', async () => {
      const mockRecords = [
        { pk: 'tenant1', sk: 'subscription', status: 'active' },
        { pk: 'tenant2', sk: 'subscription', status: 'cancelled' }
      ];

      ddbSend.mockResolvedValue({
        Responses: {
          'test-table': mockRecords
        }
      });
      unmarshall.mockImplementation((item) => item);

      const result = await batchGetSubscriptionRecords(['tenant1', 'tenant2']);

      expect(result).toEqual(mockRecords);
      expect(ddbSend).toHaveBeenCalledTimes(1);

      const batchCall = ddbSend.mock.calls[0][0];
      expect(batchCall.__type).toBe('BatchGetItem');
      expect(unmarshall).toHaveBeenCalledTimes(2);
    });

    it('should return empty array when no records found', async () => {
      ddbSend.mockResolvedValue({ Responses: {} });

      const result = await batchGetSubscriptionRecords(['nonexistent']);

      expect(result).toEqual([]);
    });

    it('should throw error for invalid input', async () => {
      await expect(batchGetSubscriptionRecords([])).rejects.toThrow('Tenant IDs array is required and cannot be empty');
      await expect(batchGetSubscriptionRecords(null)).rejects.toThrow('Tenant IDs array is required and cannot be empty');
      await expect(batchGetSubscriptionRecords('not-array')).rejects.toThrow('Tenant IDs array is required and cannot be empty');
    });

    it('should throw error for too many tenant IDs', async () => {
      const tooManyIds = Array.from({ length: 101 }, (_, i) => `tenant${i}`);

      await expect(batchGetSubscriptionRecords(tooManyIds))
        .rejects.toThrow('Cannot batch get more than 100 subscription records at once');
    });

    it('should handle DynamoDB errors', async () => {
      const error = new Error('DynamoDB error');
      ddbSend.mockRejectedValue(error);

      await expect(batchGetSubscriptionRecords(['tenant1']))
        .rejects.toThrow('Failed to batch get subscription records: DynamoDB error');
    });
  });
});
