import { jest } from '@jest/globals';
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  TransactWriteItemsCommand
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// Env must be set before importing the handler (helpers.mjs reads the key).
process.env.TABLE_NAME = 'test-newsletter-table';
process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';
process.env.EMAIL_ENCRYPTION_KEY = 'test-encryption-key-for-testing-only';

let handler;
let encrypt;
let store; // Map<`${tenantId}|${email}`, unmarshalled item>
let mockSend;

const TENANT = 'acme';
const EMAIL = 'jane.doe@example.com';

const keyOf = (tenantId, email) => `${tenantId}|${email}`;

class ValidationException extends Error {
  constructor(message) { super(message); this.name = 'ValidationException'; }
}
class ConditionalCheckFailedException extends Error {
  constructor(message) { super(message); this.name = 'ConditionalCheckFailedException'; }
}
class TransactionCanceledException extends Error {
  constructor(message) { super(message); this.name = 'TransactionCanceledException'; }
}

/* ----------------------- stateful DynamoDB emulator ----------------------- */

function handleGetItem(input) {
  const key = unmarshall(input.Key);
  const item = store.get(keyOf(key.tenantId, key.email));
  return item ? { Item: marshall(item) } : { Item: undefined };
}

function handleUpdateItem(input) {
  const key = unmarshall(input.Key);
  const id = keyOf(key.tenantId, key.email);
  const item = store.get(id) || { tenantId: key.tenantId, email: key.email };
  const expr = input.UpdateExpression;
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues ? unmarshall(input.ExpressionAttributeValues) : {};
  const topic = names['#topic'];

  if (expr.startsWith('SET interestScores.#topic.score = :score')) {
    if (item.interestScores === undefined || item.interestScores[topic] === undefined) {
      throw new ValidationException('invalid document path');
    }
    item.interestScores[topic].score = values[':score'];
    item.interestScores[topic].lastScoredAt = values[':now'];
    if (item.excludedTopics instanceof Set && values[':topicSet']) {
      for (const t of values[':topicSet']) item.excludedTopics.delete(t);
      if (item.excludedTopics.size === 0) delete item.excludedTopics;
    }
    store.set(id, item);
    return {};
  }

  if (expr === 'SET interestScores = if_not_exists(interestScores, :emptyMap)') {
    if (item.interestScores === undefined) item.interestScores = {};
    store.set(id, item);
    return {};
  }

  if (expr === 'SET interestScores.#topic = if_not_exists(interestScores.#topic, :zeroEntry)') {
    if (item.interestScores === undefined) throw new ValidationException('invalid document path');
    if (item.interestScores[topic] === undefined) item.interestScores[topic] = { ...values[':zeroEntry'] };
    store.set(id, item);
    return {};
  }

  if (expr === 'REMOVE interestScores.#topic ADD excludedTopics :topicSet') {
    if (item.interestScores) delete item.interestScores[topic];
    const set = item.excludedTopics instanceof Set ? item.excludedTopics : new Set();
    for (const t of values[':topicSet']) set.add(t);
    item.excludedTopics = set;
    store.set(id, item);
    return {};
  }

  if (expr === 'SET memberCount = if_not_exists(memberCount, :zero) - :one') {
    if (item.memberCount === undefined || item.memberCount < values[':one']) {
      throw new ConditionalCheckFailedException('memberCount floor');
    }
    item.memberCount -= values[':one'];
    store.set(id, item);
    return {};
  }

  if (expr === 'SET memberCount = :zero') {
    item.memberCount = 0;
    store.set(id, item);
    return {};
  }

  if (expr === 'ADD memberCount :one') {
    item.memberCount = (item.memberCount || 0) + values[':one'];
    store.set(id, item);
    return {};
  }

  if (expr === 'SET preferencesUpdatedAt = :now') {
    item.preferencesUpdatedAt = values[':now'];
    store.set(id, item);
    return {};
  }

  throw new Error(`Unexpected UpdateExpression in mock: ${expr}`);
}

function handlePutItem(input) {
  const item = unmarshall(input.Item);
  const id = keyOf(item.tenantId, item.email);
  if (input.ConditionExpression === 'attribute_not_exists(email)' && store.has(id)) {
    throw new ConditionalCheckFailedException('already exists');
  }
  store.set(id, item);
  return {};
}

