import { jest, describe, it, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';

// The whole point of the dispatcher is that it changes nothing about what a
// parser returns - the state machine's single `Parse Issue` Task has to produce
// byte-identical output to whichever of the two Tasks it replaces. So these
// tests do not check that fields are present; they run the dispatcher and the
// parser it delegates to over the same input and deep-compare the two results.
//
// `listCleanupDate` and `reportStatsDate` are the fields that make this
// non-negotiable: they become EventBridge Scheduler entries firing three and
// five days after the send, where a wrong value mis-fires silently, days later,
// with nothing watching.

let dispatch;
let parseMarkdown;
let parseJsonIssue;
let ddbSend;

const marshall = (obj) => obj;
const unmarshall = (item) => item;

// Loads the dispatcher together with the two REAL parser modules from the same
// module registry, so `parseMarkdown` / `parseJsonIssue` here are the very
// functions the dispatcher delegates to. Only the AWS SDK is stubbed.
const loadWithRealParsers = async () => {
  await jest.isolateModulesAsync(async () => {
    // Every read the parsers make is fail-open (tenant settings, snippets,
    // author, sponsor, contentAssembly), so an empty response exercises the
    // documented defaults rather than a half-populated tenant.
    ddbSend = jest.fn().mockResolvedValue({});

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params }))
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({ marshall, unmarshall }));

    ({ handler: dispatch } = await import('../functions/parse-issue.mjs'));
    ({ handler: parseMarkdown } = await import('../functions/parse-md-to-json.mjs'));
    ({ handler: parseJsonIssue } = await import('../functions/parse-json-issue.mjs'));
  });
};

const MARKDOWN_CONTENT = `---
title: Byte-identical or bust
description: Fixture issue for the parse dispatcher
author: allen
date: 2026-08-03
---

### First Section

Copy with a [tracked link](https://example.com/one).

### Tip of the Week

Use a dispatcher, not a duplicated path.

### Last Words

See you next week.
`;

const JSON_CONTENT = JSON.stringify({
  metadata: { title: 'A structured issue', description: 'Straight from the API' },
  content: {
    sections: [{ header: 'First Section', text: '<p>Copy</p>' }],
    lastWords: '<p>See you next week.</p>'
  }
});

const HTML_CONTENT = '<html><body><h1>Pre-rendered master</h1></body></html>';

const baseState = {
  issueId: '412',
  tenantId: 'tenant-1',
  fileName: '412.md'
};

// Mirrors the date arithmetic in both parsers exactly (`setDate(+n)` on a local
// clock, seconds precision), so the expectation is independent of the runtime's
// timezone the same way production is.
const plusDays = (iso, days) => {
  const date = new Date(iso);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('.')[0];
};

// Frozen so a `new Date()` inside a parser cannot differ between the
// dispatcher's call and the direct call. Without this the 'now' cases - json and
// html, which is what the state machine sends today - would flake whenever the
// two calls straddled a second boundary.
const FROZEN_NOW = new Date('2026-07-24T14:00:00Z');

// Loaded once, not per test: `unstable_mockModule` registrations are file-wide
// and the parser stubs the last describe block installs would otherwise be
// handed to the "real parsers" load of every test after the first.
beforeAll(async () => {
  await loadWithRealParsers();
});

beforeEach(() => {
  jest.useFakeTimers({
    now: FROZEN_NOW,
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'performance', 'hrtime']
  });
  process.env.TABLE_NAME = 'newsletter-table';
});

afterEach(() => {
  jest.useRealTimers();
});

