import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsPage } from '../SettingsPage';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { settingsService } from '@/services/settingsService';

/**
 * CI runs in UTC, which is also the server-side default for an unset zone — so
 * a real browser zone is stubbed in, otherwise the substitution tests below
 * would pass without proving anything.
 */
const BROWSER_TIME_ZONE = 'America/Chicago';
vi.mock('@/utils/dateFormatting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/dateFormatting')>()),
  getBrowserTimeZone: () => BROWSER_TIME_ZONE,
}));

vi.mock('@/services/settingsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/settingsService')>();
  return {
    ...actual,
    settingsService: {
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
    },
  };
});

const mockAddToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

// The provider only fetches for a signed-in user.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

const mockedService = vi.mocked(settingsService);

const DEFAULTS = { timezone: 'UTC', defaultSendTime: '09:00' };

type Settings = {
  timezone: string;
  defaultSendTime: string;
  subjectTemplate?: string;
  issueUrlPattern?: string;
};

/**
 * Mirrors the backend: `configured` lists the settings actually present on the
 * record, which is what tells the UI a value was chosen rather than inherited.
 */
function settingsResponse(settings: Settings, updatedAt?: string, configured?: string[]) {
  return {
    success: true as const,
    data: {
      settings,
      defaults: DEFAULTS,
      configured: configured ?? (Object.keys(settings) as string[]),
      ...(updatedAt ? { updatedAt } : {}),
    },
  };
}