function handleDeleteItem(input) {
  const key = unmarshall(input.Key);
  const id = keyOf(key.tenantId, key.email);
  if (input.ConditionExpression === 'attribute_exists(email)' && !store.has(id)) {
    throw new ConditionalCheckFailedException('does not exist');
  }
  store.delete(id);
  return {};
}

function handleTransactWrite(input) {
  // Segment creation: [Put uniqueness (conditional), Put segment record].
  for (const t of input.TransactItems) {
    const put = t.Put;
    const item = unmarshall(put.Item);
    const id = keyOf(item.tenantId, item.email);
    if (put.ConditionExpression === 'attribute_not_exists(email)' && store.has(id)) {
      throw new TransactionCanceledException('uniqueness collision');
    }
  }
  for (const t of input.TransactItems) {
    const item = unmarshall(t.Put.Item);
    store.set(keyOf(item.tenantId, item.email), item);
  }
  return {};
}

beforeEach(async () => {
  store = new Map();

  mockSend = jest.fn(async (command) => {
    if (command instanceof GetItemCommand) return handleGetItem(command.input);
    if (command instanceof UpdateItemCommand) return handleUpdateItem(command.input);
    if (command instanceof PutItemCommand) return handlePutItem(command.input);
    if (command instanceof DeleteItemCommand) return handleDeleteItem(command.input);
    if (command instanceof TransactWriteItemsCommand) return handleTransactWrite(command.input);
    throw new Error(`Unexpected command in mock: ${command?.constructor?.name}`);
  });
  DynamoDBClient.prototype.send = mockSend;
  jest.clearAllMocks();

  const helpers = await import('../utils/helpers.mjs');
  encrypt = helpers.encrypt;
  const mod = await import('../subscribers/preferences.mjs');
  handler = mod.handler;
});

/* --------------------------------- helpers -------------------------------- */

const seedSubscriber = (tenantId, email, attrs = {}) => {
  store.set(keyOf(tenantId, email), { tenantId, email, ...attrs });
};

const getStored = (tenantId, email) => store.get(keyOf(tenantId, email));

const getEvent = (token, tenantId = TENANT) => ({
  httpMethod: 'GET',
  pathParameters: { tenant: tenantId },
  queryStringParameters: token === undefined ? {} : { email: token }
});

const postEvent = (fields, tenantId = TENANT) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((val) => params.append(k, val));
    else params.append(k, v);
  }
  return {
    httpMethod: 'POST',
    pathParameters: { tenant: tenantId },
    body: params.toString(),
    isBase64Encoded: false
  };
};

const updateCalls = () => mockSend.mock.calls
  .map((c) => c[0])
  .filter((c) => c instanceof UpdateItemCommand || c instanceof PutItemCommand || c instanceof DeleteItemCommand || c instanceof TransactWriteItemsCommand);

/* ---------------------------------- GET ----------------------------------- */

describe('GET /{tenant}/preferences', () => {
  test('renders inferred topics sorted by score with masked email and taxonomy', async () => {
    seedSubscriber(TENANT, EMAIL, {
      interestScores: {
        ai: { score: 5, lastScoredAt: '2026-01-01T00:00:00.000Z' },
        serverless: { score: 2, lastScoredAt: '2026-01-01T00:00:00.000Z' }
      }
    });
    const token = encrypt(EMAIL);

    const res = await handler(getEvent(token));

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html');
    const html = res.body;

    // Inferred topics rendered (display names).
    expect(html).toContain('AI');
    expect(html).toContain('Serverless');
    // Sorted desc: AI (score 5) appears before Serverless (score 2).
    expect(html.indexOf('AI')).toBeLessThan(html.indexOf('Serverless'));

    // Full taxonomy present so subscribers can add interests.
    expect(html).toContain('Event-Driven Architecture');
    expect(html).toContain('Observability');

    // Email is masked, never shown in full.
    expect(html).toContain('j***@example.com');
    expect(html).not.toContain(EMAIL);

    // Encrypted token round-trips in the hidden field; plaintext email absent.
    expect(html).toContain(`value="${token.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`);

    // Prefer checkbox is checked for an inferred topic.
    expect(html).toMatch(/name="prefer" value="ai" checked/);
  });

  test('renders gracefully for an unknown subscriber (no inferred topics, full taxonomy)', async () => {
    const token = encrypt('ghost@example.com');

    const res = await handler(getEvent(token));

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('AI');
    expect(res.body).toContain("haven't inferred any interests");
    // No writes on a GET.
    expect(updateCalls()).toHaveLength(0);
  });

  test('shows a uniform error page for a bad token without revealing the email', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handler(getEvent('not-a-valid-token'));
    consoleSpy.mockRestore();

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Something Went Wrong');
    expect(res.body).not.toContain(EMAIL);
  });

  test('shows the error page when the email param is missing', async () => {
    const res = await handler(getEvent(undefined));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Something Went Wrong');
  });

  test('escapes hostile interpolated values (tenant + email domain)', async () => {
    const hostileTenant = '<script>alert(1)</script>';
    const hostileEmail = 'user@<evil>.com';
    seedSubscriber(hostileTenant, hostileEmail, {
      interestScores: { ai: { score: 4, lastScoredAt: '2026-01-01T00:00:00.000Z' } }
    });
    const token = encrypt(hostileEmail);

    const res = await handler(getEvent(token, hostileTenant));

    expect(res.statusCode).toBe(200);
    // Nothing hostile survives unescaped.
    expect(res.body).not.toContain('<script>alert(1)</script>');
    expect(res.body).not.toContain('@<evil>.com');
    expect(res.body).toContain('&lt;script&gt;');
    expect(res.body).toContain('&lt;evil&gt;.com');
  });
});

