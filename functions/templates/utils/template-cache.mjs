import { CacheGet, CacheSet, CacheDelete } from '@gomomento/sdk';
import { momentoClient } from '../../utils/momento-client.mjs';

/**
 * Template caching utility using Momento for performance optimization
 */
class TemplateCacheUtil {
  constructor() {
    this.defaultTtlSeconds = 3600; // 1 hour
    this.templateTtlSeconds = 1800; // 30 minutes for templates
    this.snippetTtlSeconds = 3600; // 1 hour for snippets (more stable)
    this.listTtlSeconds = 300; // 5 minutes for lists
  }

  /**
   * Get cache client with write token for the tenant
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} Cache client and auth token
   */
  async getCacheClient(tenantId) {
    if (!momentoClient.isAvailable()) {
      return null;
    }

    try {
      const authToken = await momentoClient.generateWriteToken(tenantId);
      const cacheClient = momentoClient.getCacheClient(authToken);
      return { cacheClient, authToken };
    } catch (error) {
      console.warn('Failed to get cache client:', error.message);
      return null;
    }
  }

  /**
   * Generate cache key for template content
   * @param {string} tenantId - Tenant ID
   * @param {string} templateId - Template ID
   * @param {string} versionId - S3 version ID
   * @returns {string} Cache key
   */
  getTemplateContentKey(tenantId, templateId, versionId) {
    return `${tenantId}:template:content:${templateId}:${versionId}`;
  }

  /**
   * Generate cache key for template metadata
   * @param {string} tenantId - Tenant ID
   * @param {string} templateId - Template ID
   * @returns {string} Cache key
   */
  getTemplateMetadataKey(tenantId, templateId) {
    return `${tenantId}:template:metadata:${templateId}`;
  }

  /**
   * Generate cache key content
   * @param {string} tenantId - Tenant ID
   * @param {string} snippetId - Snippet ID
   * @param {string} versionId - S3 version ID
   * @returns {string} Cache key
   */
  getSnippetContentKey(tenantId, snippetId, versionId) {
    return `${tenantId}:snippet:content:${snippetId}:${versionId}`;
  }

  /**
   * Generate cache key for snippet metadata
   * @param {string} tenantId - Tenant ID
   * @param {string} snippetId - Snippet ID
   * @returns {string} Cache key
   */
  getSnippetMetadataKey(tenantId, snippetId) {
    return `${tenantId}:snippet:metadata:${snippetId}`;
  }

  /**
   * Generate cache key for template list
   * @param {string} tenantId - Tenant ID
   * @param {Object} filters - Query filters
   * @returns {string} Cache key
   */
  getTemplateListKey(tenantId, filters = {}) {
    const filterStr = Object.keys(filters)
      .sort()
      .map(key => `${key}:${filters[key]}`)
      .join('|');
    return `${tenantId}:templates:list:${filterStr}`;
  }

  /**
   * Generate cache key for snippet list
   * @param {string} tenantId - Tenant ID
   * @param {Object} filters - Query filters
   * @returns {string} Cache key
   */
  getSnippetListKey(tenantId, filters = {}) {
    const filterStr = Object.keys(filters)
      .sort()
      .map(key => `${key}:${filters[key]}`)
      .join('|');
    return `${tenantId}:snippets:list:${filterStr}`;
  }

  /**
   * Cache template content
   * @param {string} tenantId - Tenant ID
   * @param {string} templateId - Template ID
   * @param {string} versionId - S3 version ID
   * @param {string} content - Template content
   * @returns {Promise<boolean>} Success status
   */
  async cacheTemplateContent(tenantId, templateId, versionId, content) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return false;

