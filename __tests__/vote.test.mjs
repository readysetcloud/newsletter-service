import { jest } from '@jest/globals';

// Mock AWS SDK
const mockSend = jest.fn();
const mockMarshall = jest.fn();
const mockUnmarshall = jest.fn();
const mockGetItemCommand = jest.fn();
const mockUpdateItemCommand = jest.fn();
const mockPutItemCommand = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  GetItemCommand: mockGetItemCommand,
  UpdateItemCommand: mockUpdateItemCommand,
  PutItemCommand: mockPutItemCommand
}));

jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: mockMarshall,
  unmarshall: mockUnmarshall
}));

const { handler } = await import('../functions/vote.mjs');

describe('Vote Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';
    process.env.ORIGIN = 'https://test.com';

    // Set up marshall/unmarshall mocks
    mockMarshall.mockImplementation((obj) => {
      // Simple mock that just returns the object (DynamoDB would normally convert to DynamoDB format)
      return obj;
    });

    mockUnmarshall.mockImplementation((obj) => {
      // Simple mock that just returns the object (DynamoDB would normally convert from DynamoDB format)
      return obj;
    });

    // Set up command mocks to return the input for verification
    mockGetItemCommand.mockImplementation((params) => params);
    mockUpdateItemCommand.mockImplementation((params) => params);
    mockPutItemCommand.mockImplementation((params) => params);
  });

  const mockEvent = {
    pathParameters: { tenant: 'test-tenant', slug: 'test-issue' },
    requestContext: { identity: { sourceIp: '192.168.1.1' } },
    httpMethod: 'POST',
    body: JSON.stringify({ choice: 'option1' })
  };

  const mockVoteData = {
    options: [
      { id: 'option1', description: 'Option 1' },
      { id: 'option2', description: 'Option 2' }
    ],
    option1: 5,
    option2: 3
  };

  test('should record new vote successfully', async () => {
    // Mock getting existing vote data
    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData }) // GetItem
      .mockResolvedValueOnce({}) // PutItem (new voter)
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 6 } }); // UpdateItem

    const result = await handler(mockEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);

    // Check the simple response format (just vote counts)
    expect(body.option1).toBe(6);
    expect(body.option2).toBe(3);
  });

  test('should return current results when user has already voted', async () => {
    // Mock getting existing vote data
    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData }) // GetItem
      .mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' }); // PutItem fails

    const result = await handler(mockEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);

    // Should return current vote counts (no increment since user already voted)
    expect(body.option1).toBe(5);
    expect(body.option2).toBe(3);
  });

  test('should return 400 when missing request body', async () => {
    const eventWithoutBody = {
      ...mockEvent,
      body: null
    };

    const result = await handler(eventWithoutBody);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Missing request body');
  });

  test('should return 400 for invalid JSON body', async () => {
    const invalidEvent = {
      ...mockEvent,
      body: 'invalid-json'
    };

    const result = await handler(invalidEvent);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Invalid JSON body');
  });

  test('should return 400 when missing choice', async () => {
    const eventWithoutChoice = {
      ...mockEvent,
      body: JSON.stringify({})
    };

    const result = await handler(eventWithoutChoice);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Missing choice');
  });

  test('should return 404 when vote not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: null }); // GetItem returns null

    const result = await handler(mockEvent);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Vote not found');
  });

  test('should return 400 for invalid choice', async () => {
    const invalidEvent = {
      ...mockEvent,
      body: JSON.stringify({ choice: 'invalid-option' })
    };

    mockSend.mockResolvedValueOnce({ Item: mockVoteData }); // GetItem

    const result = await handler(invalidEvent);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Invalid choice');
  });

  test('should return 400 when missing tenant or slug', async () => {
    const eventWithoutParams = {
      ...mockEvent,
      pathParameters: { tenant: 'test-tenant' } // missing slug
    };

    const result = await handler(eventWithoutParams);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Missing tenant or slug');
  });

  test('should return 400 when unable to identify voter', async () => {
    const eventWithoutIp = {
      ...mockEvent,
      requestContext: { identity: {} } // missing sourceIp
    };

    const result = await handler(eventWithoutIp);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Unable to identify voter');
  });

  test('should handle database errors gracefully', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData }) // GetItem
      .mockRejectedValueOnce(new Error('Database connection failed')); // PutItem fails with unexpected error

    const result = await handler(mockEvent);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Something went wrong');
  });

  test('should handle vote with zero existing votes', async () => {
    const emptyVoteData = {
      options: [
        { id: 'option1', description: 'Option 1' },
        { id: 'option2', description: 'Option 2' }
      ]
      // No existing vote counts
    };

    mockSend
      .mockResolvedValueOnce({ Item: emptyVoteData }) // GetItem
      .mockResolvedValueOnce({}) // PutItem (new voter)
      .mockResolvedValueOnce({ Attributes: { ...emptyVoteData, option1: 1 } }); // UpdateItem

    const result = await handler(mockEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.option1).toBe(1);
    expect(body.option2).toBe(0); // Should default to 0 for options with no votes
  });

  test('should verify correct DynamoDB commands are called', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData }) // GetItem
      .mockResolvedValueOnce({}) // PutItem (new voter)
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 6 } }); // UpdateItem

    await handler(mockEvent);

    // Verify GetItemCommand was called with correct parameters
    expect(mockGetItemCommand).toHaveBeenCalledWith({
      TableName: 'test-table',
      Key: {
        pk: 'test-tenant#test-issue',
        sk: 'votes'
      }
    });

    // Verify PutItemCommand was called with hashed IP
    expect(mockPutItemCommand).toHaveBeenCalledWith({
      TableName: 'test-table',
      Item: {
        pk: 'test-tenant#test-issue',
        sk: expect.stringMatching(/^voter#[a-f0-9]{64}$/), // SHA256 hash
        createdAt: expect.any(String),
        ttl: expect.any(Number)
      },
      ConditionExpression: 'attribute_not_exists(pk)'
    });

    // Verify UpdateItemCommand was called with correct parameters
    expect(mockUpdateItemCommand).toHaveBeenCalledWith({
      TableName: 'test-table',
      Key: {
        pk: 'test-tenant#test-issue',
        sk: 'votes'
      },
      UpdateExpression: 'SET #choice = #choice + :inc',
      ExpressionAttributeNames: {
        '#choice': 'option1'
      },
      ExpressionAttributeValues: {
        ':inc': 1
      },
      ReturnValues: 'ALL_NEW'
    });
  });

  test('should handle different IP addresses correctly', async () => {
    const eventWithDifferentIp = {
      ...mockEvent,
      requestContext: { identity: { sourceIp: '10.0.0.1' } }
    };

    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData }) // GetItem
      .mockResolvedValueOnce({}) // PutItem (new voter)
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 6 } }); // UpdateItem

    await handler(eventWithDifferentIp);

    // Verify PutItemCommand was called with different hashed IP
    const putItemCall = mockPutItemCommand.mock.calls[0][0];
    expect(putItemCall.Item.sk).toMatch(/^voter#[a-f0-9]{64}$/);
    // The hash should be different from the default IP
    expect(putItemCall.Item.sk).not.toBe('voter#4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a'); // hash of 192.168.1.1
  });

  test('should set correct TTL for voter record', async () => {
    const mockDate = Date.now();
    const originalDateNow = Date.now;
    Date.now = jest.fn(() => mockDate);

    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData }) // GetItem
      .mockResolvedValueOnce({}) // PutItem (new voter)
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 6 } }); // UpdateItem

    await handler(mockEvent);

    const expectedTtl = Math.floor(mockDate / 1000) + (7 * 24 * 60 * 60); // 7 days
    const putItemCall = mockPutItemCommand.mock.calls[0][0];
    expect(putItemCall.Item.ttl).toBe(expectedTtl);

    Date.now = originalDateNow;
  });

  test('should handle multiple vote options correctly', async () => {
    const multiOptionVoteData = {
      options: [
        { id: 'option1', description: 'Option 1' },
        { id: 'option2', description: 'Option 2' },
        { id: 'option3', description: 'Option 3' },
        { id: 'option4', description: 'Option 4' }
      ],
      option1: 10,
      option2: 5,
      option3: 2,
      option4: 0
    };

    const eventWithOption3 = {
      ...mockEvent,
      body: JSON.stringify({ choice: 'option3' })
    };

    mockSend
      .mockResolvedValueOnce({ Item: multiOptionVoteData }) // GetItem
      .mockResolvedValueOnce({}) // PutItem (new voter)
      .mockResolvedValueOnce({ Attributes: { ...multiOptionVoteData, option3: 3 } }); // UpdateItem

    const result = await handler(eventWithOption3);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.option1).toBe(10);
    expect(body.option2).toBe(5);
    expect(body.option3).toBe(3); // Incremented
    expect(body.option4).toBe(0);
  });

  test('should include CORS headers in response', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData }) // GetItem
      .mockResolvedValueOnce({}) // PutItem (new voter)
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 6 } }); // UpdateItem

    const result = await handler(mockEvent);

    expect(result.headers).toEqual({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://test.com'
    });
  });

  test('should handle CORS headers when ORIGIN is not set', async () => {
    delete process.env.ORIGIN;

    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData }) // GetItem
      .mockResolvedValueOnce({}) // PutItem (new voter)
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 6 } }); // UpdateItem

    const result = await handler(mockEvent);

    expect(result.headers).toEqual({
      'Content-Type': 'application/json'
    });

    // Restore for other tests
    process.env.ORIGIN = 'https://test.com';
  });

  test('should create consistent hash for same IP address', async () => {
    const sameIpEvent1 = {
      ...mockEvent,
      requestContext: { identity: { sourceIp: '203.0.113.1' } }
    };

    const sameIpEvent2 = {
      ...mockEvent,
      requestContext: { identity: { sourceIp: '203.0.113.1' } }
    };

    // First vote
    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData }) // GetItem
      .mockResolvedValueOnce({}) // PutItem (new voter)
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 6 } }); // UpdateItem

    await handler(sameIpEvent1);
    const firstHash = mockPutItemCommand.mock.calls[0][0].Item.sk;

    // Reset mocks for second call
    jest.clearAllMocks();
    mockMarshall.mockImplementation((obj) => obj);
    mockUnmarshall.mockImplementation((obj) => obj);
    mockGetItemCommand.mockImplementation((params) => params);
    mockUpdateItemCommand.mockImplementation((params) => params);
    mockPutItemCommand.mockImplementation((params) => params);

    // Second vote with same IP
    mockSend
      .mockResolvedValueOnce({ Item: mockVoteData }) // GetItem
      .mockResolvedValueOnce({}) // PutItem (new voter)
      .mockResolvedValueOnce({ Attributes: { ...mockVoteData, option1: 7 } }); // UpdateItem

    await handler(sameIpEvent2);
    const secondHash = mockPutItemCommand.mock.calls[0][0].Item.sk;

    expect(firstHash).toBe(secondHash);
    expect(firstHash).toMatch(/^voter#[a-f0-9]{64}$/);
  });
});
