import { apiClient } from './api';
import { retryWithBackoff } from '@/utils/errorHandling';
import type { ApiResponse } from '@/types/api';
import type {
  Template,
  Snippet,
  CreateTemplateRequest,
  UpdateTemplateRequest,
  CreateSnippetRequest,
  UpdateSnippetRequest,
  TemplateListResponse,
  SnippetListResponse,
  PreviewTemplateRequest,
  PreviewSnippetRequest,
  TemplateFilters,
  SnippetFilters,
  TemplateVersionsResponse,
  TemplateVersionResponse,
  RestoreVersionResponse,
  ExportTemplatesRequest,
  ExportTemplatesResponse,
  ImportTemplatesRequest,
  ImportTemplatesResponse
} from '@/types/template';

// Re-export types from the main types file for backward compatibility
export type {
  Template,
  Snippet,
  SnippetParameter,
  CreateTemplateRequest as CreateTemplateData,
  UpdateTemplateRequest as UpdateTemplateData,
  CreateSnippetRequest as CreateSnippetData,
  UpdateSnippetRequest as UpdateSnippetData,
  PreviewTemplateRequest as PreviewTemplateData,
  PreviewSnippetRequest as PreviewSnippetData
} from '@/types/template';

class TemplateService {
  private baseUrl = '/templates';

  // Template CRUD operations
  async getTemplates(filters: TemplateFilters = {}): Promise<ApiResponse<TemplateListResponse>> {
    const searchParams = new URLSearchParams();

    if (filters.search) searchParams.set('search', filters.search);
    if (filters.category) searchParams.set('category', filters.category);
    if (filters.tags?.length) searchParams.set('tags', filters.tags.join(','));
    if (filters.createdBy) searchParams.set('createdBy', filters.createdBy);
    if (filters.dateRange) {
      searchParams.set('startDate', filters.dateRange.start);
      searchParams.set('endDate', filters.dateRange.end);
    }

    const url = `${this.baseUrl}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return apiClient.get<TemplateListResponse>(url);
  }

  async getTemplate(id: string, options: { version?: string; includeContent?: boolean } = {}): Promise<ApiResponse<Template>> {
    const searchParams = new URLSearchParams();

    if (options.version) searchParams.set('version', options.version);
    if (options.includeContent !== undefined) searchParams.set('includeContent', options.includeContent.toString());

    const url = `${this.baseUrl}/${id}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return apiClient.get<Template>(url);
  }

  async createTemplate(data: CreateTemplateRequest): Promise<ApiResponse<Template>> {
    return apiClient.post<Template>(this.baseUrl, data);
  }

  async updateTemplate(id: string, data: UpdateTemplateRequest): Promise<ApiResponse<Template>> {
    return apiClient.put<Template>(`${this.baseUrl}/${id}`, data);
  }

  async deleteTemplate(id: string): Promise<ApiResponse<void>> {
    return apiClient.delete(`${this.baseUrl}/${id}`);
  }

  async previewTemplate(templateId: string, data: PreviewTemplateRequest): Promise<{ html: string; success: boolean; message?: string }> {
    const url = `${this.baseUrl}/${templateId}/preview`;
    const response = await apiClient.post<{ html: string; success: boolean; message?: string }>(url, data);
    return response.data || { html: '', success: false, message: 'No response data' };
  }

  // Template retry methods
  async createTemplateWithRetry(data: CreateTemplateRequest): Promise<ApiResponse<Template>> {
    return retryWithBackoff(() => this.createTemplate(data));
  }

  async updateTemplateWithRetry(id: string, data: UpdateTemplateRequest): Promise<ApiResponse<Template>> {
    return retryWithBackoff(() => this.updateTemplate(id, data));
  }

  async deleteTemplateWithRetry(id: string): Promise<ApiResponse<void>> {
    return retryWithBackoff(() => this.deleteTemplate(id));
  }

  // Template metadata operations
  async getTemplateCategories(): Promise<string[]> {
    const response = await apiClient.get<{ categories: string[] }>(`${this.baseUrl}/categories`);
    return response.data?.categories || [];
  }

  async getTemplateTags(): Promise<string[]> {
    const response = await apiClient.get<{ tags: string[] }>(`${this.baseUrl}/tags`);
    return response.data?.tags || [];
  }

  // Template version operations
  async getTemplateVersions(id: string): Promise<ApiResponse<TemplateVersionsResponse>> {
    return apiClient.get<TemplateVersionsResponse>(`${this.baseUrl}/${id}/versions`);
  }

  async getTemplateVersion(id: string, versionId: string): Promise<ApiResponse<TemplateVersionResponse>> {
    return apiClient.get<TemplateVersionResponse>(`${this.baseUrl}/${id}/versions/${versionId}`);
  }

  async restoreTemplateVersion(id: string, versionId: string): Promise<ApiResponse<RestoreVersionResponse>> {
    return apiClient.post<RestoreVersionResponse>(`${this.baseUrl}/${id}/versions/${versionId}/restore`, {});
  }

