import SnippetPreviewUtils from '@/utils/snippetPreviewUtils';
import type { Snippet } from '@/types/template';

interface PreviewServiceOptions {
  cacheTimeout?: number;
  maxConcurrentRenders?: number;
  enableThumbnails?: boolean;
  thumbnailSize?: { width: number; height: number };
}

interface PreviewRequest {
  snippet: Snippet;
  parameters: Record<string, any>;
  priority?: 'low' | 'normal' | 'high';
  generateThumbnail?: boolean;
}

interface PreviewServiceResult {
  html: string;
  success: boolean;
  error?: string;
  fromCache?: boolean;
  renderTime?: number;
  thumbnailUrl?: string;
}

/**
 * Service class for managing snippet preview generation with queue mana
 * caching, and error handling
 */
export class SnippetPreviewService {
  private options: Required<PreviewServiceOptions>;
  private requestQueue: PreviewRequest[] = [];
  private processing = false;

  constructor(options: PreviewServiceOptions = {}) {
    this.options = {
      cacheTimeout: options.cacheTimeout || 10 * 60 * 1000, // 10 minutes
      maxConcurrentRenders: options.maxConcurrentRenders || 3,
      enableThumbnails: options.enableThumbnails ?? true,
      thumbnailSize: options.thumbnailSize || { width: 300, height: 200 }
    };
  }