/* ---------------------------------- POST ---------------------------------- */

describe('POST /{tenant}/preferences — prefer', () => {
  test('floors score to the threshold and joins the auto segment', async () => {
    seedSubscriber(TENANT, EMAIL, {
      interestScores: { ai: { score: 1, lastScoredAt: '2026-01-01T00:00:00.000Z' } }
    });

    const res = await handler(postEvent({ email: encrypt(EMAIL), prefer: 'ai' }));

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Preferences Saved');
    expect(res.body).toContain('Interested in');
    expect(res.body).toContain('AI');

    const sub = getStored(TENANT, EMAIL);
    // Score floored up to the auto-segment threshold (3).
    expect(sub.interestScores.ai.score).toBe(3);
    expect(sub.preferencesUpdatedAt).toEqual(expect.any(String));

    // Segment created, member row added, memberCount incremented.
    const uniqueness = getStored(TENANT, 'SEGMENT_NAME#auto: ai');
    expect(uniqueness).toBeDefined();
    const segmentId = uniqueness.segmentId;
    const segment = getStored(TENANT, `SEGMENT#${segmentId}`);
    expect(segment.memberCount).toBe(1);
    expect(segment.autoManaged).toBe(true);
    expect(getStored(TENANT, `SEGMENT#${segmentId}#MEMBER#${EMAIL}`)).toBeDefined();
  });

  test('never lowers an already-higher score', async () => {
    seedSubscriber(TENANT, EMAIL, {
      interestScores: { ai: { score: 7, lastScoredAt: '2026-01-01T00:00:00.000Z' } }
    });

    await handler(postEvent({ email: encrypt(EMAIL), prefer: 'ai' }));

    expect(getStored(TENANT, EMAIL).interestScores.ai.score).toBe(7);
  });

  test('initializes the nested map when the topic is brand new', async () => {
    seedSubscriber(TENANT, EMAIL, {}); // no interestScores at all

    await handler(postEvent({ email: encrypt(EMAIL), prefer: 'devops' }));

    expect(getStored(TENANT, EMAIL).interestScores.devops.score).toBe(3);
  });

  test('clears a prior exclusion when the same topic is now preferred', async () => {
    seedSubscriber(TENANT, EMAIL, {
      interestScores: { serverless: { score: 1, lastScoredAt: '2026-01-01T00:00:00.000Z' } },
      excludedTopics: new Set(['ai'])
    });
    // Pre-create the interestScores.ai entry so the SET path is valid.
    getStored(TENANT, EMAIL).interestScores.ai = { score: 0, lastScoredAt: '2026-01-01T00:00:00.000Z' };

    await handler(postEvent({ email: encrypt(EMAIL), prefer: 'ai' }));

    const sub = getStored(TENANT, EMAIL);
    expect(sub.interestScores.ai.score).toBe(3);
    // 'ai' removed from the exclusion set (only member -> set cleared entirely).
    expect(sub.excludedTopics).toBeUndefined();
  });
});

