import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let ddbInstance;
let sesInstance;
let mockGetUserContext;
let mockFormatResponse;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    ddbInstance = { send: jest.fn() };
    sesInstance = { send: jest.fn() };

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ddbInstance),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
      SESv2Client: jest.fn(() => sesInstance),
      SendCustomVerificationEmailCommand: jest.fn((params) => ({ __type: 'SendCustomVerificationEmail', ...params })),
      CreateEmailIdentityCommand: jest.fn((params) => ({ __type: 'CreateEmailIdentity', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((obj) => obj),
    }));

    mockFormatResponse = jest.fn((statusCode, body) => ({
      statusCode,
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }));
    jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
      formatResponse: mockFormatResponse,
    }));

    mockGetUserContext = jest.fn();
    jest.unstable_mockModule('../functions/auth/get-user-context.mjs', () => ({
      getUserContext: mockGetUserContext,
      formatAuthError: jest.fn((message) => ({ statusCode: 401, body: JSON.stringify({ error: message }) })),
    }));

    jest.unstable_mockModule('../functions/senders/types.mjs', () => ({
      KEY_PATTERNS: {
        SENDER: (id) => `sender#${id}`,
      }
    }));

    ({ handler } = await import('../functions/senders/resend-verification.mjs'));
  });
}

describe('resend-verification handler', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    process.env.SES_VERIFY_TEMPLATE_NAME = 'test-verification-template';
    process.env.ENVIRONMENT = 'production';
    await loadIsolated();
  });

  test('uses standard AWS verification email in non-production environment', async () => {
    process.env.ENVIRONMENT = 'sandbox';
    process.env.SES_CONFIGURATION_SET = 'test-config-set';

    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send
      .mockResolvedValueOnce({
        Item: {
          tenantId: 'tenant-123',
          email: 'test@example.com',
          verificationType: 'mailbox',
          verificationStatus: 'pending'
        }
      })
      .mockResolvedValueOnce({});

    // Mock SES CreateEmailIdentity response
    sesInstance.send.mockResolvedValue({
      IdentityArn: 'arn:aws:ses:us-east-1:123456789012:identity/test@example.com'
    });

    const event = {
      pathParameters: { senderId: 'test-sender-123' }
    };

    await handler(event);

    // Should call SES CreateEmailIdentity for standard verification
    expect(sesInstance.send).toHaveBeenCalledTimes(1);
    const sesCall = sesInstance.send.mock.calls[0][0];
    expect(sesCall.__type).toBe('CreateEmailIdentity');
    expect(sesCall.EmailIdentity).toBe('test@example.com');
    expect(sesCall.ConfigurationSetName).toBe('test-config-set');

    expect(mockFormatResponse).toHaveBeenCalledWith(200, expect.objectContaining({
      message: 'AWS verification email sent successfully'
    }));

    process.env.ENVIRONMENT = 'production';
  });
});
