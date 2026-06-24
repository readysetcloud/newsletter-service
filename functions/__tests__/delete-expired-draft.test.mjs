import { jest } from '@jest/globals';

const { DynamoDBClient, DeleteItemCommand } = await import('@aws-sdk/client-dynamodb');
const { handler } = await import('../delete-expired-draft.mjs');

describe('delete-expired-draft', () => {
  let mockSend;
  let originalTableName;

  beforeEach(() => {
    originalTableName = process.env.TABLE_NAME;
    process.env.TABLE_NAME = 'newsletter-table';
    mockSend = jest.fn();
    DynamoDBClient.prototype.send = mockSend;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalTableName;
  });

  test('conditionally deletes the draft for the given tenant/issue', async () => {
    mockSend.mockResolvedValue({});

    const result = await handler({
      detail: { tenantId: 'tenant-123', issueNumber: 42 }
    });

    expect(result).toEqual({ deleted: true, tenantId: 'tenant-123', issueNumber: 42 });
    expect(mockSend).toHaveBeenCalledTimes(1);

    const command = mockSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(DeleteItemCommand);
    expect(command.input.TableName).toBe('newsletter-table');
    expect(command.input.Key.pk.S).toBe('tenant-123#42');
    expect(command.input.Key.sk.S).toBe('newsletter');
    expect(command.input.ConditionExpression).toBe('#status = :draft');
    expect(command.input.ExpressionAttributeValues[':draft'].S).toBe('draft');
  });

  test('treats issueNumber 0 as a valid issue', async () => {
    mockSend.mockResolvedValue({});

    const result = await handler({
      detail: { tenantId: 'tenant-123', issueNumber: 0 }
    });

    expect(result.deleted).toBe(true);
    expect(mockSend.mock.calls[0][0].input.Key.pk.S).toBe('tenant-123#0');
  });

  test('skips deletion when the issue is no longer a draft', async () => {
    const err = new Error('conditional check failed');
    err.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValue(err);

    const result = await handler({
      detail: { tenantId: 'tenant-123', issueNumber: 42 }
    });

    expect(result).toEqual({ deleted: false, reason: 'not-draft' });
  });

  test('returns without calling DynamoDB when parameters are missing', async () => {
    const result = await handler({ detail: { tenantId: 'tenant-123' } });

    expect(result).toEqual({ deleted: false, reason: 'missing-parameters' });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('rethrows unexpected DynamoDB errors', async () => {
    mockSend.mockRejectedValue(new Error('throttled'));

    await expect(handler({
      detail: { tenantId: 'tenant-123', issueNumber: 42 }
    })).rejects.toThrow('throttled');
  });
});
