import { jest } from '@jest/globals';

// Mock AWS SDK clients
const mockSend = jest.fn();
const mockPutEventsCommand = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({
    send: mockSend
  })),
  PutEventsCommand: mockPutEventsCommand
}));

// Mock Momento client
const mockMomentoClient = {
  isAvailable: jest.fn().mockReturnValue(true),
  generateReadOnlyToken: jest.fn().mockResolvedValue('token-123'),
  publishNotification: jest.fn().mockResolvedValue({})
};

jest.unstable_mockModule('../functions/utils/momento-client.mjs', () => ({
  momentoClient: mockMomentoClient
}));

describe('JWT Claims Refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockSend.mockResolvedValue({
      Entries: [{ EventId: 'event-123' }],
      FailedEntryCount: 0
    });

    mockPutEventsCommand.mockImplementation((params) => ({
      type: 'PutEventsCommand',
      ...params
    }));
  });

  test('should import functions without syntax errors', async () => {
    const module = await import('../functions/billing/jwt-claims-refresh.mjs');

    expect(module.triggerJwtClaimsRefresh).toBeDefined();
    expect(module.triggerJwtRefreshForSubscriptionChange).toBeDefined();
    expect(module.triggerJwtRefreshForNewUser).toBeDefined();
    expect(module.jwtRefreshHandler).toBeDefined();
  });

  test('should trigger JWT refresh successfully', async () => {
    const { triggerJwtClaimsRefresh } = await import('../functions/billing/jwt-claims-refresh.mjs');

    const result = await triggerJwtClaimsRefresh('tenant123', ['user1', 'user2'], 'test_reason');

    expect(result.tenantId).toBe('tenant123');
    expect(result.usernames).toEqual(['user1', 'user2']);
    expect(result.reason).toBe('test_reason');
    expect(result.notifications.eventBridge.success).toBe(true);
  });

  test('should handle subscription change', async () => {
    const { triggerJwtRefreshForSubscriptionChange } = await import('../functions/billing/jwt-claims-refresh.mjs');

    const users = [{ username: 'user1' }, { username: 'user2' }];
    const result = await triggerJwtRefreshForSubscriptionChange('tenant123', 'free', 'creator', users);

    expect(result.reason).toBe('subscription_upgrade_to_creator');
    expect(result.usernames).toEqual(['user1', 'user2']);
  });

  test('should handle new user', async () => {
    const { triggerJwtRefreshForNewUser } = await import('../functions/billing/jwt-claims-refresh.mjs');

    const result = await triggerJwtRefreshForNewUser('newuser', 'tenant123', 'creator');

    expect(result.reason).toBe('user_joined_tenant_creator_plan');
    expect(result.usernames).toEqual(['newuser']);
  });

  test('should handle Lambda event', async () => {
    const { jwtRefreshHandler } = await import('../functions/billing/jwt-claims-refresh.mjs');

    const event = {
      tenantId: 'tenant123',
      usernames: ['user1'],
      reason: 'test_refresh'
    };

    const result = await jwtRefreshHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
  });

  test('should handle EventBridge failures gracefully', async () => {
    mockSend.mockRejectedValueOnce(new Error('EventBridge error'));

    const { triggerJwtClaimsRefresh } = await import('../functions/billing/jwt-claims-refresh.mjs');

    const result = await triggerJwtClaimsRefresh('tenant123', ['user1'], 'test_reason');

    expect(result.notifications.eventBridge.success).toBe(false);
    expect(result.notifications.eventBridge.error).toBe('EventBridge error');
  });

  test('should handle Momento failures gracefully', async () => {
    mockMomentoClient.publishNotification.mockRejectedValueOnce(new Error('Momento error'));

    const { triggerJwtClaimsRefresh } = await import('../functions/billing/jwt-claims-refresh.mjs');

    const result = await triggerJwtClaimsRefresh('tenant123', ['user1'], 'test_reason');

    // The function should succeed but log the error internally
    expect(result.notifications.eventBridge.success).toBe(true);
    expect(result.notifications.momento).toBe(null); // No error object set since publishRefreshNotification handles errors internally
  });

  test('should handle Momento unavailable', async () => {
    mockMomentoClient.isAvailable.mockReturnValue(false);

    const { triggerJwtClaimsRefresh } = await import('../functions/billing/jwt-claims-refresh.mjs');

    const result = await triggerJwtClaimsRefresh('tenant123', ['user1'], 'test_reason');

    expect(mockMomentoClient.publishNotification).not.toHaveBeenCalled();
  });

  test('should handle Lambda validation errors', async () => {
    const { jwtRefreshHandler } = await import('../functions/billing/jwt-claims-refresh.mjs');

    const event = { usernames: ['user1'], reason: 'test' }; // Missing tenantId

    const result = await jwtRefreshHandler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(false);
    expect(body.error).toBe('tenantId is required');
  });

  test('should handle different subscription change scenarios', async () => {
    const { triggerJwtRefreshForSubscriptionChange } = await import('../functions/billing/jwt-claims-refresh.mjs');

    const users = [{ username: 'user1' }];

    // Test downgrade
    const downgradeResult = await triggerJwtRefreshForSubscriptionChange('tenant123', 'creator', 'free', users);
    expect(downgradeResult.reason).toBe('subscription_downgrade_from_creator');

    // Test plan change
    const changeResult = await triggerJwtRefreshForSubscriptionChange('tenant123', 'creator', 'pro', users);
    expect(changeResult.reason).toBe('subscription_change_creator_to_pro');
  });
});
