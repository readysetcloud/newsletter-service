// __tests__/vote.test.mjs
import { jest } from '@jest/globals';

// ---- Shared client send ----
const mockSend = jest.fn();

// ---- AWS SDK mocks ----
const mockGetItemCommand = jest.fn((params) => ({ __type: 'GetItem', ...params }));
const mockPutItemCommand = jest.fn((params) => ({ __type: 'PutItem', ...params }));
const mockUpdateItemCommand = jest.fn((params) => ({ __type: 'UpdateItem', ...params }));

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  GetItemCommand: mockGetItemCommand,
  PutItemCommand: mockPutItemCommand,
  UpdateItemCommand: mockUpdateItemCommand,
}));

// Keep marshall/unmarshall simple so we can assert plain JS objects
jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: (x) => x,
  unmarshall: (x) => x,
}));

// Import after mocks
const { handler } = await import('../functions/vote.mjs');

describe('vote handler', () => {
  const baseEvent = {
    pathParameters: { tenant: 'test-tenant', issueId: 'test-issue' },
    requestContext: { identity: { sourceIp: '192.168.1.1' } },
    httpMethod: 'POST',
    body: JSON.stringify({ choice: 'option1' }),
  };

  const mockVoteData = {
    options: [
      { id: 'option1', description: 'Option 1' },
      { id: 'option2', description: 'Option 2' },
    ],
    option1: 5,
    option2: 3,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';
    process.env.ORIGIN = 'https://test.com';
  });

  it('records a new vote and returns updated counts', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData })     // GetItem (vote doc)
      .mockResolvedValueOnce({})                         // PutItem (new voter success)
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 6 } }); // UpdateItem

    const res = await handler(baseEvent);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ option1: 6, option2: 3 });

    // Verify command shapes
    expect(mockGetItemCommand).toHaveBeenCalledWith({
      TableName: 'test-table',
      Key: { pk: 'test-tenant#test-issue', sk: 'votes' },
    });

    const putItem = mockPutItemCommand.mock.calls[0][0];
    expect(putItem.TableName).toBe('test-table');
    expect(putItem.Item.pk).toBe('test-tenant#test-issue');
    expect(putItem.Item.sk).toMatch(/^voter#[a-f0-9]{64}$/);
    expect(putItem.ConditionExpression).toBe('attribute_not_exists(pk)');

    expect(mockUpdateItemCommand).toHaveBeenCalledWith({
      TableName: 'test-table',
      Key: { pk: 'test-tenant#test-issue', sk: 'votes' },
      UpdateExpression: 'SET #choice = #choice + :inc',
      ExpressionAttributeNames: { '#choice': 'option1' },
      ExpressionAttributeValues: { ':inc': 1 },
      ReturnValues: 'ALL_NEW',
    });
  });

  it('returns current counts when voter already voted (idempotent)', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData }) // GetItem
      .mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' }); // PutItem blocked

    const res = await handler(baseEvent);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ option1: 5, option2: 3 });

    // UpdateItem not called
    expect(mockUpdateItemCommand).not.toHaveBeenCalled();
  });

  it('400 when missing body', async () => {
    const res = await handler({ ...baseEvent, body: null });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toBe('Missing request body');
  });

  it('400 when invalid JSON body', async () => {
    const res = await handler({ ...baseEvent, body: 'not-json' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toBe('Invalid JSON body');
  });

  it('400 when missing choice', async () => {
    const res = await handler({ ...baseEvent, body: JSON.stringify({}) });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toBe('Missing choice');
  });

  it('404 when vote doc not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: null }); // GetItem
    const res = await handler(baseEvent);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).message).toBe('Vote not found');
  });

  it('400 when choice is not a valid option', async () => {
    mockSend.mockResolvedValueOnce({ Item: mockVoteData }); // GetItem
    const res = await handler({ ...baseEvent, body: JSON.stringify({ choice: 'nope' }) });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toBe('Invalid choice');
  });

  it('400 when missing tenant or issueId', async () => {
    const res = await handler({ ...baseEvent, pathParameters: { tenant: 'only-tenant' } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toBe('Missing tenant or issueId');
  });

  it('400 when cannot identify voter (no sourceIp)', async () => {
    const res = await handler({ ...baseEvent, requestContext: { identity: {} } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toBe('Unable to identify voter');
  });

  it('500 on unexpected DB error', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData }) // GetItem
      .mockRejectedValueOnce(new Error('boom'));     // PutItem unexpected

    const res = await handler(baseEvent);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toBe('Something went wrong');
  });

  it('handles zero-existing votes', async () => {
    const empty = { options: [{ id: 'option1' }, { id: 'option2' }] };
    mockSend
      .mockResolvedValueOnce({ Item: empty })                           // GetItem
      .mockResolvedValueOnce({})                                        // PutItem
      .mockResolvedValueOnce({ Attributes: { ...empty, option1: 1 } }); // UpdateItem

    const res = await handler(baseEvent);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ option1: 1, option2: 0 });
  });

  it('sets a 7-day TTL on voter record', async () => {
    const fixedNow = 1_700_000_000_000;
    const realNow = Date.now;
    // @ts-ignore
    Date.now = jest.fn(() => fixedNow);

    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData }) // GetItem
      .mockResolvedValueOnce({})                     // PutItem
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 6 } });

    await handler(baseEvent);

    const putCall = mockPutItemCommand.mock.calls[0][0];
    const expected = Math.floor(fixedNow / 1000) + 7 * 24 * 60 * 60;
    expect(putCall.Item.ttl).toBe(expected);

    // restore
    // @ts-ignore
    Date.now = realNow;
  });

  it('works with more than two options', async () => {
    const multi = {
      options: [
        { id: 'option1' },
        { id: 'option2' },
        { id: 'option3' },
        { id: 'option4' },
      ],
      option1: 10,
      option2: 5,
      option3: 2,
      option4: 0,
    };
    const event = { ...baseEvent, body: JSON.stringify({ choice: 'option3' }) };

    mockSend
      .mockResolvedValueOnce({ Item: multi }) // GetItem
      .mockResolvedValueOnce({})              // PutItem
      .mockResolvedValueOnce({ Attributes: { ...multi, option3: 3 } });

    const res = await handler(event);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ option1: 10, option2: 5, option3: 3, option4: 0 });
  });

  it('includes CORS headers (when ORIGIN set)', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 6 } });

    const res = await handler(baseEvent);
    expect(res.headers).toEqual({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://test.com',
    });
  });

  it('omits CORS origin header if ORIGIN not set', async () => {
    delete process.env.ORIGIN;

    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 6 } });

    const res = await handler(baseEvent);
    expect(res.headers).toEqual({ 'Content-Type': 'application/json' });

    // restore
    process.env.ORIGIN = 'https://test.com';
  });

  it('produces consistent hash for same IP (different invocations)', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 6 } });

    await handler(baseEvent);
    const firstSk = mockPutItemCommand.mock.calls[0][0].Item.sk;

    jest.clearAllMocks();

    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 7 } });

    await handler(baseEvent);
    const secondSk = mockPutItemCommand.mock.calls[0][0].Item.sk;

    expect(firstSk).toBe(secondSk);
    expect(firstSk).toMatch(/^voter#[a-f0-9]{64}$/);
  });

  it('different IPs -> different voter hash', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 6 } });

    await handler({ ...baseEvent, requestContext: { identity: { sourceIp: '10.0.0.1' } } });
    const sk1 = mockPutItemCommand.mock.calls[0][0].Item.sk;

    jest.clearAllMocks();

    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 6 } });

    await handler({ ...baseEvent, requestContext: { identity: { sourceIp: '203.0.113.42' } } });
    const sk2 = mockPutItemCommand.mock.calls[0][0].Item.sk;

    expect(sk1).not.toBe(sk2);
  });
});
