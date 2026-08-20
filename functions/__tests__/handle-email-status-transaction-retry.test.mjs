import { jest } from '@jest/globals';
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { handler } from '../handle-email-status.mjs';

describe('handle-email-status transaction retries', () => {
  const originalSend = DynamoDBClient.prototype.send;
  const originalTable = process.env.TABLE_NAME;
  let mockSend;

  const sendEvent = (messageId = 'msg-retry') => ({
    detail: {
      eventType: 'Send',
      mail: {
        messageId,
        timestamp: '2026-08-19T12:00:00.000Z',
        destination: ['reader@example.com'],
        tags: { referenceNumber: ['tenant123_42'] }
      }
    }
  });

  const cancelled = (codes) => {
    const err = new Error('Transaction cancelled');
    err.name = 'TransactionCanceledException';
    err.CancellationReasons = codes.map((Code) => ({ Code }));
    return err;
  };

  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
    mockSend = jest.fn();
    DynamoDBClient.prototype.send = mockSend;
    jest.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    DynamoDBClient.prototype.send = originalSend;
    process.env.TABLE_NAME = originalTable;
    jest.restoreAllMocks();
  });

  test.each([
    'TransactionConflict',
    'ThrottlingError',
    'ProvisionedThroughputExceeded'
  ])('retries transient transaction cancellation %s locally', async (reasonCode) => {
    let transactAttempts = 0;
    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        return Promise.resolve({ Item: null });
      }
      if (command instanceof TransactWriteItemsCommand) {
        transactAttempts++;
        if (transactAttempts === 1) {
          return Promise.reject(cancelled(['None', reasonCode]));
        }
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    await expect(handler(sendEvent())).resolves.toBe(true);
    expect(transactAttempts).toBe(2);
  });

  test('does not locally retry a non-marker conditional failure', async () => {
    let transactAttempts = 0;
    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        return Promise.resolve({ Item: null });
      }
      if (command instanceof TransactWriteItemsCommand) {
        transactAttempts++;
        return Promise.reject(cancelled(['None', 'ConditionalCheckFailed']));
      }
      return Promise.resolve({});
    });

    await expect(handler(sendEvent())).rejects.toThrow('Transaction cancelled');
    expect(transactAttempts).toBe(1);
  });

  test('still treats the processed-marker condition as duplicate success', async () => {
    let transactAttempts = 0;
    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        return Promise.resolve({ Item: null });
      }
      if (command instanceof TransactWriteItemsCommand) {
        transactAttempts++;
        return Promise.reject(cancelled(['ConditionalCheckFailed', 'None']));
      }
      return Promise.resolve({});
    });

    await expect(handler(sendEvent())).resolves.toBe(true);
    expect(transactAttempts).toBe(1);
  });

  test('rethrows after the bounded transient retry budget is exhausted', async () => {
    let transactAttempts = 0;
    mockSend.mockImplementation((command) => {
      if (command instanceof GetItemCommand) {
        return Promise.resolve({ Item: null });
      }
      if (command instanceof TransactWriteItemsCommand) {
        transactAttempts++;
        return Promise.reject(cancelled(['None', 'TransactionConflict']));
      }
      return Promise.resolve({});
    });

    await expect(handler(sendEvent())).rejects.toThrow('Transaction cancelled');
    expect(transactAttempts).toBe(4);
  });
});
