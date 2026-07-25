import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsPage } from '../SettingsPage';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { settingsService } from '@/services/settingsService';

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

function settingsResponse(settings: Settings, updatedAt?: string) {
  return {
    success: true as const,
    data: { settings, defaults: DEFAULTS, ...(updatedAt ? { updatedAt } : {}) },
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
    mockedService.getSettings.mockResolvedValue(settingsResponse(DEFAULTS));

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
        settingsResponse({ timezone: 'America/Chicago', defaultSendTime: '09:00' })
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
    it('previews the URL a specific issue would get', async () => {
      renderPage();

      const field = await screen.findByLabelText<HTMLInputElement>('URL pattern');
      fireEvent.change(field, {
        target: { value: 'https://example.com/newsletter/{{number}}' },
      });

      expect(await screen.findByText('https://example.com/newsletter/128')).toBeInTheDocument();
    });

    it('requires an absolute URL containing the issue number', async () => {
      renderPage();

      const field = await screen.findByLabelText<HTMLInputElement>('URL pattern');

      fireEvent.change(field, { target: { value: '/newsletter/{{number}}' } });
      fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
      expect(await screen.findByText(/full URL starting with https/i)).toBeInTheDocument();

      fireEvent.change(field, { target: { value: 'https://example.com/newsletter' } });
      fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
      expect(await screen.findByText(/Include \{\{number\}\}/)).toBeInTheDocument();

      expect(mockedService.updateSettings).not.toHaveBeenCalled();
    });
  });
});
