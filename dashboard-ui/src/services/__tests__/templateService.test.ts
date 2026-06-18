import { templateService } from '../templateService';
import { apiClient } from '../api';
import type { Template, ListTemplatesResponse } from '@/types/api';

vi.mock('../api');

const mockApiClient = vi.mocked(apiClient);

const mockTemplate: Template = {
  templateId: 'tmpl-123',
  name: 'Welcome',
  description: 'Welcome email',
  category: 'transactional',
  content: '<h1>{{ title }}</h1>',
  sampleData: { title: 'Hi' },
  version: 1,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('TemplateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listTemplates', () => {
    it('calls the templates endpoint', async () => {
      const data: ListTemplatesResponse = { templates: [mockTemplate], total: 1 };
      mockApiClient.get.mockResolvedValue({ success: true, data });

      const result = await templateService.listTemplates();

      expect(mockApiClient.get).toHaveBeenCalledWith('/templates');
      expect(result.success).toBe(true);
      expect(result.data?.total).toBe(1);
    });
  });

  describe('getTemplate', () => {
    it('calls the endpoint with the template ID', async () => {
      mockApiClient.get.mockResolvedValue({ success: true, data: mockTemplate });

      const result = await templateService.getTemplate('tmpl-123');

      expect(mockApiClient.get).toHaveBeenCalledWith('/templates/tmpl-123');
      expect(result.success).toBe(true);
    });

    it('returns an error when ID is missing', async () => {
      const result = await templateService.getTemplate('');
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MISSING_TEMPLATE_ID');
      expect(mockApiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('createTemplate', () => {
    it('posts a normalized (trimmed) payload', async () => {
      mockApiClient.post.mockResolvedValue({ success: true, data: mockTemplate });

      const result = await templateService.createTemplate({
        name: '  Welcome  ',
        content: '<h1>{{ title }}</h1>',
        category: '  transactional  ',
      });

      expect(mockApiClient.post).toHaveBeenCalledWith('/templates', {
        name: 'Welcome',
        content: '<h1>{{ title }}</h1>',
        category: 'transactional',
      });
      expect(result.success).toBe(true);
    });

    it('rejects an empty name before calling the API', async () => {
      const result = await templateService.createTemplate({ name: '   ', content: 'x' });
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(mockApiClient.post).not.toHaveBeenCalled();
    });

    it('rejects empty content before calling the API', async () => {
      const result = await templateService.createTemplate({ name: 'Valid', content: '   ' });
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(mockApiClient.post).not.toHaveBeenCalled();
    });

    it('rejects names with reserved characters', async () => {
      const result = await templateService.createTemplate({ name: 'bad/name', content: 'x' });
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(mockApiClient.post).not.toHaveBeenCalled();
    });

    it('allows names with spaces and hyphens', async () => {
      mockApiClient.post.mockResolvedValue({ success: true, data: mockTemplate });
      const result = await templateService.createTemplate({ name: 'Weekly - Digest', content: 'x' });
      expect(result.success).toBe(true);
      expect(mockApiClient.post).toHaveBeenCalled();
    });
  });

  describe('updateTemplate', () => {
    it('puts to the endpoint with the template ID', async () => {
      mockApiClient.put.mockResolvedValue({ success: true, data: mockTemplate });

      const result = await templateService.updateTemplate('tmpl-123', { name: 'Renamed' });

      expect(mockApiClient.put).toHaveBeenCalledWith('/templates/tmpl-123', { name: 'Renamed' });
      expect(result.success).toBe(true);
    });

    it('returns an error when ID is missing', async () => {
      const result = await templateService.updateTemplate('', { name: 'x' });
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MISSING_TEMPLATE_ID');
      expect(mockApiClient.put).not.toHaveBeenCalled();
    });

    it('skips name/content validation when not provided', async () => {
      mockApiClient.put.mockResolvedValue({ success: true, data: mockTemplate });
      const result = await templateService.updateTemplate('tmpl-123', { description: 'new' });
      expect(result.success).toBe(true);
      expect(mockApiClient.put).toHaveBeenCalledWith('/templates/tmpl-123', { description: 'new' });
    });
  });

  describe('deleteTemplate', () => {
    it('calls delete with the template ID', async () => {
      mockApiClient.delete.mockResolvedValue({ success: true });
      const result = await templateService.deleteTemplate('tmpl-123');
      expect(mockApiClient.delete).toHaveBeenCalledWith('/templates/tmpl-123');
      expect(result.success).toBe(true);
    });

    it('returns an error when ID is missing', async () => {
      const result = await templateService.deleteTemplate('');
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MISSING_TEMPLATE_ID');
      expect(mockApiClient.delete).not.toHaveBeenCalled();
    });
  });
});
