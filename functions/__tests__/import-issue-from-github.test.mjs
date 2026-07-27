import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { readFileSync } from 'node:fs';

// The import builds the Step Functions execution input; these tests mock the
// SFN client to inspect it, plus the GitHub/tenant lookups it does first.

let handler;
let startExecution;
let ddbSend;

const MARKDOWN = [
  '---',
  'title: Test Issue',
  'date: 2026-06-25',
  'slug: /newsletter/128',
  '---',
  '',
  '### A Section',
  'Body copy.',
  ''
].join('\n');

const loadIsolated = async (settingsItem = null) => {
  await jest.isolateModulesAsync(async () => {
    startExecution = jest.fn(() => Promise.resolve({}));
    ddbSend = jest.fn((command) => {
      if (command.Key?.sk === 'settings') {
        return Promise.resolve(settingsItem ? { Item: settingsItem } : {});
      }
      return Promise.resolve({});
    });

    jest.unstable_mockModule('@aws-sdk/client-sfn', () => ({
      SFNClient: jest.fn(() => ({ send: startExecution })),
      StartExecutionCommand: jest.fn((params) => params)
    }));

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      GetItemCommand: jest.fn((params) => ({ __type: 'GetItem', ...params })),
      QueryCommand: jest.fn((params) => ({ __type: 'Query', ...params }))
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: jest.fn((obj) => obj),
      unmarshall: jest.fn((item) => item)
    }));

    jest.unstable_mockModule('../utils/helpers.mjs', () => ({
      getTenant: jest.fn(() => Promise.resolve({ pk: 'tenant-1', email: 'owner@example.com', github: { owner: 'o', repo: 'r' } })),
      getOctokit: jest.fn(() => Promise.resolve({
        request: jest.fn(() => Promise.resolve({
          data: { content: Buffer.from(MARKDOWN, 'utf8').toString('base64') }
        }))
      }))
    }));

    jest.unstable_mockModule('../utils/event-publisher.mjs', () => ({
      publishIssueEvent: jest.fn(() => Promise.resolve()),
      EVENT_TYPES: { ISSUE_DRAFT_SAVED: 'ISSUE_DRAFT_SAVED' }
    }));

    ({ handler } = await import('../import-issue-from-github.mjs'));
  });
};

const runImport = async () => {
  await handler({ detail: { github: { fileName: 'issue.md' }, tenantId: 'tenant-1' } });
  expect(startExecution).toHaveBeenCalled();
  return JSON.parse(startExecution.mock.calls[0][0].input);
};

/** Depth-first search for a named state in an ASL doc. */
const findState = (node, stateName) => {
  if (!node || typeof node !== 'object') return undefined;

  if (node.States && Object.hasOwn(node.States, stateName)) {
    return node.States[stateName];
  }

  for (const value of Object.values(node)) {
    const found = findState(value, stateName);
    if (found) return found;
  }

  return undefined;
};

/** Every `$$.Execution.Input.<field>` a state dereferences, by field name. */
const inputFieldsReadBy = (state) => {
  const fields = new Set();

  const walk = (node) => {
    if (typeof node === 'string') {
      const match = /^\$\$\.Execution\.Input\.([a-zA-Z0-9_]+)/.exec(node);
      if (match) fields.add(match[1]);
    } else if (node && typeof node === 'object') {
      // Comment strings mention paths in prose; they are not dereferences.
      for (const [key, value] of Object.entries(node)) {
        if (key !== 'Comment') walk(value);
      }
    }
  };

  walk(state.Parameters);
  walk(state.Assign);
  return [...fields];
};

describe('import-issue-from-github', () => {
  beforeEach(() => {
    jest.resetModules();
    // The fixture issue is dated 2026-06-25; stay ahead of it so the send is
    // still in the future.
    jest.useFakeTimers().setSystemTime(new Date('2026-06-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('carries every execution-input field the states it reaches dereference', async () => {
    // These states pull fields off the execution input with `.$` references.
    // Those are not optional lookups: a missing field fails the whole execution
    // at runtime, and a GitHub import is the one caller that doesn't go through
    // the API's request validation. Reading the contract out of the ASL keeps
    // this honest when the payload changes.
    //
    // `Save Issue Record` is where the content and subject are read now. Phase 5
    // moved the API's producer to identifiers only - it stages the record itself,
    // so the execution reads the content back off it - which leaves a GitHub
    // import as the one entry point that still supplies them on the input, and
    // this the one state that reads them there.
    //
    // `Parse Issue` is still checked because it is the only parse state (Phase 3
    // merged the markdown and json/html paths) and it dereferences `fileName`.
    // It reads the content type off the `$contentType` variable rather than the
    // execution input, precisely because a GitHub import doesn't set that field;
    // the two Choices that do read it guard the reference with `IsPresent`.
    const asl = JSON.parse(
      readFileSync(new URL('../../state-machines/stage-issue.asl.json', import.meta.url), 'utf8')
    );

    const referenced = new Set();
    for (const stateName of ['Save Issue Record', 'Parse Issue']) {
      // Undefined would mean the state was renamed and this test stopped
      // checking anything, so assert it was found before reading it.
      const state = findState(asl, stateName);
      expect([stateName, state]).not.toEqual([stateName, undefined]);

      for (const field of inputFieldsReadBy(state)) referenced.add(field);
    }

    expect([...referenced].sort()).toEqual(['content', 'fileName', 'issueId', 'subject', 'tenant']);

    await loadIsolated();
    const input = await runImport();

    const missing = [...referenced].filter((field) => !Object.hasOwn(input, field));

    expect(missing).toEqual([]);
  });

  it('carries a null subject so the tenant template applies', async () => {
    await loadIsolated();

    const input = await runImport();

    expect(input.subject).toBeNull();
  });

  it('schedules a bare frontmatter date at the tenant default send time', async () => {
    await loadIsolated({ timezone: 'America/Chicago', defaultSendTime: '09:00' });

    const input = await runImport();

    // 2026-06-25 at 09:00 CDT is 14:00Z — not the hardcoded 12:00Z this used
    // to produce.
    expect(input.futureDate).toBe('2026-06-25T14:00:00.000Z');
  });

  it('defaults a bare frontmatter date to 09:00 UTC', async () => {
    await loadIsolated();

    const input = await runImport();

    expect(input.futureDate).toBe('2026-06-25T09:00:00.000Z');
  });
});
