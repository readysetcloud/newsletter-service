import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// parse-md-to-json reads sponsor/author via GetItem and snippets via Query on
// GSI1. We mock the DynamoDB client so the handler runs without AWS, returning
// the snippet set per test via the Query branch.

let handler;
let ddbSend;

const loadIsolated = async (snippets = [], settingsItem = null) => {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn((command) => {
      if (command.__type === 'Query') {
        return Promise.resolve({ Items: snippets.map((s) => ({ __snippet: s })) });
      }
      // The tenant settings record, when a test supplies one; absent means the
      // handler falls back to the system defaults.
      if (command.__type === 'GetItem' && command.Key?.sk === 'settings') {
        return Promise.resolve(settingsItem ? { Item: settingsItem } : {});
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

// Marker injection for interest-aware assembly (contentAssembly). The config is
// read from the issue record (pk `${tenantId}#${issueNumber}`, sk 'newsletter'),
// where the API persists it as a JSON string mirroring abTest.
describe('parse-md-to-json content assembly marker injection', () => {
  let issueRecordReads;

  const loadWithIssueRecord = async (issueRecord) => {
    await jest.isolateModulesAsync(async () => {
      issueRecordReads = [];
      ddbSend = jest.fn((command) => {
        if (command.__type === 'Query') {
          return Promise.resolve({ Items: [] });
        }
        if (command.__type === 'GetItem' && command.Key?.sk === 'newsletter') {
          issueRecordReads.push(command);
          return Promise.resolve(issueRecord ? { Item: issueRecord } : {});
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
        unmarshall: jest.fn((item) => item.__snippet ?? item),
      }));

      ({ handler } = await import('../parse-md-to-json.mjs'));
    });
  };

  const twoSectionMd = [
    '---',
    'title: Test Issue',
    'date: 2026-06-25',
    '---',
    '',
    '### First Section',
    'Some [link](https://a.com/one) here.',
    '',
    '### Second Section',
    'More text.',
    '',
    '### Tip of the Week',
    'A tip. {{< social url="https://social.example/post" >}}',
    '',
  ].join('\n');

  beforeEach(() => {
    jest.resetModules();
  });

  it('tags every generic section with start/end markers when the issue opts in', async () => {
    await loadWithIssueRecord({ contentAssembly: JSON.stringify({ enabled: true }) });
    const result = await handler({ content: twoSectionMd, issueId: 7, tenantId: 'tenant-1' });

    const sections = result.data.content.sections;
    expect(sections).toHaveLength(2);
    for (const section of sections) {
      expect(section.markerStart).toBe('<!--ia-section start-->');
      expect(section.markerEnd).toBe('<!--ia-section end-->');
    }
    // The config was read from the issue record with a projection.
    expect(issueRecordReads).toHaveLength(1);
    expect(issueRecordReads[0].Key).toEqual({ pk: 'tenant-1#7', sk: 'newsletter' });
    expect(issueRecordReads[0].ProjectionExpression).toBe('contentAssembly');
    // Fixed blocks are unaffected: tip of the week is not a generic section.
    expect(result.data.content.tipOfTheWeek).toBeDefined();
    expect(result.data.content.tipOfTheWeek.markerStart).toBeUndefined();
  });

  it('injects no markers when the issue has no contentAssembly config', async () => {
    await loadWithIssueRecord(null);
    const result = await handler({ content: twoSectionMd, issueId: 7, tenantId: 'tenant-1' });

    for (const section of result.data.content.sections) {
      expect(section.markerStart).toBeUndefined();
      expect(section.markerEnd).toBeUndefined();
    }
  });

  it('injects no markers when the config is present but disabled', async () => {
    await loadWithIssueRecord({ contentAssembly: JSON.stringify({ enabled: false }) });
    const result = await handler({ content: twoSectionMd, issueId: 7, tenantId: 'tenant-1' });

    for (const section of result.data.content.sections) {
      expect(section.markerStart).toBeUndefined();
    }
  });

  it('fails open (no markers) when the config read throws or is malformed', async () => {
    await loadWithIssueRecord({ contentAssembly: '{not-json' });
    const result = await handler({ content: twoSectionMd, issueId: 7, tenantId: 'tenant-1' });
    for (const section of result.data.content.sections) {
      expect(section.markerStart).toBeUndefined();
    }
  });

  it('skips the issue record read entirely when there is no tenantId', async () => {
    await loadWithIssueRecord({ contentAssembly: JSON.stringify({ enabled: true }) });
    const result = await handler({ content: twoSectionMd, issueId: 7 });

    expect(issueRecordReads).toHaveLength(0);
    for (const section of result.data.content.sections) {
      expect(section.markerStart).toBeUndefined();
    }
  });
});

describe('parse-md-to-json tenant settings', () => {
  beforeEach(() => {
    jest.resetModules();
    // The fixture issue is dated 2026-06-25; freeze the clock ahead of that so
    // it stays a future send and sendAtDate isn't collapsed to "now".
    jest.useFakeTimers().setSystemTime(new Date('2026-06-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const issue = (overrides = {}) => ({
    content: md('Some body copy.'),
    issueId: 12,
    tenantId: 'tenant-1',
    ...overrides,
  });

  it('builds the subject from the tenant template', async () => {
    await loadIsolated([], { subjectTemplate: '{{title}} | Picks of the Week #{{number}}' });

    const result = await handler(issue());

    expect(result.subject).toBe('Test Issue | Picks of the Week #12');
  });

  it('prefers a subject the caller supplied over the tenant template', async () => {
    // The API sets `subject` on every issue it stages, and the state machine
    // forwards it here. A tenant template is a default, not an override.
    await loadIsolated([], { subjectTemplate: '{{title}} | Picks of the Week #{{number}}' });

    const result = await handler(issue({ subject: 'A subject the caller chose' }));

    expect(result.subject).toBe('A subject the caller chose');
  });

  it('uses the tenant template when the caller subject is null', async () => {
    // GitHub imports carry `subject: null` so the state machine can reference
    // the field unconditionally.
    await loadIsolated([], { subjectTemplate: '{{title}} | Picks of the Week #{{number}}' });

    const result = await handler(issue({ subject: null }));

    expect(result.subject).toBe('Test Issue | Picks of the Week #12');
  });

  it('falls back to the issue title when no template is configured', async () => {
    // The subject used to be a hardcoded "Ready, Set, Cloud" string that every
    // tenant inherited; with nothing configured it is now just the title.
    await loadIsolated([]);

    const result = await handler(issue());

    expect(result.subject).toBe('Test Issue');
  });

  it('omits the public URL until the tenant configures where issues live', async () => {
    await loadIsolated([]);

    const result = await handler(issue());

    expect(result.data.metadata.url).toBeUndefined();
  });

  it('builds the public URL from the tenant pattern', async () => {
    await loadIsolated([], { issueUrlPattern: 'https://example.com/newsletter/{{number}}' });

    const result = await handler(issue());

    expect(result.data.metadata.url).toBe('https://example.com/newsletter/12');
  });

  it('sends a bare frontmatter date at the tenant default send time', async () => {
    await loadIsolated([], { timezone: 'America/Chicago', defaultSendTime: '09:00' });

    const result = await handler(issue());

    // The frontmatter date is 2026-06-25 with no time; 09:00 CDT is 14:00Z.
    expect(result.sendAtDate).toBe('2026-06-25T14:00:00.000Z');
  });

  it('defaults a bare frontmatter date to 09:00 UTC', async () => {
    await loadIsolated([]);

    const result = await handler(issue());

    expect(result.sendAtDate).toBe('2026-06-25T09:00:00.000Z');
  });

  it('hangs the cleanup and report jobs off the send instant', async () => {
    await loadIsolated([], { timezone: 'America/Chicago', defaultSendTime: '09:00' });

    const result = await handler(issue());

    expect(result.listCleanupDate).toBe('2026-06-28T14:00:00');
    expect(result.reportStatsDate).toBe('2026-06-30T14:00:00');
  });

  // The schedule outranks the author's frontmatter, and it has to: with a
  // publish lead time the workflow starts before the send instant, so "now" is
  // no longer the send time and the frontmatter date is only what the author
  // typed. The Scheduler entry fired against `sendAt`; everything derived from
  // the send instant follows it, the display date included.
  it('prefers the forwarded send instant over the frontmatter date', async () => {
    await loadIsolated([], { timezone: 'America/Chicago', defaultSendTime: '09:00' });

    const result = await handler(issue({ sendAt: '2026-06-29T14:00:00+00:00' }));

    expect(result.sendAtDate).toBe('2026-06-29T14:00:00.000Z');
    expect(result.listCleanupDate).toBe('2026-07-02T14:00:00');
    expect(result.reportStatsDate).toBe('2026-07-04T14:00:00');
    expect(result.data.metadata.date).toBe('June 29, 2026');
  });

  // Both Scheduler entries are `at()` expressions, and Scheduler refuses one in
  // the past with a ValidationException that neither entry's Retry lists — so
  // it takes the Parallel's Catch and stamps the issue `failed` *after* the
  // mail has gone out. The trigger is any send whose instant is already behind
  // it: an immediate publish of a stale draft, and every resend of an issue
  // more than three days old. parse-json-issue.mjs has always clamped; this is
  // the markdown path agreeing with it.
  it('dates the cleanup and report jobs from now when the send instant has passed', async () => {
    await loadIsolated([], { timezone: 'America/Chicago', defaultSendTime: '09:00' });

    // Frontmatter a month behind the fixed clock (2026-06-01T00:00:00Z), and no
    // forwarded sendAt — the resend shape.
    const stale = md('Some body copy.').replace('date: 2026-06-25', 'date: 2026-05-01');
    const result = await handler(issue({ content: stale }));

    expect(result.sendAtDate).toBe('now');
    expect(result.listCleanupDate).toBe('2026-06-04T00:00:00');
    expect(result.reportStatsDate).toBe('2026-06-06T00:00:00');
  });

  // An immediate publish carries `sendAt: null` on the execution input, which
  // must leave the frontmatter path exactly as it was.
  it('falls back to the frontmatter date when no send instant is forwarded', async () => {
    await loadIsolated([], { timezone: 'America/Chicago', defaultSendTime: '09:00' });

    const result = await handler(issue({ sendAt: null }));

    expect(result.sendAtDate).toBe('2026-06-25T14:00:00.000Z');
  });

  it('formats the display date in the tenant timezone', async () => {
    await loadIsolated([], { timezone: 'America/Chicago', defaultSendTime: '09:00' });

    const result = await handler(issue());

    expect(result.data.metadata.date).toBe('June 25, 2026');
  });

  it('still works when the tenant settings read fails', async () => {
    // A preferences lookup must never take down a publish.
    await loadIsolated([]);
    ddbSend.mockImplementation((command) => {
      if (command.__type === 'Query') return Promise.resolve({ Items: [] });
      if (command.Key?.sk === 'settings') return Promise.reject(new Error('boom'));
      return Promise.resolve({});
    });

    const result = await handler(issue());

    expect(result.subject).toBe('Test Issue');
    expect(result.sendAtDate).toBe('2026-06-25T09:00:00.000Z');
  });
});