  // Snippet CRUD operations
  async getSnippets(filters: SnippetFilters = {}): Promise<ApiResponse<SnippetListResponse>> {
    const searchParams = new URLSearchParams();

    if (filters.search) searchParams.set('search', filters.search);
    if (filters.createdBy) searchParams.set('createdBy', filters.createdBy);
    if (filters.dateRange) {
      searchParams.set('startDate', filters.dateRange.start);
      searchParams.set('endDate', filters.dateRange.end);
    }

    const url = `/snippets${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return apiClient.get<SnippetListResponse>(url);
  }

  async getSnippet(id: string, options: { version?: string; includeContent?: boolean } = {}): Promise<ApiResponse<Snippet>> {
    const searchParams = new URLSearchParams();

    if (options.version) searchParams.set('version', options.version);
    if (options.includeContent !== undefined) searchParams.set('includeContent', options.includeContent.toString());

    const url = `/snippets/${id}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return apiClient.get<Snippet>(url);
  }

  async createSnippet(data: CreateSnippetRequest): Promise<ApiResponse<Snippet>> {
    return apiClient.post<Snippet>('/snippets', data);
  }

  async updateSnippet(id: string, data: UpdateSnippetRequest): Promise<ApiResponse<Snippet>> {
    return apiClient.put<Snippet>(`/snippets/${id}`, data);
  }

  async deleteSnippet(id: string): Promise<ApiResponse<void>> {
    return apiClient.delete(`/snippets/${id}`);
  }

  async previewSnippet(snippetId: string, data: PreviewSnippetRequest): Promise<{ html: string; success: boolean; message?: string }> {
    const url = `/snippets/${snippetId}/preview`;
    const response = await apiClient.post<{ html: string; success: boolean; message?: string }>(url, data);
    return response.data || { html: '', success: false, message: 'No response data' };
  }

  // Snippet retry methods
  async createSnippetWithRetry(data: CreateSnippetRequest): Promise<ApiResponse<Snippet>> {
    return retryWithBackoff(() => this.createSnippet(data));
  }

  async updateSnippetWithRetry(id: string, data: UpdateSnippetRequest): Promise<ApiResponse<Snippet>> {
    return retryWithBackoff(() => this.updateSnippet(id, data));
  }

  async deleteSnippetWithRetry(id: string): Promise<ApiResponse<void>> {
    return retryWithBackoff(() => this.deleteSnippet(id));
  }

  // Snippet utility methods
  async getSnippetUsage(id: string): Promise<Template[]> {
    const response = await apiClient.get<{ templates: Template[] }>(`/snippets/${id}/usage`);
    return response.data?.templates || [];
  }

  // Import/Export operations
  async exportTemplatesWithRetry(templateIds: string[], options: { includeSnippets?: boolean; format?: 'zip' | 'json' } = {}): Promise<ApiResponse<ExportTemplatesResponse>> {
    const data: ExportTemplatesRequest = {
      templateIds,
      includeSnippets: options.includeSnippets ?? true,
      format: options.format ?? 'zip'
    };
    return retryWithBackoff(() => apiClient.post<ExportTemplatesResponse>(`${this.baseUrl}/export`, data));
  }

  async importTemplatesWithRetry(data: string, options: { format?: 'zip' | 'json'; conflictResolution?: 'skip' | 'overwrite' | 'rename'; preserveIds?: boolean } = {}): Promise<ApiResponse<ImportTemplatesResponse>> {
    const requestData: ImportTemplatesRequest = {
      data,
      format: options.format ?? 'json',
      conflictResolution: options.conflictResolution ?? 'skip',
      preserveIds: options.preserveIds ?? false
    };
    return retryWithBackoff(() => apiClient.post<ImportTemplatesResponse>(`${this.baseUrl}/import`, requestData));
  }

  // Utility methods for cache optimization
  async prefetchTemplate(id: string): Promise<void> {
    try {
      // Prefetch template metadata without content for faster subsequent loads
      await this.getTemplate(id, { includeContent: false });
    } catch (error) {
      console.warn('Failed to prefetch template:', error);
    }
  }

  async prefetchSnippet(id: string): Promise<void> {
    try {
      // Prefetch snippet metadata without content for faster subsequent loads
      await this.getSnippet(id, { includeContent: false });
    } catch (error) {
      console.warn('Failed to prefetch snippet:', error);
    }
  }

  // Batch prefetch for list items
  async prefetchTemplates(ids: string[]): Promise<void> {
    const prefetchPromises = ids.map(id => this.prefetchTemplate(id));
    await Promise.allSettled(prefetchPromises);
  }

  async prefetchSnippets(ids: string[]): Promise<void> {
    const prefetchPromises = ids.map(id => this.prefetchSnippet(id));
    await Promise.allSettled(prefetchPromises);
  }

  // Cache warming for frequently accessed templates
  async warmCache(templateIds: string[] = [], snippetIds: string[] = []): Promise<void> {
    try {
      const promises: Promise<any>[] = [];

      // Warm template cache
      templateIds.forEach(id => {
        promises.push(this.getTemplate(id, { includeContent: true }));
      });

      // Warm snippet cache
      snippetIds.forEach(id => {
        promises.push(this.getSnippet(id, { includeContent: true }));
      });

      await Promise.allSettled(promises);
      console.log('Cache warming completed');
    } catch (error) {
      console.warn('Cache warming failed:', error);
    }
  }
}

export const templateService = new TemplateService();
