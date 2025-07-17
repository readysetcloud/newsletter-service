import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock SES client
jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
  SESv2Client: jest.fn(() => ({
    send: jest.fn()
  })),
  CreateContactCommand: jest.fn()
}));

// Mock DynamoDB client
jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({
    send: jest.fn()
  })),
  UpdateItemCommand: jest.fn()
}));

// Mock util-dynamodb
jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn()
}));

// Mock helpers
jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
  getTenant: jest.fn(),
  formatResponse: jest.fn()
}));

// Import handler AFTER mocks
const { handler } = await import('../functions/subscribers/add-subscriber.mjs');
const { SESv2Client, CreateContactCommand } = await import('@aws-sdk/client-sesv2');
const { DynamoDBClient, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb');
const { marshall } = await import('@aws-sdk/util-dynamodb');
const { getTenant, formatResponse } = await import('../functions/utils/helpers.mjs');

describe('Lambda Handler', () => {
  let mockSesClient, mockDdbClient;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.TABLE_NAME = 'test-table';
    process.env.ORIGIN = 'https://www.readysetcloud.io';

    mockSesClient = {
      send: jest.fn()
    };
    mockDdbClient = {
      send: jest.fn()
    };

    SESv2Client.mockReturnValue(mockSesClient);
    DynamoDBClient.mockReturnValue(mockDdbClient);
    marshall.mockReturnValue({ pk: { S: 'test' }, sk: { S: 'tenant' } });
    formatResponse.mockImplementation((statusCode, body) => ({
      statusCode,
      body: JSON.stringify({ message: body }),
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.ORIGIN
      }
    }));
  });

  test('should handle missing tenant', async () => {
    getTenant.mockResolvedValue(null);
    formatResponse.mockReturnValue({
      statusCode: 404,
      body: JSON.stringify({ message: 'Tenant not found' })
    });

    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe'
      })
    };

    const response = await handler(event);

    expect(getTenant).toHaveBeenCalledWith('test-tenant');
    expect(response.statusCode).toBe(404);
  });

  test('should add contact successfully', async () => {
    const mockTenant = { list: 'test-list', id: 'test-tenant' };
    getTenant.mockResolvedValue(mockTenant);
    mockSesClient.send.mockResolvedValue({});
    mockDdbClient.send.mockResolvedValue({});

    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe'
      })
    };

    const response = await handler(event);

    expect(getTenant).toHaveBeenCalledWith('test-tenant');
    expect(CreateContactCommand).toHaveBeenCalledWith({
      ContactListName: 'test-list',
      EmailAddress: 'test@example.com',
      AttributesData: JSON.stringify({
        firstName: 'John',
        lastName: 'Doe'
      })
    });
    expect(mockSesClient.send).toHaveBeenCalled();
    expect(UpdateItemCommand).toHaveBeenCalled();
    expect(mockDdbClient.send).toHaveBeenCalled();
    expect(response.statusCode).toBe(201);
  });

  test('should handle errors gracefully', async () => {
    getTenant.mockRejectedValue(new Error('Database error'));

    const event = {
      pathParameters: { tenant: 'test-tenant' },
      body: JSON.stringify({
        email: 'test@example.com'
      })
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(500);
  });
});
