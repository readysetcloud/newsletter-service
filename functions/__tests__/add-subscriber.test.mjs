// functions/__tests__/add-subscriber.test.mjs
// Unit tests for the integrated bot-protection handler pipeline
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

let handler;
let ddbInstance;
let mockGetTenant;
let mockFormatResponse;
let mockPublishSubscriberEvent;
let mockPublishEvent;
let mockCheckRateLimit;
let mockIsValidEmail;
let mockNormalizeEmail;
let mockExtractRequestMetadata;
let mockEvaluateHoneypot;
let mockIsDisposableDomain;
let mockIsSuspiciousUserAgent;
let mockIsSuspiciousEmailPattern;
let mockSanitizeElapsedMs;
let mockIsFastSubmission;
let mockBuildDetectionFlags;
let mockResolvePolicy;
let mockEvaluatePolicy;
let mockEmitBotProtectionLog;
let mockCreateLogger;
let mockLogger;

const DEFAULT_POLICY = {
  honeypotAction: 'block',
  disposableDomainAction: 'flag',
  rateLimitThreshold: 10,
  rateLimitWindowSeconds: 3600
};

const DEFAULT_RATE_LIMIT = { count: 1, limited: false, retryAfterSeconds: null };

const DEFAULT_FLAGS = {
  honeypotTriggered: false,
  disposableDomain: false,
  suspiciousUserAgent: false,
  unknownIp: false,
  fastSubmission: false,
  suspiciousEmailPattern: false
};

function makeEvent(body = { email: 'test@example.com' }, tenant = 't1') {
  return {
    pathParameters: { tenant },
    body: JSON.stringify(body),
    requestContext: { requestId: 'req-123', identity: { sourceIp: '1.2.3.4' } },
    headers: { 'User-Agent': 'Mozilla/5.0' }
  };
}

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    ddbInstance = { send: jest.fn() };

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ddbInstance),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
      PutItemCommand: jest.fn((params) => ({ __type: 'PutItem', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((k) => k),
    }));

    // issue attribution (no published issue → no per-issue counter writes)
    jest.unstable_mockModule('../../functions/utils/issue-attribution.mjs', () => ({
      getMostRecentPublishedIssue: jest.fn().mockResolvedValue(null),
      incrementIssueCounter: jest.fn(),
    }));

    // helpers
    mockGetTenant = jest.fn();
    mockFormatResponse = jest.fn((statusCode, body) => ({
      statusCode,
      body: JSON.stringify({ message: body }),
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.ORIGIN ? { 'Access-Control-Allow-Origin': process.env.ORIGIN } : {}),
      },
    }));
    jest.unstable_mockModule('../../functions/utils/helpers.mjs', () => ({
      getTenant: mockGetTenant,
      formatResponse: mockFormatResponse,
    }));

    // event publisher
    mockPublishSubscriberEvent = jest.fn();
    mockPublishEvent = jest.fn();
    jest.unstable_mockModule('../../functions/utils/event-publisher.mjs', () => ({
      publishSubscriberEvent: mockPublishSubscriberEvent,
      publishEvent: mockPublishEvent,
      EVENT_TYPES: { SUBSCRIBER_ADDED: 'Subscriber Added' },
    }));

    // bot-protection
    mockIsValidEmail = jest.fn().mockReturnValue(true);
    mockNormalizeEmail = jest.fn((e) => e.toLowerCase());
    mockExtractRequestMetadata = jest.fn().mockReturnValue({ sourceIp: '1.2.3.4', userAgent: 'Mozilla/5.0', unknownIp: false });
    mockEvaluateHoneypot = jest.fn().mockReturnValue(false);
    mockIsDisposableDomain = jest.fn().mockReturnValue(false);
    mockIsSuspiciousUserAgent = jest.fn().mockReturnValue(false);
    mockIsSuspiciousEmailPattern = jest.fn().mockReturnValue(false);
    mockSanitizeElapsedMs = jest.fn().mockReturnValue(null);
    mockIsFastSubmission = jest.fn().mockReturnValue(false);
    mockBuildDetectionFlags = jest.fn().mockReturnValue({ ...DEFAULT_FLAGS });
    mockResolvePolicy = jest.fn().mockReturnValue({ ...DEFAULT_POLICY });
    mockEvaluatePolicy = jest.fn().mockReturnValue({ blocked: false, rejectionReason: null });
    mockEmitBotProtectionLog = jest.fn();
    jest.unstable_mockModule('../../functions/utils/bot-protection.mjs', () => ({
      extractRequestMetadata: mockExtractRequestMetadata,
      isValidEmail: mockIsValidEmail,
      normalizeEmail: mockNormalizeEmail,
      evaluateHoneypot: mockEvaluateHoneypot,
      isDisposableDomain: mockIsDisposableDomain,
      isSuspiciousUserAgent: mockIsSuspiciousUserAgent,
      isSuspiciousEmailPattern: mockIsSuspiciousEmailPattern,
      sanitizeElapsedMs: mockSanitizeElapsedMs,
      isFastSubmission: mockIsFastSubmission,
      buildDetectionFlags: mockBuildDetectionFlags,
      resolvePolicy: mockResolvePolicy,
      evaluatePolicy: mockEvaluatePolicy,
      emitBotProtectionLog: mockEmitBotProtectionLog,
      disposableDomainSet: new Set(['tempmail.com']),
    }));

    // rate-limiter
    mockCheckRateLimit = jest.fn().mockResolvedValue({ ...DEFAULT_RATE_LIMIT });
    jest.unstable_mockModule('../../functions/utils/rate-limiter.mjs', () => ({
      checkRateLimit: mockCheckRateLimit,
    }));

    // structured-logger
    mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    mockCreateLogger = jest.fn().mockReturnValue(mockLogger);
    jest.unstable_mockModule('../../functions/utils/structured-logger.mjs', () => ({
      createLogger: mockCreateLogger,
    }));

    ({ handler } = await import('../../functions/subscribers/add-subscriber.mjs'));
  });
}

