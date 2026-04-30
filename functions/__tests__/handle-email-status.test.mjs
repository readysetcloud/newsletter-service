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
