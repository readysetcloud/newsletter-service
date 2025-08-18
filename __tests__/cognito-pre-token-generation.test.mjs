import { jest } from '@jest/globals';

// ---- Fixed clock so we can assert expires ----
const FIXED_NOW = 1_700_000_000_000; // arbitrary
const realDateNow = Date.now;
beforeAll(() => {
  // @ts-ignore
  Date.now = jest.fn(() => FIXED_NOW);
});
afterAll(() => {
  // @ts-ignore
  Date.now = realDateNow;
});

// ---- Mocks ----
const mockMomentoClient = {
  isAvailable: jest.fn(),
  generateReadOnlyToken: jest.fn(),
  getCacheName: jest.fn()
};
jest.unstable_mockModule('../functions/utils/momento-client.mjs', () => ({
  momentoClient: mockMomentoClient
}));

// Minimal structured logger with methods your code calls
const makeMockLogger = () => {
  const base = {
    correlationId: 'test-correlation-id',
    functionStart: jest.fn(),
    functionEnd: jest.fn(),
    userContextExtraction: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    momentoTokenGeneration: jest.fn(),
    child: jest.fn().mockReturnThis()
  };
  return base;
};
const mockLogger = makeMockLogger();
jest.unstable_mockModule('../functions/utils/structured-logger.mjs', () => ({
  createLogger: jest.fn(() => mockLogger)
}));

// CloudWatch metrics stub
const mockMetrics = {
  addEvent: jest.fn(),
  publishAll: jest.fn().mockResolvedValue(undefined)
};
jest.unstable_mockModule('../functions/utils/cloudwatch-metrics.mjs', () => ({
  createMetricsContext: jest.fn(() => mockMetrics)
}));

// crypto.randomUUID
jest.unstable_mockModule('crypto', () => ({
  randomUUID: jest.fn(() => 'test-correlation-id')
}));

// Import the handler after mocks
const { handler } = await import('../functions/auth/cognito-pre-token-generation.mjs');

describe('Cognito Pre Token Generation Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockMomentoClient.isAvailable.mockReturnValue(true);
    mockMomentoClient.getCacheName.mockReturnValue('newsletter-notifications');
    mockMomentoClient.generateReadOnlyToken.mockResolvedValue('mock-momento-token');
  });

  it('adds tenantId and Momento claims on success', async () => {
    const event = {
      triggerSource: 'TokenGeneration_Authentication',
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
    const claims = result.response.claimsOverrideDetails.claimsToAddOrOverride;

    // Momento call signature updated: (tenantId, userId)
    expect(mockMomentoClient.generateReadOnlyToken).toHaveBeenCalledWith('techcorp', 'user-123');

    // Tenant claim is included
    expect(claims['custom:tenant_id']).toBe('techcorp');

    // Momento claims present
    expect(claims['custom:momento_token']).toBe('mock-momento-token');
    expect(claims['custom:momento_cache']).toBe('newsletter-notifications');

    // Expiration exactly +1h from FIXED_NOW
    const expectedIso = new Date(FIXED_NOW + 60 * 60 * 1000).toISOString();
    expect(claims['custom:momento_expires']).toBe(expectedIso);

    // Logger/metrics were exercised
    expect(mockLogger.momentoTokenGeneration).toHaveBeenCalledWith('start', expect.any(Object));
    expect(mockLogger.momentoTokenGeneration).toHaveBeenCalledWith('success', expect.objectContaining({
      tenantId: 'techcorp',
      userId: 'user-123',
      tokenLength: 'mock-momento-token'.length
    }));
    expect(mockMetrics.addEvent).toHaveBeenCalled(); // at least once
    expect(mockMetrics.publishAll).toHaveBeenCalled();
  });

  it('skips Momento when tenant ID is missing and sets empty claims', async () => {
    const event = {
      triggerSource: 'TokenGeneration_Authentication',
      userName: 'test@example.com',
      userPoolId: 'us-east-1_XXXXXXXXX',
      request: {
        userAttributes: {
          sub: 'user-123',
          email: 'test@example.com'
          // no tenant
        }
      }
    };

    const result = await handler(event);
    const claims = result.response.claimsOverrideDetails.claimsToAddOrOverride;

    expect(mockMomentoClient.generateReadOnlyToken).not.toHaveBeenCalled();
    // No tenant claim added
    expect(claims['custom:tenant_id']).toBeUndefined();

    // Empty Momento claims
    expect(claims['custom:momento_token']).toBe('');
    expect(claims['custom:momento_cache']).toBe('');
    expect(claims['custom:momento_expires']).toBe('');

    // Logged as a warning
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'No tenant ID provided - skipping Momento token generation',
      expect.objectContaining({ userId: 'user-123' })
    );
  });

  it('handles Momento API failure gracefully and sets empty Momento claims', async () => {
    mockMomentoClient.generateReadOnlyToken.mockRejectedValueOnce(new Error('Momento API Error'));

    const event = {
      triggerSource: 'TokenGeneration_Authentication',
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
    const claims = result.response.claimsOverrideDetails.claimsToAddOrOverride;

    expect(claims['custom:momento_token']).toBe('');
    expect(claims['custom:momento_cache']).toBe('');
    expect(claims['custom:momento_expires']).toBe('');

    // Failure path logged and metrics published
    expect(mockLogger.momentoTokenGeneration).toHaveBeenCalledWith(
      'failure',
      expect.objectContaining({
        tenantId: 'techcorp',
        userId: 'user-123',
        error: expect.any(Error)
      })
    );
    expect(mockMetrics.addEvent).toHaveBeenCalled();
    expect(mockMetrics.publishAll).toHaveBeenCalled();
  });

  it('never blocks authentication when unexpected errors occur (returns original event)', async () => {
    mockMomentoClient.isAvailable.mockImplementation(() => {
      throw new Error('Unexpected error in availability check');
    });

    const event = {
      triggerSource: 'TokenGeneration_Authentication',
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
    // It should just return the original event to allow auth to proceed
    expect(result).toBe(event);

    // Error logged via structured logger
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Pre Token Generation failed - continuing authentication',
      expect.any(Error),
      expect.objectContaining({ userName: 'test@example.com' })
    );
    // functionEnd also called with success: false
    expect(mockLogger.functionEnd).toHaveBeenCalledWith(
      'Pre Token Generation',
      expect.objectContaining({ success: false })
    );
  });
});