    try {
      const key = this.getTemplateContentKey(tenantId, templateId, versionId);
      const result = await cache.cacheClient.set(
        momentoClient.getCacheName(),
        key,
        content,
        { ttl: this.templateTtlSeconds }
      );

      if (result instanceof CacheSet.Success) {
        console.log(`Cached template content: ${templateId}:${versionId}`);
        return true;
      } else {
        console.warn(`Failed to cache template content: ${result.message}`);
        return false;
      }
    } catch (error) {
      console.warn('Template content caching error:', error.message);
      return false;
    }
  }

  /**
   * Get cached template content
   * @param {string} tenantId - Tenant ID
   * @param {string} templateId - Template ID
   * @param {string} versionId - S3 version ID
   * @returns {Promise<string|null>} Cached content or null
   */
  async getCachedTemplateContent(tenantId, templateId, versionId) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return null;

    try {
      const key = this.getTemplateContentKey(tenantId, templateId, versionId);
      const result = await cache.cacheClient.get(
        momentoClient.getCacheName(),
        key
      );

      if (result instanceof CacheGet.Hit) {
        console.log(`Cache hit for template content: ${templateId}:${versionId}`);
        return result.valueString();
      } else if (result instanceof CacheGet.Miss) {
        console.log(`Cache miss for template content: ${templateId}:${versionId}`);
        return null;
      } else {
        console.warn(`Cache get error: ${result.message}`);
        return null;
      }
    } catch (error) {
      console.warn('Template content cache retrieval error:', error.message);
      return null;
    }
  }

  /**
   * Cache template metadata
   * @param {string} tenantId - Tenant ID
   * @param {string} templateId - Template ID
   * @param {Object} metadata - Template metadata
   * @returns {Promise<boolean>} Success status
   */
  async cacheTemplateMetadata(tenantId, templateId, metadata) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return false;

    try {
      const key = this.getTemplateMetadataKey(tenantId, templateId);
      const result = await cache.cacheClient.set(
        momentoClient.getCacheName(),
        key,
        JSON.stringify(metadata),
        { ttl: this.templateTtlSeconds }
      );

      if (result instanceof CacheSet.Success) {
        console.log(`Cached template metadata: ${templateId}`);
        return true;
      } else {
        console.warn(`Failed to cache template metadata: ${result.message}`);
        return false;
      }
    } catch (error) {
      console.warn('Template metadata caching error:', error.message);
      return false;
    }
  }

  /**
   * Get cached template metadata
   * @param {string} tenantId - Tenant ID
   * @param {string} templateId - Template ID
   * @returns {Promise<Object|null>} Cached metadata or null
   */
  async getCachedTemplateMetadata(tenantId, templateId) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return null;

    try {
      const key = this.getTemplateMetadataKey(tenantId, templateId);
      const result = await cache.cacheClient.get(
        momentoClient.getCacheName(),
        key
      );

      if (result instanceof CacheGet.Hit) {
        console.log(`Cache hit for template metadata: ${templateId}`);
        return JSON.parse(result.valueString());
      } else if (result instanceof CacheGet.Miss) {
        console.log(`Cache miss for template metadata: ${templateId}`);
        return null;
      } else {
        console.warn(`Cache get error: ${result.message}`);
        return null;
      }
    } catch (error) {
      console.warn('Template metadata cache retrieval error:', error.message);
      return null;
    }
  }

  /**
   * Cache snippet content
   * @param {string} tenantId - Tenant ID
   * @param {string} snippetId - Snippet ID
   * @param {string} versionId - S3 version ID
   * @param {string} content - Snippet content
   * @returns {Promise<boolean>} Success status
   */
  async cacheSnippetContent(tenantId, snippetId, versionId, content) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return false;

    try {
      const key = this.getSnippetContentKey(tenantId, snippetId, versionId);
      const result = await cache.cacheClient.set(
        momentoClient.getCacheName(),
        key,
        content,
        { ttl: this.snippetTtlSeconds }
      );

      if (result instanceof CacheSet.Success) {
        console.log(`Cached snippet content: ${snippetId}:${versionId}`);
        return true;
      } else {
        console.warn(`Failed to cache snippet content: ${result.message}`);
        return false;
      }
    } catch (error) {
      console.warn('Snippet content caching error:', error.message);
      return false;
    }
  }

  /**
   * Get cached snippet content
   * @param {string} tenantId - Tenant ID
   * @param {string} snippetId - Snippet ID
   * @param {string} versionId - S3 version ID
   * @returns {Promise<string|null>} Cached content or null
   */
  async getCachedSnippetContent(tenantId, snippetId, versionId) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return null;

    try {
      const key = this.getSnippetContentKey(tenantId, snippetId, versionId);
      const result = await cache.cacheClient.get(
        momentoClient.getCacheName(),
        key
      );

      if (result instanceof CacheGet.Hit) {
        console.log(`Cache hit for snippet content: ${snippetId}:${versionId}`);
        return result.valueString();
      } else if (result instanceof CacheGet.Miss) {
        console.log(`Cache miss for snippet content: ${snippetId}:${versionId}`);
        return null;
      } else {
        console.warn(`Cache get error: ${result.message}`);
        return null;
      }
    } catch (error) {
      console.warn('Snippet content cache retrieval error:', error.message);
      return null;
    }
  }

  /**
   * Cache template list
   * @param {string} tenantId - Tenant ID
   * @param {Object} filters - Query filters
   * @param {Array} templates - Template list
   * @returns {Promise<boolean>} Success status
   */
  async cacheTemplateList(tenantId, filters, templates) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return false;

    try {
      const key = this.getTemplateListKey(tenantId, filters);
      const result = await cache.cacheClient.set(
        momentoClient.getCacheName(),
        key,
        JSON.stringify(templates),
        { ttl: this.listTtlSeconds }
      );

      if (result instanceof CacheSet.Success) {
        console.log(`Cached template list with ${templates.length} items`);
        return true;
      } else {
        console.warn(`Failed to cache template list: ${result.message}`);
        return false;
      }
    } catch (error) {
      console.warn('Template list caching error:', error.message);
      return false;
    }
  }

  /**
   * Get cached template list
   * @param {string} tenantId - Tenant ID
   * @param {Object} filters - Query filters
   * @returns {Promise<Array|null>} Cached template list or null
   */
  async getCachedTemplateList(tenantId, filters) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return null;

    try {
      const key = this.getTemplateListKey(tenantId, filters);
      const result = await cache.cacheClient.get(
        momentoClient.getCacheName(),
        key
      );

      if (result instanceof CacheGet.Hit) {
        console.log(`Cache hit for template list`);
        return JSON.parse(result.valueString());
      } else if (result instanceof CacheGet.Miss) {
        console.log(`Cache miss for template list`);
        return null;
      } else {
        console.warn(`Cache get error: ${result.message}`);
        return null;
      }
    } catch (error) {
      console.warn('Template list cache retrieval error:', error.message);
      return null;
    }
  }

  /**
   * Cache snippet list
   * @param {string} tenantId - Tenant ID
   * @param {Object} filters - Query filters
   * @param {Array} snippets - Snippet list
   * @returns {Promise<boolean>} Success status
   */
  async cacheSnippetList(tenantId, filters, snippets) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return false;

    try {
      const key = this.getSnippetListKey(tenantId, filters);
      const result = await cache.cacheClient.set(
        momentoClient.getCacheName(),
        key,
        JSON.stringify(snippets),
        { ttl: this.listTtlSeconds }
      );

      if (result instanceof CacheSet.Success) {
        console.log(`Cached snippet list with ${snippets.length} items`);
        return true;
      } else {
        console.warn(`Failed to cache snippet list: ${result.message}`);
        return false;
      }
    } catch (error) {
      console.warn('Snippet list caching error:', error.message);
      return false;
    }
  }

  /**
   * Get cached snippet list
   * @param {string} tenantId - Tenant ID
   * @param {Object} filters - Query filters
   * @returns {Promise<Array|null>} Cached snippet list or null
   */
  async getCachedSnippetList(tenantId, filters) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return null;

    try {
      const key = this.getSnippetListKey(tenantId, filters);
      const result = await cache.cacheClient.get(
        momentoClient.getCacheName(),
        key
      );

      if (result instanceof CacheGet.Hit) {
        console.log(`Cache hit for snippet list`);
        return JSON.parse(result.valueString());
      } else if (result instanceof CacheGet.Miss) {
        console.log(`Cache miss for snippet list`);
        return null;
      } else {
        console.warn(`Cache get error: ${result.message}`);
        return null;
      }
    } catch (error) {
      console.warn('Snippet list cache retrieval error:', error.message);
      return null;
    }
  }

  /**
   * Invalidate template cache
   * @param {string} tenantId - Tenant ID
   * @param {string} templateId - Template ID
   * @returns {Promise<boolean>} Success status
   */
  async invalidateTemplateCache(tenantId, templateId) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return false;

    try {
      // Invalidate metadata cache
      const metadataKey = this.getTemplateMetadataKey(tenantId, templateId);
      await cache.cacheClient.delete(momentoClient.getCacheName(), metadataKey);

      // Invalidate all template lists (since they might contain this template)
      await this.invalidateTemplateListCache(tenantId);

      console.log(`Invalidated template cache: ${templateId}`);
      return true;
    } catch (error) {
      console.warn('Template cache invalidation error:', error.message);
      return false;
    }
  }

  /**
   * Invalidate snippet cache
   * @param {string} tenantId - Tenant ID
   * @param {string} snippetId - Snippet ID
   * @returns {Promise<boolean>} Success status
   */
  async invalidateSnippetCache(tenantId, snippetId) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return false;

    try {
      // Invalidate metadata cache
      const metadataKey = this.getSnippetMetadataKey(tenantId, snippetId);
      await cache.cacheClient.delete(momentoClient.getCacheName(), metadataKey);

      // Invalidate all snippet lists
      await this.invalidateSnippetListCache(tenantId);

      console.log(`Invalidated snippet cache: ${snippetId}`);
      return true;
    } catch (error) {
      console.warn('Snippet cache invalidation error:', error.message);
      return false;
    }
  }

  /**
   * Invalidate all template list caches for a tenant
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<boolean>} Success status
   */
  async invalidateTemplateListCache(tenantId) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return false;

    try {
      // Since we can't easily enumerate all possible filter combinations,
      // we'll use a simple approach and delete common cache keys
      const commonFilters = [
        {},
        { category: 'newsletter' },
        { category: 'email' },
        { search: '' }
      ];

      for (const filters of commonFilters) {
        const key = this.getTemplateListKey(tenantId, filters);
        await cache.cacheClient.delete(momentoClient.getCacheName(), key);
      }

      console.log(`Invalidated template list caches for tenant: ${tenantId}`);
      return true;
    } catch (error) {
      console.warn('Template list cache invalidation error:', error.message);
      return false;
    }
  }

  /**
   * Invalidate all snippet list caches for a tenant
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<boolean>} Success status
   */
  async invalidateSnippetListCache(tenantId) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return false;

    try {
      // Delete common snippet list cache keys
      const commonFilters = [
        {},
        { search: '' }
      ];

      for (const filters of commonFilters) {
        const key = this.getSnippetListKey(tenantId, filters);
        await cache.cacheClient.delete(momentoClient.getCacheName(), key);
      }

      console.log(`Invalidated snippet list caches for tenant: ${tenantId}`);
      return true;
    } catch (error) {
      console.warn('Snippet list cache invalidation error:', error.message);
      return false;
    }
  }
}

// Export singleton instance
export const templateCache = new TemplateCacheUtil();

// Export class for testing
export { TemplateCacheUtil };
