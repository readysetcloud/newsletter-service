import { jest } from '@jest/globals';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// Must set env before importing the module
process.env.TABLE_NAME = 'test-newsletter-table';
process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';
process.env.EMAIL_ENCRYPTION_KEY = 'test-encryption-key-for-testing-only';

let processInterestScoring;
let mockSend;

beforeEach(async () => {
  mockSend = jest.fn().mockResolvedValue({});
  DynamoDBClient.prototype.send = mockSend;
  jest.clearAllMocks();

  const mod = await import('../process-link-click.mjs');
  processInterestScoring = mod.processInterestScoring;
});

describe('processInterestScoring', () => {
  const tenantId = 'tenant-1';
  const email = 'subscriber@example.com';

  describe('early returns', () => {
    test('should return early when URL normalization fails (null)', async () => {
      await processInterestScoring(tenantId, email, 'not-a-valid-url');
      expect(mockSend).not.toHaveBeenCalled();
    });

    test('should return early when no Link_Metadata found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await processInterestScoring(tenantId, email, 'https://example.com/article');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(GetItemCommand);
    });
  });

  describe('Link_Metadata lookup', () => {
    test('should normalize URL and hash before looking up metadata', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await processInterestScoring(tenantId, email, 'https://EXAMPLE.COM/article/?utm_source=test');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(GetItemCommand);
      expect(cmd.input.TableName).toBe('test-newsletter-table');
      expect(cmd.input.Key).toBeDefined();
    });
  });

  describe('scoring logic with updateInterestScore', () => {
    const makeUpdateResult = (topic, score) => ({
      Attributes: marshall({
        interestScores: { [topic]: { score, lastScoredAt: new Date().toISOString() } }
      })
    });

    test('should score primary topic with +1.0 and first secondary with +0.5', async () => {
      // GetItem for Link_Metadata
      mockSend.mockResolvedValueOnce({
        Item: marshall({ primaryTopic: 'ai', secondaryTopics: ['serverless'] })
      });
      // UpdateItem for primary topic 'ai'
      mockSend.mockResolvedValueOnce(makeUpdateResult('ai', 1.0));
      // UpdateItem for secondary topic 'serverless'
      mockSend.mockResolvedValueOnce(makeUpdateResult('serverless', 0.5));

      await processInterestScoring(tenantId, email, 'https://example.com/ai-article');

      // 1 GetItem + 2 UpdateItems
      expect(mockSend).toHaveBeenCalledTimes(3);

      // Verify primary topic update
      const primaryCmd = mockSend.mock.calls[1][0];
      expect(primaryCmd).toBeInstanceOf(UpdateItemCommand);
      expect(primaryCmd.input.TableName).toBe('test-subscribers-table');
      expect(primaryCmd.input.UpdateExpression).toContain('interestScores.#topic.score');
      expect(primaryCmd.input.ExpressionAttributeNames['#topic']).toBe('ai');
      const primaryVals = unmarshall(primaryCmd.input.ExpressionAttributeValues);
      expect(primaryVals[':increment']).toBe(1.0);

      // Verify secondary topic update
      const secondaryCmd = mockSend.mock.calls[2][0];
      expect(secondaryCmd).toBeInstanceOf(UpdateItemCommand);
      expect(secondaryCmd.input.ExpressionAttributeNames['#topic']).toBe('serverless');
      const secondaryVals = unmarshall(secondaryCmd.input.ExpressionAttributeValues);
      expect(secondaryVals[':increment']).toBe(0.5);
    });

    test('should score only primary topic when no secondary topics', async () => {
      mockSend.mockResolvedValueOnce({
        Item: marshall({ primaryTopic: 'devops', secondaryTopics: [] })
      });
      mockSend.mockResolvedValueOnce(makeUpdateResult('devops', 1.0));

      await processInterestScoring(tenantId, email, 'https://example.com/devops-article');

      // 1 GetItem + 1 UpdateItem
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    test('should discard additional secondaries beyond the first (cap at 1.5)', async () => {
      mockSend.mockResolvedValueOnce({
        Item: marshall({ primaryTopic: 'ai', secondaryTopics: ['serverless', 'cloud'] })
      });
      mockSend.mockResolvedValueOnce(makeUpdateResult('ai', 1.0));
      mockSend.mockResolvedValueOnce(makeUpdateResult('serverless', 0.5));

      await processInterestScoring(tenantId, email, 'https://example.com/multi-topic');

      // 1 GetItem + 2 UpdateItems (ai + serverless, NOT cloud)
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    test('should skip secondary topic if not in VALID_TOPICS', async () => {
      mockSend.mockResolvedValueOnce({
        Item: marshall({ primaryTopic: 'ai', secondaryTopics: ['invalid-topic'] })
      });
      mockSend.mockResolvedValueOnce(makeUpdateResult('ai', 1.0));

      await processInterestScoring(tenantId, email, 'https://example.com/article');

      // 1 GetItem + 1 UpdateItem (only primary)
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    test('should skip primary topic if not in VALID_TOPICS', async () => {
      mockSend.mockResolvedValueOnce({
        Item: marshall({ primaryTopic: 'nonexistent', secondaryTopics: [] })
      });

      await processInterestScoring(tenantId, email, 'https://example.com/article');

      // Only 1 GetItem, no UpdateItems
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateInterestScore - nested map initialization', () => {
    test('should retry with map initialization on ValidationException', async () => {
      // GetItem for Link_Metadata
      mockSend.mockResolvedValueOnce({
        Item: marshall({ primaryTopic: 'ai', secondaryTopics: [] })
      });

      // First UpdateItem attempt fails with ValidationException
      const validationError = new Error('The document path provided in the update expression is invalid for update');
      validationError.name = 'ValidationException';
      mockSend.mockRejectedValueOnce(validationError);

      // Map initialization UpdateItem succeeds
      mockSend.mockResolvedValueOnce({});

      // Retry nested UpdateItem succeeds
      mockSend.mockResolvedValueOnce({
        Attributes: marshall({
          interestScores: { ai: { score: 1.0, lastScoredAt: new Date().toISOString() } }
        })
      });

      await processInterestScoring(tenantId, email, 'https://example.com/ai-article');

      // 1 GetItem + 1 failed UpdateItem + 1 init UpdateItem + 1 retry UpdateItem = 4
      expect(mockSend).toHaveBeenCalledTimes(4);

      // Verify the initialization command
      const initCmd = mockSend.mock.calls[2][0];
      expect(initCmd).toBeInstanceOf(UpdateItemCommand);
      expect(initCmd.input.UpdateExpression).toBe('SET interestScores = if_not_exists(interestScores, :emptyMap)');
      expect(initCmd.input.TableName).toBe('test-subscribers-table');
    });

    test('should use SET with if_not_exists, not ADD', async () => {
      mockSend.mockResolvedValueOnce({
        Item: marshall({ primaryTopic: 'security', secondaryTopics: [] })
      });
      mockSend.mockResolvedValueOnce({
        Attributes: marshall({
          interestScores: { security: { score: 2.0, lastScoredAt: new Date().toISOString() } }
        })
      });

      await processInterestScoring(tenantId, email, 'https://example.com/security-article');

      const updateCmd = mockSend.mock.calls[1][0];
      expect(updateCmd.input.UpdateExpression).toContain('SET');
      expect(updateCmd.input.UpdateExpression).toContain('if_not_exists');
      expect(updateCmd.input.UpdateExpression).not.toContain('ADD');
    });

    test('should use ReturnValues UPDATED_NEW', async () => {
      mockSend.mockResolvedValueOnce({
        Item: marshall({ primaryTopic: 'ai', secondaryTopics: [] })
      });
      mockSend.mockResolvedValueOnce({
        Attributes: marshall({
          interestScores: { ai: { score: 1.0, lastScoredAt: new Date().toISOString() } }
        })
      });

      await processInterestScoring(tenantId, email, 'https://example.com/ai-article');

      const updateCmd = mockSend.mock.calls[1][0];
      expect(updateCmd.input.ReturnValues).toBe('UPDATED_NEW');
    });

    test('should set lastScoredAt as ISO 8601 timestamp', async () => {
      mockSend.mockResolvedValueOnce({
        Item: marshall({ primaryTopic: 'ai', secondaryTopics: [] })
      });
      mockSend.mockResolvedValueOnce({
        Attributes: marshall({
          interestScores: { ai: { score: 1.0, lastScoredAt: new Date().toISOString() } }
        })
      });

      await processInterestScoring(tenantId, email, 'https://example.com/ai-article');

      const updateCmd = mockSend.mock.calls[1][0];
      const vals = unmarshall(updateCmd.input.ExpressionAttributeValues);
      expect(vals[':now']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('updateInterestScore - pre/post score computation', () => {
    test('should compute preScore as postScore - increment for threshold evaluation', async () => {
      // Setup: score goes from 2.0 to 3.0 (crossing threshold)
      // 1. GetItem for Link_Metadata
      mockSend.mockResolvedValueOnce({
        Item: marshall({ primaryTopic: 'ai', secondaryTopics: [] })
      });
      // 2. UpdateItem for interest score
      mockSend.mockResolvedValueOnce({
        Attributes: marshall({
          interestScores: { ai: { score: 3.0, lastScoredAt: new Date().toISOString() } }
        })
      });
      // 3. GetItem for segment uniqueness lookup (handleAutoSegmentation → findOrCreateInterestSegment)
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // 4. TransactWriteItems for segment creation
      mockSend.mockResolvedValueOnce({});
      // 5. PutItem for segment member addition
      mockSend.mockResolvedValueOnce({});
      // 6. UpdateItem for memberCount increment
      mockSend.mockResolvedValueOnce({});

      // processInterestScoring checks threshold crossing internally
      // preScore (2.0) < 3 AND postScore (3.0) >= 3 → triggers handleAutoSegmentation
      await processInterestScoring(tenantId, email, 'https://example.com/ai-article');

      // 1 GetItem (metadata) + 1 UpdateItem (score) + 1 GetItem (segment) + 1 TransactWrite + 1 PutItem (member) + 1 UpdateItem (count) = 6
      expect(mockSend).toHaveBeenCalledTimes(6);

      // Verify the score update used correct increment
      const updateCmd = mockSend.mock.calls[1][0];
      expect(updateCmd).toBeInstanceOf(UpdateItemCommand);
      const vals = unmarshall(updateCmd.input.ExpressionAttributeValues);
      expect(vals[':increment']).toBe(1.0);
    });

    test('should not trigger segmentation when score stays below threshold', async () => {
      mockSend.mockResolvedValueOnce({
        Item: marshall({ primaryTopic: 'ai', secondaryTopics: [] })
      });
      // postScore = 1.0, preScore = 0.0 — both below threshold
      mockSend.mockResolvedValueOnce({
        Attributes: marshall({
          interestScores: { ai: { score: 1.0, lastScoredAt: new Date().toISOString() } }
        })
      });

      await processInterestScoring(tenantId, email, 'https://example.com/ai-article');

      // 1 GetItem + 1 UpdateItem = 2 (no handleAutoSegmentation calls)
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    test('should not trigger segmentation when score was already above threshold', async () => {
      mockSend.mockResolvedValueOnce({
        Item: marshall({ primaryTopic: 'ai', secondaryTopics: [] })
      });
      // postScore = 5.0, preScore = 4.0 — both above threshold
      mockSend.mockResolvedValueOnce({
        Attributes: marshall({
          interestScores: { ai: { score: 5.0, lastScoredAt: new Date().toISOString() } }
        })
      });

      await processInterestScoring(tenantId, email, 'https://example.com/ai-article');

      // 1 GetItem + 1 UpdateItem = 2 (no handleAutoSegmentation calls)
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    test('should catch and log errors without propagating', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB timeout'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await processInterestScoring(tenantId, email, 'https://example.com/article');

      expect(consoleSpy).toHaveBeenCalledWith(
        'Interest scoring failed',
        expect.objectContaining({
          tenantId,
          subscriberEmail: email,
          error: 'DynamoDB timeout'
        })
      );

      consoleSpy.mockRestore();
    });

    test('should not propagate errors from metadata lookup', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        processInterestScoring(tenantId, email, 'https://example.com/article')
      ).resolves.toBeUndefined();
    });

    test('should propagate non-ValidationException errors from updateInterestScore', async () => {
      mockSend.mockResolvedValueOnce({
        Item: marshall({ primaryTopic: 'ai', secondaryTopics: [] })
      });
      mockSend.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw (caught by processInterestScoring's try/catch)
      await processInterestScoring(tenantId, email, 'https://example.com/ai-article');

      expect(consoleSpy).toHaveBeenCalledWith(
        'Interest scoring failed',
        expect.objectContaining({ error: 'ProvisionedThroughputExceededException' })
      );

      consoleSpy.mockRestore();
    });
  });
});
