import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let getUnsubscribePage;
let ddbSend;

async function loadIsolated() {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn();

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((obj) => obj),
    }));

    jest.unstable_mockModule('handlebars', () => ({
      default: { compile: jest.fn(() => (data) => `<html>stock success=${data.wasSuccessful}</html>`) },
    }));

    ({ getUnsubscribePage } = await import('../functions/subscribers/unsubscribe-pages.mjs'));
  });
}

describe('unsubscribe result page selection', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    await loadIsolated();
  });

  const withTemplate = (template) => {
    ddbSend.mockResolvedValue(template ? { Item: template } : {});
  };

  test("uses the tenant's custom page when the unsubscribe succeeded", async () => {
    withTemplate({ success: '<html>custom success</html>' });

    expect(await getUnsubscribePage('t1', true, 'a@b.com')).toBe('<html>custom success</html>');
  });

  // The bug: a custom success page was returned for both outcomes, so someone
  // with a dead token was told they had been unsubscribed when they had not —
  // and never saw the stock failure page, whose manual form is their only way
  // off the list.
  test('falls back to the stock failure page when the unsubscribe failed', async () => {
    withTemplate({ success: '<html>custom success</html>' });

    const page = await getUnsubscribePage('t1', false, 'a@b.com');

    expect(page).not.toContain('custom success');
    expect(page).toBe('<html>stock success=false</html>');
  });

  test("uses the tenant's custom failure page when it has one", async () => {
    withTemplate({ success: '<html>custom success</html>', failure: '<html>custom failure</html>' });

    expect(await getUnsubscribePage('t1', false, 'a@b.com')).toBe('<html>custom failure</html>');
    expect(await getUnsubscribePage('t1', true, 'a@b.com')).toBe('<html>custom success</html>');
  });

  test('uses the stock pages when the tenant has no overrides', async () => {
    withTemplate(null);

    expect(await getUnsubscribePage('t1', true, 'a@b.com')).toBe('<html>stock success=true</html>');
    expect(await getUnsubscribePage('t1', false, 'a@b.com')).toBe('<html>stock success=false</html>');
  });
});
