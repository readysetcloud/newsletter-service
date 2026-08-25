// __tests__/add-subscriber.test.mjs
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let ddbInstance;
let UpdateItemCommand;
let PutItemCommand;
let marshall;
let publishSubscriberEvent;
let EVENT_TYPES;
let mockGetTenant;
let mockFormatResponse;
let mockLookupGeo;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    // Shared client instances captured at import time
    ddbInstance = { send: jest.fn() };

    // DDB
    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ddbInstance),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
      PutItemCommand: jest.fn((params) => ({ __type: 'PutItem', ...params })),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
      // Imported by utils/suppression.mjs for clearSuppression, which is
      // deliberately unwired from this path — signup is unauthenticated and
      // cannot be treated as proof of address ownership.
      DeleteItemCommand: jest.fn((params) => ({ __type: 'DeleteItem', ...params })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
      // The subscriber write commits with a ConditionCheck on the suppression
      // key, so the consent record guards the write instead of preceding it.
      TransactWriteItemsCommand: jest.fn((params) => ({ __type: 'TransactWrite', ...params })),
    }));

    // util-dynamodb
    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((k) => k),
      unmarshall: jest.fn((k) => k),
    }));

    // issue attribution (no published issue → no per-issue counter writes)
    jest.unstable_mockModule('../functions/utils/issue-attribution.mjs', () => ({
      getMostRecentPublishedIssue: jest.fn().mockResolvedValue(null),
      incrementIssueCounter: jest.fn(),
    }));

    // helpers (formatResponse + getTenant)
    mockGetTenant = jest.fn();
    mockFormatResponse = jest.fn((statusCode, body) => ({
      statusCode,
      body: JSON.stringify({ message: body }),
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.ORIGIN ? { 'Access-Control-Allow-Origin': process.env.ORIGIN } : {}),
      },
    }));
    jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
      getTenant: mockGetTenant,
      formatResponse: mockFormatResponse,
    }));

    // event publisher
    const _mockPublishSubscriberEvent = jest.fn();
    const _mockPublishEvent = jest.fn();
    jest.unstable_mockModule('../functions/utils/event-publisher.mjs', () => ({
      publishSubscriberEvent: _mockPublishSubscriberEvent,
      publishEvent: _mockPublishEvent,
      EVENT_TYPES: { SUBSCRIBER_ADDED: 'SUBSCRIBER_ADDED' },
    }));

    // bot-protection
    jest.unstable_mockModule('../functions/utils/bot-protection.mjs', () => ({
      extractRequestMetadata: jest.fn().mockReturnValue({ sourceIp: '1.2.3.4', userAgent: 'TestAgent', unknownIp: false }),
      isValidEmail: jest.fn().mockReturnValue(true),
      normalizeEmail: jest.fn((e) => e.toLowerCase()),
      evaluateHoneypot: jest.fn().mockReturnValue(false),
      isDisposableDomain: jest.fn().mockReturnValue(false),
      isSuspiciousUserAgent: jest.fn().mockReturnValue(false),
      isSuspiciousEmailPattern: jest.fn().mockReturnValue(false),
      sanitizeElapsedMs: jest.fn().mockReturnValue(null),
      isFastSubmission: jest.fn().mockReturnValue(false),
      buildDetectionFlags: jest.fn().mockReturnValue({
        honeypotTriggered: false, disposableDomain: false,
        suspiciousUserAgent: false, unknownIp: false, fastSubmission: false,
        suspiciousEmailPattern: false
      }),
      resolvePolicy: jest.fn().mockReturnValue({
        honeypotAction: 'block', disposableDomainAction: 'flag',
        rateLimitThreshold: 10, rateLimitWindowSeconds: 3600
      }),
      evaluatePolicy: jest.fn().mockReturnValue({ blocked: false, rejectionReason: null }),
      emitBotProtectionLog: jest.fn(),
      disposableDomainSet: new Set(['tempmail.com']),
    }));

    // rate-limiter
    jest.unstable_mockModule('../functions/utils/rate-limiter.mjs', () => ({
      checkRateLimit: jest.fn().mockResolvedValue({ count: 1, limited: false, retryAfterSeconds: null }),
    }));

    // structured-logger
    jest.unstable_mockModule('../functions/utils/structured-logger.mjs', () => ({
      createLogger: jest.fn().mockReturnValue({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    }));

    // geolocation — the signup-IP timezone fallback. Defaults to a miss, which
    // is what the real module returns off-Lambda anyway (no mmdb under /opt),
    // so the tests that predate the timezone capture behave as they always did.
    mockLookupGeo = jest.fn().mockResolvedValue(null);
    jest.unstable_mockModule('../functions/utils/geolocation.mjs', () => ({
      lookupGeo: mockLookupGeo,
      lookupCountry: jest.fn().mockResolvedValue(null),
    }));

    // Import AFTER mocks, inside isolation
    ({ handler } = await import('../functions/subscribers/add-subscriber.mjs'));
    ({ UpdateItemCommand, PutItemCommand } = await import('@aws-sdk/client-dynamodb'));
    ({ marshall } = await import('@aws-sdk/util-dynamodb'));
    ({ publishSubscriberEvent, EVENT_TYPES } = await import('../functions/utils/event-publisher.mjs'));
  });

  return {
    handler,
    ddbInstance,
    UpdateItemCommand,
    PutItemCommand,
    marshall,
    publishSubscriberEvent,
    EVENT_TYPES,
    mockGetTenant,
    mockFormatResponse,
    mockLookupGeo,
  };
}

