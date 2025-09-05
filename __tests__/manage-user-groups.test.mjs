import { jest } from '@jest/globals';

// Set up environment variables before importing the module
process.env.USER_POOL_ID = 'test-user-pool';
process.env.TABLE_NAME = 'test-table';

// Mock AWS SDK clients
const mockSend = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({
    send: mockSend
  })),
  AdminAddUserToGroupCommand: jest.fn((params) => ({ type: 'AdminAddUserToGroupCommand', ...params })),
  AdminRemoveUserFromGroupCommand: jest.fn((params) => ({ type: 'AdminRemoveUserFromGroupCommand', ...params })),
  ListUsersCommand: jest.fn((params) => ({ type: 'ListUsersCommand', ...params }))
}));

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: mockSend
  })),
  QueryCommand: jest.fn((params) => ({ type: 'QueryCommand', ...params })),
  GetItemCommand: jest.fn((params) => ({ type: 'GetItemCommand', ...params }))
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => ({ marshalled: obj })),
  unmarshall: jest.fn((obj) => obj.unmarshalled || obj)
}));

// Import the module after mocking
const {
  mapPriceIdToGroup,
  mapPlanToGroup,
  getTenantUsers,
  addUserToGroup,
  removeUserFromGroup,
  batchProcessUserGroups,
  updateTenantUserGroups,
  updateTenantUserGroupsByPriceId,
  ensureUserInCorrectGroup,
  SUBSCRIPTION_PLANS
} = await import('../functions/billing/manage-user-groups.mjs');