  /**
   * Generate preview for a single snippet
   */
  async generatePreview(
    snippet: Snippet,
    parameters: Record<string, any> = {},
    options: {
      priority?: 'low' | 'normal' | 'high';
      generateThumbnail?: boolean;
      useCache?: boolean;
      fallbackOnError?: boolean;
    } = {}
  ): Promise<PreviewServiceResult> {
    const {
      priority = 'normal',
      generateThumbnail = this.options.enableThumbnails,
      useCache = true,
      fallbackOnError = true
    } = options;

    try {
      const result = await SnippetPreviewUtils.generatePreview(snippet, parameters, {
        useCache,
        cacheTimeout: this.options.cacheTimeout,
        fallbackOnError,
        generateThumbnail
      });

      return {
        html: result.html,
        success: result.success,
        error: result.error,
        fromCache: result.fromCache,
        renderTime: result.renderTime,
        thumbnailUrl: result.thumbnailUrl
      };
    } catch (error) {
      return {
        html: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Generate preview with retry logic
   */
  async generatePreviewWithRetry(
    snippet: Snippet,
    parameters: Record<string, any> = {},
    options: {
      maxRetries?: number;
      retryDelay?: number;
      generateThumbnail?: boolean;
    } = {}
  ): Promise<PreviewServiceResult> {
    const {
      maxRetries = 2,
      retryDelay = 1000,
      generateThumbnail = this.options.enableThumbnails
    } = options;

    try {
      const result = await SnippetPreviewUtils.generatePreviewWithRetry(snippet, parameters, {
        maxRetries,
        retryDelay,
        useCache: true,
        cacheTimeout: this.options.cacheTimeout,
        fallbackOnError: true,
        generateThumbnail
      });

      return {
        html: result.html,
        success: result.success,
        error: result.error,
        fromCache: result.fromCache,
        renderTime: result.renderTime,
        thumbnailUrl: result.thumbnailUrl
      };
    } catch (error) {
      return {
        html: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Batch generate previews for multiple snippets
   */
  async generatePreviewBatch(
    requests: Array<{ snippet: Snippet; parameters?: Record<string, any> }>,
    options: {
      onProgress?: (completed: number, total: number) => void;
      batchSize?: number;
      generateThumbnails?: boolean;
    } = {}
  ): Promise<Map<string, PreviewServiceResult>> {
    const {
      onProgress,
      batchSize = 5,
      generateThumbnails = this.options.enableThumbnails
    } = options;

    const results = new Map<string, PreviewServiceResult>();

    try {
      const preloadResult = await SnippetPreviewUtils.preloadPreviews(
        requests.map(({ snippet, parameters = {} }) => ({ snippet, parameters })),
        {
          onProgress,
          batchSize,
          useCache: true,
          cacheTimeout: this.options.cacheTimeout,
          fallbackOnError: true,
          generateThumbnail: generateThumbnails
        }
      );

      // Get the cached results
      for (const { snippet, parameters = {} } of requests) {
        try {
          const result = await this.generatePreview(snippet, parameters, {
            useCache: true,
            generateThumbnail: false // Already generated in preload
          });
          results.set(snippet.id, result);
        } catch (error) {
          results.set(snippet.id, {
            html: '',
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Batch preview generation failed:', error);

      // Return empty results for all snippets
      requests.forEach(({ snippet }) => {
        results.set(snippet.id, {
          html: '',
          success: false,
          error: 'Batch generation failed'
        });
      });

      return results;
    }
  }

  /**
   * Generate thumbnail for a snippet
   */
  async generateThumbnail(
    snippet: Snippet,
    parameters: Record<string, any> = {},
    options: {
      width?: number;
      height?: number;
      quality?: number;
      format?: 'png' | 'jpeg' | 'webp';
    } = {}
  ): Promise<string | null> {
    const thumbnailOptions = {
      width: options.width || this.options.thumbnailSize.width,
      height: options.height || this.options.thumbnailSize.height,
      quality: options.quality || 0.8,
      format: options.format || 'png' as const
    };

    try {
      return await SnippetPreviewUtils.generateThumbnail(snippet, parameters, thumbnailOptions);
    } catch (error) {
      console.error('Thumbnail generation failed:', error);
      return null;
    }
  }

  /**
   * Batch generate thumbnails
   */
  async generateThumbnailBatch(
    requests: Array<{ snippet: Snippet; parameters?: Record<string, any> }>,
    options: {
      onProgress?: (completed: number, total: number) => void;
      batchSize?: number;
      width?: number;
      height?: number;
    } = {}
  ): Promise<Map<string, string | null>> {
    const thumbnailOptions = {
      width: options.width || this.options.thumbnailSize.width,
      height: options.height || this.options.thumbnailSize.height,
      onProgress: options.onProgress,
      batchSize: options.batchSize || 3
    };

    return await SnippetPreviewUtils.generateThumbnailBatch(
      requests.map(({ snippet, parameters = {} }) => ({ snippet, parameters })),
      thumbnailOptions
    );
  }

  /**
   * Clear cache for specific snippet or all snippets
   */
  clearCache(snippetId?: string): void {
    SnippetPreviewUtils.clearCache(snippetId);
  }

  /**
   * Invalidate cache when snippet content changes
   */
  invalidateSnippetCache(snippetId: string, newVersion?: number): void {
    SnippetPreviewUtils.invalidateSnippetCache(snippetId, newVersion);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { totalEntries: number; totalSize: number; oldestEntry?: number } {
    return SnippetPreviewUtils.getCacheStats();
  }

  /**
   * Clean up old cache entries
   */
  cleanupCache(): number {
    return SnippetPreviewUtils.cleanupCache(this.options.cacheTimeout);
  }

  /**
   * Warm up cache with frequently used snippets
   */
  async warmCache(
    snippets: Array<{ snippet: Snippet; parameters?: Record<string, any> }>,
    options: { generateThumbnails?: boolean } = {}
  ): Promise<void> {
    const { generateThumbnails = this.options.enableThumbnails } = options;

    try {
      await this.generatePreviewBatch(snippets, {
        generateThumbnails,
        batchSize: 3 // Smaller batch size for warming
      });

      console.log(`Cache warmed for ${snippets.length} snippets`);
    } catch (error) {
      console.error('Cache warming failed:', error);
    }
  }

  /**
   * Validate snippet parameters before preview generation
   */
  validateParameters(
    snippet: Snippet,
    parameters: Record<string, any>
  ): { isValid: boolean; errors: string[]; warnings: string[] } {
    const result = SnippetPreviewUtils.validateParameters(
      snippet.parameters || [],
      parameters
    );

    return {
      isValid: result.isValid,
      errors: result.errors,
      warnings: [] // No warnings in current implementation
    };
  }

  /**
   * Get preview generation queue status
   */
  getQueueStatus(): {
    queueLength: number;
    activeRenders: number;
    maxConcurrentRenders: number;
  } {
    // This would need to be implemented in SnippetPreviewUtils
    // For now, return placeholder values
    return {
      queueLength: 0,
      activeRenders: 0,
      maxConcurrentRenders: this.options.maxConcurrentRenders
    };
  }
}

// Export singleton instance
export const snippetPreviewService = new SnippetPreviewService();
