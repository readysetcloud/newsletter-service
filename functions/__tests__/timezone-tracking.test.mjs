import { jest } from '@jest/globals';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';

let recordTimeZoneObservation;
let getConfirmedTimeZone;
let TZ_CONFIRMATION_STREAK;
let mockSend;

// Stateful store emulating the subscriber item, including the conditional
// tzHistory equality check the util relies on for optimistic concurrency.
let item; // unmarshalled subscriber item or null

class ConditionalCheckFailedException extends Error {
  constructor() {
    super('The conditional request failed');
    this.name = 'ConditionalCheckFailedException';
  }
}

function handleCommand(command) {
  if (command instanceof GetItemCommand) {
    return item ? { Item: marshall(item) } : {};
  }

  if (command instanceof UpdateItemCommand) {
    const values = unmarshall(command.input.ExpressionAttributeValues);
    const condition = command.input.ConditionExpression;

    if (condition === 'attribute_not_exists(tzHistory)') {
      if (item.tzHistory !== undefined) throw new ConditionalCheckFailedException();
    } else if (condition === 'tzHistory = :oldHistory') {
      if (JSON.stringify(item.tzHistory) !== JSON.stringify(values[':oldHistory'])) {
        throw new ConditionalCheckFailedException();
      }
    }

    item.tzHistory = values[':newHistory'];
    if (command.input.UpdateExpression.includes('#timeZone = :tz')) {
      // Enforce the reserved-word aliasing DynamoDB requires for "timeZone".
      if (command.input.ExpressionAttributeNames?.['#timeZone'] !== 'timeZone') {
        throw new Error('ValidationException: #timeZone alias missing');
      }
      item.timeZone = values[':tz'];
      item.timeZoneUpdatedAt = values[':now'];
    }
    return {};
  }

  throw new Error(`Unexpected command: ${command?.constructor?.name}`);
}

beforeEach(async () => {
  item = { tenantId: 'tenant-1', email: 'reader@example.com' };
  mockSend = jest.fn(async (command) => handleCommand(command));
  DynamoDBClient.prototype.send = mockSend;
  jest.clearAllMocks();

  const mod = await import('../utils/timezone-tracking.mjs');
  ({ recordTimeZoneObservation, getConfirmedTimeZone, TZ_CONFIRMATION_STREAK } = mod);
});

describe('getConfirmedTimeZone', () => {
  it('returns null for short histories', () => {
    expect(getConfirmedTimeZone([])).toBeNull();
    expect(getConfirmedTimeZone([{ issue: 1, tz: 'America/New_York' }])).toBeNull();
    expect(getConfirmedTimeZone([
      { issue: 1, tz: 'America/New_York' },
      { issue: 2, tz: 'America/New_York' }
    ])).toBeNull();
  });

  it('confirms when the last three distinct issues agree', () => {
    expect(getConfirmedTimeZone([
      { issue: 1, tz: 'America/New_York' },
      { issue: 2, tz: 'America/New_York' },
      { issue: 3, tz: 'America/New_York' }
    ])).toBe('America/New_York');
  });

  it('does not confirm when the recent streak is mixed', () => {
    expect(getConfirmedTimeZone([
      { issue: 1, tz: 'America/New_York' },
      { issue: 2, tz: 'Europe/London' },
      { issue: 3, tz: 'America/New_York' }
    ])).toBeNull();
  });

  it('only considers the most recent streak, so older zones do not block a move', () => {
    expect(getConfirmedTimeZone([
      { issue: 1, tz: 'America/New_York' },
      { issue: 2, tz: 'America/New_York' },
      { issue: 3, tz: 'Europe/London' },
      { issue: 4, tz: 'Europe/London' },
      { issue: 5, tz: 'Europe/London' }
    ])).toBe('Europe/London');
  });
});

