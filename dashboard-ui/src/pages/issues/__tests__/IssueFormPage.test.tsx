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
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({}),
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
