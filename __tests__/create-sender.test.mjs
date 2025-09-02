// __tests__/create-sender.test.mjs
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let ddbInstance;
let sesInstance;
let schedulerInstance;
let PutItemCommand;
let QueryCommand;
// GetItemCommand removed as it's no longer used
let CreateEmailIdentityCommand;
let SendCustomVerificationEmailCommand;
let marshall;
let unmarshall;
let mockGetUserContext;
let mockFormatResponse;
let mockFormatAuthError;
let mockRandomUUID;
let mockScheduleInitialStatusCheck;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    // DynamoDB client mock
    ddbInstance = { send: jest.fn() };
    sesInstance = { send: jest.fn() }
   // DynamoDB SDK mocks
    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ddbInstance),
      PutItemCommand: jest.fn((params) => ({ __type: 'PutItem', ...params })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
      // GetItemCommand removed as it's no longer used
    }));

    // SES SDK mocks
    jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
      SESv2Client: jest.fn(() => sesInstance),
      CreateEmailIdentityCommand: jest.fn((params) => ({ __type: 'CreateEmailIdentity', ...params })),
      SendCustomVerificationEmailCommand: jest.fn((params) => ({ __type: 'SendCustomVerificationEmail', ...params })),
      GetEmailIdentityCommand: jest.fn((params) => ({ __type: 'GetEmailIdentity', ...params })),
      CreateTenantResourceAssociationCommand: jest.fn((params) => ({ __type: 'CreateTenantResourceAssociation', ...params}))
    }));

    // Scheduler SDK mocks
    schedulerInstance = { send: jest.fn() };
    jest.unstable_mockModule('@aws-sdk/client-scheduler', () => ({
      SchedulerClient: jest.fn(() => schedulerInstance),
      CreateScheduleCommand: jest.fn((params) => ({ __type: 'CreateSchedule', ...params })),
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

    // Note: send-verification-email module mock removed as we only use SES custom verification templates now

    // Mock types module
    jest.unstable_mockModule('../functions/senders/types.mjs', () => ({
      TIER_LIMITS: {
        'free-tier': { maxSenders: 1, canUseDNS: false, canUseMailbox: true },
        'creator-tier': { maxSenders: 2, canUseDNS: true, canUseMailbox: true },
        'pro-tier': { maxSenders: 5, canUseDNS: true, canUseMailbox: true }
      },
      KEY_PATTERNS: {
        SENDER: (id) => `sender#${id}`,
        SENDER_GSI1PK: (tenantId) => `sender#${tenantId}`
      }
    }));

    // Mock automatic status checking
    mockScheduleInitialStatusCheck = jest.fn();
    jest.unstable_mockModule('../functions/senders/check-sender-status-automatically.mjs', () => ({
      scheduleInitialStatusCheck: mockScheduleInitialStatusCheck,
    }));

    // Import after mocks
    ({ handler } = await import('../functions/senders/create-sender.mjs'));
    ({ PutItemCommand, QueryCommand } = await import('@aws-sdk/client-dynamodb'));
    ({ CreateEmailIdentityCommand, SendCustomVerificationEmailCommand } = await import('@aws-sdk/client-sesv2'));
    ({ marshall, unmarshall } = await import('@aws-sdk/util-dynamodb'));
  });

  return {
    handler,
    ddbInstance,
    sesInstance,
    PutItemCommand,
    QueryCommand,
    // GetItemCommand removed
    CreateEmailIdentityCommand,
    SendCustomVerificationEmailCommand,
    marshall,
    unmarshall,
    mockGetUserContext,
    mockFormatResponse,
    mockFormatAuthError,
    mockRandomUUID,
  };
}