describe('recordTimeZoneObservation', () => {
  it('does not confirm a timezone before three distinct issues agree', async () => {
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', 1, 'America/New_York');
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', 2, 'America/New_York');

    expect(item.tzHistory).toEqual([
      { issue: 1, tz: 'America/New_York' },
      { issue: 2, tz: 'America/New_York' }
    ]);
    expect(item.timeZone).toBeUndefined();
  });

  it('confirms the timezone on the third agreeing issue', async () => {
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', 1, 'America/New_York');
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', 2, 'America/New_York');
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', 3, 'America/New_York');

    expect(item.timeZone).toBe('America/New_York');
    expect(item.timeZoneUpdatedAt).toEqual(expect.any(String));
  });

  it('ignores repeat observations for the same issue', async () => {
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', 7, 'America/New_York');
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', 7, 'Europe/London');

    expect(item.tzHistory).toEqual([{ issue: 7, tz: 'America/New_York' }]);
  });

  it('re-confirms after a move once three new issues agree', async () => {
    for (const issue of [1, 2, 3]) {
      await recordTimeZoneObservation('tenant-1', 'reader@example.com', issue, 'America/New_York');
    }
    expect(item.timeZone).toBe('America/New_York');

    // Subscriber moves: two London observations are not yet enough.
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', 4, 'Europe/London');
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', 5, 'Europe/London');
    expect(item.timeZone).toBe('America/New_York');

    // Third consistent issue flips the confirmed zone.
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', 6, 'Europe/London');
    expect(item.timeZone).toBe('Europe/London');
  });

  it('caps the history length', async () => {
    for (let issue = 1; issue <= 10; issue++) {
      await recordTimeZoneObservation('tenant-1', 'reader@example.com', issue, 'America/Denver');
    }
    expect(item.tzHistory.length).toBeLessThanOrEqual(6);
    expect(item.tzHistory[item.tzHistory.length - 1].issue).toBe(10);
  });

  it('keeps history ordered by issue when events arrive out of order', async () => {
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', 5, 'America/New_York');
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', 3, 'America/New_York');
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', 4, 'America/New_York');

    expect(item.tzHistory.map((entry) => entry.issue)).toEqual([3, 4, 5]);
    expect(item.timeZone).toBe('America/New_York');
  });

  it('skips unknown subscribers without writing', async () => {
    item = null;
    await recordTimeZoneObservation('tenant-1', 'ghost@example.com', 1, 'America/New_York');

    const updates = mockSend.mock.calls.filter(([cmd]) => cmd instanceof UpdateItemCommand);
    expect(updates).toHaveLength(0);
  });

  it('skips invalid input without any DynamoDB calls', async () => {
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', 1, null);
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', NaN, 'America/New_York');
    await recordTimeZoneObservation('tenant-1', '', 1, 'America/New_York');

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('swallows a lost optimistic-concurrency race silently', async () => {
    // Seed history so the conditional path compares :oldHistory.
    item.tzHistory = [{ issue: 1, tz: 'America/New_York' }];

    // Simulate a concurrent writer landing between the read and the write:
    // GetItem returns the seeded history, then the store changes before update.
    const originalHandler = handleCommand;
    mockSend.mockImplementation(async (command) => {
      if (command instanceof GetItemCommand) {
        const snapshot = { Item: marshall(item) };
        item.tzHistory = [{ issue: 1, tz: 'America/New_York' }, { issue: 2, tz: 'Europe/Paris' }];
        return snapshot;
      }
      return originalHandler(command);
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await recordTimeZoneObservation('tenant-1', 'reader@example.com', 3, 'America/New_York');
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();

    // The concurrent writer's history must be intact.
    expect(item.tzHistory).toEqual([
      { issue: 1, tz: 'America/New_York' },
      { issue: 2, tz: 'Europe/Paris' }
    ]);
  });

  it('logs but does not throw on unexpected DynamoDB errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB timeout'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      recordTimeZoneObservation('tenant-1', 'reader@example.com', 1, 'America/New_York')
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to record timezone observation',
      expect.objectContaining({ error: 'DynamoDB timeout' })
    );
    consoleSpy.mockRestore();
  });

  it('exports the streak length used for confirmation', () => {
    expect(TZ_CONFIRMATION_STREAK).toBe(3);
  });
});
