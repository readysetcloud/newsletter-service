import { jest } from '@jest/globals';

// Mock AWS SDK
const mockSend = jest.fn();
const mockMarshall = jest.fn();
const mockUnmarshall = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  GetItemCommand: jest.fn(),
  UpdateItemCommand: jest.fn(),
  PutItemCommand: jest.fn()
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
});
