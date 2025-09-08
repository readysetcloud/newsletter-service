import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  uploadTemplate,
  downloadTemplate,
  deleteTemplate,
  getVersionHistory,
  generateTemplateKey,
  generateSnippetKey
} from '../functions/templates/utils/s3-storage.mjs';

// Mock AWS SDK
const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn((params) => params),
  GetObjectCommand: jest.fn((params) => params),
  DeleteObjectCommand: jest.fn((params) => params),
  ListObjectVersionsCommand: jest.fn((params) => params)
}));

describe('S3 Storage Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TEMPLATES_BUCKET_NAME = 'test-templates-bucket';
  });

  describe('generateTemplateKey', () => {
    it('should generate correct template key', () => {
      const key = generateTemplateKey('tenant123', 'template456');
      expect(key).toBe('templates/tenant123/template456.hbs');
    });

    it('should handle special characters in IDs', () => {
      const key = generateTemplateKey('tenant-123', 'template_456');
      expect(key).toBe('templates/tenant-123/template_456.hbs');
    });
  });

  describe('generateSnippetKey', () => {
    it('should generate correct snippet key', () => {
      const key = generateSnippetKey('tenant123', 'snippet456');
      expect(key).toBe('snippets/tenant123/snippet456.hbs');
    });

    it('should handle special characters in IDs', () => {
      const key = generateSnippetKey('tenant-123', 'snippet_456');
      expect(key).toBe('snippets/tenant-123/snippet_456.hbs');
    });
  });

  describe('uploadTemplate', () => {
    it('should upload template content successfully', async () => {
      mockS3Send.mockResolvedValue({
        VersionId: 'version-123',
        ETag: 'etag-123'
      });

      const key = 'templates/tenant1/template1.hbs';
      const content = '<h1>{{title}}</h1><p>{{content}}</p>';
      const metadata = { author: 'user123', category: 'newsletter' };

      const result = await uploadTemplate(key, content, metadata);

      expect(result.success).toBe(true);
      expect(result.versionId).toBe('version-123');
      expect(result.etag).toBe('etag-123');

      expect(mockS3Send).toHaveBeenCalledWith({
        Bucket: 'test-templates-bucket',
        Key: key,
        Body: content,
        ContentType: 'text/plain',
        Metadata: {
          author: 'user123',
          category: 'newsletter',
          uploadedAt: expect.any(String)
        }
      });
    });

    it('should handle S3 upload errors', async () => {
      mockS3Send.mockRejectedValue(new Error('Access denied'));

      const key = 'templates/tenant1/template1.hbs';
      const content = '<h1>{{title}}</h1>';

      await expect(uploadTemplate(key, content)).rejects.toThrow('Failed to upload template: Access denied');
    });

    it('should include upload timestamp in metadata', async () => {
      mockS3Send.mockResolvedValue({
        VersionId: 'version-123',
        ETag: 'etag-123'
      });

      const key = 'templates/tenant1/template1.hbs';
      const content = '<h1>{{title}}</h1>';

      await uploadTemplate(key, content);

      const call = mockS3Send.mock.calls[0][0];
      expect(call.Metadata.uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('downloadTemplate', () => {
    it('should download template content successfully', async () => {
      const mockContent = '<h1>{{title}}</h1><p>{{content}}</p>';
      mockS3Send.mockResolvedValue({
        Body: {
          transformToString: () => Promise.resolve(mockContent)
        },
        Metadata: { author: 'user123' },
        VersionId: 'version-123',
        LastModified: new Date('2024-01-01T00:00:00Z'),
        ContentLength: mockContent.length
      });

      const key = 'templates/tenant1/template1.hbs';
      const result = await downloadTemplate(key);

      expect(result.content).toBe(mockContent);
      expect(result.metadata).toEqual({ author: 'user123' });
      expect(result.versionId).toBe('version-123');
      expect(result.lastModified).toEqual(new Date('2024-01-01T00:00:00Z'));
      expect(result.contentLength).toBe(mockContent.length);

      expect(mockS3Send).toHaveBeenCalledWith({
        Bucket: 'test-templates-bucket',
        Key: key
      });
    });

    it('should download specific version when versionId provided', async () => {
      const mockContent = '<h1>{{title}}</h1>';
      mockS3Send.mockResolvedValue({
        Body: {
          transformToString: () => Promise.resolve(mockContent)
        },
        Metadata: {},
        VersionId: 'version-456',
        LastModified: new Date(),
        ContentLength: mockContent.length
      });

      const key = 'templates/tenant1/template1.hbs';
      const versionId = 'version-456';
      const result = await downloadTemplate(key, versionId);

      expect(result.content).toBe(mockContent);
      expect(result.versionId).toBe('version-456');

      expect(mockS3Send).toHaveBeenCalledWith({
        Bucket: 'test-templates-bucket',
        Key: key,
        VersionId: versionId
      });
    });

    it('should handle NoSuchKey error', async () => {
      const error = new Error('The specified key does not exist');
      error.name = 'NoSuchKey';
      mockS3Send.mockRejectedValue(error);

      const key = 'templates/tenant1/nonexistent.hbs';

      await expect(downloadTemplate(key)).rejects.toThrow('Template not found');
    });

    it('should handle other S3 errors', async () => {
      mockS3Send.mockRejectedValue(new Error('Access denied'));

      const key = 'templates/tenant1/template1.hbs';

      await expect(downloadTemplate(key)).rejects.toThrow('Failed to download template: Access denied');
    });
  });

  describe('deleteTemplate', () => {
    it('should delete template successfully', async () => {
      mockS3Send.mockResolvedValue({
        VersionId: 'delete-marker-123'
      });

      const key = 'templates/tenant1/template1.hbs';
      const result = await deleteTemplate(key);

      expect(result.success).toBe(true);
      expect(result.versionId).toBe('delete-marker-123');

      expect(mockS3Send).toHaveBeenCalledWith({
        Bucket: 'test-templates-bucket',
        Key: key
      });
    });

    it('should handle S3 delete errors', async () => {
      mockS3Send.mockRejectedValue(new Error('Access denied'));

      const key = 'templates/tenant1/template1.hbs';

      await expect(deleteTemplate(key)).rejects.toThrow('Failed to delete template: Access denied');
    });
  });

  describe('getVersionHistory', () => {
    it('should retrieve version history successfully', async () => {
      const mockVersions = [
        {
          Key: 'templates/tenant1/template1.hbs',
          VersionId: 'version-3',
          LastModified: new Date('2024-01-03T00:00:00Z'),
          Size: 1500,
          IsLatest: true
        },
        {
          Key: 'templates/tenant1/template1.hbs',
          VersionId: 'version-2',
          LastModified: new Date('2024-01-02T00:00:00Z'),
          Size: 1200,
          IsLatest: false
        },
        {
          Key: 'templates/tenant1/template1.hbs',
          VersionId: 'version-1',
          LastModified: new Date('2024-01-01T00:00:00Z'),
          Size: 1000,
          IsLatest: false
        },
        {
          Key: 'templates/tenant1/other-template.hbs', // Different template
          VersionId: 'version-1',
          LastModified: new Date('2024-01-01T00:00:00Z'),
          Size: 800,
          IsLatest: true
        }
      ];

      mockS3Send.mockResolvedValue({
        Versions: mockVersions
      });

      const key = 'templates/tenant1/template1.hbs';
      const result = await getVersionHistory(key);

      expect(result).toHaveLength(3); // Should filter out other template
      expect(result[0].versionId).toBe('version-3'); // Most recent first
      expect(result[0].isLatest).toBe(true);
      expect(result[1].versionId).toBe('version-2');
      expect(result[2].versionId).toBe('version-1');

      expect(mockS3Send).toHaveBeenCalledWith({
        Bucket: 'test-templates-bucket',
        Prefix: key
      });
    });

    it('should handle empty version history', async () => {
      mockS3Send.mockResolvedValue({
        Versions: []
      });

      const key = 'templates/tenant1/template1.hbs';
      const result = await getVersionHistory(key);

      expect(result).toEqual([]);
    });

    it('should handle S3 errors', async () => {
      mockS3Send.mockRejectedValue(new Error('Access denied'));

      const key = 'templates/tenant1/template1.hbs';

      await expect(getVersionHistory(key)).rejects.toThrow('Failed to get version history: Access denied');
    });

    it('should sort versions by last modified date descending', async () => {
      const mockVersions = [
        {
          Key: 'templates/tenant1/template1.hbs',
          VersionId: 'version-1',
          LastModified: new Date('2024-01-01T00:00:00Z'),
          Size: 1000,
          IsLatest: false
        },
        {
          Key: 'templates/tenant1/template1.hbs',
          VersionId: 'version-3',
          LastModified: new Date('2024-01-03T00:00:00Z'),
          Size: 1500,
          IsLatest: true
        },
        {
          Key: 'templates/tenant1/template1.hbs',
          VersionId: 'version-2',
          LastModified: new Date('2024-01-02T00:00:00Z'),
          Size: 1200,
          IsLatest: false
        }
      ];

      mockS3Send.mockResolvedValue({
        Versions: mockVersions
      });

      const key = 'templates/tenant1/template1.hbs';
      const result = await getVersionHistory(key);

      expect(result[0].versionId).toBe('version-3');
      expect(result[1].versionId).toBe('version-2');
      expect(result[2].versionId).toBe('version-1');
    });
  });

  describe('Error Handling', () => {
    it('should handle network timeouts', async () => {
      const timeoutError = new Error('Request timeout');
      timeoutError.code = 'RequestTimeout';
      mockS3Send.mockRejectedValue(timeoutError);

      const key = 'templates/tenant1/template1.hbs';
      const content = '<h1>{{title}}</h1>';

      await expect(uploadTemplate(key, content)).rejects.toThrow('Failed to upload template: Request timeout');
    });

    it('should handle service unavailable errors', async () => {
      const serviceError = new Error('Service unavailable');
      serviceError.code = 'ServiceUnavailable';
      mockS3Send.mockRejectedValue(serviceError);

      const key = 'templates/tenant1/template1.hbs';

      await expect(downloadTemplate(key)).rejects.toThrow('Failed to download template: Service unavailable');
    });

    it('should handle invalid bucket name errors', async () => {
      const bucketError = new Error('The specified bucket does not exist');
      bucketError.code = 'NoSuchBucket';
      mockS3Send.mockRejectedValue(bucketError);

      const key = 'templates/tenant1/template1.hbs';
      const content = '<h1>{{title}}</h1>';

      await expect(uploadTemplate(key, content)).rejects.toThrow('Failed to upload template: The specified bucket does not exist');
    });
  });

  describe('Content Validation', () => {
    it('should handle large template uploads', async () => {
      mockS3Send.mockResolvedValue({
        VersionId: 'version-123',
        ETag: 'etag-123'
      });

      const key = 'templates/tenant1/large-template.hbs';
      const largeContent = 'x'.repeat(500000); // 500KB content

      const result = await uploadTemplate(key, largeContent);

      expect(result.success).toBe(true);
      expect(mockS3Send).toHaveBeenCalledWith(expect.objectContaining({
        Body: largeContent
      }));
    });

    it('should handle empty content uploads', async () => {
      mockS3Send.mockResolvedValue({
        VersionId: 'version-123',
        ETag: 'etag-123'
      });

      const key = 'templates/tenant1/empty-template.hbs';
      const emptyContent = '';

      const result = await uploadTemplate(key, emptyContent);

      expect(result.success).toBe(true);
      expect(mockS3Send).toHaveBeenCalledWith(expect.objectContaining({
        Body: emptyContent
      }));
    });

    it('should handle special characters in content', async () => {
      mockS3Send.mockResolvedValue({
        VersionId: 'version-123',
        ETag: 'etag-123'
      });

      const key = 'templates/tenant1/special-template.hbs';
      const specialContent = '<h1>{{title}}</h1><p>Special chars: àáâãäåæçèéêë</p><p>Symbols: ©®™€£¥</p>';

      const result = await uploadTemplate(key, specialContent);

      expect(result.success).toBe(true);
      expect(mockS3Send).toHaveBeenCalledWith(expect.objectContaining({
        Body: specialContent
      }));
    });
  });

  describe('Metadata Handling', () => {
    it('should handle complex metadata objects', async () => {
      mockS3Send.mockResolvedValue({
        VersionId: 'version-123',
        ETag: 'etag-123'
      });

      const key = 'templates/tenant1/template1.hbs';
      const content = '<h1>{{title}}</h1>';
      const metadata = {
        author: 'user123',
        category: 'newsletter',
        tags: 'monthly,news,update',
        version: '2',
        lastEditor: 'user456'
      };

      await uploadTemplate(key, content, metadata);

      const call = mockS3Send.mock.calls[0][0];
      expect(call.Metadata).toEqual({
        ...metadata,
        uploadedAt: expect.any(String)
      });
    });

    it('should handle metadata with special characters', async () => {
      mockS3Send.mockResolvedValue({
        VersionId: 'version-123',
        ETag: 'etag-123'
      });

      const key = 'templates/tenant1/template1.hbs';
      const content = '<h1>{{title}}</h1>';
      const metadata = {
        description: 'Template with special chars: àáâãäåæçèéêë',
        notes: 'Created for client: Müller & Associates'
      };

      await uploadTemplate(key, content, metadata);

      const call = mockS3Send.mock.calls[0][0];
      expect(call.Metadata.description).toBe('Template with special chars: àáâãäåæçèéêë');
      expect(call.Metadata.notes).toBe('Created for client: Müller & Associates');
    });
  });
});
