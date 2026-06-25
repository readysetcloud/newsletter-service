import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// parse-md-to-json reads sponsor/author via GetItem and snippets via Query on
// GSI1. We mock the DynamoDB client so the handler runs without AWS, returning
// the snippet set per test via the Query branch.

let handler;
let ddbSend;

const loadIsolated = async (snippets = []) => {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn((command) => {
      if (command.__type === 'Query') {
        return Promise.resolve({ Items: snippets.map((s) => ({ __snippet: s })) });
      }
      // GetItem for sponsor/author — not exercised by these tests.
      return Promise.resolve({});
    });

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      // Items are wrapped as { __snippet } so unmarshall just unwraps them.
      unmarshall: jest.fn((item) => item.__snippet ?? item),
    }));

    ({ handler } = await import('../parse-md-to-json.mjs'));
  });
};

const md = (body) => [
  '---',
  'title: Test Issue',
  'date: 2026-06-25',
  '---',
  '',
  '### A Section',
  body,
  '',
].join('\n');

const sectionText = async (result) => result.data.content.sections[0].text;

describe('parse-md-to-json body snippet bridge', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('renders robotVoice from the hardcoded fallback when no snippet exists', async () => {
    await loadIsolated([]);
    const result = await handler({
      content: md('Intro.\n\n{{< robotVoice text="A *dry* summary." >}}\n\nOutro.'),
      issueId: 5,
      tenantId: 'tenant-1',
    });
    const text = await sectionText(result);
    expect(text).toContain('robot voice');
    expect(text).toContain('404 &middot; personality not found');
    // Inline markdown inside the attribute is rendered.
    expect(text).toContain('<em>dry</em>');
    expect(text).not.toContain('{{<');
  });

  it('lets a tenant snippet override the hardcoded block', async () => {
    await loadIsolated([
      {
        name: 'robotVoice',
        content: '<aside class="rv">{{ text }}</aside>',
        parameters: [{ name: 'text', type: 'textarea', required: true }],
      },
    ]);
    const result = await handler({
      content: md('{{< robotVoice text="hello" >}}'),
      issueId: 5,
      tenantId: 'tenant-1',
    });
    const text = await sectionText(result);
    expect(text).toContain('<aside class="rv">hello</aside>');
    // The hardcoded version is not used.
    expect(text).not.toContain('404 &middot; personality not found');
  });

  it('renders an arbitrary tenant snippet used 0..N times with resolved params', async () => {
    await loadIsolated([
      {
        name: 'callout',
        content: '<div class="c">{{ label }}: {{ body }}</div>',
        parameters: [
          { name: 'label', type: 'string', defaultValue: 'Note' },
          { name: 'body', type: 'string', required: true },
        ],
      },
    ]);
    const result = await handler({
      content: md('{{< callout body="first" >}}\n\nmiddle\n\n{{< callout label="Tip" body="second" >}}'),
      issueId: 5,
      tenantId: 'tenant-1',
    });
    const text = await sectionText(result);
    // First uses the default label; second overrides it.
    expect(text).toContain('<div class="c">Note: first</div>');
    expect(text).toContain('<div class="c">Tip: second</div>');
  });

  it('leaves unknown shortcodes untouched and works with no tenantId', async () => {
    await loadIsolated([]);
    const result = await handler({
      content: md('Body with {{< unknownThing foo="bar" >}} inline.'),
      issueId: 5,
    });
    const text = await sectionText(result);
    expect(text).toContain('{{< unknownThing foo="bar" >}}');
    // No snippet query is issued when there is no tenant.
    expect(ddbSend).not.toHaveBeenCalledWith(expect.objectContaining({ __type: 'Query' }));
  });
});
