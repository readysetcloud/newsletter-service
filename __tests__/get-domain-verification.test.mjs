// __tests__/get-domain-verification.test.mjs
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let ddbInstance;
let sesInstance;
let QueryCommand;
let UpdateItemCommand;
let GetEmailIdentityCommand;
let marshall;
let unmarshall;
let mockGetUserContext;
let mockFormatResponse;
let mockFormatAuthError;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    // DynamoDB client mock
    ddbInstance = { send: jest.fn() };
    sesInstance = { send: jest.fn() };

    // DynamoDB SDK mocks
    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ddbInstance),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
    }));

    // SES SDK mocks
    jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
      SESv2Client: jest.fn(() => sesInstance),
      GetEmailIdentityCommand: jest.fn((params) => ({ __type: 'GetEmailIdentity', ...params })),
    }));

    // util-dynamodb mocks
    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((obj) => obj),
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
    ({ handler } = await import('../functions/senders/get-domain-verification.mjs'));
    ({ QueryCommand, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb'));
    ({ GetEmailIdentityCommand } = await import('@aws-sdk/client-sesv2'));
    ({ marshall, unmarshall } = await import('@aws-sdk/util-dynamodb'));
  });

  return {
    handler,
    ddbInstance,
    sesInstance,
    QueryCommand,
    UpdateItemCommand,
    GetEmailIdentityCommand,
    marshall,
    unmarshall,
    mockGetUserContext,
    mockFormatResponse,
    mockFormatAuthError,
  };
}

