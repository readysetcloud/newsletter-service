import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let unsubscribeUser;
let getTenant;
let decrypt;
let getMostRecentPublishedIssue;
let incrementIssueCounter;
let getUnsubscribePage;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    unsubscribeUser = jest.fn();
    getTenant = jest.fn();
    decrypt = jest.fn();
    getMostRecentPublishedIssue = jest.fn();
    incrementIssueCounter = jest.fn();
    getUnsubscribePage = jest.fn(async (tenantId, wasSuccessful) => `<html>result:${wasSuccessful}</html>`);

    jest.unstable_mockModule('../functions/utils/subscriber.mjs', () => ({
      unsubscribeUser,
    }));

    jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
      getTenant,
      decrypt,
    }));

    jest.unstable_mockModule('../functions/utils/issue-attribution.mjs', () => ({
      getMostRecentPublishedIssue,
      incrementIssueCounter,
    }));

    jest.unstable_mockModule('../functions/subscribers/unsubscribe-pages.mjs', () => ({
      htmlResponse: (body) => ({ statusCode: 200, headers: { 'Content-Type': 'text/html' }, body }),
      getUnsubscribePage,
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

  // A token in the query string marks the request as coming from an email we
  // sent — the RFC 8058 one-click POST from a mail provider, or the footer
  // link's confirmation form. These are the subscriber acting on their own
  // mail, so they count toward `unsubscribes`, not `manualRemovals`.
  describe('token flows (one-click and confirmation form)', () => {
    const tokenEvent = (body, headers = {}) => ({
      pathParameters: { tenant: 'test-tenant' },
      queryStringParameters: { email: 'encrypted-token' },
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      requestContext: { identity: { sourceIp: '192.168.1.1' } }
    });

    test('one-click POST removes without confirmation and answers JSON', async () => {
      decrypt.mockReturnValue('subscriber@example.com');
      unsubscribeUser.mockResolvedValue({ success: true, actuallyRemoved: true });

      const result = await handler(tokenEvent('List-Unsubscribe=One-Click'));

      expect(decrypt).toHaveBeenCalledWith('encrypted-token');
      expect(unsubscribeUser).toHaveBeenCalledWith(
        'test-tenant', 'subscriber@example.com', 'one-click', expect.any(Object)
      );
      expect(incrementIssueCounter).toHaveBeenCalledWith('test-tenant#5', 'unsubscribes');
      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/json');
    });

    test('a base64-encoded one-click body is decoded before parsing', async () => {
      decrypt.mockReturnValue('subscriber@example.com');
      unsubscribeUser.mockResolvedValue({ success: true, actuallyRemoved: true });

      const event = tokenEvent(Buffer.from('List-Unsubscribe=One-Click').toString('base64'));
      event.isBase64Encoded = true;

      const result = await handler(event);

      expect(unsubscribeUser).toHaveBeenCalledWith(
        'test-tenant', 'subscriber@example.com', 'one-click', expect.any(Object)
      );
      expect(result.statusCode).toBe(200);
    });

    test('confirmation form removes and answers with the HTML result page', async () => {
      decrypt.mockReturnValue('subscriber@example.com');
      unsubscribeUser.mockResolvedValue({ success: true, actuallyRemoved: true });

      const result = await handler(tokenEvent('confirmed=true'));

      expect(unsubscribeUser).toHaveBeenCalledWith(
        'test-tenant', 'subscriber@example.com', 'encrypted-link', expect.any(Object)
      );
      expect(incrementIssueCounter).toHaveBeenCalledWith('test-tenant#5', 'unsubscribes');
      expect(result.headers['Content-Type']).toBe('text/html');
      expect(getUnsubscribePage).toHaveBeenCalledWith('test-tenant', true, 'subscriber@example.com');
    });

    // RFC 8058 wants an honest status the provider can act on; a human gets
    // the failure page, which carries the manual form as an escape hatch.
    test('an undecryptable token fails one-click with 400 and humans with the failure page', async () => {
      decrypt.mockImplementation(() => { throw new Error('bad token'); });

      const oneClick = await handler(tokenEvent('List-Unsubscribe=One-Click'));
      expect(oneClick.statusCode).toBe(400);
      expect(unsubscribeUser).not.toHaveBeenCalled();

      const browser = await handler(tokenEvent('confirmed=true'));
      expect(browser.statusCode).toBe(200);
      expect(browser.headers['Content-Type']).toBe('text/html');
      expect(getUnsubscribePage).toHaveBeenCalledWith('test-tenant', false, '');
      expect(unsubscribeUser).not.toHaveBeenCalled();
    });

    test('an already-removed subscriber still gets a success answer and no double count', async () => {
      decrypt.mockReturnValue('subscriber@example.com');
      unsubscribeUser.mockResolvedValue({ success: true, actuallyRemoved: false });

      const result = await handler(tokenEvent('List-Unsubscribe=One-Click'));

      expect(result.statusCode).toBe(200);
      expect(incrementIssueCounter).not.toHaveBeenCalled();
    });

    test('one-click reports a real failure as 500 so the provider can retry', async () => {
      decrypt.mockReturnValue('subscriber@example.com');
      unsubscribeUser.mockResolvedValue({ success: false, actuallyRemoved: false });

      const result = await handler(tokenEvent('List-Unsubscribe=One-Click'));

      expect(result.statusCode).toBe(500);
      expect(incrementIssueCounter).not.toHaveBeenCalled();
    });
  });
});
