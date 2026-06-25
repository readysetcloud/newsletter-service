import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SnippetShortcodeInserter } from '../SnippetShortcodeInserter';
import { snippetService } from '@/services/snippetService';

vi.mock('@/services/snippetService', () => ({
  snippetService: {
    listSnippets: vi.fn(),
    getSnippet: vi.fn(),
  },
}));

const mockedList = vi.mocked(snippetService.listSnippets);
const mockedGet = vi.mocked(snippetService.getSnippet);

const summary = (name: string, snippetId = name) => ({
  snippetId,
  name,
  version: 1,
  createdAt: '',
  updatedAt: '',
});

describe('SnippetShortcodeInserter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not fetch snippets until the panel is opened', () => {
    render(<SnippetShortcodeInserter onInsert={vi.fn()} />);
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('lazily loads the snippet list on first open', async () => {
    mockedList.mockResolvedValue({ success: true, data: { snippets: [summary('robotVoice')], total: 1 } });
    render(<SnippetShortcodeInserter onInsert={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /insert snippet/i }));

    expect(await screen.findByText('robotVoice')).toBeInTheDocument();
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('inserts a parameter-scaffolded shortcode for the chosen snippet', async () => {
    mockedList.mockResolvedValue({ success: true, data: { snippets: [summary('robotVoice')], total: 1 } });
    mockedGet.mockResolvedValue({
      success: true,
      data: {
        snippetId: 'robotVoice',
        name: 'robotVoice',
        version: 1,
        createdAt: '',
        updatedAt: '',
        content: '<aside>{{ text }}</aside>',
        parameters: [{ name: 'text', type: 'textarea', required: true }],
      },
    });
    const onInsert = vi.fn();
    render(<SnippetShortcodeInserter onInsert={onInsert} />);

    fireEvent.click(screen.getByRole('button', { name: /insert snippet/i }));
    fireEvent.click(await screen.findByText('robotVoice'));

    await waitFor(() => expect(onInsert).toHaveBeenCalledWith('{{< robotVoice text="" >}}'));
  });

  it('falls back to a bare shortcode when the full snippet read fails', async () => {
    mockedList.mockResolvedValue({ success: true, data: { snippets: [summary('divider')], total: 1 } });
    mockedGet.mockResolvedValue({ success: false, error: 'boom' });
    const onInsert = vi.fn();
    render(<SnippetShortcodeInserter onInsert={onInsert} />);

    fireEvent.click(screen.getByRole('button', { name: /insert snippet/i }));
    fireEvent.click(await screen.findByText('divider'));

    await waitFor(() => expect(onInsert).toHaveBeenCalledWith('{{< divider >}}'));
  });

  it('filters the list by the search query', async () => {
    mockedList.mockResolvedValue({
      success: true,
      data: { snippets: [summary('robotVoice'), summary('callout')], total: 2 },
    });
    render(<SnippetShortcodeInserter onInsert={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /insert snippet/i }));
    await screen.findByText('robotVoice');

    fireEvent.change(screen.getByLabelText('Search snippets'), { target: { value: 'call' } });

    expect(screen.getByText('callout')).toBeInTheDocument();
    expect(screen.queryByText('robotVoice')).not.toBeInTheDocument();
  });

  it('shows an empty state when the tenant has no snippets', async () => {
    mockedList.mockResolvedValue({ success: true, data: { snippets: [], total: 0 } });
    render(<SnippetShortcodeInserter onInsert={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /insert snippet/i }));

    expect(await screen.findByText(/No snippets yet/i)).toBeInTheDocument();
  });
});
