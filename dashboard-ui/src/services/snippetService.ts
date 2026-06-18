import { apiClient } from './api';
import type {
  ApiResponse,
  Snippet,
  ListSnippetsResponse,
  CreateSnippetRequest,
  UpdateSnippetRequest,
} from '@/types/api';

/**
 * Snippet names are referenced inside templates as `{{> name }}`, so they must
 * be a valid Handlebars partial identifier (mirrors backend validation):
 * start with a letter and contain only letters, numbers, underscores, and
 * hyphens. No spaces are allowed.
 */
const SNIPPET_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const NAME_MAX_LENGTH = 100;

/**
 * Snippet Service - CRUD operations for reusable Handlebars snippets (partials).
 */
export class SnippetService {
  /**
   * List all snippets for the authenticated tenant (summaries, no content).
   */
  async listSnippets(): Promise<ApiResponse<ListSnippetsResponse>> {
    return apiClient.get<ListSnippetsResponse>('/snippets');
  }

  /**
   * Get a single snippet including its content and parameters.
   */
  async getSnippet(snippetId: string): Promise<ApiResponse<Snippet>> {
    if (!snippetId) {
      return { success: false, error: 'Snippet ID is required', errorCode: 'MISSING_SNIPPET_ID' };
    }
    return apiClient.get<Snippet>(`/snippets/${snippetId}`);
  }

  /**
   * Create a new snippet.
   */
  async createSnippet(data: CreateSnippetRequest): Promise<ApiResponse<Snippet>> {
    const validationError = this.validateSnippet(data.name, data.content);
    if (validationError) {
      return { success: false, error: validationError, errorCode: 'VALIDATION_ERROR' };
    }
    return apiClient.post<Snippet>('/snippets', this.normalize(data));
  }

  /**
   * Update an existing snippet.
   */
  async updateSnippet(snippetId: string, data: UpdateSnippetRequest): Promise<ApiResponse<Snippet>> {
    if (!snippetId) {
      return { success: false, error: 'Snippet ID is required', errorCode: 'MISSING_SNIPPET_ID' };
    }

    const validationError = this.validateSnippet(data.name, data.content);
    if (validationError) {
      return { success: false, error: validationError, errorCode: 'VALIDATION_ERROR' };
    }

    return apiClient.put<Snippet>(`/snippets/${snippetId}`, this.normalize(data));
  }

  /**
   * Delete a snippet.
   */
  async deleteSnippet(snippetId: string): Promise<ApiResponse<void>> {
    if (!snippetId) {
      return { success: false, error: 'Snippet ID is required', errorCode: 'MISSING_SNIPPET_ID' };
    }
    return apiClient.delete<void>(`/snippets/${snippetId}`);
  }

  /**
   * Validate a snippet name and content. Returns an error message or null.
   * `name` and `content` may be undefined on partial updates, in which case
   * the corresponding check is skipped.
   */
  validateSnippet(name?: string, content?: string): string | null {
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) {
        return 'Snippet name is required';
      }
      if (trimmed.length > NAME_MAX_LENGTH) {
        return `Snippet name must be ${NAME_MAX_LENGTH} characters or less`;
      }
      if (!SNIPPET_NAME_PATTERN.test(trimmed)) {
        return 'Snippet name must start with a letter and contain only letters, numbers, underscores, and hyphens (no spaces)';
      }
    }

    if (content !== undefined && !content.trim()) {
      return 'Snippet content is required';
    }

    return null;
  }

  /**
   * Trim string fields so what we send matches what the backend stores.
   */
  private normalize<T extends UpdateSnippetRequest>(data: T): T {
    return {
      ...data,
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.description !== undefined && { description: data.description.trim() }),
    };
  }
}

export const snippetService = new SnippetService();
