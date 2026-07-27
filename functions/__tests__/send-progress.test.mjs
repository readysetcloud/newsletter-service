import { jest } from '@jest/globals';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

process.env.TABLE_NAME = 'test-newsletter-table';

let buildInitialProgress;
let isComplete;
let issueIdFromReference;
let startProgress;
let markGroupSent;
let SEND_PROGRESS_SK;

// Two items live in this store: the issue record (sk `newsletter`) and the
// progress record (sk `sendProgress`). Conditions are enforced, because the
// concurrency behaviour is the point of the module.
let items; // Map of `${pk}|${sk}` -> unmarshalled item

class ConditionalCheckFailedException extends Error {
  constructor(item) {
    super('The conditional request failed');
    this.name = 'ConditionalCheckFailedException';
    // DynamoDB returns the current item alongside the error when the request
    // asks for it, which is how callers tell "already there" from "somewhere
    // else entirely".
    if (item) this.Item = marshall(item);
  }
}

const keyOf = (command) => {
  const key = unmarshall(command.input.Key);
  return `${key.pk}|${key.sk}`;
};

/** Resolve `#alias` tokens in an expression fragment to their real names. */
const resolveNames = (fragment, names = {}) =>
  fragment.replace(/#[A-Za-z0-9_]+/g, (token) => names[token] ?? token);

const checkCondition = (condition, item, values, names) => {
  if (!condition) return;
  const resolved = resolveNames(condition, names);

  const existsMatch = resolved.match(/^attribute_exists\((.+)\)$/);
  if (existsMatch) {
    const [root, leaf] = existsMatch[1].split('.');
    const present = leaf === undefined ? item?.[root] !== undefined : item?.[root]?.[leaf] !== undefined;
    if (!present) throw new ConditionalCheckFailedException();
    return;
  }

  const notExistsMatch = resolved.match(/^attribute_not_exists\((.+)\)$/);
  if (notExistsMatch) {
    if (item?.[notExistsMatch[1]] !== undefined) throw new ConditionalCheckFailedException(item);
    return;
  }

  const inMatch = resolved.match(/^status IN \((.+)\)$/);
  if (inMatch) {
    const allowed = inMatch[1].split(',').map((token) => values[token.trim()]);
    if (!allowed.includes(item?.status)) throw new ConditionalCheckFailedException(item);
    return;
  }

  throw new Error(`Test emulator does not handle condition: ${resolved}`);
};

/** Apply the SET/REMOVE clauses the module actually uses. */
const applyUpdate = (item, command, values, names) => {
  const expression = resolveNames(command.input.UpdateExpression, names);
  const [, setClause = '', removeClause = ''] = expression.match(/SET (.*?)(?:REMOVE (.*))?$/s) ?? [];

  // Split on top-level commas only: `if_not_exists(publishedAt, :now)` carries
  // one of its own.
  const assignments = setClause
    .split(/,(?![^(]*\))/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const assignment of assignments) {
    const [rawPath, rawValue] = assignment.split('=').map((part) => part.trim());

    let value;
    const ifNotExists = rawValue.match(/^if_not_exists\((.+),\s*(:.+)\)$/);
    if (ifNotExists) {
      const [existingPath, fallback] = [ifNotExists[1], ifNotExists[2]];
      value = item[existingPath] ?? values[fallback];
    } else {
      value = values[rawValue];
    }

    const path = rawPath.split('.');
    if (path.length === 1) {
      item[path[0]] = value;
    } else {
      let cursor = item;
      for (const segment of path.slice(0, -1)) {
        cursor[segment] = cursor[segment] ?? {};
        cursor = cursor[segment];
      }
      cursor[path.at(-1)] = value;
    }
  }

  for (const attribute of removeClause.split(',').map((part) => part.trim()).filter(Boolean)) {
    delete item[attribute];
  }
};

function handleCommand(command) {
  if (!(command instanceof UpdateItemCommand)) {
    throw new Error(`Unexpected command: ${command?.constructor?.name}`);
  }

  const id = keyOf(command);
  const item = items.get(id) ?? Object.fromEntries(Object.entries(unmarshall(command.input.Key)));
  const values = command.input.ExpressionAttributeValues
    ? unmarshall(command.input.ExpressionAttributeValues)
    : {};
  const names = command.input.ExpressionAttributeNames ?? {};

  checkCondition(command.input.ConditionExpression, items.get(id), values, names);
  applyUpdate(item, command, values, names);
  items.set(id, item);

  return command.input.ReturnValues === 'ALL_NEW' ? { Attributes: marshall(item) } : {};
}

const ISSUE_ID = 'tenant-1#42';
const progressKey = () => `${ISSUE_ID}|${SEND_PROGRESS_SK}`;
const issueKey = () => `${ISSUE_ID}|newsletter`;

const plansFixture = () => [
  { label: 'America/Chicago', sendTime: new Date('2026-07-27T14:00:00.000Z'), size: 40 },
  { label: 'America/Los_Angeles', sendTime: new Date('2026-07-27T16:00:00.000Z'), size: 12 },
  { label: '__default__', sendTime: new Date('2026-07-27T14:00:00.000Z'), size: 100 }
];

const buildFixture = () => buildInitialProgress({
  mode: 'timezone',
  defaultTimeZone: 'America/Chicago',
  base: new Date('2026-07-27T14:00:00.000Z'),
  catchAllAt: new Date('2026-07-27T16:30:00.000Z'),
  plans: plansFixture(),
  catchAllLabel: '__catch_all__',
  totalSubscribers: 152
});

beforeEach(async () => {
  items = new Map();
  DynamoDBClient.prototype.send = jest.fn(async (command) => handleCommand(command));

  const module = await import('../utils/send-progress.mjs');
  ({
    buildInitialProgress,
    isComplete,
    issueIdFromReference,
    startProgress,
    markGroupSent,
    SEND_PROGRESS_SK
  } = module);

  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('issueIdFromReference', () => {
  test('splits on the last underscore so tenant ids may contain one', () => {
    expect(issueIdFromReference('my_tenant', 'my_tenant_42')).toBe('my_tenant#42');
  });

  test('returns null when inputs are unusable', () => {
    expect(issueIdFromReference('tenant-1', undefined)).toBeNull();
    expect(issueIdFromReference(undefined, 'tenant-1_42')).toBeNull();
  });
});

describe('buildInitialProgress', () => {
  test('plans every group plus the catch-all, all pending', () => {
    const progress = buildInitialProgress({
      mode: 'timezone',
      defaultTimeZone: 'America/Chicago',
      base: new Date('2026-07-27T14:00:00.000Z'),
      catchAllAt: new Date('2026-07-27T16:30:00.000Z'),
      plans: plansFixture(),
      catchAllLabel: '__catch_all__',
      totalSubscribers: 152
    });

    expect(Object.keys(progress.groups).sort()).toEqual([
      'America/Chicago',
      'America/Los_Angeles',
      '__catch_all__',
      '__default__'
    ]);
    expect(Object.values(progress.groups).every((group) => group.status === 'pending')).toBe(true);
    expect(progress.groups['America/Los_Angeles'].sendAt).toBe('2026-07-27T16:00:00.000Z');
    expect(progress.groups['America/Los_Angeles'].size).toBe(12);
    expect(progress.totalSubscribers).toBe(152);
  });

  test('the catch-all has no predictable size', () => {
    // It sweeps whoever the per-group sends missed, which is not knowable up front.
    expect(buildFixture().groups.__catch_all__.size).toBeNull();
  });

  test('peak-hour mode carries no default timezone', () => {
    const progress = buildInitialProgress({
      mode: 'peak-hour',
      base: new Date('2026-07-27T14:00:00.000Z'),
      catchAllAt: new Date('2026-07-27T16:30:00.000Z'),
      plans: [{ label: 'hour-9', sendTime: new Date('2026-07-27T09:00:00.000Z'), size: 3 }],
      catchAllLabel: '__catch_all__',
      totalSubscribers: 3
    });

    expect(progress.mode).toBe('peak-hour');
    expect(progress).not.toHaveProperty('defaultTimeZone');
  });
});

describe('isComplete', () => {
  test('false while any group is pending', () => {
    const progress = buildFixture();
    progress.groups['America/Chicago'].status = 'sent';
    expect(isComplete(progress)).toBe(false);
  });

  test('true once every group has reported, counting empty as reported', () => {
    const progress = buildFixture();
    for (const group of Object.values(progress.groups)) {
      group.status = 'sent';
    }
    progress.groups.__default__.status = 'empty';
    expect(isComplete(progress)).toBe(true);
  });

  test('false for a missing or empty group map', () => {
    expect(isComplete(undefined)).toBe(false);
    expect(isComplete({})).toBe(false);
    expect(isComplete({ groups: {} })).toBe(false);
  });
});

describe('startProgress', () => {
  test('writes the plan and moves the issue to sending', async () => {
    items.set(issueKey(), { pk: ISSUE_ID, sk: 'newsletter', status: 'in progress' });

    await startProgress(ISSUE_ID, buildFixture());

    const progress = items.get(progressKey());
    expect(progress.mode).toBe('timezone');
    expect(progress.totalSubscribers).toBe(152);
    expect(Object.keys(progress.groups)).toHaveLength(4);
    expect(items.get(issueKey()).status).toBe('sending');
  });

  test('a resend of a published issue may re-enter sending', async () => {
    items.set(issueKey(), { pk: ISSUE_ID, sk: 'newsletter', status: 'published' });

    await startProgress(ISSUE_ID, buildFixture());

    expect(items.get(issueKey()).status).toBe('sending');
  });

  test('never resurrects a draft', async () => {
    items.set(issueKey(), { pk: ISSUE_ID, sk: 'newsletter', status: 'draft' });

    await startProgress(ISSUE_ID, buildFixture());

    expect(items.get(issueKey()).status).toBe('draft');
    // The plan is still recorded — only the status transition is refused.
    expect(items.get(progressKey())).toBeDefined();
  });

  test('refuses to overwrite a completed plan', async () => {
    // The plan write used to clear completedAt unconditionally, which meant a
    // redelivered event reopened a finished send. Reopening is now something a
    // caller has to ask for explicitly, by clearing the record first.
    items.set(progressKey(), { pk: ISSUE_ID, sk: SEND_PROGRESS_SK, completedAt: '2026-07-20T00:00:00.000Z' });
    items.set(issueKey(), { pk: ISSUE_ID, sk: 'newsletter', status: 'published' });

    await startProgress(ISSUE_ID, buildFixture());

    expect(items.get(progressKey()).completedAt).toBe('2026-07-20T00:00:00.000Z');
    expect(items.get(progressKey()).groups).toBeUndefined();
    expect(items.get(issueKey()).status).toBe('published');
  });

  test('a write failure is swallowed', async () => {
    DynamoDBClient.prototype.send = jest.fn(async () => {
      throw new Error('ProvisionedThroughputExceededException');
    });

    await expect(startProgress(ISSUE_ID, buildFixture())).resolves.toBeUndefined();
  });
});

describe('markGroupSent', () => {
  beforeEach(async () => {
    items.set(issueKey(), { pk: ISSUE_ID, sk: 'newsletter', status: 'in progress' });
    await startProgress(ISSUE_ID, buildFixture());
  });

  test('records recipients against the group without touching the others', async () => {
    await markGroupSent(ISSUE_ID, 'America/Chicago', { recipients: 38, skipped: 2 });

    const { groups } = items.get(progressKey());
    expect(groups['America/Chicago']).toMatchObject({ status: 'sent', recipients: 38, skipped: 2 });
    expect(groups['America/Chicago'].sentAt).toBeDefined();
    expect(groups['America/Los_Angeles'].status).toBe('pending');
    // The plan values survive the update.
    expect(groups['America/Chicago'].size).toBe(40);
  });

  test('a group that sent to nobody is recorded as empty, not sent', async () => {
    await markGroupSent(ISSUE_ID, '__default__', { recipients: 0, skipped: 100 });

    expect(items.get(progressKey()).groups.__default__.status).toBe('empty');
  });

  test('the issue stays sending until the last group reports', async () => {
    await markGroupSent(ISSUE_ID, 'America/Chicago', { recipients: 38 });
    await markGroupSent(ISSUE_ID, 'America/Los_Angeles', { recipients: 12 });
    await markGroupSent(ISSUE_ID, '__default__', { recipients: 100 });

    expect(items.get(issueKey()).status).toBe('sending');
    expect(items.get(progressKey()).completedAt).toBeUndefined();

    await markGroupSent(ISSUE_ID, '__catch_all__', { recipients: 0, skipped: 150 });

    expect(items.get(progressKey()).completedAt).toBeDefined();
    expect(items.get(issueKey()).status).toBe('published');
    expect(items.get(issueKey()).publishedAt).toBeDefined();
  });

  test('an existing publishedAt is preserved when the send completes', async () => {
    items.get(issueKey()).publishedAt = '2026-07-27T14:00:05.000Z';

    for (const label of ['America/Chicago', 'America/Los_Angeles', '__default__', '__catch_all__']) {
      await markGroupSent(ISSUE_ID, label, { recipients: 1 });
    }

    expect(items.get(issueKey()).publishedAt).toBe('2026-07-27T14:00:05.000Z');
  });

  test('completion is stamped once even if two groups finish concurrently', async () => {
    await markGroupSent(ISSUE_ID, 'America/Chicago', { recipients: 38 });
    await markGroupSent(ISSUE_ID, 'America/Los_Angeles', { recipients: 12 });

    // Both remaining groups observe a complete map and race for the stamp.
    await Promise.all([
      markGroupSent(ISSUE_ID, '__default__', { recipients: 100 }),
      markGroupSent(ISSUE_ID, '__catch_all__', { recipients: 0 })
    ]);

    const statusWrites = DynamoDBClient.prototype.send.mock.calls
      .map(([command]) => command)
      .filter((command) => unmarshall(command.input.Key).sk === 'newsletter')
      .filter((command) => unmarshall(command.input.ExpressionAttributeValues)[':status'] === 'published');

    expect(statusWrites).toHaveLength(1);
    expect(items.get(issueKey()).status).toBe('published');
  });

  test('an unplanned group label is skipped rather than invented', async () => {
    await markGroupSent(ISSUE_ID, 'Europe/Berlin', { recipients: 5 });

    expect(items.get(progressKey()).groups).not.toHaveProperty('Europe/Berlin');
  });

  test('a missing progress record is tolerated', async () => {
    items.delete(progressKey());

    await expect(markGroupSent(ISSUE_ID, 'America/Chicago', { recipients: 1 })).resolves.toBeUndefined();
    expect(items.get(issueKey()).status).toBe('sending');
  });
  test('a transient failure on the terminal status write is retried, not swallowed', async () => {
    // The failure Codex described: completedAt lands, the status write blips,
    // and the issue is stuck at 'sending' with no later event able to fix it.
    const realSend = DynamoDBClient.prototype.send;
    let failures = 2;
    DynamoDBClient.prototype.send = jest.fn(async (command) => {
      const key = unmarshall(command.input.Key);
      const setsPublished =
        key.sk === 'newsletter' &&
        unmarshall(command.input.ExpressionAttributeValues ?? {})[':status'] === 'published';
      if (setsPublished && failures > 0) {
        failures -= 1;
        const error = new Error('InternalServerError');
        error.name = 'InternalServerError';
        throw error;
      }
      return realSend(command);
    });

    for (const label of ['America/Chicago', 'America/Los_Angeles', '__default__', '__catch_all__']) {
      await markGroupSent(ISSUE_ID, label, { recipients: 1 });
    }

    expect(items.get(issueKey()).status).toBe('published');
    expect(items.get(progressKey()).completedAt).toBeDefined();
  });

  test('a status write that never succeeds leaves completion unstamped, so a redelivery can retry', async () => {
    // Ordering matters as much as the retry: if completedAt were stamped first,
    // the attribute_not_exists condition would make every later attempt bail out
    // before reaching the status write.
    const realSend = DynamoDBClient.prototype.send;
    let failing = true;
    DynamoDBClient.prototype.send = jest.fn(async (command) => {
      const key = unmarshall(command.input.Key);
      const setsPublished =
        key.sk === 'newsletter' &&
        unmarshall(command.input.ExpressionAttributeValues ?? {})[':status'] === 'published';
      if (setsPublished && failing) {
        const error = new Error('InternalServerError');
        error.name = 'InternalServerError';
        throw error;
      }
      return realSend(command);
    });

    for (const label of ['America/Chicago', 'America/Los_Angeles', '__default__', '__catch_all__']) {
      await markGroupSent(ISSUE_ID, label, { recipients: 1 });
    }

    expect(items.get(issueKey()).status).toBe('sending');
    expect(items.get(progressKey()).completedAt).toBeUndefined();

    // A redelivered final group now heals both.
    failing = false;
    await markGroupSent(ISSUE_ID, '__catch_all__', { recipients: 0 });

    expect(items.get(issueKey()).status).toBe('published');
    expect(items.get(progressKey()).completedAt).toBeDefined();
  });

  test('a refused condition is never retried', async () => {
    // ConditionalCheckFailedException is the write being answered, not failing;
    // retrying it would just burn the backoff window before the same answer.
    await markGroupSent(ISSUE_ID, 'America/Chicago', { recipients: 1 });

    const attempts = DynamoDBClient.prototype.send.mock.calls.filter(([command]) => {
      const key = unmarshall(command.input.Key);
      return key.sk === SEND_PROGRESS_SK && command.input.UpdateExpression.includes('#groups.#label');
    });

    // One attempt against a group that exists, and no repeats.
    expect(attempts).toHaveLength(1);
  });
  test('a refusal against an unexpected status is not treated as settled', async () => {
    // `failed` is reclaimable - the fan-out knows better than the state machine
    // whether mail went out. A status outside the transition's from-set is not,
    // and treating a refusal as success would stamp completion over a record
    // that never reached `published`, hiding the mismatch permanently.
    await markGroupSent(ISSUE_ID, 'America/Chicago', { recipients: 38 });
    await markGroupSent(ISSUE_ID, 'America/Los_Angeles', { recipients: 12 });
    await markGroupSent(ISSUE_ID, '__default__', { recipients: 100 });

    items.get(issueKey()).status = 'draft';

    await markGroupSent(ISSUE_ID, '__catch_all__', { recipients: 0 });

    expect(items.get(issueKey()).status).toBe('draft');
    // Completion must stay unstamped so the mismatch is still repairable.
    expect(items.get(progressKey()).completedAt).toBeUndefined();
  });

  test('a refusal because the status is already the target counts as settled', async () => {
    await markGroupSent(ISSUE_ID, 'America/Chicago', { recipients: 38 });
    await markGroupSent(ISSUE_ID, 'America/Los_Angeles', { recipients: 12 });
    await markGroupSent(ISSUE_ID, '__default__', { recipients: 100 });

    // The state machine got there first - a legitimate outcome, not a conflict.
    items.get(issueKey()).status = 'published';

    await markGroupSent(ISSUE_ID, '__catch_all__', { recipients: 0 });

    expect(items.get(issueKey()).status).toBe('published');
    expect(items.get(progressKey()).completedAt).toBeDefined();
  });

  test('a duplicate fan-out event cannot reopen a completed plan', async () => {
    // EventBridge delivers at least once. Without the guard, a redelivered
    // original event resets every group to pending, clears completedAt, and
    // takes a fully delivered issue back to `sending` for hours.
    for (const label of ['America/Chicago', 'America/Los_Angeles', '__default__', '__catch_all__']) {
      await markGroupSent(ISSUE_ID, label, { recipients: 1 });
    }
    expect(items.get(issueKey()).status).toBe('published');
    const completedAt = items.get(progressKey()).completedAt;

    await startProgress(ISSUE_ID, buildFixture());

    expect(items.get(progressKey()).completedAt).toBe(completedAt);
    expect(items.get(issueKey()).status).toBe('published');
    expect(items.get(progressKey()).groups['America/Chicago'].status).toBe('sent');
  });

  test('a fresh plan still applies once the previous one is cleared', async () => {
    // What a deliberate resend does: the API deletes the progress record, so
    // the guard has nothing to refuse.
    for (const label of ['America/Chicago', 'America/Los_Angeles', '__default__', '__catch_all__']) {
      await markGroupSent(ISSUE_ID, label, { recipients: 1 });
    }

    items.delete(progressKey());
    await startProgress(ISSUE_ID, buildFixture());

    expect(items.get(progressKey()).completedAt).toBeUndefined();
    expect(items.get(progressKey()).groups['America/Chicago'].status).toBe('pending');
    expect(items.get(issueKey()).status).toBe('sending');
  });

  test('the fan-out reclaims an issue the state machine marked failed', async () => {
    // A post-publish task can fail in the gap before the `sending` claim lands.
    // The emails are going out regardless, so the fan-out's view wins - and
    // without reclaiming it, the terminal transition could never apply and a
    // failed record is sendable, so re-staging would send twice.
    items.set(issueKey(), { pk: ISSUE_ID, sk: 'newsletter', status: 'failed' });

    await startProgress(ISSUE_ID, buildFixture());
    expect(items.get(issueKey()).status).toBe('sending');

    for (const label of ['America/Chicago', 'America/Los_Angeles', '__default__', '__catch_all__']) {
      await markGroupSent(ISSUE_ID, label, { recipients: 1 });
    }
    expect(items.get(issueKey()).status).toBe('published');
  });

  test('a failed issue whose delivery completed is still published', async () => {
    // The failure lands after the claim, so the terminal transition has to
    // accept `failed` as well as `sending`.
    await markGroupSent(ISSUE_ID, 'America/Chicago', { recipients: 38 });
    await markGroupSent(ISSUE_ID, 'America/Los_Angeles', { recipients: 12 });
    await markGroupSent(ISSUE_ID, '__default__', { recipients: 100 });

    items.get(issueKey()).status = 'failed';
    await markGroupSent(ISSUE_ID, '__catch_all__', { recipients: 0 });

    expect(items.get(issueKey()).status).toBe('published');
    expect(items.get(progressKey()).completedAt).toBeDefined();
  });
});
