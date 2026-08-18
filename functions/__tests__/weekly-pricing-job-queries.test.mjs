import { jest, describe, test, expect, beforeEach } from '@jest/globals';

/**
 * The DynamoDB access this job actually performs.
 *
 * The existing property test drives `filterEligibleTenants` with plain objects
 * and never sends a query, which is how two broken queries stayed green: a
 * Scan for an `sk` value no record carries, and a `FilterExpression` on the
 * subscribers table's sort key — which DynamoDB rejects outright, so the job
 * would have thrown in production while CI passed.
 */

let handler;
let ddbSend;
let eventBridgeSend;

const loadIsolated = async () => {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn();
    eventBridgeSend = jest.fn().mockResolvedValue({});

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
      ScanCommand: jest.fn((params) => ({ __type: 'Scan', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
      EventBridgeClient: jest.fn(() => ({ send: eventBridgeSend })),
      PutEventsCommand: jest.fn((params) => ({ __type: 'PutEvents', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((obj) => obj),
    }));

    ({ handler } = await import('../weekly-pricing-job.mjs'));
  });
};

/**
 * One tenant, one consolidated issue, and a subscribers partition holding the
 * given rows.
 */
const withSubscriberRows = (rows) => {
  ddbSend.mockImplementation(async (cmd) => {
    if (cmd.TableName === 'test-subscribers-table') {
      return { Items: rows };
    }
    if (cmd.IndexName === 'GSI1' && cmd.ExpressionAttributeValues[':gsi1pk'] === 'tenant') {
      return { Items: [{ pk: 'tenant-1' }] };
    }
    // hasPublishedIssueWithAnalytics
    return { Items: [{ pk: 'tenant-1#42' }] };
  });
};

describe('weekly-pricing-job DynamoDB access', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';
    await loadIsolated();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  // The Scan looked for `sk = "newsletter"`; tenant metadata is at sk "tenant"
  // and carries GSI1PK "tenant". So the job enumerated nothing and silently
  // priced nobody — indistinguishable from an account with no tenants.
  test('enumerates tenants through GSI1, not a Scan', async () => {
    withSubscriberRows([{ email: 'a@example.com' }]);

    await handler({});

    expect(ddbSend.mock.calls.map(([cmd]) => cmd.__type)).not.toContain('Scan');
    const tenantQuery = ddbSend.mock.calls
      .map(([cmd]) => cmd)
      .find((cmd) => cmd.IndexName === 'GSI1' && cmd.ExpressionAttributeValues[':gsi1pk'] === 'tenant');
    expect(tenantQuery.KeyConditionExpression).toBe('GSI1PK = :gsi1pk');
  });

  // `email` is the subscribers table's sort key, and DynamoDB does not allow
  // key attributes in a FilterExpression — that query fails at runtime with a
  // ValidationException rather than filtering anything.
  test('does not filter the subscribers query on its sort key', async () => {
    withSubscriberRows([{ email: 'a@example.com' }]);

    await handler({});

    const subscriberQuery = ddbSend.mock.calls
      .map(([cmd]) => cmd)
      .find((cmd) => cmd.TableName === 'test-subscribers-table');
    expect(subscriberQuery.FilterExpression).toBeUndefined();
    expect(subscriberQuery.ProjectionExpression).toBe('email');
  });

  // Segment bookkeeping shares the tenant partition. Counting it made a tenant
  // with no subscribers look eligible for pricing.
  test('counts subscribers and not segment bookkeeping', async () => {
    withSubscriberRows([
      { email: 'SEGMENT#engaged' },
      { email: 'SEGMENT#engaged#MEMBER#a@example.com' },
      { email: 'SEGMENT_NAME#engaged' },
      { email: 'real@example.com' }
    ]);

    await handler({});

    // One real subscriber is still > 0, so the tenant is eligible and an event
    // goes out.
    expect(eventBridgeSend).toHaveBeenCalledTimes(1);
  });

  test('a partition holding only segment records makes a tenant ineligible', async () => {
    withSubscriberRows([
      { email: 'SEGMENT#engaged' },
      { email: 'SEGMENT_JOB#rebuild-1' }
    ]);

    await handler({});

    expect(eventBridgeSend).not.toHaveBeenCalled();
  });
});
