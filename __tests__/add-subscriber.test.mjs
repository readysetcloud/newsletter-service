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

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    // Shared client instances captured at import time
    ddbInstance = { send: jest.fn() };

    // DDB
    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ddbInstance),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
      PutItemCommand: jest.fn((params) => ({ __type: 'PutItem', ...params })),
    }));

    // util-dynamodb
    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((k) => k),
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
    jest.unstable_mockModule('../functions/utils/event-publisher.mjs', () => ({
      publishSubscriberEvent: _mockPublishSubscriberEvent,
      EVENT_TYPES: { SUBSCRIBER_ADDED: 'SUBSCRIBER_ADDED' },
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

    // DDB calls: PutItem (subscriber) + UpdateItem (increment) + PutItem (event record)
    expect(ddbInstance.send).toHaveBeenCalledTimes(3);

    // First call: PutItem for subscriber in Subscribers table
    const subscriberPutArg = ddbInstance.send.mock.calls[0][0];
    expect(subscriberPutArg.__type).toBe('PutItem');
    expect(subscriberPutArg.TableName).toBe('test-subscribers-table');
    expect(subscriberPutArg.ConditionExpression).toBe('attribute_not_exists(tenantId)');

    // Verify subscriber item structure
    const subscriberItem = subscriberPutArg.Item;
    expect(subscriberItem.tenantId).toBe('t1');
    expect(subscriberItem.email).toBe('test@example.com');
    expect(subscriberItem.firstName).toBe('John');
    expect(subscriberItem.lastName).toBe('Doe');
    expect(typeof subscriberItem.addedAt).toBe('string');

    // Second call: UpdateItem for subscriber count
    const updateArg = ddbInstance.send.mock.calls[1][0];
    expect(updateArg.__type).toBe('UpdateItem');
    expect(updateArg.TableName).toBe('test-table');
    expect(updateArg.UpdateExpression).toBe('SET #subscribers = #subscribers + :val');

    // Third call: PutItem for subscriber event record
    const eventPutArg = ddbInstance.send.mock.calls[2][0];
    expect(eventPutArg.__type).toBe('PutItem');
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

  test('ConditionalCheckFailedException → still 201, no DDB increment or event', async () => {
    const tenant = { id: 't1', list: 'list-1', subscribers: 5 };
    mockGetTenant.mockResolvedValue(tenant);
    ddbInstance.send.mockRejectedValue(Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' }));

    const event = {
      pathParameters: { tenant: 't1' },
      body: JSON.stringify({ email: 'dup@example.com' }),
    };

    const res = await handler(event);
    expect(res && res.statusCode).toBe(201);

    // Only one DDB call (the failed PutItem for subscriber)
    expect(ddbInstance.send).toHaveBeenCalledTimes(1);
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

          // Simulate ConditionalCheckFailedException for duplicate subscriber
          ddbInstance.send.mockRejectedValue(
            Object.assign(new Error('Subscriber already exists'), { name: 'ConditionalCheckFailedException' })
          );

          const event = {
            pathParameters: { tenant: 'test-tenant' },
            body: JSON.stringify({ email, firstName, lastName }),
          };

          const res = await handler(event);

          // Should still return 201 (success response)
          expect(res && res.statusCode).toBe(201);

          // Should only call DynamoDB once (the failed PutItem for subscriber)
          expect(ddbInstance.send).toHaveBeenCalledTimes(1);

          // Should NOT publish subscriber added event
          expect(publishSubscriberEvent).not.toHaveBeenCalled();

          // Reset mocks for next iteration
          jest.clearAllMocks();
        }
      ),
      { numRuns: 100 }
    );
  });
});
