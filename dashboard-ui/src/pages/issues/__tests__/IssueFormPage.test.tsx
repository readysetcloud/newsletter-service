import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { IssueFormPage } from '../IssueFormPage';
import { issuesService } from '@/services/issuesService';
import { templateService } from '@/services/templateService';
import { subscriberService } from '@/services/subscriberService';
import { settingsService } from '@/services/settingsService';
import { SettingsProvider } from '@/contexts/SettingsContext';

vi.mock('@/services/issuesService', () => ({
  issuesService: {
    createIssue: vi.fn(),
    updateIssue: vi.fn(),
    getIssue: vi.fn(),
  },
}));

vi.mock('@/services/templateService', () => ({
  templateService: {
    listTemplates: vi.fn(),
    getTemplate: vi.fn(),
  },
}));

vi.mock('@/services/subscriberService', () => ({
  subscriberService: {
    getTimeZoneCoverage: vi.fn(),
  },
}));

const mockNavigate = vi.fn();
// Default is create mode ({}); edit-mode tests set an id and must reset it.
let mockParams: Record<string, string> = {};
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => mockParams,
  // The schedule field links to Settings; render it as a plain anchor so these
  // tests don't need a Router.
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const mockAddToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

// Only the tenant-timezone block below renders a SettingsProvider; everywhere
// else these mocks are inert and the form falls back to UTC as before.
vi.mock('@/services/settingsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/settingsService')>()),
  settingsService: { getSettings: vi.fn(), updateSettings: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

// MDXEditor (lexical) is too heavy for jsdom; replace the wrapper with a plain
// textarea that preserves the value/onChange contract the form relies on.
vi.mock('@/components/issues/MarkdownWysiwygEditor', () => ({
  MarkdownWysiwygEditor: ({
    value,
    onChange,
    id,
  }: {
    value: string;
    onChange: (v: string) => void;
    id?: string;
  }) => (
    <textarea
      data-testid="wysiwyg"
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

// Every non-html issue has to name a template now — there is no built-in layout
// left to fall back on — so the picker is part of a completable form, and the
// blocks below that are about something else still have to answer it.
const templateOptions = {
  success: true as const,
  data: {
    total: 1,
    templates: [
      {
        templateId: 'tmpl-1',
        name: 'Weekly Template',
        version: 1,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ],
  },
};

const selectTemplate = async () => {
  await waitFor(() => {
    expect(screen.getByRole('option', { name: 'Weekly Template' })).toBeInTheDocument();
  });
  fireEvent.change(screen.getByLabelText(/template \*/i), { target: { value: 'tmpl-1' } });
};

describe('IssueFormPage authoring modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParams = {};
    vi.mocked(templateService.listTemplates).mockResolvedValue(templateOptions);
  });

  it('defaults to markdown mode and creates a markdown issue', async () => {
    vi.mocked(issuesService.createIssue).mockResolvedValue({
      success: true,
      data: { id: '1' } as never,
    });

    render(<IssueFormPage />);

    fireEvent.change(screen.getByPlaceholderText('Enter issue subject'), {
      target: { value: 'Hello World' },
    });
    fireEvent.change(screen.getByTestId('wysiwyg'), {
      target: { value: '# My content' },
    });

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Weekly Template' })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/template \*/i), { target: { value: 'tmpl-1' } });

    fireEvent.click(screen.getByRole('button', { name: /create new issue/i }));

    await waitFor(() => {
      expect(issuesService.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Hello World',
          content: '# My content',
          contentType: 'markdown',
          templateId: 'tmpl-1',
        })
      );
    });
  });

  // Markdown used to be sendable with no template, rendering against a static
  // default bundled with the publish Lambda. That default is gone — the API
  // returns a 400 and the send fails — so the form has to ask for a template
  // here rather than let the author find out at send time.
  it('requires a template in markdown mode', async () => {
    render(<IssueFormPage />);

    fireEvent.change(screen.getByPlaceholderText('Enter issue subject'), {
      target: { value: 'Hello World' },
    });
    fireEvent.change(screen.getByTestId('wysiwyg'), {
      target: { value: '# My content' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create new issue/i }));

    await waitFor(() => {
      expect(screen.getByText(/select a template to render this issue/i)).toBeInTheDocument();
    });
    expect(issuesService.createIssue).not.toHaveBeenCalled();
  });

  it('requires a template when switching to JSON mode', async () => {
    render(<IssueFormPage />);

    fireEvent.change(screen.getByPlaceholderText('Enter issue subject'), {
      target: { value: 'JSON Issue' },
    });

    // Switch to Template + JSON mode.
    fireEvent.click(screen.getByRole('radio', { name: /template \+ json/i }));

    // Provide valid JSON but no template selected.
    const jsonEditor = await screen.findByLabelText(/template data \(json\)/i);
    fireEvent.change(jsonEditor, { target: { value: '{"metadata": {"title": "x"}}' } });

    fireEvent.click(screen.getByRole('button', { name: /create new issue/i }));

    await waitFor(() => {
      expect(screen.getByText(/select a template to render the json data/i)).toBeInTheDocument();
    });
    expect(issuesService.createIssue).not.toHaveBeenCalled();
  });

  it('creates a json issue with the selected template', async () => {
    vi.mocked(issuesService.createIssue).mockResolvedValue({
      success: true,
      data: { id: '2' } as never,
    });

    render(<IssueFormPage />);

    fireEvent.change(screen.getByPlaceholderText('Enter issue subject'), {
      target: { value: 'JSON Issue' },
    });

    fireEvent.click(screen.getByRole('radio', { name: /template \+ json/i }));

    // Select the template (the picker is required in json mode).
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Weekly Template' })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/template \*/i), { target: { value: 'tmpl-1' } });

    const jsonEditor = screen.getByLabelText(/template data \(json\)/i);
    fireEvent.change(jsonEditor, { target: { value: '{"metadata": {"title": "x"}}' } });

    fireEvent.click(screen.getByRole('button', { name: /create new issue/i }));

    await waitFor(() => {
      expect(issuesService.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'JSON Issue',
          contentType: 'json',
          templateId: 'tmpl-1',
          content: '{"metadata": {"title": "x"}}',
        })
      );
    });
  });

  it('blocks invalid JSON in json mode', async () => {
    render(<IssueFormPage />);

    fireEvent.change(screen.getByPlaceholderText('Enter issue subject'), {
      target: { value: 'JSON Issue' },
    });
    fireEvent.click(screen.getByRole('radio', { name: /template \+ json/i }));

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Weekly Template' })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/template \*/i), { target: { value: 'tmpl-1' } });

    const jsonEditor = screen.getByLabelText(/template data \(json\)/i);
    fireEvent.change(jsonEditor, { target: { value: 'not json' } });

    fireEvent.click(screen.getByRole('button', { name: /create new issue/i }));

    await waitFor(() => {
      expect(screen.getByText(/template data must be valid json/i)).toBeInTheDocument();
    });
    expect(issuesService.createIssue).not.toHaveBeenCalled();
  });
});

