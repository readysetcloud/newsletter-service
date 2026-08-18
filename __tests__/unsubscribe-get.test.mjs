import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let handler;
let readSubscriberToken;
let getTenant;
let getConfirmationPage;
let getUnsubscribePage;
let eventBridgeSend;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    readSubscriberToken = jest.fn();
    getTenant = jest.fn();
    getConfirmationPage = jest.fn((tenantId, email) => `<html>confirm ${email}</html>`);
    getUnsubscribePage = jest.fn(async (tenantId, wasSuccessful) => `<html>result:${wasSuccessful}</html>`);
    eventBridgeSend = jest.fn().mockResolvedValue({});

    jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
      getTenant,
    }));

    jest.unstable_mockModule('../functions/utils/subscriber-token.mjs', () => ({
      readSubscriberToken,
    }));

    jest.unstable_mockModule('../functions/subscribers/unsubscribe-pages.mjs', () => ({
      htmlResponse: (body) => ({ statusCode: 200, headers: { 'Content-Type': 'text/html' }, body }),
      getConfirmationPage,
      getUnsubscribePage,
    }));

    jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
      EventBridgeClient: jest.fn(() => ({ send: eventBridgeSend })),
      PutEventsCommand: jest.fn((params) => ({ __type: 'PutEvents', ...params })),
    }));

    ({ handler } = await import('../functions/subscribers/unsubscribe.mjs'));
  });
}

// The GET is what corporate mail security fetches when it scans every link in
// a message. It must therefore render and do nothing else — the removal lives
// behind the POST, which scanners never send.
describe('unsubscribe GET handler', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    await loadIsolated();

    getTenant.mockResolvedValue({
      pk: 'test-tenant',
      brandName: 'Test Brand',
      createdBy: 'admin@example.com'
    });
  });

  test('renders the confirmation page and removes nobody', async () => {
    readSubscriberToken.mockReturnValue({ email: 'subscriber@example.com', legacy: false });

    const result = await handler({
      pathParameters: { tenant: 'test-tenant' },
      queryStringParameters: { email: 'encrypted-token' }
    });

    expect(result.statusCode).toBe(200);
    expect(result.headers['Content-Type']).toBe('text/html');
    expect(getConfirmationPage).toHaveBeenCalledWith('test-tenant', 'subscriber@example.com');
    // No result page, no admin alert — a scanner fetching this URL leaves no trace.
    expect(getUnsubscribePage).not.toHaveBeenCalled();
    expect(eventBridgeSend).not.toHaveBeenCalled();
  });

  test('an undecryptable token gets the failure page with the manual form', async () => {
    readSubscriberToken.mockImplementation(() => { throw new Error('bad token'); });

    const result = await handler({
      pathParameters: { tenant: 'test-tenant' },
      queryStringParameters: { email: 'garbage' }
    });

    expect(result.statusCode).toBe(200);
    expect(getConfirmationPage).not.toHaveBeenCalled();
    expect(getUnsubscribePage).toHaveBeenCalledWith('test-tenant', false, null);
    // The operator hears about broken links.
    expect(eventBridgeSend).toHaveBeenCalled();
  });

  test('a missing token gets the failure page', async () => {
    const result = await handler({
      pathParameters: { tenant: 'test-tenant' },
      queryStringParameters: {}
    });

    expect(result.statusCode).toBe(200);
    expect(getUnsubscribePage).toHaveBeenCalledWith('test-tenant', false, null);
  });
});