describe('add-subscriber handler — bot protection integration', () => {
  const savedEnv = {};

  beforeEach(async () => {
    jest.resetModules();
    savedEnv.TABLE_NAME = process.env.TABLE_NAME;
    savedEnv.SUBSCRIBERS_TABLE_NAME = process.env.SUBSCRIBERS_TABLE_NAME;
    savedEnv.ORIGIN = process.env.ORIGIN;
    savedEnv.HONEYPOT_ACTION = process.env.HONEYPOT_ACTION;
    savedEnv.DISPOSABLE_DOMAIN_ACTION = process.env.DISPOSABLE_DOMAIN_ACTION;
    savedEnv.RATE_LIMIT_THRESHOLD = process.env.RATE_LIMIT_THRESHOLD;
    savedEnv.RATE_LIMIT_WINDOW_SECONDS = process.env.RATE_LIMIT_WINDOW_SECONDS;
    savedEnv.SUSPICIOUS_UA_PATTERNS = process.env.SUSPICIOUS_UA_PATTERNS;
    savedEnv.PUBLISH_BLOCKED_EVENTS = process.env.PUBLISH_BLOCKED_EVENTS;

    process.env.TABLE_NAME = 'test-table';
    process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';
    process.env.ORIGIN = 'https://example.com';
    process.env.HONEYPOT_ACTION = 'block';
    process.env.DISPOSABLE_DOMAIN_ACTION = 'flag';
    process.env.RATE_LIMIT_THRESHOLD = '10';
    process.env.RATE_LIMIT_WINDOW_SECONDS = '3600';
    process.env.SUSPICIOUS_UA_PATTERNS = 'bot,crawler';
    process.env.PUBLISH_BLOCKED_EVENTS = 'false';

    await loadIsolated();
  });

  afterEach(() => {
    Object.keys(savedEnv).forEach((k) => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
  });

  // 1. HTTP 400 for invalid email format
  test('returns HTTP 400 for invalid email format', async () => {
    mockGetTenant.mockResolvedValue({ id: 't1', subscribers: 5 });
    mockIsValidEmail.mockReturnValue(false);

    const res = await handler(makeEvent({ email: 'not-an-email' }));

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toBe('Invalid email format');
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(ddbInstance.send).not.toHaveBeenCalled();
  });

  // 2. HTTP 429 with Retry-After header when rate limited
  test('returns HTTP 429 with Retry-After header when rate limited', async () => {
    mockGetTenant.mockResolvedValue({ id: 't1', subscribers: 5 });
    mockCheckRateLimit.mockResolvedValue({ count: 11, limited: true, retryAfterSeconds: 3500 });

    const res = await handler(makeEvent());

    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBe('3500');
    expect(JSON.parse(res.body).message).toBe('Too many requests');
    // Should emit a blocked log with rate_limit reason
    expect(mockEmitBotProtectionLog).toHaveBeenCalledWith(
      mockLogger,
      'signup.blocked',
      expect.objectContaining({ rejectionReason: 'rate_limit' })
    );
    // No subscriber record created
    expect(ddbInstance.send).not.toHaveBeenCalled();
  });

  // 3. HTTP 201 silent block for honeypot trigger (no Signup_Record created)
  test('returns HTTP 201 silent block for honeypot trigger', async () => {
    mockGetTenant.mockResolvedValue({ id: 't1', subscribers: 5 });
    mockEvaluateHoneypot.mockReturnValue(true);
    mockBuildDetectionFlags.mockReturnValue({ ...DEFAULT_FLAGS, honeypotTriggered: true });
    mockEvaluatePolicy.mockReturnValue({ blocked: true, rejectionReason: 'honeypot' });

    const res = await handler(makeEvent({ email: 'bot@example.com', website: 'http://spam.com' }));

    expect(res.statusCode).toBe(201);
    // No DDB writes for subscriber
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(mockEmitBotProtectionLog).toHaveBeenCalledWith(
      mockLogger,
      'signup.blocked',
      expect.objectContaining({ rejectionReason: 'honeypot' })
    );
    expect(mockPublishSubscriberEvent).not.toHaveBeenCalled();
  });

  // 4. HTTP 201 silent block for disposable domain with action=block
  test('returns HTTP 201 silent block for disposable domain with action=block', async () => {
    mockGetTenant.mockResolvedValue({ id: 't1', subscribers: 5 });
    mockIsDisposableDomain.mockReturnValue(true);
    mockBuildDetectionFlags.mockReturnValue({ ...DEFAULT_FLAGS, disposableDomain: true });
    mockResolvePolicy.mockReturnValue({ ...DEFAULT_POLICY, disposableDomainAction: 'block' });
    mockEvaluatePolicy.mockReturnValue({ blocked: true, rejectionReason: 'disposable_domain' });

    const res = await handler(makeEvent({ email: 'user@tempmail.com' }));

    expect(res.statusCode).toBe(201);
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(mockEmitBotProtectionLog).toHaveBeenCalledWith(
      mockLogger,
      'signup.blocked',
      expect.objectContaining({ rejectionReason: 'disposable_domain' })
    );
    expect(mockPublishSubscriberEvent).not.toHaveBeenCalled();
  });

  // 5. HTTP 201 flagged signup for disposable domain with action=flag (Signup_Record created with flag)
  test('returns HTTP 201 flagged signup for disposable domain with action=flag', async () => {
    mockGetTenant.mockResolvedValue({ id: 't1', subscribers: 5 });
    mockIsDisposableDomain.mockReturnValue(true);
    const flaggedFlags = { ...DEFAULT_FLAGS, disposableDomain: true };
    mockBuildDetectionFlags.mockReturnValue(flaggedFlags);
    mockResolvePolicy.mockReturnValue({ ...DEFAULT_POLICY, disposableDomainAction: 'flag' });
    mockEvaluatePolicy.mockReturnValue({ blocked: false, rejectionReason: null });
    ddbInstance.send.mockResolvedValue({});

    const res = await handler(makeEvent({ email: 'user@tempmail.com' }));

    expect(res.statusCode).toBe(201);
    // Subscriber PutItem should have been called (record created)
    expect(ddbInstance.send).toHaveBeenCalled();
    const putCall = ddbInstance.send.mock.calls[0][0];
    expect(putCall.__type).toBe('PutItem');
    expect(putCall.Item.disposableDomain).toBe(true);
    // Should emit signup.flagged log since disposableDomain flag is true
    expect(mockEmitBotProtectionLog).toHaveBeenCalledWith(
      mockLogger,
      'signup.flagged',
      expect.objectContaining({ detectionFlags: flaggedFlags })
    );
  });

  // 6. HTTP 201 for duplicate email (no additional writes)
  test('returns HTTP 201 for duplicate email with no additional writes', async () => {
    mockGetTenant.mockResolvedValue({ id: 't1', subscribers: 5 });
    // First DDB send (PutItem for subscriber) throws ConditionalCheckFailedException
    ddbInstance.send.mockRejectedValue(
      Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' })
    );

    const res = await handler(makeEvent({ email: 'dup@example.com' }));

    expect(res.statusCode).toBe(201);
    // Only one DDB call — the failed PutItem; no UpdateItem or event record
    expect(ddbInstance.send).toHaveBeenCalledTimes(1);
    expect(mockPublishSubscriberEvent).not.toHaveBeenCalled();
  });

  // 7. HTTP 201 success with all Detection_Flags and Detection_Attributes persisted
  test('returns HTTP 201 success with all detection flags and attributes persisted', async () => {
    mockGetTenant.mockResolvedValue({ id: 't1', subscribers: 5 });
    mockExtractRequestMetadata.mockReturnValue({ sourceIp: '10.0.0.1', userAgent: 'TestAgent', unknownIp: false });
    mockIsSuspiciousUserAgent.mockReturnValue(true);
    mockSanitizeElapsedMs.mockReturnValue(500);
    mockIsFastSubmission.mockReturnValue(true);
    const allFlags = {
      honeypotTriggered: false,
      disposableDomain: false,
      suspiciousUserAgent: true,
      unknownIp: false,
      fastSubmission: true
    };
    mockBuildDetectionFlags.mockReturnValue(allFlags);
    mockCheckRateLimit.mockResolvedValue({ count: 2, limited: false, retryAfterSeconds: null });
    ddbInstance.send.mockResolvedValue({});

    const res = await handler(makeEvent({ email: 'real@example.com', elapsedMs: 500 }));

    expect(res.statusCode).toBe(201);
    // First DDB call is PutItem for subscriber
    const putCall = ddbInstance.send.mock.calls[0][0];
    expect(putCall.__type).toBe('PutItem');
    expect(putCall.Item.sourceIp).toBe('10.0.0.1');
    expect(putCall.Item.userAgent).toBe('TestAgent');
    expect(putCall.Item.honeypotTriggered).toBe(false);
    expect(putCall.Item.disposableDomain).toBe(false);
    expect(putCall.Item.suspiciousUserAgent).toBe(true);
    expect(putCall.Item.unknownIp).toBe(false);
    expect(putCall.Item.fastSubmission).toBe(true);
    expect(putCall.Item.requestCountInWindow).toBe(2);
    expect(putCall.Item.elapsedMs).toBe(500);
    // signup.flagged log should be emitted because suspiciousUserAgent and fastSubmission are true
    expect(mockEmitBotProtectionLog).toHaveBeenCalledWith(
      mockLogger,
      'signup.flagged',
      expect.objectContaining({ detectionFlags: allFlags })
    );
  });

  // 8. Duplicate abuse log emitted at requestCount > 3
  test('emits duplicate_abuse log when requestCount > 3 for duplicate email', async () => {
    mockGetTenant.mockResolvedValue({ id: 't1', subscribers: 5 });
    mockCheckRateLimit.mockResolvedValue({ count: 4, limited: false, retryAfterSeconds: null });
    ddbInstance.send.mockRejectedValue(
      Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' })
    );

    const res = await handler(makeEvent({ email: 'dup@example.com' }));

    expect(res.statusCode).toBe(201);
    expect(mockEmitBotProtectionLog).toHaveBeenCalledWith(
      mockLogger,
      'signup.duplicate_abuse',
      expect.objectContaining({
        tenantId: 't1',
        requestCountInWindow: 4
      })
    );
  });

  test('does NOT emit duplicate_abuse log when requestCount <= 3 for duplicate email', async () => {
    mockGetTenant.mockResolvedValue({ id: 't1', subscribers: 5 });
    mockCheckRateLimit.mockResolvedValue({ count: 3, limited: false, retryAfterSeconds: null });
    ddbInstance.send.mockRejectedValue(
      Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' })
    );

    const res = await handler(makeEvent({ email: 'dup@example.com' }));

    expect(res.statusCode).toBe(201);
    // emitBotProtectionLog should NOT have been called with duplicate_abuse
    const dupAbuseCalls = mockEmitBotProtectionLog.mock.calls.filter(
      ([, eventType]) => eventType === 'signup.duplicate_abuse'
    );
    expect(dupAbuseCalls).toHaveLength(0);
  });

  // 9. EventBridge publish called when PUBLISH_BLOCKED_EVENTS=true
  test('publishes EventBridge event when PUBLISH_BLOCKED_EVENTS=true and signup is blocked', async () => {
    process.env.PUBLISH_BLOCKED_EVENTS = 'true';
    mockGetTenant.mockResolvedValue({ id: 't1', subscribers: 5 });
    mockEvaluateHoneypot.mockReturnValue(true);
    mockBuildDetectionFlags.mockReturnValue({ ...DEFAULT_FLAGS, honeypotTriggered: true });
    mockEvaluatePolicy.mockReturnValue({ blocked: true, rejectionReason: 'honeypot' });

    const res = await handler(makeEvent({ email: 'bot@example.com', website: 'spam' }));

    expect(res.statusCode).toBe(201);
    expect(mockPublishEvent).toHaveBeenCalledWith(
      'newsletter-service',
      'Signup Blocked',
      expect.objectContaining({
        tenantId: 't1',
        rejectionReason: 'honeypot'
      })
    );
  });

  // 10. EventBridge publish NOT called when PUBLISH_BLOCKED_EVENTS=false
  test('does NOT publish EventBridge event when PUBLISH_BLOCKED_EVENTS=false and signup is blocked', async () => {
    process.env.PUBLISH_BLOCKED_EVENTS = 'false';
    mockGetTenant.mockResolvedValue({ id: 't1', subscribers: 5 });
    mockEvaluateHoneypot.mockReturnValue(true);
    mockBuildDetectionFlags.mockReturnValue({ ...DEFAULT_FLAGS, honeypotTriggered: true });
    mockEvaluatePolicy.mockReturnValue({ blocked: true, rejectionReason: 'honeypot' });

    const res = await handler(makeEvent({ email: 'bot@example.com', website: 'spam' }));

    expect(res.statusCode).toBe(201);
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  // 11. Structured log output for blocked, flagged, and duplicate_abuse event types
  describe('structured log output', () => {
    test('emits signup.blocked log with correct fields for honeypot block', async () => {
      mockGetTenant.mockResolvedValue({ id: 't1', subscribers: 5 });
      const flags = { ...DEFAULT_FLAGS, honeypotTriggered: true };
      mockBuildDetectionFlags.mockReturnValue(flags);
      mockEvaluatePolicy.mockReturnValue({ blocked: true, rejectionReason: 'honeypot' });
      mockCheckRateLimit.mockResolvedValue({ count: 1, limited: false, retryAfterSeconds: null });

      await handler(makeEvent({ email: 'bot@example.com', website: 'spam' }));

      expect(mockEmitBotProtectionLog).toHaveBeenCalledWith(
        mockLogger,
        'signup.blocked',
        expect.objectContaining({
          tenantId: 't1',
          normalizedEmail: 'bot@example.com',
          sourceIp: '1.2.3.4',
          userAgent: 'Mozilla/5.0',
          detectionFlags: flags,
          rejectionReason: 'honeypot',
          requestCountInWindow: 1
        })
      );
    });

    test('emits signup.flagged log with correct fields for flagged signup', async () => {
      mockGetTenant.mockResolvedValue({ id: 't1', subscribers: 5 });
      const flags = { ...DEFAULT_FLAGS, suspiciousUserAgent: true };
      mockBuildDetectionFlags.mockReturnValue(flags);
      mockEvaluatePolicy.mockReturnValue({ blocked: false, rejectionReason: null });
      mockCheckRateLimit.mockResolvedValue({ count: 2, limited: false, retryAfterSeconds: null });
      ddbInstance.send.mockResolvedValue({});

      await handler(makeEvent({ email: 'user@example.com' }));

      expect(mockEmitBotProtectionLog).toHaveBeenCalledWith(
        mockLogger,
        'signup.flagged',
        expect.objectContaining({
          tenantId: 't1',
          normalizedEmail: 'user@example.com',
          sourceIp: '1.2.3.4',
          userAgent: 'Mozilla/5.0',
          detectionFlags: flags,
          requestCountInWindow: 2
        })
      );
    });

    test('emits signup.duplicate_abuse log with correct fields', async () => {
      mockGetTenant.mockResolvedValue({ id: 't1', subscribers: 5 });
      mockCheckRateLimit.mockResolvedValue({ count: 5, limited: false, retryAfterSeconds: null });
      ddbInstance.send.mockRejectedValue(
        Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' })
      );

      await handler(makeEvent({ email: 'dup@example.com' }));

      expect(mockEmitBotProtectionLog).toHaveBeenCalledWith(
        mockLogger,
        'signup.duplicate_abuse',
        expect.objectContaining({
          tenantId: 't1',
          normalizedEmail: 'dup@example.com',
          sourceIp: '1.2.3.4',
          userAgent: 'Mozilla/5.0',
          detectionFlags: DEFAULT_FLAGS,
          requestCountInWindow: 5
        })
      );
    });

    test('emits signup.blocked log for rate limit with correct fields', async () => {
      mockGetTenant.mockResolvedValue({ id: 't1', subscribers: 5 });
      mockCheckRateLimit.mockResolvedValue({ count: 11, limited: true, retryAfterSeconds: 3500 });

      await handler(makeEvent({ email: 'spammer@example.com' }));

      expect(mockEmitBotProtectionLog).toHaveBeenCalledWith(
        mockLogger,
        'signup.blocked',
        expect.objectContaining({
          tenantId: 't1',
          normalizedEmail: 'spammer@example.com',
          rejectionReason: 'rate_limit',
          requestCountInWindow: 11
        })
      );
    });
  });
});
