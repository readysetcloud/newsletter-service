import { jest, describe, it, expect, beforeEach } from '@jest/globals';

let updateSubscriberEngagement;
let ddbSend;
let consoleErrorSpy;

const loadIsolated = async () => {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn();

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: (obj) => {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value === 'string') {
            result[key] = { S: value };
          } else if (typeof value === 'number') {
            result[key] = { N: String(value) };
          }
        }
        return result;
      },
    }));

    ({ updateSubscriberEngagement } = await import('../utils/subscriber-engagement.mjs'));
  });
};

describe('updateSubscriberEngagement', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await loadIsolated();
  });

  it('first-time engagement sets lastEngagedIssue and engagementCount = 1', async () => {
    ddbSend.mockResolvedValueOnce({});

    await updateSubscriberEngagement('tenant1', 'user@example.com', 5);

    expect(ddbSend).toHaveBeenCalledTimes(1);
    const command = ddbSend.mock.calls[0][0];
    expect(command.__type).toBe('UpdateItem');
    expect(command.TableName).toBe('test-subscribers-table');
    expect(command.Key).toEqual({
      tenantId: { S: 'tenant1' },
      email: { S: 'user@example.com' },
    });
    expect(command.ConditionExpression).toBe(
      'attribute_not_exists(lastEngagedIssue) OR lastEngagedIssue < :issueNumber'
    );
    expect(command.UpdateExpression).toBe(
      'SET lastEngagedIssue = :issueNumber ADD engagementCount :one'
    );
    expect(command.ExpressionAttributeValues).toEqual({
      ':issueNumber': { N: '5' },
      ':one': { N: '1' },
    });
  });

  it('new issue engagement increments engagementCount', async () => {
    ddbSend.mockResolvedValueOnce({});

    await updateSubscriberEngagement('tenant1', 'user@example.com', 10);

    expect(ddbSend).toHaveBeenCalledTimes(1);
    const command = ddbSend.mock.calls[0][0];
    expect(command.ConditionExpression).toBe(
      'attribute_not_exists(lastEngagedIssue) OR lastEngagedIssue < :issueNumber'
    );
    expect(command.UpdateExpression).toBe(
      'SET lastEngagedIssue = :issueNumber ADD engagementCount :one'
    );
    expect(command.ExpressionAttributeValues[':issueNumber']).toEqual({ N: '10' });
    expect(command.ExpressionAttributeValues[':one']).toEqual({ N: '1' });
  });

  it('same-issue event is silently deduplicated (ConditionalCheckFailedException)', async () => {
    const error = new Error('The conditional request failed');
    error.name = 'ConditionalCheckFailedException';
    ddbSend.mockRejectedValueOnce(error);

    await expect(
      updateSubscriberEngagement('tenant1', 'user@example.com', 5)
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('DynamoDB transient error is logged but does not throw', async () => {
    const error = new Error('Service Unavailable');
    error.name = 'InternalServerError';
    ddbSend.mockRejectedValueOnce(error);

    await expect(
      updateSubscriberEngagement('tenant1', 'user@example.com', 5)
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to update subscriber engagement',
      expect.objectContaining({
        tenantId: 'tenant1',
        email: 'user@example.com',
        issueNumber: 5,
        error: 'Service Unavailable',
      })
    );
  });
});