describe('IssueFormPage local send', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParams = {};
    vi.mocked(templateService.listTemplates).mockResolvedValue(templateOptions);
    vi.mocked(issuesService.createIssue).mockResolvedValue({
      success: true,
      data: { id: '1' } as never,
    });
    vi.mocked(subscriberService.getTimeZoneCoverage).mockResolvedValue({
      success: true,
      data: { totalSubscribers: 200, confirmedTimeZone: 50, peakHourEligible: 120 },
    });
  });

  const fillRequiredFields = async () => {
    fireEvent.change(screen.getByPlaceholderText('Enter issue subject'), {
      target: { value: 'Issue with local send' },
    });
    fireEvent.change(screen.getByTestId('wysiwyg'), {
      target: { value: '# Content' },
    });
    await selectTemplate();
  };

  it('omits localSend when the toggle is off', async () => {
    render(<IssueFormPage />);
    await fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: /create new issue/i }));

    await waitFor(() => {
      expect(issuesService.createIssue).toHaveBeenCalled();
    });
    const payload = vi.mocked(issuesService.createIssue).mock.calls[0][0];
    expect(payload.localSend).toBeUndefined();
  });

  it('sends localSend with the chosen default timezone when enabled', async () => {
    render(<IssueFormPage />);
    await fillRequiredFields();

    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));

    const timezoneSelect = await screen.findByRole('combobox', { name: 'Default timezone' });
    fireEvent.change(timezoneSelect, { target: { value: 'America/Chicago' } });

    fireEvent.click(screen.getByRole('button', { name: /create new issue/i }));

    await waitFor(() => {
      expect(issuesService.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          localSend: { enabled: true, defaultTimeZone: 'America/Chicago', mode: 'timezone' },
        })
      );
    });
  });

  it('hides the timezone picker until local send is enabled', () => {
    render(<IssueFormPage />);

    expect(screen.queryByRole('combobox', { name: 'Default timezone' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));
    expect(screen.getByRole('combobox', { name: 'Default timezone' })).toBeInTheDocument();
  });

  it('hides the delivery-time mode radios until local send is enabled', () => {
    render(<IssueFormPage />);

    expect(
      screen.queryByRole('radio', { name: /at the scheduled time in their timezone/i })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));

    // Timezone mode is preselected.
    expect(
      screen.getByRole('radio', { name: /at the scheduled time in their timezone/i })
    ).toBeChecked();
    expect(
      screen.getByRole('radio', { name: /personal best hour/i })
    ).not.toBeChecked();
  });

  it('persists peak-hour mode when the personal best hour option is selected', async () => {
    render(<IssueFormPage />);
    await fillRequiredFields();

    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));
    fireEvent.click(screen.getByRole('radio', { name: /personal best hour/i }));

    fireEvent.click(screen.getByRole('button', { name: /create new issue/i }));

    await waitFor(() => {
      expect(issuesService.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          localSend: expect.objectContaining({ enabled: true, mode: 'peak-hour' }),
        })
      );
    });
  });

  it('does not fetch coverage until local send is enabled', async () => {
    render(<IssueFormPage />);

    expect(subscriberService.getTimeZoneCoverage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));

    await waitFor(() => {
      expect(subscriberService.getTimeZoneCoverage).toHaveBeenCalledTimes(1);
    });
  });

  it('fetches coverage once across repeated toggles and mode switches', async () => {
    render(<IssueFormPage />);

    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));
    await waitFor(() => {
      expect(subscriberService.getTimeZoneCoverage).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));
    fireEvent.click(screen.getByRole('radio', { name: /personal best hour/i }));

    await waitFor(() => {
      expect(screen.getByText(/have enough opens for a peak hour/i)).toBeInTheDocument();
    });
    expect(subscriberService.getTimeZoneCoverage).toHaveBeenCalledTimes(1);
  });

  it('still shows coverage when the toggle is switched off and on mid-request', async () => {
    // Regression: cleanup runs on every localSendEnabled change, not just on
    // unmount. Discarding the in-flight response on toggle-off used to strand
    // the one-shot guard — re-enabling never retried, so the box sat on
    // "Checking audience coverage…" for the rest of the session.
    let resolveCoverage: (value: never) => void;
    vi.mocked(subscriberService.getTimeZoneCoverage).mockReturnValue(
      new Promise((resolve) => {
        resolveCoverage = resolve as (value: never) => void;
      })
    );

    render(<IssueFormPage />);

    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));
    await waitFor(() => {
      expect(subscriberService.getTimeZoneCoverage).toHaveBeenCalledTimes(1);
    });

    // Off and back on while the request is still outstanding.
    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));

    await act(async () => {
      resolveCoverage!({
        success: true,
        data: { totalSubscribers: 200, confirmedTimeZone: 50, peakHourEligible: 120 },
      } as never);
    });

    expect(await screen.findByText(/50 of 200 subscribers/i)).toBeInTheDocument();
    expect(screen.queryByText(/Checking audience coverage/i)).not.toBeInTheDocument();
    expect(subscriberService.getTimeZoneCoverage).toHaveBeenCalledTimes(1);
  });

  it('reports timezone coverage and who falls back for timezone mode', async () => {
    render(<IssueFormPage />);

    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));

    // 50 of 200 confirmed = 25%; the other 150 send at the default zone's time.
    expect(await screen.findByText(/50 of 200 subscribers/i)).toBeInTheDocument();
    expect(screen.getByText(/have a detected timezone/i)).toBeInTheDocument();
    expect(screen.getByText(/The other 150 receive the issue/i)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /coverage/i })).toHaveAttribute(
      'aria-valuenow',
      '25'
    );
  });

  it('switches the coverage figure to the open histogram in peak-hour mode', async () => {
    render(<IssueFormPage />);

    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));
    await screen.findByText(/50 of 200 subscribers/i);

    fireEvent.click(screen.getByRole('radio', { name: /personal best hour/i }));

    // 120 of 200 eligible = 60%, a different audience than the confirmed zones.
    expect(await screen.findByText(/120 of 200 subscribers/i)).toBeInTheDocument();
    expect(screen.getByText(/have enough opens for a peak hour/i)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /coverage/i })).toHaveAttribute(
      'aria-valuenow',
      '60'
    );
  });

  it('omits the fallback sentence when every subscriber can be placed', async () => {
    vi.mocked(subscriberService.getTimeZoneCoverage).mockResolvedValue({
      success: true,
      data: { totalSubscribers: 80, confirmedTimeZone: 80, peakHourEligible: 80 },
    });
    render(<IssueFormPage />);

    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));

    expect(await screen.findByText(/80 of 80 subscribers/i)).toBeInTheDocument();
    expect(screen.queryByText(/receive the issue at the scheduled time/i)).not.toBeInTheDocument();
  });

  it('stays silent rather than showing a percentage of an empty list', async () => {
    vi.mocked(subscriberService.getTimeZoneCoverage).mockResolvedValue({
      success: true,
      data: { totalSubscribers: 0, confirmedTimeZone: 0, peakHourEligible: 0 },
    });
    render(<IssueFormPage />);

    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));

    await waitFor(() => {
      expect(subscriberService.getTimeZoneCoverage).toHaveBeenCalled();
    });
    expect(screen.queryByRole('progressbar', { name: /coverage/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/subscribers have/i)).not.toBeInTheDocument();
  });

  it('leaves the toggle usable when the coverage lookup fails', async () => {
    vi.mocked(subscriberService.getTimeZoneCoverage).mockResolvedValue({
      success: false,
      error: 'boom',
    });
    render(<IssueFormPage />);
    await fillRequiredFields();

    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));

    await waitFor(() => {
      expect(subscriberService.getTimeZoneCoverage).toHaveBeenCalled();
    });
    expect(screen.queryByRole('progressbar', { name: /coverage/i })).not.toBeInTheDocument();

    // Coverage is advisory — a failed lookup must not block configuring a send.
    fireEvent.click(screen.getByRole('button', { name: /create new issue/i }));
    await waitFor(() => {
      expect(issuesService.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ localSend: expect.objectContaining({ enabled: true }) })
      );
    });
  });

  it('switching back to timezone mode persists mode timezone', async () => {
    render(<IssueFormPage />);
    await fillRequiredFields();

    fireEvent.click(screen.getByRole('checkbox', { name: /local send/i }));
    fireEvent.click(screen.getByRole('radio', { name: /personal best hour/i }));
    fireEvent.click(screen.getByRole('radio', { name: /at the scheduled time in their timezone/i }));

    fireEvent.click(screen.getByRole('button', { name: /create new issue/i }));

    await waitFor(() => {
      expect(issuesService.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          localSend: expect.objectContaining({ mode: 'timezone' }),
        })
      );
    });
  });
});

