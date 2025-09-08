import { TemplateCacheUtil } from '../functions/templates/utils/template-cache.mjs';

describe('TemplateCacheUtil', () => {
  let cacheUtil;
  const tenantId = 'test-tenant';
  const templateId = 'test-template';
  const snippetId = 'test-snippet';
  const versionId = 'v123';

  beforeEach(() => {
    cacheUtil = new TemplateCacheUtil();
  });

  describe('Cache Key Generation', () => {
    test('should generate correct template content key', () => {
      const key = cacheUtil.getTemplateContentKey(tenantId, templateId, versionId);
      expect(key).toBe(`${tenantId}:template:content:${templateId}:${versionId}`);
    });

    test('should generate correct template metadata key', () => {
      const key = cacheUtil.getTemplateMetadataKey(tenantId, templateId);
      expect(key).toBe(`${tenantId}:template:metadata:${templateId}`);
    });

    test('should generate correct snippet content key', () => {
      const key = cacheUtil.getSnippetContentKey(tenantId, snippetId, versionId);
      expect(key).toBe(`${tenantId}:snippet:content:${snippetId}:${versionId}`);
    });

    test('should generate correct snippet metadata key', () => {
      const key = cacheUtil.getSnippetMetadataKey(tenantId, snippetId);
      expect(key).toBe(`${tenantId}:snippet:metadata:${snippetId}`);
    });

    test('should generate correct template list key with filters', () => {
      const filters = { category: 'newsletter', search: 'test' };
      const key = cacheUtil.getTemplateListKey(tenantId, filters);
      expect(key).toBe(`${tenantId}:templates:list:category:newsletter|search:test`);
    });

    test('should generate correct snippet list key with filters', () => {
      const filters = { search: 'test' };
      const key = cacheUtil.getSnippetListKey(tenantId, filters);
      expect(key).toBe(`${tenantId}:snippets:list:search:test`);
    });

    test('should generate template list key with empty filters', () => {
      const filters = {};
      const key = cacheUtil.getTemplateListKey(tenantId, filters);
      expect(key).toBe(`${tenantId}:templates:list:`);
    });

    test('should sort filter keys consistently', () => {
      const filters1 = { search: 'test', category: 'newsletter' };
      const filters2 = { category: 'newsletter', search: 'test' };
      const key1 = cacheUtil.getTemplateListKey(tenantId, filters1);
      const key2 = cacheUtil.getTemplateListKey(tenantId, filters2);
      expect(key1).toBe(key2);
    });
  });

  describe('TTL Configuration', () => {
    test('should have correct default TTL values', () => {
      expect(cacheUtil.defaultTtlSeconds).toBe(3600);
      expect(cacheUtil.templateTtlSeconds).toBe(1800);
      expect(cacheUtil.snippetTtlSeconds).toBe(3600);
      expect(cacheUtil.listTtlSeconds).toBe(300);
    });
  });

  describe('Cache Client Availability', () => {
    test('should handle Momento being unavailable gracefully', async () => {
      // Mock Momento being unavailable
      const originalEnv = process.env.MOMENTO_API_KEY;
      delete process.env.MOMENTO_API_KEY;

      const result = await cacheUtil.getCacheClient(tenantId);
      expect(result).toBe(null);

      // Restore environment
      if (originalEnv) {
        process.env.MOMENTO_API_KEY = originalEnv;
      }
    });
  });
});