function renderPage() {
  return render(
    <SettingsProvider>
      <SettingsPage />
    </SettingsProvider>
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedService.getSettings.mockResolvedValue(
      settingsResponse({ timezone: 'America/Chicago', defaultSendTime: '09:00' }, '2026-07-25T00:00:00Z')
    );
  });

  it('shows the tenant’s saved timezone and send time', async () => {
    renderPage();

    const timezone = await screen.findByLabelText<HTMLSelectElement>('Newsletter timezone');
    await waitFor(() => expect(timezone.value).toBe('America/Chicago'));

    const sendTime = screen.getByLabelText<HTMLInputElement>('Time of day');
    expect(sendTime.value).toBe('09:00');
  });

  it('says when a value is only inherited from the system default', async () => {
    mockedService.getSettings.mockResolvedValue(settingsResponse(DEFAULTS, undefined, []));

    renderPage();

    expect(
      await screen.findByText(/These settings have never been saved/i)
    ).toBeInTheDocument();
  });

  it('previews where a date-only send would land in both zones', async () => {
    renderPage();

    // 09:00 Chicago, shown alongside the same instant in UTC so the effect of
    // the zone choice is visible.
    await waitFor(() => {
      expect(screen.getByText(/9:00 AM (CDT|CST)/)).toBeInTheDocument();
    });
    expect(screen.getByText(/would send at/i)).toBeInTheDocument();
  });

  it('saves both settings and reports success', async () => {
    mockedService.updateSettings.mockResolvedValue(
      settingsResponse({ timezone: 'Europe/London', defaultSendTime: '07:30' }, '2026-07-26T00:00:00Z')
    );

    renderPage();

    const timezone = await screen.findByLabelText<HTMLSelectElement>('Newsletter timezone');
    await waitFor(() => expect(timezone.value).toBe('America/Chicago'));

    fireEvent.change(timezone, { target: { value: 'Europe/London' } });
    fireEvent.change(screen.getByLabelText('Time of day'), { target: { value: '07:30' } });

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(mockedService.updateSettings).toHaveBeenCalledWith({
        timezone: 'Europe/London',
        defaultSendTime: '07:30',
        subjectTemplate: '',
        issueUrlPattern: '',
      });
    });
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' })
    );
  });

  it('keeps save disabled until something actually changes', async () => {
    renderPage();

    const timezone = await screen.findByLabelText<HTMLSelectElement>('Newsletter timezone');
    await waitFor(() => expect(timezone.value).toBe('America/Chicago'));

    const save = screen.getByRole('button', { name: /save settings/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Time of day'), { target: { value: '10:00' } });
    expect(save).toBeEnabled();
  });

  it('applies a send-time preset', async () => {
    renderPage();

    const sendTime = await screen.findByLabelText<HTMLInputElement>('Time of day');
    await waitFor(() => expect(sendTime.value).toBe('09:00'));

    fireEvent.click(screen.getByRole('button', { name: '6:00 AM' }));

    expect(screen.getByLabelText<HTMLInputElement>('Time of day').value).toBe('06:00');
  });

  it('discards edits back to what is saved', async () => {
    renderPage();

    const sendTime = await screen.findByLabelText<HTMLInputElement>('Time of day');
    await waitFor(() => expect(sendTime.value).toBe('09:00'));

    fireEvent.change(sendTime, { target: { value: '11:11' } });
    expect(sendTime.value).toBe('11:11');

    fireEvent.click(screen.getByRole('button', { name: /discard changes/i }));
    expect(screen.getByLabelText<HTMLInputElement>('Time of day').value).toBe('09:00');
  });

  it('surfaces a save failure without losing the edit', async () => {
    mockedService.updateSettings.mockResolvedValue({
      success: false,
      error: 'Tenant access required',
    });

    renderPage();

    const sendTime = await screen.findByLabelText<HTMLInputElement>('Time of day');
    await waitFor(() => expect(sendTime.value).toBe('09:00'));

    fireEvent.change(sendTime, { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
    expect(screen.getByLabelText<HTMLInputElement>('Time of day').value).toBe('10:00');
  });

  it('reports a failed load with a retry', async () => {
    mockedService.getSettings.mockResolvedValue({
      success: false,
      error: 'Network error',
    });

    renderPage();

    expect(await screen.findByText(/Could not load settings/i)).toBeInTheDocument();
  });

  describe('subject line format', () => {
    it('shows the saved template and previews a rendered subject', async () => {
      mockedService.getSettings.mockResolvedValue(
        settingsResponse(
          {
            timezone: 'America/Chicago',
            defaultSendTime: '09:00',
            subjectTemplate: '{{title}} | Weekly #{{number}}',
          },
          '2026-07-25T00:00:00Z'
        )
      );

      renderPage();

      const field = await screen.findByLabelText<HTMLInputElement>('Format');
      await waitFor(() => expect(field.value).toBe('{{title}} | Weekly #{{number}}'));
      expect(screen.getByText(/Serverless Patterns That Scale \| Weekly #128/)).toBeInTheDocument();
    });

    it('rejects an unsupported placeholder before saving', async () => {
      renderPage();

      const field = await screen.findByLabelText<HTMLInputElement>('Format');
      fireEvent.change(field, { target: { value: '{{title}} from {{brand}}' } });
      fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

      expect(await screen.findByText(/\{\{brand\}\} isn't available/)).toBeInTheDocument();
      expect(mockedService.updateSettings).not.toHaveBeenCalled();
    });

    it('sends an empty template to clear it', async () => {
      mockedService.getSettings.mockResolvedValue(
        settingsResponse(
          {
            timezone: 'America/Chicago',
            defaultSendTime: '09:00',
            subjectTemplate: '{{title}}',
          },
          '2026-07-25T00:00:00Z'
        )
      );
      mockedService.updateSettings.mockResolvedValue(
        settingsResponse({ timezone: 'America/Chicago', defaultSendTime: '09:00' }, undefined, [
          'timezone',
          'defaultSendTime',
        ])
      );

      renderPage();

      const field = await screen.findByLabelText<HTMLInputElement>('Format');
      await waitFor(() => expect(field.value).toBe('{{title}}'));

      fireEvent.change(field, { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

      await waitFor(() => {
        expect(mockedService.updateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ subjectTemplate: '' })
        );
      });
    });
  });

  describe('issue URL', () => {
    /**
     * Every keystroke here re-renders the whole page, and that includes the
     * timezone `<select>` with one option per IANA zone — several hundred
     * nodes rebuilt in jsdom for a change to an unrelated field. It takes
     * ~110ms on an idle machine, comfortably inside the 1s default, but this
     * suite runs 105 files in parallel on a shared runner and the margin is
     * not as large as it looks: this assertion timed out in CI while passing
     * on every developer machine.
     *
     * The wait is longer rather than the assertion weaker — the preview still
     * has to appear with exactly the right URL, it is just given room to.
     */
    const RENDER_TIMEOUT = { timeout: 5000 };

    it('previews the URL a specific issue would get', async () => {
      renderPage();

      const field = await screen.findByLabelText<HTMLInputElement>('URL pattern');
      fireEvent.change(field, {
        target: { value: 'https://example.com/newsletter/{{number}}' },
      });

      expect(
        await screen.findByText('https://example.com/newsletter/128', undefined, RENDER_TIMEOUT)
      ).toBeInTheDocument();
    });

    it('requires an absolute URL containing the issue number', async () => {
      renderPage();

      const field = await screen.findByLabelText<HTMLInputElement>('URL pattern');

      fireEvent.change(field, { target: { value: '/newsletter/{{number}}' } });
      fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
      expect(
        await screen.findByText(/full URL starting with https/i, undefined, RENDER_TIMEOUT)
      ).toBeInTheDocument();

      fireEvent.change(field, { target: { value: 'https://example.com/newsletter' } });
      fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
      expect(
        await screen.findByText(/Include \{\{number\}\}/, undefined, RENDER_TIMEOUT)
      ).toBeInTheDocument();

      expect(mockedService.updateSettings).not.toHaveBeenCalled();
    });
  });

  describe('unconfigured timezone', () => {
    const unconfigured = () =>
      mockedService.getSettings.mockResolvedValue(
        settingsResponse({ timezone: 'UTC', defaultSendTime: '09:00' }, undefined, [])
      );

    it("suggests the browser's timezone instead of the server default", async () => {
      // The server can't know where anyone is, so an unset zone comes back as
      // UTC. The browser does know, and one Save turns the guess into a real
      // setting.
      unconfigured();

      renderPage();

      const timezone = await screen.findByLabelText<HTMLSelectElement>('Newsletter timezone');
      await waitFor(() => expect(timezone.value).toBe(BROWSER_TIME_ZONE));
    });

    it('says the zone was detected rather than chosen', async () => {
      unconfigured();

      renderPage();

      expect(await screen.findByText(/Detected from your browser/i)).toBeInTheDocument();
    });

    it('saves the detected zone as the tenant choice', async () => {
      unconfigured();
      mockedService.updateSettings.mockResolvedValue(
        settingsResponse({ timezone: BROWSER_TIME_ZONE, defaultSendTime: '09:00' })
      );

      renderPage();

      const timezone = await screen.findByLabelText<HTMLSelectElement>('Newsletter timezone');
      await waitFor(() => expect(timezone.value).toBe(BROWSER_TIME_ZONE));

      fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

      await waitFor(() => {
        expect(mockedService.updateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ timezone: BROWSER_TIME_ZONE })
        );
      });
    });

    it('offers to save the suggestion without further edits', async () => {
      // The form is meaningfully ahead of what's stored, so Save is live.
      unconfigured();

      renderPage();

      await screen.findByLabelText('Newsletter timezone');
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /save settings/i })).toBeEnabled()
      );
    });

    it('leaves a zone the tenant did choose alone', async () => {
      mockedService.getSettings.mockResolvedValue(
        settingsResponse({ timezone: 'UTC', defaultSendTime: '09:00' }, '2026-07-25T00:00:00Z', [
          'timezone',
        ])
      );

      renderPage();

      // An explicit UTC is a choice, not an absent value to override.
      const timezone = await screen.findByLabelText<HTMLSelectElement>('Newsletter timezone');
      await waitFor(() => expect(timezone.value).toBe('UTC'));
      expect(screen.queryByText(/Detected from your browser/i)).not.toBeInTheDocument();
    });
  });

  describe('mobile layout', () => {
    it('gives the send-time presets a 44px touch target', async () => {
      renderPage();

      const preset = await screen.findByRole('button', { name: '6:00 AM' });
      expect(preset.className).toContain('min-h-[44px]');
    });

    it('stacks the actions full-width on small screens only', async () => {
      renderPage();

      const save = await screen.findByRole('button', { name: /save settings/i });
      const discard = screen.getByRole('button', { name: /discard changes/i });

      for (const button of [save, discard]) {
        expect(button.className).toContain('w-full');
        expect(button.className).toContain('sm:w-auto');
      }

      // Reversed column order puts the primary action above the secondary one
      // on a phone, where the thumb reaches the bottom of the screen first.
      expect(save.parentElement?.className).toContain('flex-col-reverse');
      expect(save.parentElement?.className).toContain('sm:flex-row');
    });

    it('tightens card padding below the sm breakpoint', async () => {
      renderPage();

      const heading = await screen.findByRole('heading', { name: 'Timezone' });
      const card = heading.closest('div.p-4');

      expect(card).not.toBeNull();
      expect(card!.className).toContain('sm:p-6');
    });
  });
});