describe('parse-issue dispatcher: output matches the delegate exactly', () => {
  it('markdown output deep-equals parse-md-to-json for the same input', async () => {
    const state = { ...baseState, contentType: 'markdown', content: MARKDOWN_CONTENT, subject: 'Explicit subject' };

    const dispatched = await dispatch(state);
    const direct = await parseMarkdown(state);

    expect(dispatched).toEqual(direct);
    // Spelled out separately from the deep-equal so a regression here names
    // itself in the failure output rather than hiding inside a large diff.
    expect(dispatched.reportStatsDate).toBe(direct.reportStatsDate);
    expect(dispatched.listCleanupDate).toBe(direct.listCleanupDate);
  });

  it('json output deep-equals parse-json-issue for the same input', async () => {
    const state = { ...baseState, contentType: 'json', content: JSON_CONTENT, subject: 'Explicit subject' };

    const dispatched = await dispatch(state);
    const direct = await parseJsonIssue(state);

    expect(dispatched).toEqual(direct);
    expect(dispatched.reportStatsDate).toBe(direct.reportStatsDate);
    expect(dispatched.listCleanupDate).toBe(direct.listCleanupDate);
  });

  it('html output deep-equals parse-json-issue for the same input', async () => {
    const state = { ...baseState, contentType: 'html', content: HTML_CONTENT };

    const dispatched = await dispatch(state);
    const direct = await parseJsonIssue(state);

    expect(dispatched).toEqual(direct);
    expect(dispatched.reportStatsDate).toBe(direct.reportStatsDate);
    expect(dispatched.listCleanupDate).toBe(direct.listCleanupDate);
    // html mode carries the pre-rendered master through untouched; if this input
    // had been routed to the markdown parser it would have been mangled into
    // sections instead.
    expect(dispatched.data.__master).toBe(HTML_CONTENT);
  });

  it('deep-equals parse-json-issue when a futureDate moves the scheduler dates', async () => {
    // The only input that moves listCleanupDate/reportStatsDate off "now" on the
    // json path, and therefore the one most worth pinning.
    const state = {
      ...baseState,
      contentType: 'json',
      content: JSON_CONTENT,
      futureDate: '2026-08-03T09:00:00Z'
    };

    const dispatched = await dispatch(state);
    const direct = await parseJsonIssue(state);

    expect(dispatched).toEqual(direct);
    expect(dispatched.sendAtDate).toBe('2026-08-03T09:00:00.000Z');
  });

  // Teeth for the deep-equals above: they only mean something if the two parsers
  // actually disagree on these fields for the same input. They do - the
  // markdown parser reads the send instant out of the frontmatter `date`, the
  // json parser has no frontmatter to read and falls back to now - so a
  // dispatcher that picked the wrong delegate could not pass.
  it('the two parsers disagree on the scheduler dates for the same input', async () => {
    const state = { ...baseState, contentType: 'json', content: MARKDOWN_CONTENT };

    const asMarkdown = await parseMarkdown(state);
    const asJson = await parseJsonIssue({ ...state, content: JSON_CONTENT });

    expect(asMarkdown.reportStatsDate).not.toBe(asJson.reportStatsDate);
    expect(asMarkdown.listCleanupDate).not.toBe(asJson.listCleanupDate);
  });
});

describe('parse-issue dispatcher: scheduler dates hang off the send instant', () => {
  it('puts list cleanup at send +3 days and the stats report at send +5', async () => {
    const dispatched = await dispatch({
      ...baseState,
      contentType: 'markdown',
      content: MARKDOWN_CONTENT
    });

    // The frontmatter date is bare, so it resolves to the tenant's default send
    // time (09:00) in the tenant's timezone (UTC, since the settings read is
    // empty here).
    expect(dispatched.sendAtDate).toBe('2026-08-03T09:00:00.000Z');
    expect(dispatched.listCleanupDate).toBe(plusDays(dispatched.sendAtDate, 3));
    expect(dispatched.reportStatsDate).toBe(plusDays(dispatched.sendAtDate, 5));
  });

  it('anchors both dates to now for an immediate json send', async () => {
    const dispatched = await dispatch({ ...baseState, contentType: 'json', content: JSON_CONTENT });

    expect(dispatched.sendAtDate).toBe('now');
    expect(dispatched.listCleanupDate).toBe(plusDays(FROZEN_NOW.toISOString(), 3));
    expect(dispatched.reportStatsDate).toBe(plusDays(FROZEN_NOW.toISOString(), 5));
  });
});

