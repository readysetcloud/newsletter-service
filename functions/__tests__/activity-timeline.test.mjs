import { jest } from '@jest/globals';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';

let recordActivity;
let recordOpenHour;
let mockSend;

// Stateful store emulating the subscriber item, including the conditional
// recentActivity equality check the util relies on for optimistic concurrency,
// and the nested-map ValidationException the histogram init pattern handles.
let item; // unmarshalled subscriber item or null

class ConditionalCheckFailedException extends Error {
  constructor() {
    super('The conditional request failed');
    this.name = 'ConditionalCheckFailedException';
  }
}

class ValidationException extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationException';
  }
}

function handleCommand(command) {
  if (command instanceof GetItemCommand) {
    return item ? { Item: marshall(item) } : {};
  }

  if (command instanceof UpdateItemCommand) {
    const values = command.input.ExpressionAttributeValues
      ? unmarshall(command.input.ExpressionAttributeValues)
      : {};
    const expr = command.input.UpdateExpression;
    const condition = command.input.ConditionExpression;

    // ── recentActivity write (Part 1) ──────────────────────────────────
    if (expr.includes('recentActivity = :newActivity')) {
      if (condition === 'attribute_not_exists(recentActivity)') {
        if (item.recentActivity !== undefined) throw new ConditionalCheckFailedException();
      } else if (condition === 'recentActivity = :oldActivity') {
        if (JSON.stringify(item.recentActivity) !== JSON.stringify(values[':oldActivity'])) {
          throw new ConditionalCheckFailedException();
        }
      }
      item.recentActivity = values[':newActivity'];
      return {};
    }

    // ── open-hour histogram init (Part 2) ──────────────────────────────
    if (expr.includes('openHours = if_not_exists(openHours, :emptyMap)')) {
      if (item.openHours === undefined) item.openHours = {};
      return {};
    }

    // ── open-hour histogram increment (Part 2) ─────────────────────────
    if (expr.includes('openHours.#hour')) {
      // DynamoDB rejects a nested SET when the parent map does not exist.
      if (item.openHours === undefined) {
        throw new ValidationException('The document path provided in the update expression is invalid');
      }
      const hourKey = command.input.ExpressionAttributeNames['#hour'];
      item.openHours[hourKey] = (item.openHours[hourKey] || 0) + 1;
      item.openHourTotal = (item.openHourTotal || 0) + 1;
      return {};
    }
  }

  throw new Error(`Unexpected command: ${command?.constructor?.name}`);
}

beforeEach(async () => {
  item = { tenantId: 'tenant-1', email: 'reader@example.com' };
  mockSend = jest.fn(async (command) => handleCommand(command));
  DynamoDBClient.prototype.send = mockSend;
  jest.clearAllMocks();

  const mod = await import('../utils/activity-timeline.mjs');
  ({ recordActivity, recordOpenHour } = mod);
});

