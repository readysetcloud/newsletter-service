import { jest } from '@jest/globals';

const { SchedulerClient, CreateScheduleCommand, UpdateScheduleCommand } = await import('@aws-sdk/client-scheduler');
const { handler, calculateScheduleTime, ensureFutureScheduleTime } = await import('../schedule-aggregation.mjs');

describe('schedule-aggregation', () => {
  let mockSend;
  let originalEnv;

  beforeEach(() => {
    originalEnv = {
      AGGREGATION_FUNCTION_ARN: process.env.AGGREGATION_FUNCTION_ARN,
      SCHEDULER_ROLE_ARN: process.env.SCHEDULER_ROLE_ARN
    };
    process.env.AGGREGATION_FUNCTION_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:aggregate';
    process.env.SCHEDULER_ROLE_ARN = 'arn:aws:iam::123456789012:role/scheduler-role';
    mockSend = jest.fn();
    SchedulerClient.prototype.send = mockSend;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.AGGREGATION_FUNCTION_ARN = originalEnv.AGGREGATION_FUNCTION_ARN;
    process.env.SCHEDULER_ROLE_ARN = originalEnv.SCHEDULER_ROLE_ARN;
  });

  describe('handler', () => {
    test('should read issueNumber and publishedAt from event.detail.data', async () => {
      mockSend.mockResolvedValue({});

      const publishedAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      const event = {
        detail: {
          tenantId: 'tenant-123',
          userId: 'user-456',
          type: 'ISSUE_PUBLISHED',
          data: {
            issueNumber: 42,
            publishedAt,
            title: 'Test Issue'
          }
        }
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      expect(result.scheduleName).toBe('aggregate-tenant-123-42-24h');
      expect(mockSend).toHaveBeenCalledTimes(1);

      const createScheduleCommand = mockSend.mock.calls[0][0];
      expect(createScheduleCommand).toBeInstanceOf(CreateScheduleCommand);
      expect(createScheduleCommand.input.Name).toBe('aggregate-tenant-123-42-24h');
      expect(createScheduleCommand.input.GroupName).toBe('newsletter');
    });

    test('should return 400 when issueNumber is missing', async () => {
      const event = {
        detail: {
          tenantId: 'tenant-123',
          data: {
            publishedAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toBe('Missing required parameters');
      expect(mockSend).not.toHaveBeenCalled();
    });

    test('should return 400 when publishedAt is missing', async () => {
      const event = {
        detail: {
          tenantId: 'tenant-123',
          data: {
            issueNumber: 42
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toBe('Missing required parameters');
      expect(mockSend).not.toHaveBeenCalled();
    });

    test('should return 400 when data object is missing', async () => {
      const event = {
        detail: {
          tenantId: 'tenant-123'
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toBe('Missing required parameters');
      expect(mockSend).not.toHaveBeenCalled();
    });

    test('should return 500 on scheduler error', async () => {
      mockSend.mockRejectedValue(new Error('Scheduler service unavailable'));

      const event = {
        detail: {
          tenantId: 'tenant-123',
          data: {
            issueNumber: 42,
            publishedAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
          }
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).message).toBe('Failed to create schedule');
    });
  });

  describe('calculateScheduleTime', () => {
    test('should calculate 24h schedule time correctly', () => {
      const publishedAt = '2025-01-29T10:00:00.000Z';
      const scheduleTime = calculateScheduleTime(publishedAt, '24h');

      expect(scheduleTime).toBe('2025-01-30T10:00:00');
    });

    test('should calculate 7d schedule time correctly', () => {
      const publishedAt = '2025-01-29T10:00:00.000Z';
      const scheduleTime = calculateScheduleTime(publishedAt, '7d');

      expect(scheduleTime).toBe('2025-02-05T10:00:00');
    });

    test('should calculate 30d schedule time correctly', () => {
      const publishedAt = '2025-01-29T10:00:00.000Z';
      const scheduleTime = calculateScheduleTime(publishedAt, '30d');

      expect(scheduleTime).toBe('2025-02-28T10:00:00');
    });

    test('should handle different time zones', () => {
      const publishedAt = '2025-01-29T23:30:00.000Z';
      const scheduleTime = calculateScheduleTime(publishedAt, '24h');

      expect(scheduleTime).toBe('2025-01-30T23:30:00');
    });

    test('should throw error for unsupported delay', () => {
      const publishedAt = '2025-01-29T10:00:00.000Z';

      expect(() => calculateScheduleTime(publishedAt, '12h')).toThrow('Unsupported delay: 12h');
    });

    test('should remove milliseconds from ISO string', () => {
      const publishedAt = '2025-01-29T10:00:00.123Z';
      const scheduleTime = calculateScheduleTime(publishedAt, '24h');

      expect(scheduleTime).toBe('2025-01-30T10:00:00');
      expect(scheduleTime).not.toContain('.');
    });
  });

  describe('ensureFutureScheduleTime', () => {
    test('should keep future schedule times unchanged', () => {
      const future = new Date(Date.now() + 2 * 60 * 60 * 1000)
        .toISOString()
        .replace(/\.\d{3}Z$/, '');
      const result = ensureFutureScheduleTime(future);
      expect(result).toBe(future);
    });

    test('should bump past schedule times to at least one minute from now', () => {
      const past = '2020-01-01T00:00:00';
      const result = ensureFutureScheduleTime(past);
      const resultTime = new Date(`${result}Z`).getTime();
      const minTime = Date.now() + 60 * 1000;
      expect(resultTime).toBeGreaterThanOrEqual(minTime - 1000);
    });
  });
  describe('Issue Send Completed', () => {
    const completedEvent = (detail) => ({
      'detail-type': 'Issue Send Completed',
      detail: {
        tenantId: 'tenant-123',
        issueNumber: 42,
        recipients: 1450,
        baseAt: '2026-09-21T14:00:00.000Z',
        ...detail
      }
    });

    test('moves the window to 24 hours after delivery finished, not after hand-off', async () => {
      mockSend.mockResolvedValue({});

      const result = await handler(completedEvent());

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);

      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(UpdateScheduleCommand);
      // Same name the hand-off booked, so this replaces that window rather
      // than racing a second aggregation against it.
      expect(command.input.Name).toBe('aggregate-tenant-123-42-24h');

      // Measured from now (completion), not from the issue's base instant -
      // that is the entire point of handling this event.
      const scheduledFor = new Date(`${command.input.ScheduleExpression.slice(3, -1)}Z`).getTime();
      const expected = Date.now() + 24 * 60 * 60 * 1000;
      expect(Math.abs(scheduledFor - expected)).toBeLessThan(60 * 1000);
    });

    test('passes baseAt to the aggregator as its publishedAt input', async () => {
      mockSend.mockResolvedValue({});

      await handler(completedEvent());

      const input = JSON.parse(mockSend.mock.calls[0][0].input.Target.Input);
      expect(input).toEqual({
        tenantId: 'tenant-123',
        issueNumber: 42,
        publishedAt: '2026-09-21T14:00:00.000Z'
      });
    });

    test('creates the schedule when the hand-off never booked one', async () => {
      const notFound = new Error('No schedule');
      notFound.name = 'ResourceNotFoundException';
      mockSend
        .mockRejectedValueOnce(notFound)
        .mockResolvedValueOnce({});

      const result = await handler(completedEvent());

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend.mock.calls[0][0]).toBeInstanceOf(UpdateScheduleCommand);
      expect(mockSend.mock.calls[1][0]).toBeInstanceOf(CreateScheduleCommand);
    });

    test('surfaces a non-missing scheduler failure instead of silently creating', async () => {
      mockSend.mockRejectedValue(new Error('AccessDenied'));

      const result = await handler(completedEvent());

      expect(result.statusCode).toBe(500);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('returns 400 without baseAt, leaving the hand-off window in place', async () => {
      const result = await handler(completedEvent({ baseAt: undefined }));

      expect(result.statusCode).toBe(400);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