describe('IssueFormPage personalized section order (contentAssembly)', () => {
  const baseIssue = {
    id: '5',
    issueNumber: 5,
    subject: 'Existing Issue',
    content: '# Existing content',
    status: 'draft' as const,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    templateId: 'tmpl-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockParams = {};
    vi.mocked(templateService.listTemplates).mockResolvedValue(templateOptions);
  });

  it('creates an issue with contentAssembly when the checkbox is ticked', async () => {
    vi.mocked(issuesService.createIssue).mockResolvedValue({
      success: true,
      data: { id: '1' } as never,
    });

    render(<IssueFormPage />);

    fireEvent.change(screen.getByPlaceholderText('Enter issue subject'), {
      target: { value: 'Personalized Issue' },
    });
    fireEvent.change(screen.getByTestId('wysiwyg'), {
      target: { value: '# Content' },
    });
    await selectTemplate();
    fireEvent.click(screen.getByRole('checkbox', { name: /personalized section order/i }));

    fireEvent.click(screen.getByRole('button', { name: /create new issue/i }));

    await waitFor(() => {
      expect(issuesService.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ contentAssembly: { enabled: true } })
      );
    });
  });

  it('omits contentAssembly on create when the checkbox is left unchecked', async () => {
    vi.mocked(issuesService.createIssue).mockResolvedValue({
      success: true,
      data: { id: '1' } as never,
    });

    render(<IssueFormPage />);

    // The section explains the behavior inline.
    expect(
      screen.getByText(/readers see the sections matching their interests first/i)
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Enter issue subject'), {
      target: { value: 'Plain Issue' },
    });
    fireEvent.change(screen.getByTestId('wysiwyg'), {
      target: { value: '# Content' },
    });
    await selectTemplate();

    fireEvent.click(screen.getByRole('button', { name: /create new issue/i }));

    await waitFor(() => {
      expect(issuesService.createIssue).toHaveBeenCalled();
    });
    const payload = vi.mocked(issuesService.createIssue).mock.calls[0][0];
    expect('contentAssembly' in payload).toBe(false);
  });

  it('hydrates the checkbox from a saved contentAssembly config in edit mode', async () => {
    mockParams = { id: '5' };
    vi.mocked(issuesService.getIssue).mockResolvedValue({
      success: true,
      data: { ...baseIssue, contentAssembly: { enabled: true } } as never,
    });

    render(<IssueFormPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('checkbox', { name: /personalized section order/i })
      ).toBeChecked();
    });
  });

  it('sends an explicit null to clear a previously-saved config when unchecked', async () => {
    mockParams = { id: '5' };
    vi.mocked(issuesService.getIssue).mockResolvedValue({
      success: true,
      data: { ...baseIssue, contentAssembly: { enabled: true } } as never,
    });
    vi.mocked(issuesService.updateIssue).mockResolvedValue({
      success: true,
      data: baseIssue as never,
    });

    render(<IssueFormPage />);

    const checkbox = await screen.findByRole('checkbox', { name: /personalized section order/i });
    await waitFor(() => expect(checkbox).toBeChecked());

    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /update issue/i }));

    await waitFor(() => {
      expect(issuesService.updateIssue).toHaveBeenCalledWith(
        '5',
        expect.objectContaining({ contentAssembly: null })
      );
    });
  });

  it('persists contentAssembly on update when enabling it for an existing issue', async () => {
    mockParams = { id: '5' };
    vi.mocked(issuesService.getIssue).mockResolvedValue({
      success: true,
      data: baseIssue as never,
    });
    vi.mocked(issuesService.updateIssue).mockResolvedValue({
      success: true,
      data: baseIssue as never,
    });

    render(<IssueFormPage />);

    const checkbox = await screen.findByRole('checkbox', { name: /personalized section order/i });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /update issue/i }));

    await waitFor(() => {
      expect(issuesService.updateIssue).toHaveBeenCalledWith(
        '5',
        expect.objectContaining({ contentAssembly: { enabled: true } })
      );
    });
  });

  it('omits contentAssembly on update when it was never saved and stays unchecked', async () => {
    mockParams = { id: '5' };
    vi.mocked(issuesService.getIssue).mockResolvedValue({
      success: true,
      data: baseIssue as never,
    });
    vi.mocked(issuesService.updateIssue).mockResolvedValue({
      success: true,
      data: baseIssue as never,
    });

    render(<IssueFormPage />);

    await screen.findByRole('checkbox', { name: /personalized section order/i });

    fireEvent.change(screen.getByPlaceholderText('Enter issue subject'), {
      target: { value: 'Renamed Issue' },
    });
    fireEvent.click(screen.getByRole('button', { name: /update issue/i }));

    await waitFor(() => {
      expect(issuesService.updateIssue).toHaveBeenCalled();
    });
    const payload = vi.mocked(issuesService.updateIssue).mock.calls[0][1];
    expect('contentAssembly' in payload).toBe(false);
  });
});

