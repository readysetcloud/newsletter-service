import { jest } from '@jest/globals';
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
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

    const putCalls = mockSend.mock.calls.filter(([command]) => command instanceof PutItemCommand);
    const clickEventCall = putCalls.find(([command]) => {
      const item = unmarshall(command.input.Item);
      return item.eventType === 'click';
    });

    expect(clickEventCall).toBeDefined();
    const clickEvent = unmarshall(clickEventCall[0].input.Item);
    expect(clickEvent.linkPosition).toBe(2);

    const updateCalls = mockSend.mock.calls.filter(([command]) => command instanceof UpdateItemCommand);
    expect(updateCalls.length).toBeGreaterThan(0);
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
