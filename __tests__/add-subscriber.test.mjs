// __tests__/add-subscriber.test.mjs
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let sesInstance;
let ddbInstance;
let CreateContactCommand;
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
    sesInstance = { send: jest.fn() };
    ddbInstance = { send: jest.fn() };

    // SES
    jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
      SESv2Client: jest.fn(() => sesInstance),
      CreateContactCommand: jest.fn((params) => ({ __type: 'CreateContact', ...params })),
    }));

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
    ({ CreateContactCommand } = await import('@aws-sdk/client-sesv2'));
    ({ UpdateItemCommand, PutItemCommand } = await import('@aws-sdk/client-dynamodb'));
    ({ marshall } = await import('@aws-sdk/util-dynamodb'));
    ({ publishSubscriberEvent, EVENT_TYPES } = await import('../functions/utils/event-publisher.mjs'));
  });

  return {
    handler,
    sesInstance,
    ddbInstance,
    CreateContactCommand,
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
    expect(sesInstance.send).not.toHaveBeenCalled();
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(publishSubscriberEvent).not.toHaveBeenCalled();
  });

  test('returns 400 when body is missing', async () => {
    mockGetTenant.mockResolvedValue({ id: 't1', list: 'list-1', subscribers: 10 });

    const event = { pathParameters: { tenant: 't1' } };
    const res = await handler(event);

    expect(res && res.statusCode).toBe(400);
    expect(sesInstance.send).not.toHaveBeenCalled();
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
    expect(sesInstance.send).not.toHaveBeenCalled();
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(publishSubscriberEvent).not.toHaveBeenCalled();
  });

  test('adds contact, increments count, creates event record, and publishes event', async () => {
    const tenant = { id: 't1', list: 'list-1', subscribers: 5 };
    mockGetTenant.mockResolvedValue(tenant);
    sesInstance.send.mockResolvedValue({});
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

    // SES
    expect(sesInstance.send).toHaveBeenCalledTimes(1);
    const sesArg = sesInstance.send.mock.calls[0][0];
    expect(sesArg.__type).toBe('CreateContact');
    expect(sesArg.ContactListName).toBe('list-1');
    expect(sesArg.EmailAddress).toBe('test@example.com');
    expect(JSON.parse(sesArg.AttributesData)).toEqual({ firstName: 'John', lastName: 'Doe' });

    // DDB calls: UpdateItem (increment) + PutItem (event record)
    expect(ddbInstance.send).toHaveBeenCalledTimes(2);

    // First call: UpdateItem for subscriber count
    const updateArg = ddbInstance.send.mock.calls[0][0];
    expect(updateArg.__type).toBe('UpdateItem');
    expect(updateArg.TableName).toBe('test-table');
    expect(updateArg.UpdateExpression).toBe('SET #subscribers = #subscribers + :val');

    // Second call: PutItem for subscriber event record
    const putArg = ddbInstance.send.mock.calls[1][0];
    expect(putArg.__type).toBe('PutItem');
    expect(putArg.TableName).toBe('test-table');

    // Verify the event record structure
    const putItem = putArg.Item;
    expect(putItem.pk).toBe('t1');
    expect(putItem.sk).toMatch(/^subscriber#\d+#test@example\.com$/);
    expect(putItem.GSI1PK).toBe('t1');
    expect(putItem.GSI1SK).toMatch(/^subscriber#\d+$/);
    expect(putItem.email).toBe('test@example.com');
    expect(typeof putItem.addedAt).toBe('string');
    expect(typeof putItem.ttl).toBe('number');

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

  test('AlreadyExistsException → still 201, no DDB increment or event', async () => {
    const tenant = { id: 't1', list: 'list-1', subscribers: 5 };
    mockGetTenant.mockResolvedValue(tenant);
    sesInstance.send.mockRejectedValue(Object.assign(new Error('exists'), { name: 'AlreadyExistsException' }));

    const event = {
      pathParameters: { tenant: 't1' },
      body: JSON.stringify({ email: 'dup@example.com' }),
    };

    const res = await handler(event);
    expect(res && res.statusCode).toBe(201);
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(publishSubscriberEvent).not.toHaveBeenCalled();
  });

  test('unexpected SES error → 500', async () => {
    const tenant = { id: 't1', list: 'list-1', subscribers: 5 };
    mockGetTenant.mockResolvedValue(tenant);
    sesInstance.send.mockRejectedValue(new Error('SES blew up'));

    const event = {
      pathParameters: { tenant: 't1' },
      body: JSON.stringify({ email: 'x@y.com' }),
    };

    const res = await handler(event);
    expect(res && res.statusCode).toBe(500);
    expect(ddbInstance.send).not.toHaveBeenCalled();
    expect(publishSubscriberEvent).not.toHaveBeenCalled();
  });
});

// Property-based tests
import * as fc from 'fast-check';

describe('add-subscriber property-based tests', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
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

          // Simulate AlreadyExistsException for duplicate subscriber
          sesInstance.send.mockRejectedValue(
            Object.assign(new Error('Contact already exists'), { name: 'AlreadyExistsException' })
          );

          const event = {
            pathParameters: { tenant: 'test-tenant' },
            body: JSON.stringify({ email, firstName, lastName }),
          };

          const res = await handler(event);

          // Should still return 201 (success response)
          expect(res && res.statusCode).toBe(201);

          // Should NOT call DynamoDB (no count increment, no event record)
          expect(ddbInstance.send).not.toHaveBeenCalled();

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
