import { jest } from '@jest/globals';
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import crypto from 'crypto';
import { handler } from '../handle-email-status.mjs';

describe('handle-email-status click position capture', () => {
  let mockSend;
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.TABLE_NAME;
    process.env.TABLE_NAME = 'test-table';
    mockSend = jest.fn();
    DynamoDBClient.prototype.send = mockSend;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv;
  });

  test('stores link position on click events when a matching link record exists', async () => {
    const issueId = 'tenant123#42';
    const linkUrl = 'https://example.com/article';
    const linkHash = crypto.createHash('sha256').update(linkUrl).digest('hex').slice(0, 16);

    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        const key = unmarshall(command.input.Key);
        if (key.sk === 'stats') {
          return Promise.resolve({
            Item: {
              pk: { S: issueId },
              sk: { S: 'stats' },
              publishedAt: { S: '2025-01-29T10:00:00.000Z' }
            }
          });
        }

        if (key.sk === `link#${linkHash}`) {
          return Promise.resolve({
            Item: {
              pk: { S: issueId },
              sk: { S: `link#${linkHash}` },
              position: { N: '2' }
            }
          });
        }
      }

      return Promise.resolve({});
    });

    await handler({
      detail: {
        eventType: 'Click',
        click: {
          link: linkUrl,
          timestamp: '2025-01-29T10:05:00.000Z'
        },
        mail: {
          destination: ['reader@example.com'],
          tags: {
            referenceNumber: ['tenant123_42']
          }
        }
      }
    });

    // The click's analytics record and its stat now commit together inside one
    // TransactWriteItems rather than as independent writes.
    const commit = mockSend.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof TransactWriteItemsCommand);
    expect(commit).toBeDefined();

    const clickEventPut = commit.input.TransactItems
      .map((item) => item.Put)
      .filter(Boolean)
      .find((put) => unmarshall(put.Item).eventType === 'click');

    expect(clickEventPut).toBeDefined();
    expect(unmarshall(clickEventPut.Item).linkPosition).toBe(2);

    const statsUpdates = commit.input.TransactItems.map((item) => item.Update).filter(Boolean);
    expect(statsUpdates.length).toBeGreaterThan(0);
  });
});

// An issue whose 'Extract Links' step never ran has no `link#` records, and the
// nested `byDay` increment cannot address a record that isn't there. That used to
// throw straight out of the click branch into the handler's outer catch, which
// dropped the `clicks` counter and the click event with it — the issue reported
// zero clicks while SES delivered thousands.
describe('handle-email-status click tracking without link records', () => {
  let mockSend;
  let originalTable;

  const clickEvent = {
    detail: {
      eventType: 'Click',
      click: { link: 'https://example.com/article', timestamp: '2025-01-29T10:05:00.000Z' },
      mail: {
        destination: ['reader@example.com'],
        tags: { referenceNumber: ['tenant123_42'] }
      }
    }
  };

  const conditionalCheckFailed = () => {
    const err = new Error('The conditional request failed');
    err.name = 'ConditionalCheckFailedException';
    return err;
  };

  const transactItems = () => {
    const commit = mockSend.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof TransactWriteItemsCommand);
    return commit ? commit.input.TransactItems : [];
  };

  const statsUpdate = () =>
    transactItems()
      .map((item) => item.Update)
      .filter(Boolean)
      .find((update) => unmarshall(update.Key).sk === 'stats');

  const clickEventPut = () =>
    transactItems()
      .map((item) => item.Put)
      .filter(Boolean)
      .find((put) => unmarshall(put.Item).eventType === 'click');

  beforeEach(() => {
    originalTable = process.env.TABLE_NAME;
    process.env.TABLE_NAME = 'test-table';
    mockSend = jest.fn();
    DynamoDBClient.prototype.send = mockSend;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalTable;
  });

  test('counts the click when the link record is missing', async () => {
    mockSend.mockImplementation((command) => {
      // No link record exists, so the guarded counter update fails its condition.
      if (command instanceof UpdateItemCommand && unmarshall(command.input.Key).sk.startsWith('link#')) {
        return Promise.reject(conditionalCheckFailed());
      }
      return Promise.resolve({});
    });

    await expect(handler(clickEvent)).resolves.toBe(true);

    expect(statsUpdate()?.ExpressionAttributeNames['#stat']).toBe('clicks');
    expect(clickEventPut()).toBeDefined();
  });

  // Belt to the condition's braces: whatever else the per-link counter can fail
  // on, the click is still counted and still recorded.
  test('counts the click when the counter update fails outright', async () => {
    mockSend.mockImplementation((command) => {
      if (command instanceof UpdateItemCommand && unmarshall(command.input.Key).sk.startsWith('link#')) {
        return Promise.reject(new Error('ValidationException'));
      }
      return Promise.resolve({});
    });

    await expect(handler(clickEvent)).resolves.toBe(true);

    expect(statsUpdate()?.ExpressionAttributeNames['#stat']).toBe('clicks');
    expect(clickEventPut()).toBeDefined();
  });

  test('guards the counter update so it cannot create a record link extraction owns', async () => {
    mockSend.mockResolvedValue({});

    await handler(clickEvent);

    const counterUpdate = mockSend.mock.calls
      .map(([command]) => command)
      .find(
        (command) =>
          command instanceof UpdateItemCommand &&
          unmarshall(command.input.Key).sk.startsWith('link#')
      );

    expect(counterUpdate.input.ConditionExpression).toBe(
      'attribute_exists(pk) AND attribute_exists(sk)'
    );
  });

  // A failed click-event write must not take the counter with it either.
  test('counts the click when the event capture fails', async () => {
    mockSend.mockImplementation((command) => {
      if (command instanceof PutItemCommand && unmarshall(command.input.Item).eventType === 'click') {
        return Promise.reject(new Error('throughput exceeded'));
      }
      return Promise.resolve({});
    });

    await expect(handler(clickEvent)).resolves.toBe(true);

    expect(statsUpdate()?.ExpressionAttributeNames['#stat']).toBe('clicks');
  });
});