describe('recordActivity', () => {
  it('records an open entry (no url) newest-first', async () => {
    await recordActivity('tenant-1', 'reader@example.com', {
      type: 'open',
      issue: 42,
      ts: '2025-01-21T10:30:00.000Z'
    });

    expect(item.recentActivity).toEqual([
      { type: 'open', issue: 42, ts: '2025-01-21T10:30:00.000Z' }
    ]);
  });

  it('records a click entry with its url', async () => {
    await recordActivity('tenant-1', 'reader@example.com', {
      type: 'click',
      issue: 42,
      ts: '2025-01-21T10:30:00.000Z',
      url: 'https://example.com/article'
    });

    expect(item.recentActivity).toEqual([
      { type: 'click', issue: 42, ts: '2025-01-21T10:30:00.000Z', url: 'https://example.com/article' }
    ]);
  });

  it('prepends newer entries so the list stays newest-first', async () => {
    await recordActivity('tenant-1', 'reader@example.com', { type: 'open', issue: 1, ts: '2025-01-01T00:00:00.000Z' });
    await recordActivity('tenant-1', 'reader@example.com', { type: 'click', issue: 2, ts: '2025-01-02T00:00:00.000Z', url: 'https://x.test' });

    expect(item.recentActivity.map((e) => e.issue)).toEqual([2, 1]);
  });

  it('caps the list at 20 entries, dropping the oldest', async () => {
    for (let i = 1; i <= 25; i++) {
      await recordActivity('tenant-1', 'reader@example.com', {
        type: 'open',
        issue: i,
        ts: `2025-01-${String(i).padStart(2, '0')}T00:00:00.000Z`
      });
    }

    expect(item.recentActivity).toHaveLength(20);
    // Newest-first: most recent issue at the front, oldest kept is issue 6.
    expect(item.recentActivity[0].issue).toBe(25);
    expect(item.recentActivity[19].issue).toBe(6);
  });

  it('does not store a url for a click entry that has none', async () => {
    await recordActivity('tenant-1', 'reader@example.com', { type: 'click', issue: 3, ts: '2025-01-03T00:00:00.000Z' });

    expect(item.recentActivity[0]).toEqual({ type: 'click', issue: 3, ts: '2025-01-03T00:00:00.000Z' });
  });

  it('skips unknown subscribers without writing', async () => {
    item = null;
    await recordActivity('tenant-1', 'ghost@example.com', { type: 'open', issue: 1, ts: '2025-01-01T00:00:00.000Z' });

    const updates = mockSend.mock.calls.filter(([cmd]) => cmd instanceof UpdateItemCommand);
    expect(updates).toHaveLength(0);
  });

  it('skips invalid input without any DynamoDB calls', async () => {
    await recordActivity('tenant-1', 'reader@example.com', { type: 'bogus', issue: 1, ts: '2025-01-01T00:00:00.000Z' });
    await recordActivity('tenant-1', 'reader@example.com', { type: 'open', issue: NaN, ts: '2025-01-01T00:00:00.000Z' });
    await recordActivity('tenant-1', 'reader@example.com', { type: 'open', issue: 1 });
    await recordActivity('tenant-1', '', { type: 'open', issue: 1, ts: '2025-01-01T00:00:00.000Z' });
    await recordActivity('tenant-1', 'reader@example.com', null);

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('swallows a lost optimistic-concurrency race silently', async () => {
    item.recentActivity = [{ type: 'open', issue: 1, ts: '2025-01-01T00:00:00.000Z' }];

    const originalHandler = handleCommand;
    mockSend.mockImplementation(async (command) => {
      if (command instanceof GetItemCommand) {
        const snapshot = { Item: marshall(item) };
        item.recentActivity = [
          { type: 'click', issue: 2, ts: '2025-01-02T00:00:00.000Z', url: 'https://x.test' },
          { type: 'open', issue: 1, ts: '2025-01-01T00:00:00.000Z' }
        ];
        return snapshot;
      }
      return originalHandler(command);
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await recordActivity('tenant-1', 'reader@example.com', { type: 'open', issue: 3, ts: '2025-01-03T00:00:00.000Z' });
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();

    // The concurrent writer's list must be intact.
    expect(item.recentActivity.map((e) => e.issue)).toEqual([2, 1]);
  });

  it('logs but does not throw on unexpected DynamoDB errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB timeout'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      recordActivity('tenant-1', 'reader@example.com', { type: 'open', issue: 1, ts: '2025-01-01T00:00:00.000Z' })
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to record subscriber activity',
      expect.objectContaining({ error: 'DynamoDB timeout' })
    );
    consoleSpy.mockRestore();
  });
});

describe('recordOpenHour', () => {
  it('initializes the openHours map and increments on the first open', async () => {
    await recordOpenHour('tenant-1', 'reader@example.com', 10);

    expect(item.openHours).toEqual({ 10: 1 });
    expect(item.openHourTotal).toBe(1);
    // First attempt (ValidationException) + init + retry = 3 sends.
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('increments an existing hour bucket without re-initializing', async () => {
    item.openHours = { 10: 2 };
    item.openHourTotal = 5;

    await recordOpenHour('tenant-1', 'reader@example.com', 10);

    expect(item.openHours['10']).toBe(3);
    expect(item.openHourTotal).toBe(6);
    // No ValidationException path — a single increment call.
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('tracks distinct hour buckets independently', async () => {
    await recordOpenHour('tenant-1', 'reader@example.com', 9);
    await recordOpenHour('tenant-1', 'reader@example.com', 23);
    await recordOpenHour('tenant-1', 'reader@example.com', 9);

    expect(item.openHours).toEqual({ 9: 2, 23: 1 });
    expect(item.openHourTotal).toBe(3);
  });

  it('skips out-of-range or non-integer hours without any DynamoDB calls', async () => {
    await recordOpenHour('tenant-1', 'reader@example.com', -1);
    await recordOpenHour('tenant-1', 'reader@example.com', 24);
    await recordOpenHour('tenant-1', 'reader@example.com', 10.5);
    await recordOpenHour('tenant-1', '', 10);

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('logs but does not throw when the retry also fails', async () => {
    // First increment throws ValidationException (no map yet); make the init fail.
    mockSend
      .mockImplementationOnce(async (command) => handleCommand(command)) // increment → ValidationException
      .mockRejectedValueOnce(new Error('init failed')); // init step fails
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      recordOpenHour('tenant-1', 'reader@example.com', 10)
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to record open hour',
      expect.objectContaining({ error: 'init failed' })
    );
    consoleSpy.mockRestore();
  });
});