describe('POST /{tenant}/preferences — exclude', () => {
  const SEGMENT_ID = 'SEG_AI_1';

  beforeEach(() => {
    seedSubscriber(TENANT, EMAIL, {
      interestScores: { ai: { score: 5, lastScoredAt: '2026-01-01T00:00:00.000Z' } }
    });
    // Existing auto segment for AI with this subscriber as a member.
    store.set(keyOf(TENANT, 'SEGMENT_NAME#auto: ai'), { tenantId: TENANT, email: 'SEGMENT_NAME#auto: ai', segmentId: SEGMENT_ID });
    store.set(keyOf(TENANT, `SEGMENT#${SEGMENT_ID}`), { tenantId: TENANT, email: `SEGMENT#${SEGMENT_ID}`, segmentId: SEGMENT_ID, autoManaged: true, memberCount: 1 });
    store.set(keyOf(TENANT, `SEGMENT#${SEGMENT_ID}#MEMBER#${EMAIL}`), { tenantId: TENANT, email: `SEGMENT#${SEGMENT_ID}#MEMBER#${EMAIL}`, segmentId: SEGMENT_ID });
  });

  test('removes the score, records the exclusion, and leaves the segment', async () => {
    const res = await handler(postEvent({ email: encrypt(EMAIL), exclude: 'ai' }));

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Not interested in');
    expect(res.body).toContain('AI');

    const sub = getStored(TENANT, EMAIL);
    expect(sub.interestScores.ai).toBeUndefined();
    expect([...sub.excludedTopics]).toContain('ai');
    expect(sub.preferencesUpdatedAt).toEqual(expect.any(String));

    // Member row deleted, memberCount decremented (floored, not negative).
    expect(getStored(TENANT, `SEGMENT#${SEGMENT_ID}#MEMBER#${EMAIL}`)).toBeUndefined();
    expect(getStored(TENANT, `SEGMENT#${SEGMENT_ID}`).memberCount).toBe(0);
  });

  test('does not decrement below zero when memberCount is already 0', async () => {
    store.get(keyOf(TENANT, `SEGMENT#${SEGMENT_ID}`)).memberCount = 0;

    await handler(postEvent({ email: encrypt(EMAIL), exclude: 'ai' }));

    expect(getStored(TENANT, `SEGMENT#${SEGMENT_ID}`).memberCount).toBe(0);
  });

  test('exclusion wins when a topic is submitted as both preferred and excluded', async () => {
    await handler(postEvent({ email: encrypt(EMAIL), prefer: 'ai', exclude: 'ai' }));

    const sub = getStored(TENANT, EMAIL);
    expect(sub.interestScores.ai).toBeUndefined();
    expect([...sub.excludedTopics]).toContain('ai');
  });
});

describe('POST /{tenant}/preferences — validation & edge cases', () => {
  test('silently ignores unknown topics', async () => {
    seedSubscriber(TENANT, EMAIL, {
      interestScores: { ai: { score: 1, lastScoredAt: '2026-01-01T00:00:00.000Z' } }
    });

    const res = await handler(postEvent({
      email: encrypt(EMAIL),
      prefer: ['ai', 'not-a-real-topic'],
      exclude: ['also-bogus']
    }));

    expect(res.statusCode).toBe(200);
    const sub = getStored(TENANT, EMAIL);
    expect(sub.interestScores.ai.score).toBe(3);
    // The bogus topics were never written anywhere.
    expect(sub.excludedTopics).toBeUndefined();
    expect(sub.interestScores['not-a-real-topic']).toBeUndefined();
  });

  test('handles an unknown subscriber without writing or crashing', async () => {
    const res = await handler(postEvent({ email: encrypt('ghost@example.com'), prefer: 'ai' }));

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Preferences Saved');
    // Only the subscriber lookup happened — no mutations.
    expect(updateCalls()).toHaveLength(0);
  });

  test('shows the error page for a bad token on POST', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handler(postEvent({ email: 'garbage-token', prefer: 'ai' }));
    consoleSpy.mockRestore();

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Something Went Wrong');
    expect(updateCalls()).toHaveLength(0);
  });

  test('decodes a base64-encoded form body', async () => {
    seedSubscriber(TENANT, EMAIL, {
      interestScores: { ai: { score: 1, lastScoredAt: '2026-01-01T00:00:00.000Z' } }
    });
    const raw = new URLSearchParams({ email: encrypt(EMAIL), prefer: 'ai' }).toString();
    const event = {
      httpMethod: 'POST',
      pathParameters: { tenant: TENANT },
      body: Buffer.from(raw, 'utf8').toString('base64'),
      isBase64Encoded: true
    };

    const res = await handler(event);

    expect(res.statusCode).toBe(200);
    expect(getStored(TENANT, EMAIL).interestScores.ai.score).toBe(3);
  });
});
