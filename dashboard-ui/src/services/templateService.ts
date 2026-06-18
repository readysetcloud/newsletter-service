import { apiClient } from './api';
import type {
  ApiResponse,
  Template,
  ListTemplatesResponse,
  CreateTemplateRequest,
  UpdateTemplateRequest,
  PreviewTemplateRequest,
  PreviewTemplateResponse,
} from '@/types/api';

/**
 * Reserved characters that are not allowed in template names (mirrors backend
 * validation). Spaces and hyphens are allowed; control characters are rejected
 * separately by `hasControlCharacter`.
 */
const RESERVED_NAME_CHARS = /[<>:"/\\|?*]/;
const NAME_MAX_LENGTH = 100;

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    if (char.charCodeAt(0) < 0x20) {
      return true;
    }
  }
  return false;
}

/**
 * Template Service - CRUD operations for Handlebars email templates.
 */
export class TemplateService {
  /**
   * List all templates for the authenticated tenant (summaries, no content).
   */
  async listTemplates(): Promise<ApiResponse<ListTemplatesResponse>> {
    return apiClient.get<ListTemplatesResponse>('/templates');
  }

  /**
   * Get a single template including its content and sample data.
   */
  async getTemplate(templateId: string): Promise<ApiResponse<Template>> {
    if (!templateId) {
      return { success: false, error: 'Template ID is required', errorCode: 'MISSING_TEMPLATE_ID' };
    }
    return apiClient.get<Template>(`/templates/${templateId}`);
  }

  /**
   * Create a new template.
   */
  async createTemplate(data: CreateTemplateRequest): Promise<ApiResponse<Template>> {
    const validationError = this.validateTemplate(data.name, data.content);
    if (validationError) {
      return { success: false, error: validationError, errorCode: 'VALIDATION_ERROR' };
    }
    return apiClient.post<Template>('/templates', this.normalize(data));
  }

  /**
   * Update an existing template.
   */
  async updateTemplate(templateId: string, data: UpdateTemplateRequest): Promise<ApiResponse<Template>> {
    if (!templateId) {
      return { success: false, error: 'Template ID is required', errorCode: 'MISSING_TEMPLATE_ID' };
    }

    const validationError = this.validateTemplate(data.name, data.content);
    if (validationError) {
      return { success: false, error: validationError, errorCode: 'VALIDATION_ERROR' };
    }

    return apiClient.put<Template>(`/templates/${templateId}`, this.normalize(data));
  }

  /**
   * Delete a template.
   */
  async deleteTemplate(templateId: string): Promise<ApiResponse<void>> {
    if (!templateId) {
      return { success: false, error: 'Template ID is required', errorCode: 'MISSING_TEMPLATE_ID' };
    }
    return apiClient.delete<void>(`/templates/${templateId}`);
  }

  /**
   * Server-side preview of unsaved editor content. Renders the supplied
   * Handlebars `content` against `sampleData`, merging the tenant's snippets.
   * The backend returns a 400 with a helpful message on invalid Handlebars.
   */
  async previewTemplate(
    request: PreviewTemplateRequest,
  ): Promise<ApiResponse<PreviewTemplateResponse>> {
    if (!request.content || !request.content.trim()) {
      return {
        success: false,
        error: 'Template content is required',
        errorCode: 'VALIDATION_ERROR',
      };
    }
    return apiClient.post<PreviewTemplateResponse>('/templates/preview', {
      content: request.content,
      ...(request.sampleData !== undefined && { sampleData: request.sampleData }),
    });
  }

  /**
   * Server-side preview of a saved template by ID. Renders the stored content,
   * optionally overriding the sample data.
   */
  async previewSavedTemplate(
    templateId: string,
    sampleData?: Record<string, unknown>,
  ): Promise<ApiResponse<PreviewTemplateResponse>> {
    if (!templateId) {
      return { success: false, error: 'Template ID is required', errorCode: 'MISSING_TEMPLATE_ID' };
    }
    return apiClient.post<PreviewTemplateResponse>(
      `/templates/${templateId}/preview`,
      sampleData !== undefined ? { sampleData } : {},
    );
  }

  /**
   * Validate a template name and content. Returns an error message or null.
   * `name` and `content` may be undefined on partial updates, in which case
   * the corresponding check is skipped.
   */
  validateTemplate(name?: string, content?: string): string | null {
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) {
        return 'Template name is required';
      }
      if (trimmed.length > NAME_MAX_LENGTH) {
        return `Template name must be ${NAME_MAX_LENGTH} characters or less`;
      }
      if (RESERVED_NAME_CHARS.test(trimmed) || hasControlCharacter(trimmed)) {
        return 'Template name contains invalid characters';
      }
    }

    if (content !== undefined && !content.trim()) {
      return 'Template content is required';
    }

    return null;
  }

  /**
   * Trim string fields so what we send matches what the backend stores.
   */
  private normalize<T extends UpdateTemplateRequest>(data: T): T {
    return {
      ...data,
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.description !== undefined && { description: data.description.trim() }),
      ...(data.category !== undefined && { category: data.category.trim() }),
    };
  }
}

export const templateService = new TemplateService();
