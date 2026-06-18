import { snippetService } from '../snippetService';
import { apiClient } from '../api';
import type { Snippet, ListSnippetsResponse } from '@/types/api';

vi.mock('../api');

const mockApiClient = vi.mocked(apiClient);

const mockSnippet: Snippet = {
  snippetId: 'snip-123',
  name: 'sponsorBlock',
  description: 'Reusable sponsor block',
  content: '<div>{{ title }}</div>',
  parameters: [
    { name: 'title', type: 'string', required: true },
  ],
  version: 1,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('SnippetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listSnippets', () => {
    it('calls the snippets endpoint', async () => {
      const data: ListSnippetsResponse = { snippets: [mockSnippet], total: 1 };
      mockApiClient.get.mockResolvedValue({ success: true, data });

      const result = await snippetService.listSnippets();

      expect(mockApiClient.get).toHaveBeenCalledWith('/snippets');
      expect(result.success).toBe(true);
      expect(result.data?.total).toBe(1);
    });
  });

  describe('getSnippet', () => {
    it('calls the endpoint with the snippet ID', async () => {
      mockApiClient.get.mockResolvedValue({ success: true, data: mockSnippet });

      const result = await snippetService.getSnippet('snip-123');

      expect(mockApiClient.get).toHaveBeenCalledWith('/snippets/snip-123');
      expect(result.success).toBe(true);
    });

    it('returns an error when ID is missing', async () => {
      const result = await snippetService.getSnippet('');
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MISSING_SNIPPET_ID');
      expect(mockApiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('createSnippet', () => {
    it('posts a normalized (trimmed) payload', async () => {
      mockApiClient.post.mockResolvedValue({ success: true, data: mockSnippet });

      const result = await snippetService.createSnippet({
        name: '  sponsorBlock  ',
        content: '<div>{{ title }}</div>',
        description: '  Reusable sponsor block  ',
      });

      expect(mockApiClient.post).toHaveBeenCalledWith('/snippets', {
        name: 'sponsorBlock',
        content: '<div>{{ title }}</div>',
        description: 'Reusable sponsor block',
      });
      expect(result.success).toBe(true);
    });

    it('rejects an empty name before calling the API', async () => {
      const result = await snippetService.createSnippet({ name: '   ', content: 'x' });
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(mockApiClient.post).not.toHaveBeenCalled();
    });

    it('rejects empty content before calling the API', async () => {
      const result = await snippetService.createSnippet({ name: 'valid', content: '   ' });
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(mockApiClient.post).not.toHaveBeenCalled();
    });

    it('rejects names with spaces', async () => {
      const result = await snippetService.createSnippet({ name: 'bad name', content: 'x' });
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(mockApiClient.post).not.toHaveBeenCalled();
    });

    it('rejects names that do not start with a letter', async () => {
      const result = await snippetService.createSnippet({ name: '1abc', content: 'x' });
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(mockApiClient.post).not.toHaveBeenCalled();
    });

    it('allows names with underscores and hyphens', async () => {
      mockApiClient.post.mockResolvedValue({ success: true, data: mockSnippet });
      const result = await snippetService.createSnippet({ name: 'footer_block-1', content: 'x' });
      expect(result.success).toBe(true);
      expect(mockApiClient.post).toHaveBeenCalled();
    });

    it('forwards parameters in the payload', async () => {
      mockApiClient.post.mockResolvedValue({ success: true, data: mockSnippet });
      await snippetService.createSnippet({
        name: 'sponsorBlock',
        content: 'x',
        parameters: [{ name: 'tone', type: 'select', required: false, options: ['formal'] }],
      });
      expect(mockApiClient.post).toHaveBeenCalledWith('/snippets', expect.objectContaining({
        parameters: [{ name: 'tone', type: 'select', required: false, options: ['formal'] }],
      }));
    });
  });

  describe('updateSnippet', () => {
    it('puts to the endpoint with the snippet ID', async () => {
      mockApiClient.put.mockResolvedValue({ success: true, data: mockSnippet });

      const result = await snippetService.updateSnippet('snip-123', { name: 'renamed' });

      expect(mockApiClient.put).toHaveBeenCalledWith('/snippets/snip-123', { name: 'renamed' });
      expect(result.success).toBe(true);
    });

    it('returns an error when ID is missing', async () => {
      const result = await snippetService.updateSnippet('', { name: 'x' });
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MISSING_SNIPPET_ID');
      expect(mockApiClient.put).not.toHaveBeenCalled();
    });

    it('skips name/content validation when not provided', async () => {
      mockApiClient.put.mockResolvedValue({ success: true, data: mockSnippet });
      const result = await snippetService.updateSnippet('snip-123', { description: 'new' });
      expect(result.success).toBe(true);
      expect(mockApiClient.put).toHaveBeenCalledWith('/snippets/snip-123', { description: 'new' });
    });
  });

  describe('deleteSnippet', () => {
    it('calls delete with the snippet ID', async () => {
      mockApiClient.delete.mockResolvedValue({ success: true });
      const result = await snippetService.deleteSnippet('snip-123');
      expect(mockApiClient.delete).toHaveBeenCalledWith('/snippets/snip-123');
      expect(result.success).toBe(true);
    });

    it('returns an error when ID is missing', async () => {
      const result = await snippetService.deleteSnippet('');
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MISSING_SNIPPET_ID');
      expect(mockApiClient.delete).not.toHaveBeenCalled();
    });
  });
});
