import { calculateScheduleTime } from '../schedule-aggregation.mjs';

describe('schedule-aggregation', () => {
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
});