describe('handle-email-status interest scoring on email click', () => {
  let mockSend;
  let originalTable;
  let originalSubscribersTable;

  beforeEach(() => {
    originalTable = process.env.TABLE_NAME;
    originalSubscribersTable = process.env.SUBSCRIBERS_TABLE_NAME;
    process.env.TABLE_NAME = 'test-table';
    process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';
    mockSend = jest.fn();
    DynamoDBClient.prototype.send = mockSend;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalTable;
    process.env.SUBSCRIBERS_TABLE_NAME = originalSubscribersTable;
  });

  test('scores the identified subscriber against the clicked link topic', async () => {
    const issueId = 'tenant123#42';
    const linkUrl = 'https://example.com/ai-article';
    const linkHash = crypto.createHash('sha256').update(linkUrl).digest('hex').slice(0, 16);

    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        const key = unmarshall(command.input.Key);
        if (key.sk === 'stats') {
          return Promise.resolve({
            Item: { pk: { S: issueId }, sk: { S: 'stats' }, publishedAt: { S: '2025-01-29T10:00:00.000Z' } }
          });
        }
        if (key.sk === `link#${linkHash}`) {
          // The link record carries the LLM topic classification used for scoring.
          return Promise.resolve({
            Item: {
              pk: { S: issueId },
              sk: { S: `link#${linkHash}` },
              position: { N: '1' },
              primaryTopic: { S: 'ai' },
              secondaryTopics: { L: [] }
            }
          });
        }
      }

      if (command instanceof UpdateItemCommand) {
        // Return an interestScores payload for the nested-score UpdateItem so
        // processInterestScoring can compute pre/post scores.
        if (command.input.TableName === 'test-subscribers-table') {
          return Promise.resolve({
            Attributes: {
              interestScores: { M: { ai: { M: { score: { N: '1' }, lastScoredAt: { S: '2025-01-29T10:05:00.000Z' } } } } }
            }
          });
        }
      }

      return Promise.resolve({});
    });

    await handler({
      detail: {
        eventType: 'Click',
        click: { link: linkUrl, timestamp: '2025-01-29T10:05:00.000Z' },
        mail: {
          destination: ['reader@example.com'],
          tags: { referenceNumber: ['tenant123_42'] }
        }
      }
    });

    // Interest scoring must have issued a nested-score update against the
    // subscribers table for the identified reader.
    const scoringUpdate = mockSend.mock.calls
      .map(([command]) => command)
      .find(
        (command) =>
          command instanceof UpdateItemCommand &&
          command.input.TableName === 'test-subscribers-table' &&
          typeof command.input.UpdateExpression === 'string' &&
          command.input.UpdateExpression.includes('interestScores.#topic.score')
      );

    expect(scoringUpdate).toBeDefined();
    const key = unmarshall(scoringUpdate.input.Key);
    expect(key.email).toBe('reader@example.com');
    expect(scoringUpdate.input.ExpressionAttributeNames['#topic']).toBe('ai');
  });
});

