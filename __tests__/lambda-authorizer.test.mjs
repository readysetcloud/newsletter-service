import { jest } from '@jest/globals';

// ---- Mocks ----

// aws-jwt-verify
const mockVerify = jest.fn();
jest.unstable_mockModule('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: jest.fn(() => ({ verify: mockVerify })) },
}));

// Cognito Identity Provider
const mockSend = jest.fn();
jest.unstable_mockModule('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: mockSend })),
  GetUserCommand: jest.fn((params) => ({ __type: 'GetUser', ...params })),
}));

// validate-api-key
const mockValidateApiKey = jest.fn();
jest.unstable_mockModule('../functions/auth/validate-api-key.mjs', () => ({
  validateApiKey: mockValidateApiKey,
}));

// Import after mocks
const { handler } = await import('../functions/auth/lambda-authorizer.mjs');

describe('Lambda Authorizer (JWT + API key)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USER_POOL_ID = 'test-user-pool-id';
    process.env.USER_POOL_CLIENT_ID = 'test-client-id';
  });

  it('prioritizes JWT when both JWT and API key are present', async () => {
    // Verifier returns OK
    mockVerify.mockResolvedValue({ sub: 'user-123' });
    // GetUser returns attributes
    mockSend.mockResolvedValue({
      UserAttributes: [
        { Name: 'sub', Value: 'user-123' },
        { Name: 'email', Value: 'test@example.com' },
        { Name: 'given_name', Value: 'Jane' },
        { Name: 'family_name', Value: 'Doe' },
        { Name: 'custom:tenant_id', Value: 'tenant-xyz' },
        { Name: 'zoneinfo', Value: 'America/Chicago' },
      ],
    });

    const event = {
      headers: {
        Authorization: 'Bearer valid-access-token',
        'x-api-key': 'ak_should_be_ignored',
      },
      methodArn: 'arn:aws:execute-api:us-east-1:123:apiid/stage/GET/path',
    };

    const res = await handler(event);

    expect(mockVerify).toHaveBeenCalledWith('valid-access-token');
    // Should not invoke api key path
    expect(mockValidateApiKey).not.toHaveBeenCalled();

    expect(res.principalId).toBe('user-123');
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(res.policyDocument.Statement[0].Resource).toBe(
      'arn:aws:execute-api:us-east-1:123:apiid/stage/*/*'
    );
    expect(res.context.authType).toBe('jwt');
    expect(res.context.userId).toBe('user-123');
    expect(res.context.email).toBe('test@example.com');
    expect(res.context.tenantId).toBe('tenant-xyz');
    expect(res.context.firstName).toBe('Jane');
    expect(res.context.lastName).toBe('Doe');
    expect(res.context.timezone).toBe('America/Chicago');
  });

  it('allows with valid JWT even if GetUser fails (no attributes)', async () => {
    mockVerify.mockResolvedValue({ sub: 'user-abc' });
    mockSend.mockRejectedValue(new Error('GetUser failure'));

    const event = {
      headers: { Authorization: 'Bearer token-ok' },
      methodArn: 'arn:aws:execute-api:us-east-1:123:apiid/stage/POST/thing',
    };

    const res = await handler(event);

    expect(res.principalId).toBe('user-abc');
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(res.context.userId).toBe('user-abc');
    expect(res.context.email).toBeUndefined();
    expect(res.context.tenantId).toBe(undefined);
  });

  it('falls back to API key when Authorization is a non-bearer key', async () => {
    mockValidateApiKey.mockResolvedValue({
      createdBy: 'creator-1',
      tenantId: 'tenant-123',
      keyId: 'key-456',
    });

    const event = {
      headers: { Authorization: 'ak_live_abc123' },
      methodArn: 'arn:aws:execute-api:us-east-1:123:apiid/stage/GET/health',
    };

    const res = await handler(event);

    expect(mockValidateApiKey).toHaveBeenCalledWith('ak_live_abc123');
    expect(res.principalId).toBe('tenant-123'); // using tenantId in principal per code
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(res.context.authType).toBe('api_key');
    expect(res.context.userId).toBe('creator-1');
    expect(res.context.tenantId).toBe('tenant-123');
    expect(res.context.keyId).toBe('key-456');
  });

  it('supports lowercase authorization header', async () => {
    mockVerify.mockResolvedValue({ sub: 'user-777' });
    mockSend.mockResolvedValue({
      UserAttributes: [
        { Name: 'sub', Value: 'user-777' },
        { Name: 'email', Value: 'a@b.com' },
      ],
    });

    const event = {
      headers: { authorization: 'Bearer tok' },
      methodArn: 'arn:aws:execute-api:us-east-1:123:apiid/stage/GET/x',
    };

    const res = await handler(event);
    expect(res.principalId).toBe('user-777');
    expect(res.context.authType).toBe('jwt');
    expect(res.context.email).toBe('a@b.com');
  });

  it('denies with invalid JWT', async () => {
    mockVerify.mockRejectedValue(new Error('bad token'));

    const event = {
      headers: { Authorization: 'Bearer nope' },
      methodArn: 'arn:aws:execute-api:us-east-1:123:apiid/stage/GET/x',
    };

    const res = await handler(event);
    expect(res.principalId).toBe('user');
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('denies when no Authorization header is provided', async () => {
    const event = {
      headers: {},
      methodArn: 'arn:aws:execute-api:us-east-1:123:apiid/stage/GET/x',
    };

    const res = await handler(event);
    expect(res.principalId).toBe('user');
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockValidateApiKey).not.toHaveBeenCalled();
  });

  it('API key invalid -> deny', async () => {
    mockValidateApiKey.mockResolvedValue(null);

    const event = {
      headers: { Authorization: 'ak_bad' },
      methodArn: 'arn:aws:execute-api:us-east-1:123:apiid/stage/GET/x',
    };

    const res = await handler(event);
    expect(res.principalId).toBe('user');
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
  });
});
