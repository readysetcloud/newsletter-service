import { apiClient } from './api';
import type { ApiResponse, ListSnippetsResponse, SnippetSummary } from '@/types/api';

/**
 * Read-only snippet access for the template builder.
 *
 * Snippets (the `{{> name }}` partials) are owned by issue #265, which is being
 * built on a parallel branch. Until that lands, `GET /snippets` may 404 or be
 * absent at runtime; callers should degrade gracefully (empty list) rather than
 * surface an error. `listSnippets` never rejects: a failed request resolves to
 * an empty list so autocomplete and the snippet browser simply show nothing.
 */
export class SnippetService {
  /**
   * List the tenant's snippets. Returns an empty list if the endpoint is
   * unavailable (e.g. 404 before issue #265 ships).
   */
  async listSnippets(): Promise<SnippetSummary[]> {
    const response: ApiResponse<ListSnippetsResponse> =
      await apiClient.get<ListSnippetsResponse>('/snippets');
    if (response.success && response.data?.snippets) {
      return response.data.snippets;
    }
    return [];
  }
}

export const snippetService = new SnippetService();