describe('create-sender handler', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    process.env.SES_CONFIGURATION_SET = 'test-config-set';
    process.env.SES_VERIFY_TEMPLATE_NAME = 'test-verification-template';
    await loadIsolated();
  });

  test('returns 401 when no tenant access', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: null });

    const event = {
      body: JSON.stringify({ email: 'test@example.com' }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatAuthError).toHaveBeenCalledWith('Tenant access required');
    expect(result.statusCode).toBe(401);
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when email is missing', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      body: JSON.stringify({ name: 'Test Sender' }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'Email address is required');
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when email format is invalid', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      body: JSON.stringify({ email: 'invalid-email' }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'Invalid email address format');
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when DNS verification requested for free tier', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });
    ddbInstance.send.mockResolvedValue({ Items: [] }); // No existing senders

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        verificationType: 'domain'
      }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, {
      error: 'DNS verification not available for your tier',
      upgradeRequired: true,
      currentTier: 'free-tier'
    });
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns 400 when tier limit exceeded', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    // Mock existing sender for free tier (limit 1)
    ddbInstance.send.mockResolvedValue({
      Items: [{ email: 'existing@example.com' }]
    });

    const event = {
      body: JSON.stringify({ email: 'test@example.com' }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, {
      error: 'Maximum sender limit reached (1)',
      upgradeRequired: true,
      currentTier: 'free-tier',
      currentCount: 1,
      maxSenders: 1
    });
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('returns 409 when email already exists', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    // Mock existing sender with same email for creator tier (has room for more)
    ddbInstance.send.mockResolvedValue({
      Items: [{ email: 'test@example.com' }]
    });

    const event = {
      body: JSON.stringify({ email: 'test@example.com' }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(409, 'Email address already configured');
    expect(sesInstance.send).not.toHaveBeenCalled();
  });

  test('successfully creates mailbox verification sender', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    // No existing senders
    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] }) // Query for existing senders
      .mockResolvedValueOnce({}); // PutItem success

    // SES success for custom verification email and tenant association
    sesInstance.send.mockResolvedValue({
      MessageId: 'test-message-id-123'
    });

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        name: 'Test Sender',
        verificationType: 'mailbox'
      }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    // Verify SES calls for custom verification email and tenant association
    expect(sesInstance.send).toHaveBeenCalledTimes(2);
    const sesCall1 = sesInstance.send.mock.calls[0][0];
    expect(sesCall1.__type).toBe('SendCustomVerificationEmail');
    expect(sesCall1.EmailAddress).toBe('test@example.com');
    expect(sesCall1.TemplateName).toBe('test-verification-template');

    const sesCall2 = sesInstance.send.mock.calls[1][0];
    expect(sesCall2.__type).toBe('CreateTenantResourceAssociation');

    // Verify DynamoDB PutItem call
    expect(ddbInstance.send).toHaveBeenCalledTimes(2);
    const putCall = ddbInstance.send.mock.calls[1][0];
    expect(putCall.__type).toBe('PutItem');
    expect(putCall.TableName).toBe('test-table');
    expect(putCall.ConditionExpression).toBe('attribute_not_exists(pk) AND attribute_not_exists(sk)');

    // Verify response
    expect(mockFormatResponse).toHaveBeenCalledWith(201, {
      senderId: 'test-uuid-123',
      email: 'test@example.com',
      name: 'Test Sender',
      verificationType: 'mailbox',
      verificationStatus: 'pending',
      isDefault: true, // First sender is default
      domain: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      message: 'Verification email sent. Please check your inbox and click the verification link.'
    });
  });

  test('successfully creates domain verification sender for creator tier', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    // No existing senders
    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] }) // Query for existing senders
      .mockResolvedValueOnce({}); // PutItem success

    // SES success for domain verification
    sesInstance.send.mockResolvedValue({
      identityArn: 'arn:aws:ses:us-east-1:123456789012:identity/example.com'
    });

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        name: 'Test Sender',
        verificationType: 'domain'
      }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    // Verify SES calls for domain verification and tenant association
    expect(sesInstance.send).toHaveBeenCalledTimes(2);
    const sesCall1 = sesInstance.send.mock.calls[0][0];
    expect(sesCall1.__type).toBe('CreateEmailIdentity');
    expect(sesCall1.EmailIdentity).toBe('example.com');

    const sesCall2 = sesInstance.send.mock.calls[1][0];
    expect(sesCall2.__type).toBe('CreateTenantResourceAssociation');

    // Verify response
    expect(mockFormatResponse).toHaveBeenCalledWith(201, {
      senderId: 'test-uuid-123',
      email: 'test@example.com',
      name: 'Test Sender',
      verificationType: 'domain',
      verificationStatus: 'pending',
      isDefault: true,
      domain: 'example.com',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      message: 'Domain verification initiated. DNS records will be provided separately.'
    });
  });

  test('sets isDefault to false when other senders exist', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    // One existing sender
    ddbInstance.send
      .mockResolvedValueOnce({ Items: [{ email: 'existing@example.com' }] })
      .mockResolvedValueOnce({});

    sesInstance.send.mockResolvedValue({
      identityArn: 'arn:aws:ses:us-east-1:123456789012:identity/test@example.com'
    });

    const event = {
      body: JSON.stringify({ email: 'test@example.com' }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(201, expect.objectContaining({
      isDefault: false // Not default when others exist
    }));
  });

  test('handles SES verification failure for domain verification', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send.mockResolvedValue({ Items: [] });
    sesInstance.send.mockRejectedValue(new Error('SES error'));

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        verificationType: 'domain'
      }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(500, 'Failed to initiate domain verification');
    expect(ddbInstance.send).toHaveBeenCalledTimes(1); // Only query, no put
  });

  test('handles DynamoDB conditional check failure', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] })
      .mockRejectedValueOnce(Object.assign(new Error('Conditional check failed'), {
        name: 'ConditionalCheckFailedException'
      }));

    sesInstance.send.mockResolvedValue({
      identityArn: 'arn:aws:ses:us-east-1:123456789012:identity/test@example.com'
    });

    const event = {
      body: JSON.stringify({ email: 'test@example.com' }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(409, 'Sender already exists');
  });

  test('handles invalid authorization context error', async () => {
    mockGetUserContext.mockImplementation(() => {
      throw new Error('Invalid authorization context');
    });

    const event = {
      body: JSON.stringify({ email: 'test@example.com' }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatAuthError).toHaveBeenCalledWith('Authentication required');
  });

  test('handles missing request body', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'Email address is required');
  });

  test('validates verification type', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        verificationType: 'invalid'
      }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    expect(mockFormatResponse).toHaveBeenCalledWith(400, 'Verification type must be either "mailbox" or "domain"');
  });

  test('uses SendCustomVerificationEmail for mailbox verification', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    // No existing senders
    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    // Mock successful custom verification email
    sesInstance.send.mockResolvedValue({
      MessageId: 'custom-verification-message-id'
    });

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        name: 'Test Sender',
        verificationType: 'mailbox'
      }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    // Verify SendCustomVerificationEmail was called with correct parameters
    expect(sesInstance.send).toHaveBeenCalledTimes(2);
    const sesCall = sesInstance.send.mock.calls[0][0];
    expect(sesCall.__type).toBe('SendCustomVerificationEmail');
    expect(sesCall.EmailAddress).toBe('test@example.com');
    expect(sesCall.TemplateName).toBe('test-verification-template');

    const tenantCall = sesInstance.send.mock.calls[1][0];
    expect(tenantCall.__type).toBe('CreateTenantResourceAssociation');

    expect(mockFormatResponse).toHaveBeenCalledWith(201, expect.objectContaining({
      email: 'test@example.com',
      verificationType: 'mailbox',
      verificationStatus: 'pending'
    }));
  });



  test('handles missing SES_VERIFY_TEMPLATE_NAME', async () => {
    // Remove template name for this test
    delete process.env.SES_VERIFY_TEMPLATE_NAME;

    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        verificationType: 'mailbox'
      }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    // Should still create the sender record but verification email sending should fail gracefully
    expect(mockFormatResponse).toHaveBeenCalledWith(201, expect.objectContaining({
      email: 'test@example.com',
      verificationType: 'mailbox',
      verificationStatus: 'pending'
    }));

    // Reset environment variable
    process.env.SES_VERIFY_TEMPLATE_NAME = 'test-verification-template';
  });

  test('handles SendCustomVerificationEmail failure gracefully', async () => {
    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    // Mock SES failure
    sesInstance.send.mockRejectedValue(new Error('SES custom verification failed'));

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        verificationType: 'mailbox'
      }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    // Should still create the sender record even if verification email fails
    expect(mockFormatResponse).toHaveBeenCalledWith(201, expect.objectContaining({
      email: 'test@example.com',
      verificationType: 'mailbox',
      verificationStatus: 'pending'
    }));
  });

  test('uses standard AWS verification email in non-production environment', async () => {
    // Set non-production environment
    process.env.ENVIRONMENT = 'sandbox';

    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    // Mock SES CreateEmailIdentity response
    sesInstance.send.mockResolvedValue({
      IdentityArn: 'arn:aws:ses:us-east-1:123456789012:identity/test@example.com'
    });

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        name: 'Test Sender',
        verificationType: 'mailbox'
      }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    // Should call SES CreateEmailIdentity for standard verification
    expect(sesInstance.send).toHaveBeenCalledTimes(2);
    const sesCall = sesInstance.send.mock.calls[0][0];
    expect(sesCall.__type).toBe('CreateEmailIdentity');
    expect(sesCall.EmailIdentity).toBe('test@example.com');
    expect(sesCall.ConfigurationSetName).toBe('test-config-set');

    const tenantCall = sesInstance.send.mock.calls[1][0];
    expect(tenantCall.__type).toBe('CreateTenantResourceAssociation');

    // Should still create the sender record
    expect(ddbInstance.send).toHaveBeenCalledTimes(2);
    const putCall = ddbInstance.send.mock.calls[1][0];
    expect(putCall.__type).toBe('PutItem');

    // Should return success with appropriate message
    expect(mockFormatResponse).toHaveBeenCalledWith(201, expect.objectContaining({
      email: 'test@example.com',
      verificationType: 'mailbox',
      verificationStatus: 'pending',
      message: 'AWS verification email sent. Please check your inbox and click the verification link.'
    }));

    // Reset environment
    process.env.ENVIRONMENT = 'production';
  });

  test('uses standard AWS verification email in stage environment', async () => {
    // Set stage environment
    process.env.ENVIRONMENT = 'stage';

    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    // Mock SES CreateEmailIdentity response
    sesInstance.send.mockResolvedValue({
      IdentityArn: 'arn:aws:ses:us-east-1:123456789012:identity/test@example.com'
    });

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        verificationType: 'mailbox'
      }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    // Should call SES CreateEmailIdentity for standard verification
    expect(sesInstance.send).toHaveBeenCalledTimes(2);
    const sesCall = sesInstance.send.mock.calls[0][0];
    expect(sesCall.__type).toBe('CreateEmailIdentity');
    expect(sesCall.EmailIdentity).toBe('test@example.com');

    const tenantCall = sesInstance.send.mock.calls[1][0];
    expect(tenantCall.__type).toBe('CreateTenantResourceAssociation');

    // Should return success with appropriate message
    expect(mockFormatResponse).toHaveBeenCalledWith(201, expect.objectContaining({
      message: 'AWS verification email sent. Please check your inbox and click the verification link.'
    }));

    // Reset environment
    process.env.ENVIRONMENT = 'production';
  });

  test('sends custom verification email in production environment', async () => {
    // Explicitly set production environment
    process.env.ENVIRONMENT = 'production';

    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    sesInstance.send.mockResolvedValue({
      MessageId: 'test-message-id-123'
    });

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        verificationType: 'mailbox'
      }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    // Should call SES for custom verification email
    expect(sesInstance.send).toHaveBeenCalledTimes(2);
    const sesCall = sesInstance.send.mock.calls[0][0];
    expect(sesCall.__type).toBe('SendCustomVerificationEmail');

    const tenantCall = sesInstance.send.mock.calls[1][0];
    expect(tenantCall.__type).toBe('CreateTenantResourceAssociation');

    // Should return success with production message
    expect(mockFormatResponse).toHaveBeenCalledWith(201, expect.objectContaining({
      message: 'Verification email sent. Please check your inbox and click the verification link.'
    }));
  });

  test('defaults to production behavior when ENVIRONMENT is not set', async () => {
    // Remove environment variable
    delete process.env.ENVIRONMENT;

    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    sesInstance.send.mockResolvedValue({
      MessageId: 'test-message-id-123'
    });

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        verificationType: 'mailbox'
      }),
      requestContext: { authorizer: { tier: 'free-tier' } }
    };

    const result = await handler(event);

    // Should call SES for custom verification email (production default)
    expect(sesInstance.send).toHaveBeenCalledTimes(2);
    const sesCall = sesInstance.send.mock.calls[0][0];
    expect(sesCall.__type).toBe('SendCustomVerificationEmail');

    const tenantCall = sesInstance.send.mock.calls[1][0];
    expect(tenantCall.__type).toBe('CreateTenantResourceAssociation');

    // Should return success with production message
    expect(mockFormatResponse).toHaveBeenCalledWith(201, expect.objectContaining({
      message: 'Verification email sent. Please check your inbox and click the verification link.'
    }));

    // Reset environment for other tests
    process.env.ENVIRONMENT = 'production';
  });

  test('domain verification is not affected by environment setting', async () => {
    // Set non-production environment
    process.env.ENVIRONMENT = 'sandbox';

    mockGetUserContext.mockReturnValue({ tenantId: 'tenant-123' });

    ddbInstance.send
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    sesInstance.send.mockResolvedValue({
      identityArn: 'arn:aws:ses:us-east-1:123456789012:identity/example.com'
    });

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        verificationType: 'domain'
      }),
      requestContext: { authorizer: { tier: 'creator-tier' } }
    };

    const result = await handler(event);

    // Should still call SES for domain verification regardless of environment
    expect(sesInstance.send).toHaveBeenCalledTimes(2);
    const sesCall = sesInstance.send.mock.calls[0][0];
    expect(sesCall.__type).toBe('CreateEmailIdentity');

    const tenantCall = sesInstance.send.mock.calls[1][0];
    expect(tenantCall.__type).toBe('CreateTenantResourceAssociation');

    // Should return domain verification message
    expect(mockFormatResponse).toHaveBeenCalledWith(201, expect.objectContaining({
      message: 'Domain verification initiated. DNS records will be provided separately.'
    }));

    // Reset environment
    process.env.ENVIRONMENT = 'production';
  });
});
