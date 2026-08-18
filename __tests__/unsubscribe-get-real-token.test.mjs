import { jest, describe, test, expect, beforeEach } from '@jest/globals';

/**
 * Deliberately its own file, with the token module left real.
 *
 * The handler suites mock `readSubscriberToken`, which means a handler reaching
 * for the wrong decode primitive still passes them — exactly how the GET path
 * shipped calling `decrypt()` and rendering a serialized payload where the
 * address belongs. Minting a real token end to end is the only version of this
 * test that can catch that.
 */
describe('unsubscribe GET with a real minted token', () => {
  let realHandler;
  let capturedConfirmation;
  let mintSubscriberToken;

  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    process.env.EMAIL_ENCRYPTION_KEY = 'test-encryption-key';
    capturedConfirmation = null;

    await jest.isolateModulesAsync(async () => {
      jest.unstable_mockModule('../functions/subscribers/unsubscribe-pages.mjs', () => ({
        htmlResponse: (body) => ({ statusCode: 200, headers: { 'Content-Type': 'text/html' }, body }),
        getConfirmationPage: jest.fn((tenantId, email) => {
          capturedConfirmation = { tenantId, email };
          return `<html>confirm ${email}</html>`;
        }),
        getUnsubscribePage: jest.fn(async () => '<html>failure</html>'),
      }));

      jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
        EventBridgeClient: jest.fn(() => ({ send: jest.fn().mockResolvedValue({}) })),
        PutEventsCommand: jest.fn((params) => ({ __type: 'PutEvents', ...params })),
      }));

      ({ mintSubscriberToken } = await import('../functions/utils/subscriber-token.mjs'));
      ({ handler: realHandler } = await import('../functions/subscribers/unsubscribe.mjs'));
    });
  });

  test('shows the address, not the serialized token payload', async () => {
    const token = mintSubscriberToken('test-tenant', 'subscriber@example.com');

    const result = await realHandler({
      pathParameters: { tenant: 'test-tenant' },
      queryStringParameters: { email: token }
    });

    expect(result.statusCode).toBe(200);
    expect(capturedConfirmation).toEqual({
      tenantId: 'test-tenant',
      email: 'subscriber@example.com'
    });
    // The payload's own fields must never reach the page.
    expect(result.body).not.toContain('subscriber-link');
    expect(result.body).not.toContain('tenantId');
  });

  test('refuses a token minted for another tenant', async () => {
    const token = mintSubscriberToken('other-tenant', 'subscriber@example.com');

    const result = await realHandler({
      pathParameters: { tenant: 'test-tenant' },
      queryStringParameters: { email: token }
    });

    expect(capturedConfirmation).toBeNull();
    expect(result.body).toBe('<html>failure</html>');
  });
});
