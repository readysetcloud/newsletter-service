import { jest, describe, it, expect } from '@jest/globals';
import { renderWithSnippets } from '../utils/render-template.mjs';
import { resolveParameters } from '../utils/snippet-parameters.mjs';

// Parity guard: a snippet invoked from the issue BODY (the `{{< name >}}`
// shortcode bridge in parse-md-to-json) must render identically to the same
// snippet invoked from a TEMPLATE (`{{> name }}` via renderWithSnippets), given
// the same resolved parameters. This is the body-side analogue of the
// JS-send / Rust-preview conformance harness, locking the "one component,
// idiomatic per surface" guarantee for issue-body usage.

let handler;

const loadIsolated = async (snippets = []) => {
  await jest.isolateModulesAsync(async () => {
    const ddbSend = jest.fn((command) => {
      if (command.__type === 'Query') {
        return Promise.resolve({ Items: snippets.map((s) => ({ __snippet: s })) });
      }
      return Promise.resolve({});
    });

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((item) => item.__snippet ?? item),
    }));

    ({ handler } = await import('../parse-md-to-json.mjs'));
  });
};

const md = (body) => [
  '---',
  'title: Parity',
  'date: 2026-06-25',
  '---',
  '',
  '### Section',
  body,
  '',
].join('\n');

const snippet = {
  name: 'callout',
  content: '<div class="c"><strong>{{ label }}</strong>: {{ body }}</div>',
  parameters: [
    { name: 'label', type: 'string', defaultValue: 'Note' },
    { name: 'body', type: 'string', required: true },
  ],
};

describe('body / template snippet render parity', () => {
  it('renders the same HTML from the body bridge and the template path', async () => {
    await loadIsolated([snippet]);

    // Body path: the shortcode (with `label` omitted so the default applies).
    const result = await handler({
      content: md('{{< callout body="hello" >}}'),
      issueId: 9,
      tenantId: 'tenant-1',
    });
    const bodyHtml = result.data.content.sections[0].text;

    // Template path: the same snippet invoked as a partial, against the same
    // parameters resolved by the shared resolver.
    const { values } = resolveParameters(snippet.parameters, { body: 'hello' });
    const templateHtml = renderWithSnippets('{{> callout }}', values, [snippet]);

    // The template path produces exactly the snippet block...
    expect(templateHtml).toBe('<div class="c"><strong>Note</strong>: hello</div>');
    // ...and the body path embeds that identical block in the section.
    expect(bodyHtml).toContain(templateHtml);
  });
});
