// __tests__/verify-domain.test.mjs
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let ddbInstance;
let sesInstance;
let PutItemCond;
let QueryCommand;
let CreateEmailIdentityCommand;
let GetEmailIdentityCommand;
let marshall;
let unmarshall;
let mockGetUserContext;
let mockFormatResponse;
let mockFormatAuthError;
let mockRandomUUID;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    // DynamoDB client mock
    ddbInstance = { send: jest.fn() };
    sesInstance = { send: jest.fn() };

    // DynamoDB SDK mocks
    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ddbInstance),
      PutItemCommand: jest.fn((params) => ({ __type: 'PutItem', ...params })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
    }));

    // SES SDK mocks
    jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
      SESv2Client: jest.fn(() => sesInstance),
      CreateEmailIdentityCommand: jest.fn((params) => ({ __type: 'CreateEmailIdentity', ...params })),
      GetEmailIdentityCommand: jest.fn((params) => ({ __type: 'GetEmailIdentity', ...params })),
    }));

    // util-dynamodb mocks
    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((obj) => obj),
    }));

    // crypto mock
    mockRandomUUID = jest.fn(() => 'test-uuid-123');
    jest.unstable_mockModule('crypto', () => ({
      randomUUID: mockRandomUUID,
    }));

    // helpers mock
    mockFormatResponse = jest.fn((statusCode, body) => ({
      statusCode,
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }));
    jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
      formatResponse: mockFormatResponse,
    }));

    // auth context mock
    mockGetUserContext = jest.fn();
    mockFormatAuthError = jest.fn((message) => ({
      statusCode: 401,
      body: JSON.stringify({ error: message }),
    }));
    jest.unstable_mockModule('../functions/auth/get-user-context.mjs', () => ({
      getUserContext: mockGetUserContext,
      formatAuthError: mockFormatAuthError,
    }));

    // Import after mocks
    ({ handler } = await import('../functions/senders/verify-domain.mjs'));
    ({ PutItemCommand, QueryCommand } = await import('@aws-sdk/client-dynamodb'));
    ({ CreateEmailIdentityCommand, GetEmailIdentityCommand } = await import('@aws-sdk/client-sesv2'));
    ({ marshall, unmarshall } = await import('@aws-sdk/util-dynamodb'));
  });

  return {
    handler,
    ddbInstance,
    sesInstance,
    PutItemCommand,
    QueryCommand,
    CreateEmailIdentityCommand,
    GetEmailIdentityCommand,
    marshall,
    unmarshall,
    mockGetUserContext,
    mockFormatResponse,
    mockFormatAuthError,
    mockRandomUUID,
  };
}

