import { describe, it, expect, vi, beforeEach } from 'vitest';
import { settingsService, padSendTime, isValidTimeZone } from '../settingsService';
import { apiClient } from '../api';

vi.mock('../api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockedClient = vi.mocked(apiClient);

const successResponse = {
  success: true as const,
  data: {
    settings: { timezone: 'America/Chicago', defaultSendTime: '09:00' },
    defaults: { timezone: 'UTC', defaultSendTime: '09:00' },
    updatedAt: '2026-07-25T00:00:00Z',
  },
};

describe('SettingsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSettings', () => {
    it('reads from /settings', async () => {
      mockedClient.get.mockResolvedValue(successResponse);

      const result = await settingsService.getSettings();

      expect(mockedClient.get).toHaveBeenCalledWith('/settings');
      expect(result).toEqual(successResponse);
    });
  });

  describe('updateSettings', () => {
    it('sends only the settings that were provided', async () => {
      mockedClient.put.mockResolvedValue(successResponse);

      await settingsService.updateSettings({ timezone: 'Europe/London' });

      expect(mockedClient.put).toHaveBeenCalledWith('/settings', { timezone: 'Europe/London' });
    });

    it('normalizes the send time to the canonical zero-padded form', async () => {
      mockedClient.put.mockResolvedValue(successResponse);

      await settingsService.updateSettings({ defaultSendTime: ' 9:05 ' });

      expect(mockedClient.put).toHaveBeenCalledWith('/settings', { defaultSendTime: '09:05' });
    });

    it('turns an empty value into an explicit null so the backend resets it', async () => {
      mockedClient.put.mockResolvedValue(successResponse);

      await settingsService.updateSettings({ timezone: '' });

      expect(mockedClient.put).toHaveBeenCalledWith('/settings', { timezone: null });
    });

    it('passes an explicit null through as a reset', async () => {
      mockedClient.put.mockResolvedValue(successResponse);

      await settingsService.updateSettings({ defaultSendTime: null });

      expect(mockedClient.put).toHaveBeenCalledWith('/settings', { defaultSendTime: null });
    });

    it('rejects an unknown timezone without calling the API', async () => {
      const result = await settingsService.updateSettings({ timezone: 'Not/AZone' });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(mockedClient.put).not.toHaveBeenCalled();
    });

    it('rejects a malformed send time without calling the API', async () => {
      for (const bad of ['9am', '25:00', '09:60', 'noon']) {
        const result = await settingsService.updateSettings({ defaultSendTime: bad });
        expect(result.success, `${bad} should be rejected`).toBe(false);
      }
      expect(mockedClient.put).not.toHaveBeenCalled();
    });

    it('rejects an empty update rather than sending a no-op request', async () => {
      const result = await settingsService.updateSettings({});

      expect(result.success).toBe(false);
      expect(mockedClient.put).not.toHaveBeenCalled();
    });
  });

  describe('padSendTime', () => {
    it('zero-pads the hour', () => {
      expect(padSendTime('9:05')).toBe('09:05');
      expect(padSendTime('09:05')).toBe('09:05');
      expect(padSendTime('23:59')).toBe('23:59');
    });

    it('leaves anything unrecognized alone for the API to reject', () => {
      expect(padSendTime('9am')).toBe('9am');
      expect(padSendTime('')).toBe('');
    });
  });

  describe('isValidTimeZone', () => {
    it('accepts IANA names and rejects everything else', () => {
      expect(isValidTimeZone('America/Chicago')).toBe(true);
      expect(isValidTimeZone('UTC')).toBe(true);
      expect(isValidTimeZone('Not/AZone')).toBe(false);
      expect(isValidTimeZone('CST')).toBe(false);
    });
  });
});