describe('add-subscriber handler (isolated)', () => {
  beforeEach(async () => {
    jest.resetModules(); // clear module cache between tests
    process.env.TABLE_NAME = 'test-table';
    process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';
    process.env.ORIGIN = 'https://www.readysetcloud.io';
    await loadIsolated();
  });

  test('returns 404 when tenant not found', async () => {
    mockGetTenant.mockResolvedValue(null);

    const event = {
      pathParameters: { tenant: 'missing-tenant' },
      body: JSON.stringify({ email: 'a@b.com' }),
    };

    const res = await handler(event);
    expect(mockGetTenant).toHaveBeenCalledWith('missing-tenant');
    expect(res && res.statusCode).toBe(404);
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(publishSubscriberEvent).not.toHaveBeenCalled();
  });

  test('returns 400 when body is missing', async () => {
    mockGetTenant.mockResolvedValue({ id: 't1', list: 'list-1', subscribers: 10 });

    const event = { pathParameters: { tenant: 't1' } };
    const res = await handler(event);

    expect(res && res.statusCode).toBe(400);
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(publishSubscriberEvent).not.toHaveBeenCalled();
  });

  test('returns 400 when email is missing', async () => {
    mockGetTenant.mockResolvedValue({ id: 't1', list: 'list-1', subscribers: 10 });

    const event = {
      pathParameters: { tenant: 't1' },
      body: JSON.stringify({ firstName: 'John' }),
    };

    const res = await handler(event);

    expect(res && res.statusCode).toBe(400);
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(publishSubscriberEvent).not.toHaveBeenCalled();
  });

  test('adds subscriber, increments count, creates event record, and publishes event', async () => {
    const tenant = { id: 't1', list: 'list-1', subscribers: 5 };
    mockGetTenant.mockResolvedValue(tenant);
    ddbInstance.send.mockResolvedValue({});

    const event = {
      pathParameters: { tenant: 't1' },
      body: JSON.stringify({
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
      }),
    };

    const res = await handler(event);
    expect(res && res.statusCode).toBe(201);

    // Two DDB calls: GetItem (suppression check — an opted-out address is
    // refused) + TransactWriteItems carrying everything durable about the
    // signup: the subscriber Put, the tenant count, and the timeline record.
    // Both the count and the record used to be separate writes after the
    // transaction, and either failing left a committed subscriber that a retry
    // would treat as a duplicate, skipping the rest of the creation work.
    expect(ddbInstance.send).toHaveBeenCalledTimes(2);

    // First call: GetItem checking whether this address has opted out
    const suppressionGetArg = ddbInstance.send.mock.calls[0][0];
    expect(suppressionGetArg.__type).toBe('GetItem');
    expect(suppressionGetArg.Key).toEqual({ pk: 't1', sk: 'suppression#test@example.com' });

    // Second call: the transactional subscriber write — the suppression
    // ConditionCheck commits with the Put so the record guards it.
    const transactArg = ddbInstance.send.mock.calls[1][0];
    expect(transactArg.__type).toBe('TransactWrite');
    expect(transactArg.TransactItems[0].ConditionCheck.ConditionExpression)
      .toBe('attribute_not_exists(pk)');
    const subscriberPutArg = transactArg.TransactItems[1].Put;
    expect(subscriberPutArg.TableName).toBe('test-subscribers-table');
    expect(subscriberPutArg.ConditionExpression).toBe('attribute_not_exists(tenantId)');

    // Verify subscriber item structure
    const subscriberItem = subscriberPutArg.Item;
    expect(subscriberItem.tenantId).toBe('t1');
    expect(subscriberItem.email).toBe('test@example.com');
    expect(subscriberItem.firstName).toBe('John');
    expect(subscriberItem.lastName).toBe('Doe');
    expect(typeof subscriberItem.addedAt).toBe('string');

    // Third transaction item: the tenant count, incremented in the same commit.
    const countUpdate = transactArg.TransactItems[2].Update;
    expect(countUpdate.TableName).toBe('test-table');
    expect(countUpdate.Key).toEqual({ pk: 't1', sk: 'tenant' });
    expect(countUpdate.UpdateExpression)
      .toBe('SET #subscribers = if_not_exists(#subscribers, :zero) + :one');

    // Fourth transaction item: the subscriber event record.
    const eventPutArg = transactArg.TransactItems[3].Put;
    expect(eventPutArg.TableName).toBe('test-table');

    // Verify the event record structure
    const eventItem = eventPutArg.Item;
    expect(eventItem.pk).toBe('t1');
    expect(eventItem.sk).toMatch(/^subscriber#\d+#test@example\.com$/);
    expect(eventItem.GSI1PK).toBe('t1');
    expect(eventItem.GSI1SK).toMatch(/^subscriber#\d+$/);
    expect(eventItem.email).toBe('test@example.com');
    expect(typeof eventItem.addedAt).toBe('string');
    expect(typeof eventItem.ttl).toBe('number');

    // Event
    expect(publishSubscriberEvent).toHaveBeenCalledTimes(1);
    const [tenantId, userId, eventType, details] = publishSubscriberEvent.mock.calls[0];
    expect(tenantId).toBe('t1');
    expect(userId).toBeNull();
    expect(eventType).toBe(EVENT_TYPES.SUBSCRIBER_ADDED);
    expect(details).toMatchObject({
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
      subscriberCount: 6,
    });
    expect(typeof details.addedAt).toBe('string');
  });

  test('cancelled transaction on an existing subscriber → still 201, no DDB increment or event', async () => {
    const tenant = { id: 't1', list: 'list-1', subscribers: 5 };
    mockGetTenant.mockResolvedValue(tenant);
    // The consent lookup runs first and must resolve clean, or the rejection
    // lands on the read instead of the subscriber write it is aiming at. The
    // write is the Put half of a transaction, so an existing subscriber shows
    // up as a cancellation whose second reason is ConditionalCheckFailed.
    ddbInstance.send.mockImplementation((cmd) =>
      cmd.__type === 'GetItem'
        ? Promise.resolve({})
        : Promise.reject(Object.assign(new Error('exists'), {
          name: 'TransactionCanceledException',
          CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }]
        }))
    );

    const event = {
      pathParameters: { tenant: 't1' },
      body: JSON.stringify({ email: 'dup@example.com' }),
    };

    const res = await handler(event);
    expect(res && res.statusCode).toBe(201);

    // Two DDB calls: the consent lookup and the failed PutItem for subscriber
    expect(ddbInstance.send).toHaveBeenCalledTimes(2);
    expect(publishSubscriberEvent).not.toHaveBeenCalled();
  });

  test('unexpected DDB error → 500', async () => {
    const tenant = { id: 't1', list: 'list-1', subscribers: 5 };
    mockGetTenant.mockResolvedValue(tenant);
    ddbInstance.send.mockRejectedValue(new Error('DDB blew up'));

    const event = {
      pathParameters: { tenant: 't1' },
      body: JSON.stringify({ email: 'x@y.com' }),
    };

    const res = await handler(event);
    expect(res && res.statusCode).toBe(500);
    expect(publishSubscriberEvent).not.toHaveBeenCalled();
  });
});

