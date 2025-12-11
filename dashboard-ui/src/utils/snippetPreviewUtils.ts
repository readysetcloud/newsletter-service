import { templateService } from '../services/templateService';
import type { Snippet, SnippetParameter } from '@/types/template';

interface PreviewCache {
  [key: string]: {
    html: string;
    timestamp: number;
    parameters: Record<string, any>;
    snippetVersion?: number;
    thumbnailUrl?: string;
  };
}

interface PreviewOptions {
  useCache?: boolean;
  cacheTimeout?: number; // in milliseconds
  fallbackOnError?: boolean;
  maxRenderTime?: number; // in milliseconds
  generateThumbnail?: boolean;
}

interface PreviewResult {
  html: string;
  success: boolean;
  error?: string;
  fromCache?: boolean;
  renderTime?: number;
  thumbnailUrl?: string;
}

interface ThumbnailOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'png' | 'jpeg' | 'webp';
  backgroundColor?: string;
  scale?: number;
}

interface PreviewQueueItem {
  resolve: (result: PreviewResult) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

class SnippetPreviewUtils {
  private static previewCache: PreviewCache = {};
  private static renderQueue = new Map<string, PreviewQueueItem[]>();
  private static thumbnailCache = new Map<string, string>();
  private static readonly DEFAULT_CACHE_TIMEOUT = 10 * 60 * 1000; // 10 minutes
  private static readonly DEFAULT_MAX_RENDER_TIME = 5000; // 5 seconds
  private static readonly THUMBNAIL_CACHE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private static readonly MAX_CONCURRENT_RENDERS = 3;
  private static activeRenders = 0;

  /**
   * Generate a cache key for preview caching
   */
  private static getCacheKey(snippetId: string, parameters: Record<string, any>): string {
    const paramString = JSON.stringify(parameters, Object.keys(parameters).sort());
    return `${snippetId}:${btoa(paramString)}`;
  }

  /**
   * Check if cached preview is still valid
   */
  private static isCacheValid(cacheEntry: PreviewCache[string], timeout: number, snippet?: Snippet): boolean {
    const now = Date.now();
    const timeValid = (now - cacheEntry.timestamp) < timeout;

    // Also check if snippet version has changed
    if (snippet && cacheEntry.snippetVersion !== undefined) {
      return timeValid && cacheEntry.snippetVersion === snippet.version;
    }

    return timeValid;
  }

  /**
   * Generate preview HTML for a snippet with given parameters
   */
  static async generatePreview(
    snippet: Snippet,
    parameters: Record<string, any> = {},
    options: PreviewOptions = {}
  ): Promise<PreviewResult> {
    const {
      useCache = true,
      cacheTimeout = this.DEFAULT_CACHE_TIMEOUT,
      fallbackOnError = true,
      maxRenderTime = this.DEFAULT_MAX_RENDER_TIME,
      generateThumbnail = false
    } = options;

    const cacheKey = this.getCacheKey(snippet.id, parameters);
    const startTime = Date.now();

    // Check cache first
    if (useCache && this.previewCache[cacheKey]) {
      const cached = this.previewCache[cacheKey];
      if (this.isCacheValid(cached, cacheTimeout, snippet)) {
        return {
          html: cached.html,
          success: true,
          fromCache: true,
          renderTime: 0,
          thumbnailUrl: cached.thumbnailUrl
        };
      }
    }

    // Check if already rendering - queue the request
    if (this.renderQueue.has(cacheKey)) {
      return this.waitForRender(cacheKey, maxRenderTime);
    }

    // Check concurrent render limit
    if (this.activeRenders >= this.MAX_CONCURRENT_RENDERS) {
      return this.queueRender(snippet, parameters, options);
    }

    this.renderQueue.set(cacheKey, []);
    this.activeRenders++;

    try {
      // Validate parameters before rendering
      const validationResult = this.validateParameters(snippet.parameters || [], parameters);
      if (!validationResult.isValid) {
        throw new Error(`Parameter validation failed: ${validationResult.errors.join(', ')}`);
      }

      // Set timeout for rendering
      const renderPromise = this.performRender(snippet, parameters);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Preview generation timeout')), maxRenderTime);
      });

      const response = await Promise.race([renderPromise, timeoutPromise]);
      const renderTime = Date.now() - startTime;