describe('User Group Management Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Plan and Price ID Mapping', () => {
    test('mapPriceIdToGroup should return correct group for valid price ID', () => {
      expect(mapPriceIdToGroup('price_creator_monthly')).toBe('creator-tier');
      expect(mapPriceIdToGroup('price_pro_monthly')).toBe('pro-tier');
      expect(mapPriceIdToGroup('invalid_price')).toBeNull();
    });

    test('mapPlanToGroup should return correct group for valid plan', () => {
      expect(mapPlanToGroup('free')).toBe('free-tier');
      expect(mapPlanToGroup('creator')).toBe('creator-tier');
      expect(mapPlanToGroup('pro')).toBe('pro-tier');
      expect(mapPlanToGroup('invalid')).toBeNull();
    });

    test('SUBSCRIPTION_PLANS should have correct structure', () => {
      expect(SUBSCRIPTION_PLANS.free.cognitoGroup).toBe('free-tier');
      expect(SUBSCRIPTION_PLANS.creator.priceId).toBe('price_creator_monthly');
      expect(SUBSCRIPTION_PLANS.pro.limits.subscribers).toBe(10000);
    });
  });

  describe('getTenantUsers', () => {
    test('should return formatted user list for valid tenant', async () => {
      const mockItems = [
        {
          unmarshalled: {
            pk: 'tenant123',
            sk: 'user#john.doe',
            role: 'admin',
            joinedAt: '2024-01-01T00:00:00Z'
          }
        },
        {
          unmarshalled: {
            pk: 'tenant123',
            sk: 'user#jane.smith',
            role: 'member',
            joinedAt: '2024-01-02T00:00:00Z'
          }
        }
      ];

      mockSend.mockResolvedValueOnce({
        Items: mockItems
      });

      const result = await getTenantUsers('tenant123');

      expect(result).toHaveLength(2);
      expect(result[0].username).toBe('john.doe');
      expect(result[0].role).toBe('admin');
      expect(result[1].username).toBe('jane.smith');
      expect(result[1].role).toBe('member');
    });

    test('should handle empty result', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await getTenantUsers('tenant123');

      expect(result).toHaveLength(0);
    });

    test('should handle DynamoDB errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));

      await expect(getTenantUsers('tenant123')).rejects.toThrow('Failed to retrieve tenant users');
    });
  });

  describe('addUserToGroup', () => {
    test('should successfully add user to group', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await addUserToGroup('john.doe', 'creator-tier');

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith({
        type: 'AdminAddUserToGroupCommand',
        GroupName: 'creator-tier',
        UserPoolId: 'test-user-pool',
        Username: 'john.doe'
      });
    });

    test('should handle UserNotConfirmedException gracefully', async () => {
      const error = new Error('User not confirmed');
      error.name = 'UserNotConfirmedException';
      mockSend.mockRejectedValueOnce(error);

      const result = await addUserToGroup('john.doe', 'creator-tier');

      expect(result).toBe(false);
    });

    test('should handle UserNotFoundException gracefully', async () => {
      const error = new Error('User not found');
      error.name = 'UserNotFoundException';
      mockSend.mockRejectedValueOnce(error);

      const result = await addUserToGroup('john.doe', 'creator-tier');

      expect(result).toBe(false);
    });

    test('should throw on unexpected errors', async () => {
      const error = new Error('Unexpected error');
      error.name = 'UnexpectedError';
      mockSend.mockRejectedValueOnce(error);

      await expect(addUserToGroup('john.doe', 'creator-tier')).rejects.toThrow('Failed to add user to group');
    });
  });

  describe('removeUserFromGroup', () => {
    test('should successfully remove user from group', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await removeUserFromGroup('john.doe', 'creator-tier');

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith({
        type: 'AdminRemoveUserFromGroupCommand',
        GroupName: 'creator-tier',
        UserPoolId: 'test-user-pool',
        Username: 'john.doe'
      });
    });

    test('should handle UserNotInGroupException gracefully', async () => {
      const error = new Error('User not in group');
      error.name = 'UserNotInGroupException';
      mockSend.mockRejectedValueOnce(error);

      const result = await removeUserFromGroup('john.doe', 'creator-tier');

      expect(result).toBe(false);
    });

    test('should handle UserNotFoundException gracefully', async () => {
      const error = new Error('User not found');
      error.name = 'UserNotFoundException';
      mockSend.mockRejectedValueOnce(error);

      const result = await removeUserFromGroup('john.doe', 'creator-tier');

      expect(result).toBe(false);
    });
  });

  describe('batchProcessUserGroups', () => {
    const mockUsers = [
      { username: 'user1' },
      { username: 'user2' },
      { username: 'user3' }
    ];

    test('should process all users successfully for add action', async () => {
      mockSend.mockResolvedValue({});

      const result = await batchProcessUserGroups(mockUsers, 'creator-tier', 'add');

      expect(result.successful).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    test('should handle mixed success/failure results', async () => {
      mockSend
        .mockResolvedValueOnce({}) // user1 success
        .mockRejectedValueOnce(Object.assign(new Error('User not confirmed'), { name: 'UserNotConfirmedException' })) // user2 skipped
        .mockRejectedValueOnce(new Error('Unexpected error')); // user3 failed

      const result = await batchProcessUserGroups(mockUsers, 'creator-tier', 'add');

      expect(result.successful).toHaveLength(1);
      expect(result.successful[0]).toBe('user1');
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toBe('user2');
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].username).toBe('user3');
    });

    test('should handle invalid action', async () => {
      const result = await batchProcessUserGroups(mockUsers, 'creator-tier', 'invalid');

      expect(result.successful).toHaveLength(0);
      expect(result.failed).toHaveLength(3);
      expect(result.skipped).toHaveLength(0);
      expect(result.failed[0].error).toBe('Invalid action: invalid');
    });
  });

  describe('updateTenantUserGroups', () => {
    const mockUsers = [
      { username: 'user1', sk: 'user#user1' },
      { username: 'user2', sk: 'user#user2' }
    ];

    beforeEach(() => {
      // Mock getTenantUsers
      mockSend.mockResolvedValue({
        Items: mockUsers.map(user => ({ unmarshalled: user }))
      });
    });

    test('should upgrade users from free to creator plan', async () => {
      // Mock successful group operations
      mockSend
        .mockResolvedValueOnce({ Items: mockUsers.map(user => ({ unmarshalled: user })) }) // getTenantUsers
        .mockResolvedValue({}); // All group operations succeed

      const result = await updateTenantUserGroups('tenant123', 'free', 'creator');

      expect(result.tenantId).toBe('tenant123');
      expect(result.users).toBe(2);
      expect(result.operations).toHaveLength(2);
      expect(result.operations[0].action).toBe('remove');
      expect(result.operations[0].group).toBe('free-tier');
      expect(result.operations[1].action).toBe('add');
      expect(result.operations[1].group).toBe('creator-tier');
    });

    test('should handle downgrade from pro to free', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: mockUsers.map(user => ({ unmarshalled: user })) })
        .mockResolvedValue({});

      const result = await updateTenantUserGroups('tenant123', 'pro', 'free');

      expect(result.operations).toHaveLength(2);
      expect(result.operations[0].group).toBe('pro-tier');
      expect(result.operations[1].group).toBe('free-tier');
    });

    test('should handle same plan (no changes)', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: mockUsers.map(user => ({ unmarshalled: user })) })
        .mockResolvedValue({});

      const result = await updateTenantUserGroups('tenant123', 'creator', 'creator');

      expect(result.operations).toHaveLength(1); // Only add operation, no remove
      expect(result.operations[0].action).toBe('add');
      expect(result.operations[0].group).toBe('creator-tier');
    });

    test('should handle tenant with no users', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await updateTenantUserGroups('tenant123', 'free', 'creator');

      expect(result.users).toBe(0);
      expect(result.operations).toHaveLength(0);
    });
  });

  describe('updateTenantUserGroupsByPriceId', () => {
    const mockUsers = [{ username: 'user1', sk: 'user#user1' }];

    beforeEach(() => {
      mockSend.mockResolvedValue({
        Items: mockUsers.map(user => ({ unmarshalled: user }))
      });
    });

    test('should handle price ID to plan mapping', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: mockUsers.map(user => ({ unmarshalled: user })) })
        .mockResolvedValue({});

      const result = await updateTenantUserGroupsByPriceId('tenant123', null, 'price_creator_monthly');

      expect(result.operations).toHaveLength(2);
      expect(result.operations[0].group).toBe('free-tier'); // Remove from free
      expect(result.operations[1].group).toBe('creator-tier'); // Add to creator
    });

    test('should handle cancellation (to free plan)', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: mockUsers.map(user => ({ unmarshalled: user })) })
        .mockResolvedValue({});

      const result = await updateTenantUserGroupsByPriceId('tenant123', 'price_pro_monthly', null);

      expect(result.operations).toHaveLength(2);
      expect(result.operations[0].group).toBe('pro-tier'); // Remove from pro
      expect(result.operations[1].group).toBe('free-tier'); // Add to free
    });

    test('should throw error for unknown price ID', async () => {
      await expect(updateTenantUserGroupsByPriceId('tenant123', null, 'unknown_price')).rejects.toThrow('Unknown price ID');
    });
  });

  describe('ensureUserInCorrectGroup', () => {
    test('should place user in correct group based on tenant subscription', async () => {
      // Mock getTenantSubscription (via getTenantUsers call pattern)
      mockSend
        .mockResolvedValueOnce({ // getTenantSubscription
          Item: {
            unmarshalled: {
              status: 'active',
              planId: 'price_creator_monthly'
            }
          }
        })
        .mockResolvedValue({}); // All group operations

      const result = await ensureUserInCorrectGroup('john.doe', 'tenant123');

      expect(result.username).toBe('john.doe');
      expect(result.tenantId).toBe('tenant123');
      expect(result.targetGroup).toBe('creator-tier');
      expect(result.addedTo).toBe('creator-tier');
    });

    test('should handle tenant with no subscription (free tier)', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: null }) // No subscription
        .mockResolvedValue({});

      const result = await ensureUserInCorrectGroup('john.doe', 'tenant123');

      expect(result.targetGroup).toBe('free-tier');
    });
  });
});