describe('IssueFormPage tenant timezone', () => {
  const scheduledIssue = {
    id: '5',
    issueNumber: 5,
    subject: 'Existing Issue',
    content: '# Existing content',
    status: 'draft' as const,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    // 09:00 in Chicago, 14:00 in UTC — the two render differently, so which
    // zone the form used is visible in the field.
    scheduledAt: '2026-08-01T14:00:00Z',
  };

  const chicagoSettings = {
    success: true as const,
    data: {
      settings: { timezone: 'America/Chicago', defaultSendTime: '09:00' },
      defaults: { timezone: 'UTC', defaultSendTime: '09:00' },
      configured: ['timezone', 'defaultSendTime'],
      updatedAt: '2026-07-25T00:00:00Z',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockParams = { id: '5' };
    vi.mocked(templateService.listTemplates).mockResolvedValue(templateOptions);
    vi.mocked(issuesService.getIssue).mockResolvedValue({
      success: true,
      data: scheduledIssue as never,
    });
  });

  const renderWithSettings = () =>
    render(
      <SettingsProvider>
        <IssueFormPage />
      </SettingsProvider>
    );

  it('fetches the issue once even though settings arrive afterwards', async () => {
    // The timezone landing late changes the date formatter, which used to
    // change `loadIssue` and re-run the load effect: a second GET that reset
    // the form and could race the first response.
    let releaseSettings: (value: unknown) => void = () => {};
    vi.mocked(settingsService.getSettings).mockReturnValue(
      new Promise((resolve) => {
        releaseSettings = resolve;
      }) as never
    );

    renderWithSettings();

    const field = await screen.findByLabelText<HTMLInputElement>(/schedule publication/i);
    await waitFor(() => expect(field.value).toBe('2026-08-01T14:00'));
    expect(issuesService.getIssue).toHaveBeenCalledTimes(1);

    releaseSettings(chicagoSettings);

    await waitFor(() => expect(field.value).toBe('2026-08-01T09:00'));
    expect(issuesService.getIssue).toHaveBeenCalledTimes(1);
  });

  it('re-expresses a loaded schedule when the timezone resolves late', async () => {
    let releaseSettings: (value: unknown) => void = () => {};
    vi.mocked(settingsService.getSettings).mockReturnValue(
      new Promise((resolve) => {
        releaseSettings = resolve;
      }) as never
    );

    renderWithSettings();

    const field = await screen.findByLabelText<HTMLInputElement>(/schedule publication/i);
    await waitFor(() => expect(field.value).toBe('2026-08-01T14:00'));

    releaseSettings(chicagoSettings);

    // Same instant, now shown as the newsletter's wall clock.
    await waitFor(() => expect(field.value).toBe('2026-08-01T09:00'));
  });

  it('never overwrites an edit the author already made', async () => {
    // Reprojection is a correction to an untouched form, not a licence to
    // discard typing that happened while settings were in flight.
    let releaseSettings: (value: unknown) => void = () => {};
    vi.mocked(settingsService.getSettings).mockReturnValue(
      new Promise((resolve) => {
        releaseSettings = resolve;
      }) as never
    );

    renderWithSettings();

    const field = await screen.findByLabelText<HTMLInputElement>(/schedule publication/i);
    await waitFor(() => expect(field.value).toBe('2026-08-01T14:00'));

    fireEvent.change(field, { target: { value: '2026-09-15T07:45' } });
    releaseSettings(chicagoSettings);

    // The helper text under the field names the newsletter's zone, so it only
    // says "America/Chicago" once settings have landed and re-rendered. Waiting
    // on that is what makes this a real test rather than a race.
    expect(await screen.findByText(/America\/Chicago/)).toBeInTheDocument();
    // Flush anything the zone change queued — without this the assertion can
    // run before a stray refetch lands and pass for the wrong reason.
    await act(async () => {});

    expect(field.value).toBe('2026-09-15T07:45');
  });
});