      if (response.success && response.html) {
        let thumbnailUrl: string | undefined | null;

        // Generate thumbnail if requested
        if (generateThumbnail) {
          try {
            thumbnailUrl = await this.generateThumbnail(snippet, parameters, {
              width: 300,
              height: 200
            });
          } catch (thumbnailError) {
            console.warn('Failed to generate thumbnail:', thumbnailError);
          }
        }

        // Cache successful result
        if (useCache) {
          this.previewCache[cacheKey] = {
            html: response.html,
            timestamp: Date.now(),
            parameters: { ...parameters },
            snippetVersion: snippet.version,
            thumbnailUrl: thumbnailUrl || undefined
          };
        }

        const result: PreviewResult = {
          html: response.html,
          success: true,
          renderTime,
          thumbnailUrl: thumbnailUrl || undefined,
          fromCache: false
        };

        // Resolve any queued requests
        this.resolveQueuedRequests(cacheKey, result);

        return result;
      } else {
        throw new Error(response.message || 'Preview generation failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Don't use fallback for validation errors or timeouts
      const isValidationError = errorMessage.includes('Parameter validation failed');
      const isTimeoutError = errorMessage.includes('timeout');

      // Try fallback strategies (but not for validation errors or timeouts)
      if (fallbackOnError && !isValidationError && !isTimeoutError) {
        const fallbackHtml = this.generateFallbackPreview(snippet, parameters);
        if (fallbackHtml) {
          const result: PreviewResult = {
            html: fallbackHtml,
            success: true,
            error: `Fallback used: ${errorMessage}`,
            renderTime: Date.now() - startTime,
            fromCache: false
          };

          this.resolveQueuedRequests(cacheKey, result);
          return result;
        }
      }

      const errorResult: PreviewResult = {
        html: '',
        success: false,
        error: errorMessage,
        renderTime: Date.now() - startTime,
        fromCache: false
      };

      this.rejectQueuedRequests(cacheKey, new Error(errorMessage));
      return errorResult;
    } finally {
      this.renderQueue.delete(cacheKey);
      this.activeRenders--;
    }
  }

  /**
   * Perform the actual render operation
   */
  private static async performRender(
    snippet: Snippet,
    parameters: Record<string, any>
  ): Promise<{ html: string; success: boolean; message?: string }> {
    try {
      return await templateService.previewSnippet(snippet.id, { parameters });
    } catch (error) {
      return {
        html: '',
        success: false,
        message: error instanceof Error ? error.message : 'Render failed'
      };
    }
  }

  /**
   * Queue a render request when at concurrent limit
   */
  private static async queueRender(
    snippet: Snippet,
    parameters: Record<string, any>,
    options: PreviewOptions
  ): Promise<PreviewResult> {
    const cacheKey = this.getCacheKey(snippet.id, parameters);

    return new Promise((resolve, reject) => {
      const queueItem: PreviewQueueItem = {
        resolve,
        reject,
        timestamp: Date.now()
      };

      if (!this.renderQueue.has(cacheKey)) {
        this.renderQueue.set(cacheKey, []);
      }

      this.renderQueue.get(cacheKey)!.push(queueItem);

      // Set timeout for queued request
      setTimeout(() => {
        reject(new Error('Queued render timeout'));
      }, options.maxRenderTime || this.DEFAULT_MAX_RENDER_TIME);
    });
  }

  /**
   * Wait for an ongoing render to complete
   */
  private static async waitForRender(cacheKey: string, maxWaitTime: number): Promise<PreviewResult> {
    return new Promise((resolve, reject) => {
      const queueItem: PreviewQueueItem = {
        resolve,
        reject,
        timestamp: Date.now()
      };

      const queue = this.renderQueue.get(cacheKey);
      if (queue) {
        queue.push(queueItem);
      }

      // Set timeout
      setTimeout(() => {
        reject(new Error('Render wait timeout'));
      }, maxWaitTime);
    });
  }

  /**
   * Resolve all queued requests for a cache key
   */
  private static resolveQueuedRequests(cacheKey: string, result: PreviewResult): void {
    const queue = this.renderQueue.get(cacheKey);
    if (queue) {
      queue.forEach(item => {
        try {
          item.resolve(result);
        } catch (error) {
          console.warn('Error resolving queued request:', error);
        }
      });
    }
  }

  /**
   * Reject all queued requests for a cache key
   */
  private static rejectQueuedRequests(cacheKey: string, error: Error): void {
    const queue = this.renderQueue.get(cacheKey);
    if (queue) {
      queue.forEach(item => {
        try {
          item.reject(error);
        } catch (rejectionError) {
          console.warn('Error rejecting queued request:', rejectionError);
        }
      });
    }
  }

