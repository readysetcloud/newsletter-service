import { jest } from '@jest/globals';

// Mock the momento-client module
const mockMomentoClient = {
  isAvailable: jest.fn(),
  generateReadOnlyToken: jest.fn(),
  getCacheName: jest.fn()
};

jest.unstable_mockModule('../functions/utils/momento-client.mjs', () => ({
  momentoClient: mockMomentoClient
}));

// Mock crypto module
jest.unstable_mockModule('crypto', () => ({
  randomUUID: jest.fn(() => 'test-correlation-id')
}));

// Import the handler after mocking
const { handler } = await import('../functions/auth/cognito-pre-token-generation.mjs');

describe('Cognito Pre Token Generation Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.TTL_HOURS;
    mockMomentoClient.isAvailable.mockReturnValue(true);
    mockMomentoClient.getCacheName.mockReturnValue('newsletter-notifications');
    mockMomentoClient.generateReadOnlyToken.mockResolvedValue('mock-momento-token');
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should extract complete user context from valid Cognito event', async () => {
    const event = {
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

    const result = await handler(event);

    expect(mockMomentoClient.generateReadOnlyToken).toHaveBeenCalledWith('techcorp', 'user-123', 24);
    expect(result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:momento_token']).toBe('mock-momento-token');
  });

  it('should handle missing tenant ID', async () => {
    const event = {
      triggerSource: 'TokenGeneration_HostedAuth',
      userName: 'test@example.com',
      userPoolId: 'us-east-1_XXXXXXXXX',
      request: {
        userAttributes: {
          sub: 'user-123',
          email: 'test@example.com'
        }
      }
    };

    const result = await handler(event);

    expect(mockMomentoClient.generateReadOnlyToken).not.toHaveBeenCalled();
    expect(result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:momento_token']).toBe('');
  });

  it('should handle Momento API failure gracefully', async () => {
    mockMomentoClient.generateReadOnlyToken.mockRejectedValue(new Error('Momento API Error'));

    const event = {
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

    const result = await handler(event);

    expect(console.error).toHaveBeenCalledWith(
      'Failed to generate Momento read only token',
      expect.objectContaining({
        correlationId: 'test-correlation-id',
        tenantId: 'techcorp',
        userId: 'user-123',
        error: 'Momento API Error'
      })
    );
    expect(result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:momento_token']).toBe('');
  });

  it('should never throw errors that block authentication', async () => {
    mockMomentoClient.isAvailable.mockImplementation(() => {
      throw new Error('Unexpected error');
    });

    const event = {
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

    const result = await handler(event);

    expect(console.error).toHaveBeenCalledWith(
      'Pre Token Generation failed - continuing authentication',
      expect.objectContaining({
        correlationId: 'test-correlation-id',
        userName: 'test@example.com',
        error: 'Unexpected error'
      })
    );
    expect(result).toEqual(event);
  });
});
