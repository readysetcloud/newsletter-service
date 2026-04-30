import { jest } from '@jest/globals';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { handler } from '../update-link-tracking.mjs';

describe('update-link-tracking handler', () => {
  let mockSend;
  let originalEnv;

  beforeEach(() => {
    originalEnv = {
      TABLE_NAME: process.env.TABLE_NAME,
      REDIRECT_URL: process.env.REDIRECT_URL
    };
    process.env.TABLE_NAME = 'test-table';
    process.env.REDIRECT_URL = 'https://redirect.example.com';
    mockSend = jest.fn();
    DynamoDBClient.prototype.send = mockSend;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv.TABLE_NAME;
    process.env.REDIRECT_URL = originalEnv.REDIRECT_URL;
  });

  test('rewrites links with issue cid and position parameters', async () => {
    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand || command instanceof PutItemCommand) {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const result = await handler({
      tenantId: 'tenant123',
      issueId: '42',
      content: 'One [first](https://example.com/first) and [second](https://example.com/second?x=1)'
    });

    expect(result.content).toContain('cid=tenant123%2342');
    expect(result.content).toContain('p=1');
    expect(result.content).toContain('p=2');
    expect(result.content).toContain('s=__EMAIL_HASH__');
  });
});
