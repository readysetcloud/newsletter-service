import { snippetService } from '../snippetService';
import { apiClient } from '../api';
import type { ListSnippetsResponse } from '@/types/api';

vi.mock('../api');

const mockApiClient = vi.mocked(apiClient);

describe('SnippetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the snippets list on success', async () => {
    const data: ListSnippetsResponse = {
      snippets: [
        { snippetId: 's1', name: 'footer', version: 1, createdAt: 'now', updatedAt: 'now' },
      ],
      total: 1,
    };
    mockApiClient.get.mockResolvedValue({ success: true, data });

    const result = await snippetService.listSnippets();

    expect(mockApiClient.get).toHaveBeenCalledWith('/snippets');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('footer');
  });

  it('degrades to an empty list when the endpoint 404s', async () => {
    mockApiClient.get.mockResolvedValue({ success: false, error: 'Resource not found.' });

    const result = await snippetService.listSnippets();

    expect(result).toEqual([]);
  });

  it('degrades to an empty list when data is missing', async () => {
    mockApiClient.get.mockResolvedValue({ success: true });

    const result = await snippetService.listSnippets();

    expect(result).toEqual([]);
  });
});
