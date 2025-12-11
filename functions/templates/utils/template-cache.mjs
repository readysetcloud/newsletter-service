import { CacheGet, CacheSet } from '@gomomento/sdk';
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
      const cacheClient = momentoClient.getCacheClient(authToken, this.defaultTtlSeconds);
      return { cacheClient, authToken };
    } catch (error) {
      console.warn('Failed to get cache client:', error.message);
      return null;
    }
  }

  /**
   * Generate cache key
   * @param {string} tenantId - Tenant ID
   * @param {string} type - Cache type (template, snippet)
   * @param {string} subtype - Subtype (content, metadata, list)
   * @param {string} id - Resource ID
   * @param {string} extra - Extra identifier (version, filters)
   * @returns {string} Cache key
   */
  getCacheKey(tenantId, type, subtype, id, extra = '') {
    const parts = [tenantId, type, subtype, id];
    if (extra) parts.push(extra);
    return parts.join(':');
  }

  /**
   * Set cache value
   * @param {string} tenantId - Tenant ID
   * @param {string} key - Cache key
   * @param {string} value - Value to cache
   * @param {number} ttl - TTL in seconds
   * @returns {Promise<boolean>} Success status
   */
  async set(tenantId, key, value, ttl) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return false;

    try {
      const result = await cache.cacheClient.set(
        momentoClient.getCacheName(),
        key,
        value,
        { ttl }
      );

      return result instanceof CacheSet.Success;
    } catch (error) {
      console.warn('Cache set error:', error.message);
      return false;
    }
  }

  /**
   * Get cache value
   * @param {string} tenantId - Tenant ID
   * @param {string} key - Cache key
   * @returns {Promise<string|null>} Cached value or null
   */
  async get(tenantId, key) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return null;

    try {
      const result = await cache.cacheClient.get(
        momentoClient.getCacheName(),
        key
      );

      if (result instanceof CacheGet.Hit) {
        return result.valueString();
      }
      return null;
    } catch (error) {
      console.warn('Cache get error:', error.message);
      return null;
    }
  }

  /**
   * Cache template content
   */
  async cacheTemplateContent(tenantId, templateId, versionId, content) {
    const key = this.getCacheKey(tenantId, 'template', 'content', templateId, versionId);
    return this.set(tenantId, key, content, this.templateTtlSeconds);
  }

  /**
   * Get cached template content
   */
  async getCachedTemplateContent(tenantId, templateId, versionId) {
    const key = this.getCacheKey(tenantId, 'template', 'content', templateId, versionId);
    return this.get(tenantId, key);
  }

  /**
   * Cache template metadata
   */
  async cacheTemplateMetadata(tenantId, templateId, metadata) {
    const key = this.getCacheKey(tenantId, 'template', 'metadata', templateId);
    return this.set(tenantId, key, JSON.stringify(metadata), this.templateTtlSeconds);
  }

  /**
   * Get cached template metadata
   */
  async getCachedTemplateMetadata(tenantId, templateId) {
    const key = this.getCacheKey(tenantId, 'template', 'metadata', templateId);
    const cached = await this.get(tenantId, key);
    return cached ? JSON.parse(cached) : null;
  }

  /**
   * Cache snippet content
   */
  async cacheSnippetContent(tenantId, snippetId, versionId, content) {
    const key = this.getCacheKey(tenantId, 'snippet', 'content', snippetId, versionId);
    return this.set(tenantId, key, content, this.snippetTtlSeconds);
  }

  /**
   * Get cached snippet content
   */
  async getCachedSnippetContent(tenantId, snippetId, versionId) {
    const key = this.getCacheKey(tenantId, 'snippet', 'content', snippetId, versionId);
    return this.get(tenantId, key);
  }

  /**
   * Cache snippet metadata
   */
  async cacheSnippetMetadata(tenantId, snippetId, metadata) {
    const key = this.getCacheKey(tenantId, 'snippet', 'metadata', snippetId);
    return this.set(tenantId, key, JSON.stringify(metadata), this.snippetTtlSeconds);
  }

  /**
   * Get cached snippet metadata
   */
  async getCachedSnippetMetadata(tenantId, snippetId) {
    const key = this.getCacheKey(tenantId, 'snippet', 'metadata', snippetId);
    const cached = await this.get(tenantId, key);
    return cached ? JSON.parse(cached) : null;
  }

  /**
   * Cache template list
   */
  async cacheTemplateList(tenantId, filters, templates) {
    const filterStr = Object.keys(filters).sort().map(k => `${k}:${filters[k]}`).join('|');
    const key = this.getCacheKey(tenantId, 'templates', 'list', filterStr);
    return this.set(tenantId, key, JSON.stringify(templates), this.listTtlSeconds);
  }

  /**
   * Get cached template list
   */
  async getCachedTemplateList(tenantId, filters) {
    const filterStr = Object.keys(filters).sort().map(k => `${k}:${filters[k]}`).join('|');
    const key = this.getCacheKey(tenantId, 'templates', 'list', filterStr);
    const cached = await this.get(tenantId, key);
    return cached ? JSON.parse(cached) : null;
  }

  /**
   * Cache snippet list
   */
  async cacheSnippetList(tenantId, filters, snippets) {
    const filterStr = Object.keys(filters).sort().map(k => `${k}:${filters[k]}`).join('|');
    const key = this.getCacheKey(tenantId, 'snippets', 'list', filterStr);
    return this.set(tenantId, key, JSON.stringify(snippets), this.listTtlSeconds);
  }

  /**
   * Get cached snippet list
   */
  async getCachedSnippetList(tenantId, filters) {
    const filterStr = Object.keys(filters).sort().map(k => `${k}:${filters[k]}`).join('|');
    const key = this.getCacheKey(tenantId, 'snippets', 'list', filterStr);
    const cached = await this.get(tenantId, key);
    return cached ? JSON.parse(cached) : null;
  }

  /**
   * Delete cache key
   * @param {string} tenantId - Tenant ID
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} Success status
   */
  async delete(tenantId, key) {
    const cache = await this.getCacheClient(tenantId);
    if (!cache) return false;

    try {
      await cache.cacheClient.delete(momentoClient.getCacheName(), key);
      return true;
    } catch (error) {
      console.warn('Cache delete error:', error.message);
      return false;
    }
  }

  /**
   * Invalidate template cache
   */
  async invalidateTemplateCache(tenantId, templateId) {
    const metadataKey = this.getCacheKey(tenantId, 'template', 'metadata', templateId);
    await this.delete(tenantId, metadataKey);
    await this.invalidateTemplateListCache(tenantId);
  }

  /**
   * Invalidate snippet cache
   */
  async invalidateSnippetCache(tenantId, snippetId) {
    const metadataKey = this.getCacheKey(tenantId, 'snippet', 'metadata', snippetId);
    await this.delete(tenantId, metadataKey);
    await this.invalidateSnippetListCache(tenantId);
  }

  /**
   * Invalidate template list caches
   */
  async invalidateTemplateListCache(tenantId) {
    // Just delete the most common list cache (empty filters)
    const key = this.getCacheKey(tenantId, 'templates', 'list', '');
    await this.delete(tenantId, key);
  }

  /**
   * Invalidate snippet list caches
   */
  async invalidateSnippetListCache(tenantId) {
    // Just delete the most common list cache (empty filters)
    const key = this.getCacheKey(tenantId, 'snippets', 'list', '');
    await this.delete(tenantId, key);
  }
}

// Export singleton instance
export const templateCache = new TemplateCacheUtil();

// Export class for testing
export { TemplateCacheUtil };