describe('parse-issue dispatcher: content type routing', () => {
  // Matches `normalize_content_type` in issues.rs: json and html are named
  // explicitly, everything else - absent, empty, unknown - is markdown.
  const markdownAliases = [undefined, '', '   ', 'markdown', 'MarkDown', ' markdown ', 'md', 'mdx', 'text/markdown'];

  it.each(markdownAliases)('routes contentType %p to the markdown parser', async (contentType) => {
    const state = { ...baseState, content: MARKDOWN_CONTENT, ...(contentType === undefined ? {} : { contentType }) };

    const dispatched = await dispatch(state);
    const direct = await parseMarkdown(state);

    expect(dispatched).toEqual(direct);
  });

  it.each(['json', 'JSON', ' Json '])('routes contentType %p to the json parser', async (contentType) => {
    const dispatched = await dispatch({ ...baseState, contentType, content: JSON_CONTENT });
    const direct = await parseJsonIssue({ ...baseState, contentType: 'json', content: JSON_CONTENT });

    expect(dispatched).toEqual(direct);
  });

  it.each(['html', 'HTML', ' Html '])('routes contentType %p to the json parser in html mode', async (contentType) => {
    const dispatched = await dispatch({ ...baseState, contentType, content: HTML_CONTENT });
    const direct = await parseJsonIssue({ ...baseState, contentType: 'html', content: HTML_CONTENT });

    expect(dispatched).toEqual(direct);
    // A capitalized value that reached the json parser un-normalized would take
    // the JSON.parse branch and throw on a pre-rendered master.
    expect(dispatched.data.__master).toBe(HTML_CONTENT);
  });

  it('surfaces the delegate\'s error rather than swallowing or rewrapping it', async () => {
    await expect(dispatch({ ...baseState, contentType: 'json', content: 'not json at all' }))
      .rejects.toThrow(/Issue content is not valid JSON/);
  });
});

describe('parse-issue dispatcher: delegation', () => {
  // Same checks from the other side, with both parsers stubbed: proves the
  // dispatcher forwards the payload it was given and returns the delegate's
  // result by identity - so there is nowhere for it to re-shape a field even in
  // principle.
  // Created once and only cleared between tests: a mocked ESM module is
  // instantiated once per file, so a factory that closed over a per-test
  // `jest.fn()` would keep handing the dispatcher the first test's stub.
  const markdownStub = jest.fn().mockResolvedValue({ from: 'markdown' });
  const jsonStub = jest.fn().mockResolvedValue({ from: 'json' });
  let dispatchStubbed;

  beforeAll(async () => {
    jest.unstable_mockModule('../functions/parse-md-to-json.mjs', () => ({ handler: markdownStub }));
    jest.unstable_mockModule('../functions/parse-json-issue.mjs', () => ({ handler: jsonStub }));

    await jest.isolateModulesAsync(async () => {
      ({ handler: dispatchStubbed } = await import('../functions/parse-issue.mjs'));
    });
  });

  beforeEach(() => {
    markdownStub.mockClear();
    jsonStub.mockClear();
  });

  it('calls only the markdown parser for markdown and returns its result unchanged', async () => {
    const result = await dispatchStubbed({ ...baseState, contentType: 'markdown', content: MARKDOWN_CONTENT });

    expect(jsonStub).not.toHaveBeenCalled();
    expect(markdownStub).toHaveBeenCalledTimes(1);
    expect(result).toBe(await markdownStub.mock.results[0].value);
  });

  it.each(['json', 'html'])('calls only the json parser for %s and returns its result unchanged', async (contentType) => {
    const result = await dispatchStubbed({ ...baseState, contentType, content: JSON_CONTENT });

    expect(markdownStub).not.toHaveBeenCalled();
    expect(jsonStub).toHaveBeenCalledTimes(1);
    expect(result).toBe(await jsonStub.mock.results[0].value);
  });

  it('forwards every payload field, with contentType normalized', async () => {
    const state = {
      issueId: '412',
      tenantId: 'tenant-1',
      fileName: '412.md',
      subject: 'Explicit subject',
      futureDate: '2026-08-03T09:00:00Z',
      content: HTML_CONTENT,
      contentType: 'HTML'
    };

    await dispatchStubbed(state);

    expect(jsonStub).toHaveBeenCalledWith({ ...state, contentType: 'html' });
  });

  it('tolerates a missing payload rather than throwing before the parser sees it', async () => {
    await dispatchStubbed(undefined);

    expect(markdownStub).toHaveBeenCalledWith({ contentType: 'markdown' });
  });
});
