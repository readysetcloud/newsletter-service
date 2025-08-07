import { jest } from '@jest/globals';
import { handler } from '../functions/auth/cognito-post-confirmation.mjs';

// Mock AWS SDK
const mockSend = jest.fn();
jest.unstable_mockModule('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({
    send: mockSend
  })),
  AdminAddUserToGroupCommand: jest.fn((params) => params)
}));

describe('Cognito Post Confirmation Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USER_POOL_ID = 'test-pool-id';
  });

  it('should add new user to free-tier group', async () => {
    const event = {
      request: {
        userAttributes: {
          email: 'test@example.com',
          given_name: 'John',
          family_name: 'Doe'
        }
      }
    };

    mockSend.mockResolvedValueOnce({});

    const result = await handler(event);

    expect(mockSend).toHaveBeenCalledWith({
      UserPoolId: 'test-pool-id',
      Username: 'test@example.com',
      GroupName: 'free-tier'
    });

    expect(result).toEqual(event);
  });

  it('should handle errors gracefully and not break Cognito flow', async () => {
    const event = {
      request: {
        userAttributes: {
          email: 'test@example.com'
        }
      }
    };

    mockSend.mockRejectedValueOnce(new Error('AWS Error'));

    const result = await handler(event);

    expect(result).toEqual(event);
  });

  it('should handle missing email gracefully', async () => {
    const event = {
      request: {
        userAttributes: {}
      }
    };

    const result = await handler(event);

    expect(mockSend).not.toHaveBeenCalled();
    expect(result).toEqual(event);
  });
});
