import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IssueFormPage } from '../IssueFormPage';
import { issuesService } from '@/services/issuesService';
import { templateService } from '@/services/templateService';

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

const mockNavigate = vi.fn();
// Default is create mode ({}); edit-mode tests set an id and must reset it.
let mockParams: Record<string, string> = {};
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => mockParams,
}));

const mockAddToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
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

describe('IssueFormPage authoring modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParams = {};
    vi.mocked(templateService.listTemplates).mockResolvedValue({
      success: true,
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
    });
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

    fireEvent.click(screen.getByRole('button', { name: /create new issue/i }));

    await waitFor(() => {
      expect(issuesService.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Hello World',
          content: '# My content',
          contentType: 'markdown',
        })
      );
    });
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
    vi.mocked(templateService.listTemplates).mockResolvedValue({
      success: true,
      data: { total: 0, templates: [] },
    });
    vi.mocked(issuesService.createIssue).mockResolvedValue({
      success: true,
      data: { id: '1' } as never,
    });
  });

  const fillRequiredFields = () => {
    fireEvent.change(screen.getByPlaceholderText('Enter issue subject'), {
      target: { value: 'Issue with local send' },
    });
    fireEvent.change(screen.getByTestId('wysiwyg'), {
      target: { value: '# Content' },
    });
  };

  it('omits localSend when the toggle is off', async () => {
    render(<IssueFormPage />);
    fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: /create new issue/i }));

    await waitFor(() => {
      expect(issuesService.createIssue).toHaveBeenCalled();
    });
    const payload = vi.mocked(issuesService.createIssue).mock.calls[0][0];
    expect(payload.localSend).toBeUndefined();
  });

  it('sends localSend with the chosen default timezone when enabled', async () => {
    render(<IssueFormPage />);
    fillRequiredFields();

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
    fillRequiredFields();

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

  it('switching back to timezone mode persists mode timezone', async () => {
    render(<IssueFormPage />);
    fillRequiredFields();

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
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockParams = {};
    vi.mocked(templateService.listTemplates).mockResolvedValue({
      success: true,
      data: { total: 0, templates: [] },
    });
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