  /**
   * Generate a fallback preview when rendering fails
   */
  private static generateFallbackPreview(snippet: Snippet, parameters: Record<string, any>): string {
    const paramList = Object.entries(parameters)
      .map(([key, value]) => `<li><strong>${key}:</strong> ${String(value)}</li>`)
      .join('');

    return `
      <div style="border: 2px dashed #ccc; padding: 16px; border-radius: 8px; background: #f9f9f9;">
        <h3 style="margin: 0 0 12px 0; color: #666;">${snippet.name}</h3>
        <p style="margin: 0 0 12px 0; color: #888; font-size: 14px;">
          ${snippet.description || 'No description available'}
        </p>
        ${paramList ? `
          <div style="margin-top: 12px;">
            <strong style="color: #666;">Parameters:</strong>
            <ul style="margin: 4px 0 0 0; padding-left: 20px; color: #666;">
              ${paramList}
            </ul>
          </div>
        ` : ''}
        <div style="margin-top: 12px; font-size: 12px; color: #999;">
          Preview unavailable - using fallback display
        </div>
      </div>
    `;
  }

  /**
   * Validate snippet parameters
   */
  static validateParameters(
    parameterDefinitions: SnippetParameter[],
    providedParameters: Record<string, any>
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const param of parameterDefinitions) {
      const value = providedParameters[param.name];

      // Check required parameters
      if (param.required && (value === undefined || value === null || value === '')) {
        errors.push(`Parameter '${param.name}' is required`);
        continue;
      }

      // Skip validation if parameter is not provided and not required
      if (value === undefined || value === null) {
        continue;
      }

      // Type validation
      switch (param.type) {
        case 'string':
          if (typeof value !== 'string') {
            errors.push(`Parameter '${param.name}' must be a string`);
          }
          break;
        case 'number':
          if (typeof value !== 'number' || isNaN(value)) {
            errors.push(`Parameter '${param.name}' must be a valid number`);
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean') {
            errors.push(`Parameter '${param.name}' must be a boolean`);
          }
          break;
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Generate thumbnail for snippet preview
   */
  static async generateThumbnail(
    snippet: Snippet,
    parameters: Record<string, any> = {},
    options: ThumbnailOptions = {}
  ): Promise<string | null> {
    const {
      width = 300,
      height = 200,
      quality = 0.8,
      format = 'png',
      backgroundColor = '#ffffff',
      scale = 1
    } = options;

    const thumbnailKey = `${snippet.id}:${JSON.stringify(parameters)}:${width}x${height}`;

    // Check thumbnail cache first
    if (this.thumbnailCache.has(thumbnailKey)) {
      const cached = this.thumbnailCache.get(thumbnailKey)!;
      const cacheAge = Date.now() - parseInt(cached.split(':')[0]);
      if (cacheAge < this.THUMBNAIL_CACHE_TIMEOUT) {
        return cached.split(':').slice(1).join(':');
      }
    }

    try {
      const previewResult = await this.generatePreview(snippet, parameters, {
        useCache: true,
        fallbackOnError: true,
        generateThumbnail: false // Prevent infinite recursion
      });

      if (!previewResult.success || !previewResult.html) {
        return this.generateFallbackThumbnail(snippet, options);
      }

      const thumbnailUrl = await this.renderHtmlToThumbnail(
        previewResult.html,
        { width, height, quality, format, backgroundColor, scale }
      );

      // Cache the thumbnail
      if (thumbnailUrl) {
        this.thumbnailCache.set(thumbnailKey, `${Date.now()}:${thumbnailUrl}`);
      }

      return thumbnailUrl;
    } catch (error) {
      console.error('Error generating thumbnail:', error);
      return this.generateFallbackThumbnail(snippet, options);
    }
  }

  /**
   * Render HTML content to thumbnail using canvas
   */
  private static async renderHtmlToThumbnail(
    html: string,
    options: Required<ThumbnailOptions>
  ): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        // Create a temporary container
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.top = '-9999px';
        container.style.width = `${options.width}px`;
        container.style.height = `${options.height}px`;
        container.style.overflow = 'hidden';
        container.style.backgroundColor = options.backgroundColor;
        container.style.transform = `scale(${options.scale})`;
        container.style.transformOrigin = 'top left';

        // Add styles for better rendering
        container.style.fontFamily = 'Arial, sans-serif';
        container.style.fontSize = '14px';
        container.style.lineHeight = '1.4';

        container.innerHTML = html;
        document.body.appendChild(container);

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = options.width * options.scale;
        canvas.height = options.height * options.scale;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          document.body.removeChild(container);
          resolve(null);
          return;
        }

        // Fill background
        ctx.fillStyle = options.backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Wait for any images or fonts to load
        setTimeout(() => {
          try {
            // In a real implementation, you would use html2canvas or similar
            // For now, create a simple placeholder thumbnail
            const placeholderThumbnail = this.createPlaceholderThumbnail(
              canvas,
              ctx,
              `${container.textContent?.substring(0, 50) || 'Snippet Preview'}...`,
              options
            );

            document.body.removeChild(container);
            resolve(placeholderThumbnail);
          } catch (error) {
            console.error('Error rendering to canvas:', error);
            document.body.removeChild(container);
            resolve(null);
          }
        }, 1000); // Wait 1 second for content to render
      } catch (error) {
        console.error('Error setting up thumbnail rendering:', error);
        resolve(null);
      }
    });
  }

  /**
   * Create a placeholder thumbnail when rendering fails
   */
  private static createPlaceholderThumbnail(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    text: string,
    options: Required<ThumbnailOptions>
  ): string {
    // Clear canvas
    ctx.fillStyle = options.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw border
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

    // Draw text
    ctx.fillStyle = '#666666';
    ctx.font = `${12 * options.scale}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Word wrap text
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    const maxWidth = canvas.width - 20 * options.scale;

    for (const word of words) {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    // Draw lines
    const lineHeight = 16 * options.scale;
    const startY = (canvas.height - (lines.length - 1) * lineHeight) / 2;

    lines.forEach((line, index) => {
      ctx.fillText(line, canvas.width / 2, startY + index * lineHeight);
    });

    return canvas.toDataURL(`image/${options.format}`, options.quality);
  }

  /**
   * Generate a fallback thumbnail for failed renders
   */
  private static generateFallbackThumbnail(
    snippet: Snippet,
    options: ThumbnailOptions
  ): string {
    const canvas = document.createElement('canvas');
    canvas.width = options.width || 300;
    canvas.height = options.height || 200;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return '';
    }

    return this.createPlaceholderThumbnail(
      canvas,
      ctx,
      `${snippet.name}\n${snippet.description || 'No preview available'}`,
      {
        width: options.width || 300,
        height: options.height || 200,
        quality: options.quality || 0.8,
        format: options.format || 'png',
        backgroundColor: options.backgroundColor || '#f5f5f5',
        scale: options.scale || 1
      }
    );
  }

  /**
   * Clear preview cache with enhanced invalidation
   */
  static clearCache(snippetId?: string): void {
    if (snippetId) {
      // Clear cache entries for specific snippet
      const keysToDelete = Object.keys(this.previewCache).filter(key =>
        key.startsWith(`${snippetId}:`)
      );
      keysToDelete.forEach(key => delete this.previewCache[key]);

      // Clear thumbnail cache for specific snippet
      const thumbnailKeysToDelete = Array.from(this.thumbnailCache.keys()).filter(key =>
        key.startsWith(`${snippetId}:`)
      );
      thumbnailKeysToDelete.forEach(key => this.thumbnailCache.delete(key));
    } else {
      // Clear entire cache
      this.previewCache = {};
      this.thumbnailCache.clear();
    }
  }

  /**
   * Invalidate cache when snippet content changes
   */
  static invalidateSnippetCache(snippetId: string, newVersion?: number): void {
    // Clear all cache entries for this snippet
    this.clearCache(snippetId);

    // Cancel any ongoing renders for this snippet
    const keysToCancel = Array.from(this.renderQueue.keys()).filter(key =>
      key.startsWith(`${snippetId}:`)
    );

    keysToCancel.forEach(key => {
      const queue = this.renderQueue.get(key);
      if (queue) {
        queue.forEach(item => {
          item.reject(new Error('Snippet content changed, render cancelled'));
        });
      }
      this.renderQueue.delete(key);
    });

    console.log(`Cache invalidated for snippet ${snippetId}${newVersion ? ` (version ${newVersion})` : ''}`);
  }

  /**
   * Get cache statistics
   */
  static getCacheStats(): { totalEntries: number; totalSize: number; oldestEntry?: number } {
    const entries = Object.values(this.previewCache);
    const totalEntries = entries.length;
    const totalSize = JSON.stringify(this.previewCache).length;
    const oldestEntry = entries.length > 0
      ? Math.min(...entries.map(entry => entry.timestamp))
      : undefined;

    return {
      totalEntries,
      totalSize,
      oldestEntry
    };
  }

  /**
   * Clean up old cache entries
   */
  static cleanupCache(maxAge: number = this.DEFAULT_CACHE_TIMEOUT): number {
    const now = Date.now();
    let removedCount = 0;

    Object.keys(this.previewCache).forEach(key => {
      const entry = this.previewCache[key];
      if (now - entry.timestamp > maxAge) {
        delete this.previewCache[key];
        removedCount++;
      }
    });

    return removedCount;
  }

  /**
   * Preload previews for multiple snippets with progress tracking
   */
  static async preloadPreviews(
    snippets: Array<{ snippet: Snippet; parameters?: Record<string, any> }>,
    options: PreviewOptions & {
      onProgress?: (completed: number, total: number) => void;
      batchSize?: number;
    } = {}
  ): Promise<{ successful: number; failed: number; errors: Array<{ snippetId: string; error: string }> }> {
    const { onProgress, batchSize = 5, ...previewOptions } = options;
    const results = { successful: 0, failed: 0, errors: [] as Array<{ snippetId: string; error: string }> };

    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < snippets.length; i += batchSize) {
      const batch = snippets.slice(i, i + batchSize);

      const batchPromises = batch.map(async ({ snippet, parameters = {} }) => {
        try {
          const result = await this.generatePreview(snippet, parameters, {
            ...previewOptions,
            useCache: true,
            generateThumbnail: true
          });

          if (result.success) {
            results.successful++;
          } else {
            results.failed++;
            results.errors.push({
              snippetId: snippet.id,
              error: result.error || 'Preview generation failed'
            });
          }
        } catch (error) {
          results.failed++;
          results.errors.push({
            snippetId: snippet.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          console.warn(`Failed to preload preview for snippet ${snippet.id}:`, error);
        }
      });

      await Promise.allSettled(batchPromises);

      if (onProgress) {
        onProgress(Math.min(i + batchSize, snippets.length), snippets.length);
      }
    }

    return results;
  }

  /**
   * Generate preview with enhanced error handling and retry logic
   */
  static async generatePreviewWithRetry(
    snippet: Snippet,
    parameters: Record<string, any> = {},
    options: PreviewOptions & { maxRetries?: number; retryDelay?: number } = {}
  ): Promise<PreviewResult> {
    const { maxRetries = 2, retryDelay = 1000, ...previewOptions } = options;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.generatePreview(snippet, parameters, previewOptions);

        // If we got a successful result or it's using fallback, return it
        if (result.success) {
          return result;
        }

        // If it's the last attempt, return the failed result
        if (attempt === maxRetries) {
          return result;
        }

        lastError = new Error(result.error || 'Preview generation failed');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        // If it's the last attempt, throw the error
        if (attempt === maxRetries) {
          throw lastError;
        }
      }

      // Wait before retrying
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
      }
    }

    // This should never be reached, but just in case
    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Batch generate thumbnails for snippet browser
   */
  static async generateThumbnailBatch(
    snippets: Array<{ snippet: Snippet; parameters?: Record<string, any> }>,
    options: ThumbnailOptions & {
      onProgress?: (completed: number, total: number) => void;
      batchSize?: number;
    } = {}
  ): Promise<Map<string, string | null>> {
    const { onProgress, batchSize = 3, ...thumbnailOptions } = options;
    const results = new Map<string, string | null>();

    for (let i = 0; i < snippets.length; i += batchSize) {
      const batch = snippets.slice(i, i + batchSize);

      const batchPromises = batch.map(async ({ snippet, parameters = {} }) => {
        try {
          const thumbnail = await this.generateThumbnail(snippet, parameters, thumbnailOptions);
          results.set(snippet.id, thumbnail);
        } catch (error) {
          console.warn(`Failed to generate thumbnail for snippet ${snippet.id}:`, error);
          results.set(snippet.id, null);
        }
      });

      await Promise.allSettled(batchPromises);

      if (onProgress) {
        onProgress(Math.min(i + batchSize, snippets.length), snippets.length);
      }
    }

    return results;
  }
}

export default SnippetPreviewUtils;
