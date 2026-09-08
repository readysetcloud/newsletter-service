import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SettingsProvider, useSettings } from '../SettingsContext';
import { settingsService } from '@/services/settingsService';

vi.mock('@/services/settingsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/settingsService')>();
  return {
    ...actual,
    settingsService: { getSettings: vi.fn(), updateSettings: vi.fn() },
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

const mockedService = vi.mocked(settingsService);

const RESPONSE = {
  success: true as const,
  data: {
    settings: { timezone: 'America/Chicago', defaultSendTime: '09:00' },
    defaults: { timezone: 'UTC', defaultSendTime: '09:00' },
    configured: ['timezone', 'defaultSendTime'],
    updatedAt: '2026-07-25T00:00:00Z',
  },
};

/**
 * Consumers key off the identity of `settings`, not its contents — SettingsPage
 * re-seeds its entire form whenever that object changes, discarding whatever
 * was typed and any validation errors on screen. So identity is part of this
 * context's contract, and these pin it.
 */
describe('SettingsContext settings identity', () => {
  let seen: unknown[] = [];

  /** One entry per identity change, which is what downstream resets key off. */
  function Probe() {
    const { settings, refresh } = useSettings();

    useEffect(() => {
      seen.push(settings);
    }, [settings]);

    return (
      <button type="button" onClick={() => void refresh()}>
        {settings.timezone}
      </button>
    );
  }

  const renderProbe = () =>
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>
    );

  beforeEach(() => {
    vi.clearAllMocks();
    seen = [];
  });

  it('changes once when the load lands, not on every provider render', async () => {
    mockedService.getSettings.mockResolvedValue(RESPONSE);

    renderProbe();

    await waitFor(() =>
      expect(screen.getByRole('button')).toHaveTextContent('America/Chicago')
    );

    // Pre-load fallback, then the loaded settings. The loading flag flipping
    // on and back off in between is not a settings change and must not read as
    // one: it used to mint a fresh object each time, because the substituted
    // browser zone was spread inside the context-value memo.
    expect(seen).toHaveLength(2);
  });

  it('holds the same object across a refresh that returns unchanged settings', async () => {
    // A tenant who has never picked a zone: `configured` omits it, so the
    // provider substitutes the browser's. That substitution is what used to
    // mint a new object on every render, so this is the case that churned
    // hardest — and the common one, since the zone is inferred until someone
    // saves the suggestion.
    mockedService.getSettings.mockResolvedValue({
      ...RESPONSE,
      data: { ...RESPONSE.data, configured: ['defaultSendTime'] },
    });

    renderProbe();

    await waitFor(() => expect(seen).toHaveLength(2));
    const afterLoad = seen[seen.length - 1];

    // A refresh sets isLoading true, then false again. Nothing about the
    // tenant's settings has changed, so nothing downstream should be reset.
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(mockedService.getSettings).toHaveBeenCalledTimes(2));

    expect(seen[seen.length - 1]).toBe(afterLoad);
    expect(seen).toHaveLength(2);
  });
});