describe('get-domain-verification handler', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    await loadIsolated();
  });

  test('returns 401 when no tenant access', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: null });

    const event = {
      pathParameters: { domain: 'example.com' }
    };

    const result = await handler(event);

    expect(mockFormatAuthError).toHaveBeenCalledWith('Tenant access required');
    expect(result.statusCode).toBe(401);
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when domain parameter is missing', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      pathParameters: {}
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, {
      error: 'Domain parameter is required'
    });
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when domain format is invalid', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      pathParameters: { domain: 'invalid..domain' }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, {
      error: 'Invalid domain format'
    });
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns 404 when domain verification not found', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    // Mock no domain record found
    ddbInstance.send.mockResolvedValue({ Items: [] });

    const event = {
      pathParameters: { domain: 'example.com' }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(404, {
      error: 'Domain verification not found',
      message: 'Please initiate domain verification first'
    });
    expect(ddbInstance.send).toHaveBeenCalledTimes(1);
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns domain verification details with pending status', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const domainRecord = {
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
          name: '_amazonses.example.com',
          type: 'TXT',
          value: 'verification-token',
          description: 'Domain ownership verification record'
        }
      ],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    };

    // Mock domain record found
    ddbInstance.send.mockResolvedValue({
      Items: [domainRecord]
    });

    // Mock SES response
    sesInstance.send.mockResolvedValue({
      VerificationStatus: 'Pending',
      VerifiedForSendingStatus: false
    });

    const event = {
      pathParameters: { domain: 'example.com' }
    };

    const result = await handler(event);

    expect(ddbInstance.send).toHaveBeenCalledTimes(1);
    expect(sesInstance.send).toHaveBeenCalledTimes(1);

    const sesCall = sesInstance.send.mock.calls[0][0];
    expect(sesCall.__type).toBe('GetEmailIdentity');
    expect(sesCall.EmailIdentity).toBe('example.com');

    expect(mockFormatResponse).toHaveBeenCalledWith(200, {
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
          name: '_amazonses.example.com',
          type: 'TXT',
          value: 'verification-token',
          description: 'Domain ownership verification record'
        }
      ],
      instructions: expect.arrayContaining([
        "To verify your domain ownership, you need to add DNS records to your domain's DNS settings.",
        expect.stringContaining("Record 1:")
      ]),
      estimatedVerificationTime: 'Verification typically completes within 15-30 minutes after DNS records are added, but can take up to 72 hours.',
      troubleshooting: expect.arrayContaining([
        "Ensure DNS records are added exactly as shown, including any trailing dots"
      ]),
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      verifiedAt: null
    });
  });

  test('returns domain verification details with verified status and updates record', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const domainRecord = {
      domain: 'example.com',
      verificationStatus: 'pending', // Stored as pending
      dnsRecords: [
        {
          name: '_amazonses.example.com',
          type: 'TXT',
          value: 'verification-token'
        }
      ],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [domainRecord] }) // Query
      .mockResolvedValueOnce({}); // UpdateItem

    // Mock SES showing verified status
    sesInstance.send.mockResolvedValue({
      VerificationStatus: 'Success',
      VerifiedForSendingStatus: true
    });

    const event = {
      pathParameters: { domain: 'example.com' }
    };

    const result = await handler(event);

    expect(ddbInstance.send).toHaveBeenCalledTimes(2);
    expect(sesInstance.send).toHaveBeenCalledTimes(1);

    // Verify UpdateItem call to update status
    const updateCall = ddbInstance.send.mock.calls[1][0];
    expect(updateCall.__type).toBe('UpdateItem');
    expect(updateCall.UpdateExpression).toContain('verificationStatus = :status');
    expect(updateCall.UpdateExpression).toContain('verifiedAt = :verifiedAt');

    expect(mockFormatResponse).toHaveBeenCalledWith(200, expect.objectContaining({
      domain: 'example.com',
      verificationStatus: 'verified',
      estimatedVerificationTime: 'Domain is verified and ready for sending emails.',
      troubleshooting: expect.arrayContaining([
        "Your domain is successfully verified!"
      ]),
      updatedAt: expect.any(String),
      verifiedAt: expect.any(String)
    }));
  });

  test('returns domain verification details with failed status', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const domainRecord = {
      domain: 'example.com',
      verificationStatus: 'pending',
      dnsRecords: [],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    };

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [domainRecord] })
      .mockResolvedValueOnce({});

    // Mock SES showing failed status
    sesInstance.send.mockResolvedValue({
      VerificationStatus: 'Failed',
      VerifiedForSendingStatus: false
    });

    const event = {
      pathParameters: { domain: 'example.com' }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(200, expect.objectContaining({
      domain: 'example.com',
      verificationStatus: 'failed',
      estimatedVerificationTime: 'Verification failed. Please check your DNS records and try again.',
      troubleshooting: expect.arrayContaining([
        "Double-check that all DNS records are correctly configured"
      ])
    }));
  });

  test('continues with stored status when SES check fails', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const domainRecord = {
      domain: 'example.com',
      verificationStatus: 'pending',
      dnsRecords: [],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    };

    ddbInstance.send.mockResolvedValue({ Items: [domainRecord] });

    // SES check fails
    sesInstance.send.mockRejectedValue(new Error('SES error'));

    const event = {
      pathParameters: { domain: 'example.com' }
    };

    const result = await handler(event);

    // Should still return response with stored status
    expect(mockFormatResponse).toHaveBeenCalledWith(200, expect.objectContaining({
      domain: 'example.com',
      verificationStatus: 'pending' // Uses stored status
    }));
  });

  test('adds default descriptions for DNS records without descriptions', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const domainRecord = {
      domain: 'example.com',
      verificationStatus: 'pending',
      dnsRecords: [
        {
          name: 'record1.example.com',
          type: 'TXT',
          value: 'value1'
          // No description
        },
        {
          name: 'record2.example.com',
          type: 'CNAME',
          value: 'value2'
          // No description
        }
      ],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    };

    ddbInstance.send.mockResolvedValue({ Items: [domainRecord] });
    sesInstance.send.mockResolvedValue({
      VerificationStatus: 'Pending',
      VerifiedForSendingStatus: false
    });

    const event = {
      pathParameters: { domain: 'example.com' }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(200, expect.objectContaining({
      dnsRecords: [
        {
          name: 'record1.example.com',
          type: 'TXT',
          value: 'value1',
          description: 'Domain ownership verification'
        },
        {
          name: 'record2.example.com',
          type: 'CNAME',
          value: 'value2',
          description: 'Email authentication (DKIM)'
        }
      ]
    }));
  });

  test('handles invalid authorization context error', async () => {
    mockGetUserContext.mockImplementation(() => {
      throw new Error('Invalid authorization context');
    });

    const event = {
      pathParameters: { domain: 'example.com' }
    };

    const result = await handler(event);

    expect(mockFormatAuthError).toHaveBeenCalledWith('Authentication required');
  });

  test('handles DynamoDB query error', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send.mockRejectedValue(new Error('DynamoDB error'));

    const event = {
      pathParameters: { domain: 'example.com' }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(500, {
      error: 'Failed to retrieve domain verification details',
      message: 'Please try again later'
    });
  });

  test('handles missing pathParameters', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {};

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, {
      error: 'Domain parameter is required'
    });
  });

  test('validates domain with protocol', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      pathParameters: { domain: 'https://example.com' }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, {
      error: 'Domain should not include protocol or path'
    });
  });

  test('does not update status when SES status matches stored status', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const domainRecord = {
      domain: 'example.com',
      verificationStatus: 'verified', // Already verified
      dnsRecords: [],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      verifiedAt: '2024-01-01T01:00:00Z'
    };

    ddbInstance.send.mockResolvedValue({ Items: [domainRecord] });

    sesInstance.send.mockResolvedValue({
      VerificationStatus: 'Success',
      VerifiedForSendingStatus: true
    });

    const event = {
      pathParameters: { domain: 'example.com' }
    };

    const result = await handler(event);

    // Should not call UpdateItem since status hasn't changed
    expect(ddbInstance.send).toHaveBeenCalledTimes(1);

    expect(mockFormatResponse).toHaveBeenCalledWith(200, expect.objectContaining({
      verificationStatus: 'verified',
      updatedAt: '2024-01-01T00:00:00Z', // Original timestamp
      verifiedAt: '2024-01-01T01:00:00Z'
    }));
  });
});
