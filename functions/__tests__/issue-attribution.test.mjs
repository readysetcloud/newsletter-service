import { jest } from '@jest/globals';
import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { getMostRecentPublishedIssue, incrementIssueCounter } from '../utils/issue-attribution.mjs';

describe('issue-attribution', () => {
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

  describe('getMostRecentPublishedIssue', () => {
    test('should return null when no issues exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await getMostRecentPublishedIssue('tenant1');

      expect(result).toBeNull();
      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(QueryCommand);
      const values = unmarshall(cmd.input.ExpressionAttributeValues);
      expect(values[':gsi1pk']).toBe('tenant1#issue');
      expect(cmd.input.ScanIndexForward).toBe(false);
    });

    test('should return null when only drafts exist (no publishedAt)', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          marshall({ pk: 'tenant1#5', GSI1PK: 'tenant1#issue', GSI1SK: '00005', issueNumber: 5 }),
          marshall({ pk: 'tenant1#4', GSI1PK: 'tenant1#issue', GSI1SK: '00004', issueNumber: 4 }),
          marshall({ pk: 'tenant1#3', GSI1PK: 'tenant1#issue', GSI1SK: '00003', issueNumber: 3 })
        ]
      });

      const result = await getMostRecentPublishedIssue('tenant1');

      expect(result).toBeNull();
    });

    test('should return the single published issue', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          marshall({ pk: 'tenant1#3', GSI1PK: 'tenant1#issue', GSI1SK: '00003', issueNumber: 3, publishedAt: '2025-01-15T10:00:00.000Z' })
        ]
      });

      const result = await getMostRecentPublishedIssue('tenant1');

      expect(result).toEqual({ pk: 'tenant1#3', issueNumber: 3 });
    });

    test('should return the highest-numbered published issue from a mix of drafts and published', async () => {
      // GSI1 descending: issue 5 (draft), issue 4 (published), issue 3 (draft), issue 2 (published)
      mockSend.mockResolvedValueOnce({
        Items: [
          marshall({ pk: 'tenant1#5', GSI1PK: 'tenant1#issue', GSI1SK: '00005', issueNumber: 5 }),
          marshall({ pk: 'tenant1#4', GSI1PK: 'tenant1#issue', GSI1SK: '00004', issueNumber: 4, publishedAt: '2025-01-20T10:00:00.000Z' }),
          marshall({ pk: 'tenant1#3', GSI1PK: 'tenant1#issue', GSI1SK: '00003', issueNumber: 3 }),
          marshall({ pk: 'tenant1#2', GSI1PK: 'tenant1#issue', GSI1SK: '00002', issueNumber: 2, publishedAt: '2025-01-10T10:00:00.000Z' })
        ]
      });

      const result = await getMostRecentPublishedIssue('tenant1');

      expect(result).toEqual({ pk: 'tenant1#4', issueNumber: 4 });
    });

    test('should return the highest-numbered published issue when multiple are published', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          marshall({ pk: 'tenant1#10', GSI1PK: 'tenant1#issue', GSI1SK: '00010', issueNumber: 10, publishedAt: '2025-02-01T10:00:00.000Z' }),
          marshall({ pk: 'tenant1#9', GSI1PK: 'tenant1#issue', GSI1SK: '00009', issueNumber: 9, publishedAt: '2025-01-25T10:00:00.000Z' }),
          marshall({ pk: 'tenant1#8', GSI1PK: 'tenant1#issue', GSI1SK: '00008', issueNumber: 8, publishedAt: '2025-01-20T10:00:00.000Z' })
        ]
      });

      const result = await getMostRecentPublishedIssue('tenant1');

      expect(result).toEqual({ pk: 'tenant1#10', issueNumber: 10 });
    });

    test('should paginate when published issue is not in the first page', async () => {
      // First page: all drafts, with LastEvaluatedKey
      mockSend.mockResolvedValueOnce({
        Items: Array.from({ length: 10 }, (_, i) =>
          marshall({ pk: `tenant1#${20 - i}`, GSI1PK: 'tenant1#issue', GSI1SK: String(20 - i).padStart(5, '0'), issueNumber: 20 - i })
        ),
        LastEvaluatedKey: marshall({ pk: 'tenant1#11', GSI1PK: 'tenant1#issue', GSI1SK: '00011' })
      });

      // Second page: contains a published issue
      mockSend.mockResolvedValueOnce({
        Items: [
          marshall({ pk: 'tenant1#10', GSI1PK: 'tenant1#issue', GSI1SK: '00010', issueNumber: 10 }),
          marshall({ pk: 'tenant1#9', GSI1PK: 'tenant1#issue', GSI1SK: '00009', issueNumber: 9, publishedAt: '2025-01-10T10:00:00.000Z' })
        ]
      });

      const result = await getMostRecentPublishedIssue('tenant1');

      expect(result).toEqual({ pk: 'tenant1#9', issueNumber: 9 });
      expect(mockSend).toHaveBeenCalledTimes(2);

      // Verify second call includes ExclusiveStartKey
      const secondCmd = mockSend.mock.calls[1][0];
      expect(secondCmd.input.ExclusiveStartKey).toBeDefined();
    });

    test('should fall back to parsing issueNumber from pk when issueNumber field is missing', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          marshall({ pk: 'tenant1#42', GSI1PK: 'tenant1#issue', GSI1SK: '00042', publishedAt: '2025-01-15T10:00:00.000Z' })
        ]
      });

      const result = await getMostRecentPublishedIssue('tenant1');

      expect(result).toEqual({ pk: 'tenant1#42', issueNumber: 42 });
    });

    test('should query GSI1 index with correct parameters', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await getMostRecentPublishedIssue('myTenant');

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(QueryCommand);
      expect(cmd.input.TableName).toBe('test-table');
      expect(cmd.input.IndexName).toBe('GSI1');
      expect(cmd.input.ScanIndexForward).toBe(false);
      expect(cmd.input.Limit).toBe(10);
    });
  });

  describe('incrementIssueCounter', () => {
    test('should form correct ADD expression for unsubscribes', async () => {
      mockSend.mockResolvedValueOnce({});

      await incrementIssueCounter('tenant1#42', 'unsubscribes');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(UpdateItemCommand);
      expect(cmd.input.TableName).toBe('test-table');
      expect(cmd.input.UpdateExpression).toBe('ADD #counter :val');
      expect(cmd.input.ExpressionAttributeNames['#counter']).toBe('unsubscribes');

      const key = unmarshall(cmd.input.Key);
      expect(key).toEqual({ pk: 'tenant1#42', sk: 'stats' });

      const values = unmarshall(cmd.input.ExpressionAttributeValues);
      expect(values[':val']).toBe(1);
    });

    test('should form correct ADD expression for manualRemovals', async () => {
      mockSend.mockResolvedValueOnce({});

      await incrementIssueCounter('tenant1#7', 'manualRemovals');

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.ExpressionAttributeNames['#counter']).toBe('manualRemovals');

      const key = unmarshall(cmd.input.Key);
      expect(key).toEqual({ pk: 'tenant1#7', sk: 'stats' });
    });

    test('should form correct ADD expression for cleaned', async () => {
      mockSend.mockResolvedValueOnce({});

      await incrementIssueCounter('tenant1#99', 'cleaned');

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.ExpressionAttributeNames['#counter']).toBe('cleaned');

      const key = unmarshall(cmd.input.Key);
      expect(key).toEqual({ pk: 'tenant1#99', sk: 'stats' });
    });
  });
});
