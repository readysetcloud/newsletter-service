import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let unsubscribeUser;
let getTenant;
let getMostRecentPublishedIssue;
let incrementIssueCounter;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    unsubscribeUser = jest.fn();
    getTenant = jest.fn();
    getMostRecentPublishedIssue = jest.fn();
    incrementIssueCounter = jest.fn();

    jest.unstable_mockModule('../functions/utils/subscriber.mjs', () => ({
      unsubscribeUser,
    }));

    jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
      getTenant,
    }));

    jest.unstable_mockModule('../functions/utils/issue-attribution.mjs', () => ({
      getMostRecentPublishedIssue,
      incrementIssueCounter,
    }));

    ({ handler } = await import('../functions/subscribers/manual-unsubscribe.mjs'));
  });

  return { handler, unsubscribeUser, getTenant, getMostRecentPublishedIssue, incrementIssueCounter };
}

describe('manual-unsubscribe handler', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    await loadIsolated();

    getTenant.mockResolvedValue({
      pk: 'test-tenant',
      brandName: 'Test Brand',
      createdBy: 'admin@example.com'
    });

    getMostRecentPublishedIssue.mockResolvedValue({ pk: 'test-tenant#5', issueNumber: 5 });
    incrementIssueCounter.mockResolvedValue();
  });

  test('valid email submission returns success JSON', async () => {
    unsubscribeUser.mockResolvedValue({ success: true, actuallyRemoved: true });

    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({ email: 'test@example.com' }),
      requestContext: {
        identity: {
          sourceIp: '192.168.1.1'
        }
      },
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(result.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Successfully unsubscribed');
    expect(unsubscribeUser).toHaveBeenCalledWith(
      'test-tenant',
      'test@example.com',
      'manual-form',
      expect.objectContaining({
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0'
      })
    );
  });

  test('invalid email format returns error JSON with validation message', async () => {
    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({ email: 'invalid-email' }),
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(result.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Invalid email format');
    expect(unsubscribeUser).not.toHaveBeenCalled();
  });

  test('missing tenant parameter returns error JSON', async () => {
    const event = {
      pathParameters: {},
      body: JSON.stringify({ email: 'test@example.com' }),
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(result.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Missing tenant parameter');
    expect(unsubscribeUser).not.toHaveBeenCalled();
  });

  test('missing email parameter returns error JSON', async () => {
    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({ firstName: 'John' }),
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(result.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Missing email parameter');
    expect(unsubscribeUser).not.toHaveBeenCalled();
  });

  test('already-unsubscribed email returns success but does not increment counter', async () => {
    unsubscribeUser.mockResolvedValue({ success: true, actuallyRemoved: false });

    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({ email: 'already@unsubscribed.com' }),
      requestContext: {
        identity: {
          sourceIp: '192.168.1.1'
        }
      },
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(result.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Successfully unsubscribed');
    expect(unsubscribeUser).toHaveBeenCalledWith(
      'test-tenant',
      'already@unsubscribed.com',
      'manual-form',
      expect.objectContaining({
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0'
      })
    );
    expect(getMostRecentPublishedIssue).not.toHaveBeenCalled();
    expect(incrementIssueCounter).not.toHaveBeenCalled();
  });

  test('unsubscribeUser failure returns success for privacy', async () => {
    unsubscribeUser.mockResolvedValue({ success: false, actuallyRemoved: false });

    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({ email: 'test@example.com' }),
      requestContext: {
        identity: {
          sourceIp: '192.168.1.1'
        }
      },
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(result.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Successfully unsubscribed');
    expect(unsubscribeUser).toHaveBeenCalledWith(
      'test-tenant',
      'test@example.com',
      'manual-form',
      expect.objectContaining({
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0'
      })
    );
  });

  test('empty body returns error JSON', async () => {
    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: '',
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(result.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Missing email parameter');
    expect(unsubscribeUser).not.toHaveBeenCalled();
  });

  test('email with special characters is validated correctly', async () => {
    unsubscribeUser.mockResolvedValue({ success: true, actuallyRemoved: true });

    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({ email: 'user+test@example.com' }),
      requestContext: {
        identity: {
          sourceIp: '192.168.1.1'
        }
      },
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Successfully unsubscribed');
    expect(unsubscribeUser).toHaveBeenCalledWith(
      'test-tenant',
      'user+test@example.com',
      'manual-form',
      expect.objectContaining({
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0'
      })
    );
  });

  test('exception during processing returns success for privacy', async () => {
    unsubscribeUser.mockRejectedValue(new Error('Unexpected error'));

    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({ email: 'test@example.com' }),
      requestContext: {
        identity: {
          sourceIp: '192.168.1.1'
        }
      },
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(result.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Successfully unsubscribed');
  });

  test('extracts IP from X-Forwarded-For header when available', async () => {
    unsubscribeUser.mockResolvedValue({ success: true, actuallyRemoved: true });

    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({ email: 'test@example.com' }),
      headers: {
        'X-Forwarded-For': '203.0.113.1, 198.51.100.1',
        'User-Agent': 'Mozilla/5.0'
      }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(unsubscribeUser).toHaveBeenCalledWith(
      'test-tenant',
      'test@example.com',
      'manual-form',
      expect.objectContaining({
        ipAddress: '203.0.113.1',
        userAgent: 'Mozilla/5.0'
      })
    );
  });

  test('handles missing IP and user agent gracefully', async () => {
    unsubscribeUser.mockResolvedValue({ success: true, actuallyRemoved: true });

    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({ email: 'test@example.com' }),
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(unsubscribeUser).toHaveBeenCalledWith(
      'test-tenant',
      'test@example.com',
      'manual-form',
      expect.objectContaining({
        ipAddress: 'unknown',
        userAgent: 'unknown'
      })
    );
  });

  test('increments manualRemovals counter on successful unsubscribe', async () => {
    unsubscribeUser.mockResolvedValue({ success: true, actuallyRemoved: true });
    getMostRecentPublishedIssue.mockResolvedValue({ pk: 'test-tenant#5', issueNumber: 5 });

    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({ email: 'test@example.com' }),
      requestContext: { identity: { sourceIp: '192.168.1.1' } },
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };

    await handler(event);

    expect(getMostRecentPublishedIssue).toHaveBeenCalledWith('test-tenant');
    expect(incrementIssueCounter).toHaveBeenCalledWith('test-tenant#5', 'manualRemovals');
  });

  test('skips counter increment when no published issue found', async () => {
    unsubscribeUser.mockResolvedValue({ success: true, actuallyRemoved: true });
    getMostRecentPublishedIssue.mockResolvedValue(null);

    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({ email: 'test@example.com' }),
      requestContext: { identity: { sourceIp: '192.168.1.1' } },
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(getMostRecentPublishedIssue).toHaveBeenCalledWith('test-tenant');
    expect(incrementIssueCounter).not.toHaveBeenCalled();
  });

  test('does not increment counter when unsubscribe fails', async () => {
    unsubscribeUser.mockResolvedValue({ success: false, actuallyRemoved: false });

    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({ email: 'test@example.com' }),
      requestContext: { identity: { sourceIp: '192.168.1.1' } },
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };

    await handler(event);

    expect(getMostRecentPublishedIssue).not.toHaveBeenCalled();
    expect(incrementIssueCounter).not.toHaveBeenCalled();
  });

  test('attribution failure does not fail the unsubscribe operation', async () => {
    unsubscribeUser.mockResolvedValue({ success: true, actuallyRemoved: true });
    getMostRecentPublishedIssue.mockRejectedValue(new Error('DynamoDB error'));

    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({ email: 'test@example.com' }),
      requestContext: { identity: { sourceIp: '192.168.1.1' } },
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Successfully unsubscribed');
  });
});