// A local-send issue delivers its timezone groups hours apart, so the issue-wide
// publishedAt is the wrong zero for everyone outside the first group: a reader in
// a late group who opens immediately was being recorded as a many-hour-late open,
// which flattened the decay curve into a smear.
describe('handle-email-status per-recipient send anchor', () => {
  let mockSend;
  let originalEnv;

  const PUBLISHED_AT = '2026-09-21T14:00:00.000Z';
  // This recipient's copy went out 16 hours after the issue was handed off.
  const RECIPIENT_SENT_AT = '2026-09-22T06:00:00.000Z';

  beforeEach(() => {
    originalEnv = process.env.TABLE_NAME;
    process.env.TABLE_NAME = 'test-table';
    mockSend = jest.fn();
    DynamoDBClient.prototype.send = mockSend;
    jest.clearAllMocks();

    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        const key = unmarshall(command.input.Key);
        if (key.sk === 'stats') {
          return Promise.resolve({
            Item: {
              pk: { S: 'tenant123#42' },
              sk: { S: 'stats' },
              publishedAt: { S: PUBLISHED_AT }
            }
          });
        }
      }
      return Promise.resolve({});
    });
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv;
  });

  const committedRecord = (eventType) => {
    const commit = mockSend.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof TransactWriteItemsCommand);
    expect(commit).toBeDefined();

    const put = commit.input.TransactItems
      .map((item) => item.Put)
      .filter(Boolean)
      .map((item) => unmarshall(item.Item))
      .find((item) => item.eventType === eventType);

    expect(put).toBeDefined();
    return put;
  };

  const sendOpen = (commonHeaders) => handler({
    detail: {
      eventType: 'Open',
      open: { timestamp: '2026-09-22T06:30:00.000Z' },
      mail: {
        destination: ['reader@example.com'],
        tags: { referenceNumber: ['tenant123_42'] },
        ...commonHeaders && { commonHeaders }
      }
    }
  });

  test('times an open from this recipient\'s own send, not the issue publish', async () => {
    await sendOpen({ date: RECIPIENT_SENT_AT });

    // 30 minutes after their copy went out - a prompt reader. Anchored to
    // publishedAt this same open reads as 16.5 hours late.
    expect(committedRecord('open').timeToOpen).toBe(1800);
  });

  test('falls back to the issue publish when the header is absent', async () => {
    await sendOpen(undefined);

    expect(committedRecord('open').timeToOpen).toBe(59400);
  });

  test('ignores an unparseable header date rather than recording NaN', async () => {
    await sendOpen({ date: 'not a date' });

    expect(committedRecord('open').timeToOpen).toBe(59400);
  });

  test('labels the record as recipient-anchored so aggregation can trust it', async () => {
    await sendOpen({ date: RECIPIENT_SENT_AT });

    // The redirect click pipeline writes into the same click# space and can
    // only ever be publish-anchored, so the stored number alone is ambiguous.
    expect(committedRecord('open').timingAnchor).toBe('recipient');
  });

  test('labels a header-less record as publish-anchored, not recipient', async () => {
    await sendOpen(undefined);

    expect(committedRecord('open').timingAnchor).toBe('publish');
  });

  test('times a click from this recipient\'s own send too', async () => {
    await handler({
      detail: {
        eventType: 'Click',
        click: {
          link: 'https://example.com/article',
          timestamp: '2026-09-22T07:00:00.000Z'
        },
        mail: {
          destination: ['reader@example.com'],
          tags: { referenceNumber: ['tenant123_42'] },
          commonHeaders: { date: RECIPIENT_SENT_AT }
        }
      }
    });

    expect(committedRecord('click').timeToClick).toBe(3600);
  });
});
