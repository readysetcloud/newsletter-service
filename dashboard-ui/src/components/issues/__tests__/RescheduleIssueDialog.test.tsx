import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RescheduleIssueDialog } from '../RescheduleIssueDialog';
import type { Issue } from '@/types/issues';

// The tenant is in Chicago at 09:00, so a bare date and a resolved instant are
// visibly different values — which is the distinction these tests are about.
vi.mock('@/contexts/SettingsContext', async () => {
  const actual = await vi.importActual<typeof import('@/contexts/SettingsContext')>(
    '@/contexts/SettingsContext'
  );
  const settings = { timezone: 'America/Chicago', defaultSendTime: '09:00' };

  return {
    ...actual,
    useTenantSettings: () => settings,
    useTenantDateFormat: () => ({
      timeZone: settings.timezone,
      formatDate: (value: string) => value,
      formatLongDate: (value: string) => value,
      formatTime: (value: string) => value,
      formatDateTime: (value: string) => value,
      timeZoneLabel: () => 'CDT'
    })
  };
});

/** Far enough out that these never collide with the "must be future" guard. */
const SCHEDULED_AT = '2099-08-03T00:00:00.000Z';

const issue = {
  issueNumber: 42,
  subject: 'Issue 42',
  scheduledAt: SCHEDULED_AT
} as Pick<Issue, 'issueNumber' | 'subject' | 'scheduledAt'>;

const renderDialog = (onSubmit = vi.fn().mockResolvedValue(undefined)) => {
  render(
    <RescheduleIssueDialog isOpen onClose={vi.fn()} issue={issue} onSubmit={onSubmit} />
  );
  return onSubmit;
};

const submit = () => fireEvent.click(screen.getByRole('button', { name: /change send time/i }));

describe('RescheduleIssueDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens on the tenant default and sends a bare date so the API resolves it', async () => {
    const onSubmit = renderDialog();

    // The stored instant is midnight UTC, which is the previous evening in
    // Chicago — the date field shows the day the tenant sees.
    expect(screen.getByLabelText('Date')).toHaveValue('2099-08-02');
    // No time input in default mode: the send time is the tenant's setting.
    expect(screen.queryByLabelText('Time of day')).not.toBeInTheDocument();

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('2099-08-02'));
  });

  it('previews the instant a date-only send would land on', () => {
    renderDialog();

    // 09:00 CDT is 14:00Z — the resolution the API will perform, shown before
    // the operator commits to it.
    expect(screen.getByText(/Aug 2, 2099, 9:00\s?AM CDT/)).toBeInTheDocument();
    expect(screen.getByText(/Aug 2, 2099, 2:00\s?PM UTC/)).toBeInTheDocument();
  });

  it('sends a resolved instant when a specific time is picked', async () => {
    const onSubmit = renderDialog();

    fireEvent.click(screen.getByLabelText(/Pick a specific time/i));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2099-08-05' } });
    fireEvent.change(screen.getByLabelText('Time of day'), { target: { value: '18:30' } });

    submit();

    // 18:30 CDT is 23:30Z. A specific time is the caller being specific, so it
    // goes to the API as an instant rather than a date to be resolved.
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith('2099-08-05T23:30:00.000Z')
    );
  });

  it('refuses a send time in the past', async () => {
    const onSubmit = renderDialog();

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-01' } });
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/future/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and shows why when the API refuses', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new Error('Issue 42 is already being prepared to send'));
    renderDialog(onSubmit);

    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/already being prepared/i);
  });
});