// Property-based tests
import * as fc from 'fast-check';

describe('add-subscriber property-based tests', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';
    process.env.ORIGIN = 'https://www.readysetcloud.io';
    await loadIsolated();
  });

  // Feature: welcome-newsletter, Property 4: Duplicate subscription idempotency
  // Validates: Requirements 1.5
  test('Property 4: duplicate subscription does not trigger welcome email or event record', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.nat({ max: 10000 }),
        async (email, firstName, lastName, subscriberCount) => {
          const tenant = { id: 'test-tenant', list: 'test-list', subscribers: subscriberCount };
          mockGetTenant.mockResolvedValue(tenant);

          // Simulate the transaction cancelling on the subscriber Put because
          // the address is already on the list. The consent lookup precedes it
          // and resolves clean.
          ddbInstance.send.mockImplementation((cmd) =>
            cmd.__type === 'GetItem'
              ? Promise.resolve({})
              : Promise.reject(Object.assign(new Error('Subscriber already exists'), {
                name: 'TransactionCanceledException',
                CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }]
              }))
          );

          const event = {
            pathParameters: { tenant: 'test-tenant' },
            body: JSON.stringify({ email, firstName, lastName }),
          };

          const res = await handler(event);

          // Should still return 201 (success response)
          expect(res && res.statusCode).toBe(201);

          // Two DynamoDB calls: the consent lookup, then the failed PutItem
          expect(ddbInstance.send).toHaveBeenCalledTimes(2);

          // Should NOT publish subscriber added event
          expect(publishSubscriberEvent).not.toHaveBeenCalled();

          // Reset mocks for next iteration
          jest.clearAllMocks();
        }
      ),
      { numRuns: 100 }
    );
  });

  describe('timezone capture at signup', () => {
    const tenant = { id: 't1', list: 'list-1', subscribers: 5 };

    /** The subscriber Item from the transactional write. */
    const writtenSubscriber = () => {
      const transactArg = ddbInstance.send.mock.calls[1][0];
      return transactArg.TransactItems[1].Put.Item;
    };

    const signUp = (body) => handler({
      pathParameters: { tenant: 't1' },
      body: JSON.stringify({ email: 'test@example.com', ...body }),
    });

    beforeEach(() => {
      mockGetTenant.mockResolvedValue(tenant);
      ddbInstance.send.mockResolvedValue({});
    });

    test('stores the timezone the form submitted, without geolocating', async () => {
      await signUp({ timeZone: 'America/Chicago' });

      const item = writtenSubscriber();
      expect(item.timeZone).toBe('America/Chicago');
      expect(item.timeZoneSource).toBe('signup');
      expect(item.timeZoneUpdatedAt).toBe(item.addedAt);
      // The browser's own answer cannot be improved on, so the IP is not read.
      expect(mockLookupGeo).not.toHaveBeenCalled();
    });

    // Intl accepts these and would hand them straight through. Stored raw they
    // split one zone across several local-send groups that each fire on their
    // own schedule.
    test.each([
      ['america/chicago', 'America/Chicago'],
      ['US/Central', 'America/Chicago'],
      ['EST5EDT', 'America/New_York'],
      ['GMT', 'UTC'],
    ])('canonicalizes %s to %s', async (submitted, expected) => {
      await signUp({ timeZone: submitted });
      expect(writtenSubscriber().timeZone).toBe(expected);
    });

    test('falls back to the signup IP when the form sent nothing', async () => {
      mockLookupGeo.mockResolvedValue({ countryCode: 'US', countryName: 'United States', timeZone: 'America/Denver' });

      await signUp({});

      expect(mockLookupGeo).toHaveBeenCalledWith('1.2.3.4');
      const item = writtenSubscriber();
      expect(item.timeZone).toBe('America/Denver');
      expect(item.timeZoneSource).toBe('signup');
    });

    test('falls back to the signup IP when the form sent something unusable', async () => {
      mockLookupGeo.mockResolvedValue({ countryCode: 'US', countryName: 'United States', timeZone: 'America/Denver' });

      await signUp({ timeZone: 'Not/AZone' });

      expect(mockLookupGeo).toHaveBeenCalled();
      expect(writtenSubscriber().timeZone).toBe('America/Denver');
    });

    // Absent, not null: groupSubscribersByTimeZone and the API's coverage count
    // both read absence as "no confirmed zone".
    test('omits the field entirely when neither source can supply one', async () => {
      mockLookupGeo.mockResolvedValue(null);

      await signUp({});

      const item = writtenSubscriber();
      expect(item).not.toHaveProperty('timeZone');
      expect(item).not.toHaveProperty('timeZoneSource');
      expect(item).not.toHaveProperty('timeZoneUpdatedAt');
    });

    // The country database resolves a country and no zone, which is what a
    // deployment without the City mmdb looks like.
    test('omits the field when geolocation resolves a country but no zone', async () => {
      mockLookupGeo.mockResolvedValue({ countryCode: 'US', countryName: 'United States', timeZone: null });

      await signUp({});

      expect(writtenSubscriber()).not.toHaveProperty('timeZone');
    });

    // A subscriber is worth more than a timezone: the lookup reads a file off
    // the layer, and a failure there must not cost the signup.
    test('still adds the subscriber when geolocation throws', async () => {
      mockLookupGeo.mockRejectedValue(new Error('mmdb unreadable'));

      const res = await signUp({});

      expect(res.statusCode).toBe(201);
      const item = writtenSubscriber();
      expect(item.email).toBe('test@example.com');
      expect(item).not.toHaveProperty('timeZone');
    });

    test.each([null, 42, '', '   ', { toString: () => 'America/Chicago' }])(
      'ignores a non-string timezone (%p) and falls through to the IP',
      async (submitted) => {
        mockLookupGeo.mockResolvedValue({ countryCode: 'US', countryName: 'United States', timeZone: 'America/Denver' });

        await signUp({ timeZone: submitted });

        expect(writtenSubscriber().timeZone).toBe('America/Denver');
      }
    );
  });

});