describe('verify-domain handler', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    process.env.SES_CONFIGURATION_SET = 'test-config-set';
    await loadIsolated();
  });

  test('returns 401 when no tenant access', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: null });

    const event = {
      body: JSON.stringify({ domain: 'example.com' }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatAuthError).toHaveBeenCalledWith('Tenant access required');
    expect(result.statusCode).toBe(401);
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when domain is missing', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      body: JSON.stringify({}),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'Domain is required');
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when domain format is invalid', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      body: JSON.stringify({ domain: 'invalid..domain' }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'Invalid domain format');
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when domain includes protocol', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      body: JSON.stringify({ domain: 'https://example.com' }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'Domain should not include protocol or path');
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when DNS verification not available for free tier', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      body: JSON.stringify({ domain: 'example.com' }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, {
      error: 'DNS verification not available for your tier',
      upgradeRequired: true,
      currentTier: 'free-tier'
    });
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns 409 when domain already exists', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const existingDomain = {
      domain: 'example.com',
      verificationStatus: 'pending'
    };

    // Mock existing domain query
    ddbInstance.send.mockResolvedValue({
      Items: [existingDomain]
    });

    const event = {
      body: JSON.stringify({ domain: 'example.com' }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(409, {
      error: 'Domain already configured',
      domain: 'example.com',
      verificationStatus: 'pending'
    });
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('successfully initiates domain verification with DKIM records', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    // No existing domain
    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] }) // Query for existing domain
      .mockResolvedValueOnce({}); // PutItem success

    // Mock SES responses
    sesInstance.send
      .mockResolvedValueOnce({ // CreateEmailIdentity
        identityArn: 'arn:aws:ses:us-east-1:123456789012:identity/example.com'
      })
      .mockResolvedValueOnce({ // GetEmailIdentity
        VerificationStatus: 'Pending',
        DkimAttributes: {
          Tokens: ['token1', 'token2']
        }
      });

    const event = {
      body: JSON.stringify({ domain: 'example.com' }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    // Verify SES calls
    expect(sesInstance.send).toHaveBeenCalledTimes(2);

    const createCall = sesInstance.send.mock.calls[0][0];
    expect(createCall.__type).toBe('CreateEmailIdentity');
    expect(createCall.EmailIdentity).toBe('example.com');
    expect(createCall.ConfigurationSetName).toBe('test-config-set');

    const getCall = sesInstance.send.mock.calls[1][0];
    expect(getCall.__type).toBe('GetEmailIdentity');
    expect(getCall.EmailIdentity).toBe('example.com');

    // Verify DynamoDB PutItem call
    expect(ddbInstance.send).toHaveBeenCalledTimes(2);
    const putItemCall = ddbInstance.send.mock.calls[1][0];
    expect(putItemCall.__type).toBe('PutItem');
    expect(putItemCall.TableName).toBe('test-table');
    expect(putItemCall.ConditionExpression).toBe('attribute_not_exists(pk) AND attribute_not_exists(sk)');

    // Verify response
    expect(mockFormatResponse).toHaveBeenCalledWith(201, {
      domain: 'example.com',
      verificationStatus: 'pending',
      dnsRecords: [
        {
          name: 'token1._domainkey.example.com',
          type: 'CNAME',
          value: 'token1.dkim.amazonses.com',
          description: 'DKIM record 1 for email authentication'
        },
        {
          name: 'token2._domainkey.example.com',
          type: 'CNAME',
          value: 'token2.dkim.amazonses.com',
          description: 'DKIM record 2 for email authentication'
        },
        {
          name: '_amazonses.example.com',
          type: 'TXT',
          value: 'amazonses-verification-record-placeholder',
          description: 'Domain ownership verification record'
        }
      ],
      createdAt: expect.any(String),
      message: 'Domain verification initiated. Please add the DNS records to complete verification.'
    });
  });

  test('successfully initiates domain verification without DKIM tokens', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    sesInstance.send
      .mockResolvedValueOnce({
        identityArn: 'arn:aws:ses:us-east-1:123456789012:identity/example.com'
      })
      .mockResolvedValueOnce({
        VerificationStatus: 'Pending'
        // No DkimAttributes
      });

    const event = {
      body: JSON.stringify({ domain: 'example.com' }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(201, expect.objectContaining({
      domain: 'example.com',
      verificationStatus: 'pending',
      dnsRecords: [
        {
          name: '_amazonses.example.com',
          type: 'TXT',
          value: 'amazonses-verification-record-placeholder',
          description: 'Domain ownership verification record'
        }
      ]
    }));
  });

  test('handles SES PutEmailIdentity failure', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send.mockResolvedValue({ Items: [] });
    sesInstance.send.mockRejectedValue(new Error('SES error'));

    const event = {
      body: JSON.stringify({ domain: 'example.com' }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(500, {
      error: 'Failed to initiate domain verification',
      details: 'SES error'
    });
    expect(ddbInstance.send).toHaveBeenCalledTimes(1); // Only query, no put
  });

  test('handles SES GetEmailIdentity failure gracefully', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    sesInstance.send
      .mockResolvedValueOnce({
        identityArn: 'arn:aws:ses:us-east-1:123456789012:identity/example.com'
      })
      .mockRejectedValueOnce(new Error('GetEmailIdentity failed'));

    const event = {
      body: JSON.stringify({ domain: 'example.com' }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    // Should still succeed with empty DNS records
    expect(mockFormatResponse).toHaveBeenCalledWith(201, expect.objectContaining({
      domain: 'example.com',
      verificationStatus: 'pending',
      dnsRecords: []
    }));
  });

  test('handles DynamoDB conditional check failure', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] })
      .mockRejectedValueOnce(Object.assign(new Error('Conditional check failed'), {
        name: 'ConditionalCheckFailedException'
      }));

    sesInstance.send
      .mockResolvedValueOnce({
        identityArn: 'arn:aws:ses:us-east-1:123456789012:identity/example.com'
      })
      .mockResolvedValueOnce({
        VerificationStatus: 'Pending'
      });

    const event = {
      body: JSON.stringify({ domain: 'example.com' }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(409, 'Domain verification already exists');
  });

  test('handles invalid authorization context error', async () => {
    mockGetUserContext.mockImplementation(() => {
      throw new Error('Invalid authorization context');
    });

    const event = {
      body: JSON.stringify({ domain: 'example.com' }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatAuthError).toHaveBeenCalledWith('Authentication required');
  });

  test('defaults to free tier when tier not specified', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      body: JSON.stringify({ domain: 'example.com' }),
      requestContext: { authorizer: {} }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, {
      error: 'DNS verification not available for your tier',
      upgradeRequired: true,
      currentTier: 'free-tier'
    });
  });

  test('handles missing request body', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'Domain is required');
  });

  test('validates domain with path', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      body: JSON.stringify({ domain: 'example.com/path' }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'Domain should not include protocol or path');
  });

  test('works for pro tier', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    sesInstance.send
      .mockResolvedValueOnce({
        identityArn: 'arn:aws:ses:us-east-1:123456789012:identity/example.com'
      })
      .mockResolvedValueOnce({
        VerificationStatus: 'Pending'
      });

    const event = {
      body: JSON.stringify({ domain: 'example.com' }),
      requestContext: { authorizer: { tier: 'pro-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(201, expect.objectContaining({
      domain: 'example.com',
      verificationStatus: 'pending'
    }));
  });
});
