import { PerformanceCache } from './performanceOptimizations';
import type { Snippet } from '@/types/template';

interface SnippetCacheEntry {
  snippet: Snippet;
  version: number;
  lastAccessed: number;
  accessCount: number;
}

interface PreviewCacheEntry {
  html: string;
  thumbnailUrl?: string;
  parameters: Record<string, any>;
  timestamp: number;
  renderTime: number;
  size: number; // Approximate size in bytes
}

interface ThumbnailCacheEntry {
  url: string;
  timestamp: number;
  size: number;
  format: string;
}

interface CacheStats {
  snippets: {
    total: number;
    size: number;
    hitRate: number;
    avgAccessTime: number;
  };
  previews: {
    total: number;
    size: number;
    hitRate: number;
    avgRenderTime: number;
  };
  thumbnails: {
    total: number;
    size: number;
    hitRate: number;
  };
  memory: {
    used: number;
    limit: number;
    percentage: number;
  };
}

export class SnippetCacheManager {
  private static instance: SnippetCacheManager;

  // Cache instances
  private snippetCache: PerformanceCache<SnippetCacheEntry>;
  private previewCache: PerformanceCache<PreviewCacheEntry>;
  private thumbnailCache: PerformanceCache<ThumbnailCacheEntry>;

  // Performance tracking
  private hitCounts = { snippets: 0, previews: 0, thumbnails: 0 };
  private missCounts = { snippets: 0, previews: 0, thumbnails: 0 };
  private renderTimes: number[] = [];

  // Configuration
  private readonly MAX_MEMORY_USAGE = 50 * 1024 * 1024; // 50MB
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private readonly PRELOAD_BATCH_SIZE = 5;

  private cleanupTimer?: NodeJS.Timeout;

  private constructor() {
    // Initialize caches with different configurations
    this.snippetCache = new PerformanceCache<SnippetCacheEntry>(200, 30 * 60 * 1000); // 30 min TTL
    this.previewCache = new PerformanceCache<PreviewCacheEntry>(100, 10 * 60 * 1000); // 10 min TTL
    this.thumbnailCache = new PerformanceCache<ThumbnailCacheEntry>(150, 60 * 60 * 1000); // 60 min TTL

    this.startCleanupTimer();
    this.setupMemoryMonitoring();
  }

  public static getInstance(): SnippetCacheManager {
    if (!SnippetCacheManager.instance) {
      SnippetCacheManager.instance = new SnippetCacheManager();
    }
    return SnippetCacheManager.instance;
  }

  // Snippet caching methods
  public cacheSnippet(snippet: Snippet): void {
    const entry: SnippetCacheEntry = {
      snippet,
      version: snippet.version || 1,
      lastAccessed: Date.now(),
      accessCount: 0
    };

    this.snippetCache.set(snippet.id, entry);
    this.saveToLocalStorage('snippets', snippet.id, entry);
  }

  public getSnippet(snippetId: string): Snippet | null {
    const startTime = performance.now();

    let entry = this.snippetCache.get(snippetId);

    // Try local storage if not in memory cache
    if (!entry) {
      entry = this.loadFromLocalStorage('snippets', snippetId);
      if (entry) {
        this.snippetCache.set(snippetId, entry);
      }
    }

    if (entry) {
      entry.lastAccessed = Date.now();
      entry.accessCount++;
      this.hitCounts.snippets++;

      // Track access time for performance monitoring
      const accessTime = performance.now() - startTime;
      this.trackAccessTime(accessTime);

      return entry.snippet;
    }

    this.missCounts.snippets++;
    return null;
  }

  public invalidateSnippet(snippetId: string): void {
    this.snippetCache.delete(snippetId);
    this.removeFromLocalStorage('snippets', snippetId);

    // Also invalidate related previews and thumbnails
    this.invalidateSnippetPreviews(snippetId);
    this.invalidateSnippetThumbnails(snippetId);
  }

  // Preview caching methods
  public cachePreview(
    snippetId: string,
    parameters: Record<string, any>,
    html: string,
    renderTime: number,
    thumbnailUrl?: string
  ): void {
    const cacheKey = this.getPreviewCacheKey(snippetId, parameters);
    const size = this.estimateSize(html);

    const entry: PreviewCacheEntry = {
      html,
      thumbnailUrl,
      parameters: { ...parameters },
      timestamp: Date.now(),
      renderTime,
      size
    };

    this.previewCache.set(cacheKey, entry);
    this.renderTimes.push(renderTime);

    // Keep only last 100 render times for statistics
    if (this.renderTimes.length > 100) {
      this.renderTimes = this.renderTimes.slice(-100);
    }

    // Save to local storage for persistence (with size limit)
    if (size < 100 * 1024) { // Only cache previews smaller than 100KB
      this.saveToLocalStorage('previews', cacheKey, entry);
    }
  }

  public getPreview(snippetId: string, parameters: Record<string, any>): PreviewCacheEntry | null {
    const cacheKey = this.getPreviewCacheKey(snippetId, parameters);

    let entry = this.previewCache.get(cacheKey);

    // Try local storage if not in memory cache
    if (!entry) {
      entry = this.loadFromLocalStorage('previews', cacheKey);
      if (entry) {
        this.previewCache.set(cacheKey, entry);
      }
    }

    if (entry) {
      this.hitCounts.previews++;
      return entry;
    }

    this.missCounts.previews++;
    return null;
  }

  private invalidateSnippetPreviews(snippetId: string): void {
    // Remove all previews for this snippet
    const keysToRemove: string[] = [];

    // We need to iterate through cache keys to find matches
    // This is a limitation of the current cache implementation
    // In a production system, we'd maintain an index

    this.removeFromLocalStorageByPrefix('previews', snippetId);
  }

  // Thumbnail caching methods
  public cacheThumbnail(
    snippetId: string,
    parameters: Record<string, any>,
    url: string,
    format: string = 'png'
  ): void {
    const cacheKey = this.getThumbnailCacheKey(snippetId, parameters);
    const size = this.estimateThumbnailSize(url);

    const entry: ThumbnailCacheEntry = {
      url,
      timestamp: Date.now(),
      size,
      format
    };

    this.thumbnailCache.set(cacheKey, entry);
    this.saveToLocalStorage('thumbnails', cacheKey, entry);
  }

  public getThumbnail(snippetId: string, parameters: Record<string, any>): string | null {
    const cacheKey = this.getThumbnailCacheKey(snippetId, parameters);

    let entry = this.thumbnailCache.get(cacheKey);

    // Try local storage if not in memory cache
    if (!entry) {
      entry = this.loadFromLocalStorage('thumbnails', cacheKey);
      if (entry) {
        this.thumbnailCache.set(cacheKey, entry);
      }
    }

    if (entry) {
      this.hitCounts.thumbnails++;
      return entry.url;
    }

    this.missCounts.thumbnails++;
    return null;
  }

  private invalidateSnippetThumbnails(snippetId: string): void {
    this.removeFromLocalStorageByPrefix('thumbnails', snippetId);
  }

  // Batch operations for performance
  public async preloadSnippets(snippets: Snippet[]): Promise<void> {
    const batches = this.createBatches(snippets, this.PRELOAD_BATCH_SIZE);

    for (const batch of batches) {
      await Promise.all(
        batch.map(snippet => {
          return new Promise<void>(resolve => {
            // Use requestIdleCallback for non-blocking preloading
            if (typeof window.requestIdleCallback === 'function') {
              window.requestIdleCallback(() => {
                this.cacheSnippet(snippet);
                resolve();
              });
            } else {
              setTimeout(() => {
                this.cacheSnippet(snippet);
                resolve();
              }, 0);
            }
          });
        })
      );
    }
  }

  public async preloadPreviews(
    requests: Array<{ snippetId: string; parameters: Record<string, any> }>,
    onProgress?: (completed: number, total: number) => void
  ): Promise<void> {
    const batches = this.createBatches(requests, this.PRELOAD_BATCH_SIZE);
    let completed = 0;

    for (const batch of batches) {
      await Promise.all(
        batch.map(async request => {
          // Check if already cached
          const existing = this.getPreview(request.snippetId, request.parameters);
          if (!existing) {
            // Would trigger actual preview generation here
            // For now, just mark as completed
          }
          completed++;
          onProgress?.(completed, requests.length);
        })
      );
    }
  }

  // Cache management
  public clearCache(type?: 'snippets' | 'previews' | 'thumbnails'): void {
    if (!type || type === 'snippets') {
      this.snippetCache.clear();
      this.clearLocalStorage('snippets');
    }

    if (!type || type === 'previews') {
      this.previewCache.clear();
      this.clearLocalStorage('previews');
    }

    if (!type || type === 'thumbnails') {
      this.thumbnailCache.clear();
      this.clearLocalStorage('thumbnails');
    }

    // Reset statistics
    if (!type) {
      this.hitCounts = { snippets: 0, previews: 0, thumbnails: 0 };
      this.missCounts = { snippets: 0, previews: 0, thumbnails: 0 };
      this.renderTimes = [];
    }
  }

  public getStats(): CacheStats {
    const memoryUsage = this.estimateMemoryUsage();

    return {
      snippets: {
        total: this.snippetCache.getStats().size,
        size: this.estimateCacheSize('snippets'),
        hitRate: this.calculateHitRate('snippets'),
        avgAccessTime: this.calculateAverageAccessTime()
      },
      previews: {
        total: this.previewCache.getStats().size,
        size: this.estimateCacheSize('previews'),
        hitRate: this.calculateHitRate('previews'),
        avgRenderTime: this.calculateAverageRenderTime()
      },
      thumbnails: {
        total: this.thumbnailCache.getStats().size,
        size: this.estimateCacheSize('thumbnails'),
        hitRate: this.calculateHitRate('thumbnails')
      },
      memory: {
        used: memoryUsage,
        limit: this.MAX_MEMORY_USAGE,
        percentage: (memoryUsage / this.MAX_MEMORY_USAGE) * 100
      }
    };
  }

  // Utility methods
  private getPreviewCacheKey(snippetId: string, parameters: Record<string, any>): string {
    const paramString = JSON.stringify(parameters, Object.keys(parameters).sort());
    return `${snippetId}:${btoa(paramString)}`;
  }

  private getThumbnailCacheKey(snippetId: string, parameters: Record<string, any>): string {
    return `thumb:${this.getPreviewCacheKey(snippetId, parameters)}`;
  }

  private estimateSize(content: string): number {
    return new Blob([content]).size;
  }

  private estimateThumbnailSize(url: string): number {
    // Rough estimate based on data URL or assume average thumbnail size
    if (url.startsWith('data:')) {
      return Math.ceil(url.length * 0.75); // Base64 overhead
    }
    return 10 * 1024; // Assume 10KB for external URLs
  }

  private estimateMemoryUsage(): number {
    let total = 0;

    // Estimate snippet cache size
    total += this.estimateCacheSize('snippets');
    total += this.estimateCacheSize('previews');
    total += this.estimateCacheSize('thumbnails');

    return total;
  }

  private estimateCacheSize(type: 'snippets' | 'previews' | 'thumbnails'): number {
    // Rough estimation - in production, you'd want more accurate measurement
    switch (type) {
      case 'snippets':
        return this.snippetCache.getStats().size * 2048; // ~2KB per snippet
      case 'previews':
        return this.previewCache.getStats().size * 10240; // ~10KB per preview
      case 'thumbnails':
        return this.thumbnailCache.getStats().size * 5120; // ~5KB per thumbnail
      default:
        return 0;
    }
  }

  private calculateHitRate(type: 'snippets' | 'previews' | 'thumbnails'): number {
    const hits = this.hitCounts[type];
    const misses = this.missCounts[type];
    const total = hits + misses;

    return total > 0 ? (hits / total) * 100 : 0;
  }

  private calculateAverageAccessTime(): number {
    // This would need to be tracked separately in a real implementation
    return 0;
  }

  private calculateAverageRenderTime(): number {
    if (this.renderTimes.length === 0) return 0;

    const sum = this.renderTimes.reduce((a, b) => a + b, 0);
    return sum / this.renderTimes.length;
  }

  private trackAccessTime(time: number): void {
    // Track access times for performance monitoring
    // Implementation would depend on specific requirements
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  // Local storage methods
  private saveToLocalStorage(type: string, key: string, data: any): void {
    try {
      const storageKey = `snippet-cache:${type}:${key}`;
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch (error) {
      console.warn('Failed to save to localStorage:', error);
      // Handle quota exceeded or other storage errors
      this.handleStorageError(type);
    }
  }

  private loadFromLocalStorage<T>(type: string, key: string): T | null {
    try {
      const storageKey = `snippet-cache:${type}:${key}`;
      const data = localStorage.getItem(storageKey);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.warn('Failed to load from localStorage:', error);
      return null;
    }
  }

  private removeFromLocalStorage(type: string, key: string): void {
    try {
      const storageKey = `snippet-cache:${type}:${key}`;
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.warn('Failed to remove from localStorage:', error);
    }
  }

  private removeFromLocalStorageByPrefix(type: string, prefix: string): void {
    try {
      const keys = Object.keys(localStorage);
      const targetPrefix = `snippet-cache:${type}:${prefix}`;

      keys.forEach(key => {
        if (key.startsWith(targetPrefix)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Failed to remove from localStorage by prefix:', error);
    }
  }

  private clearLocalStorage(type: string): void {
    try {
      const keys = Object.keys(localStorage);
      const targetPrefix = `snippet-cache:${type}:`;

      keys.forEach(key => {
        if (key.startsWith(targetPrefix)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Failed to clear localStorage:', error);
    }
  }

  private handleStorageError(type: string): void {
    // When storage quota is exceeded, clear oldest entries
    console.warn(`Storage quota exceeded for ${type}, clearing old entries`);

    // Clear half of the entries to make room
    switch (type) {
      case 'previews':
        // Clear preview cache as it's typically the largest
        this.clearLocalStorage('previews');
        break;
      case 'thumbnails':
        this.clearLocalStorage('thumbnails');
        break;
      default:
        // Clear all caches as last resort
        this.clearCache();
        break;
    }
  }

  // Cleanup and monitoring
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, this.CLEANUP_INTERVAL);
  }

  private performCleanup(): void {
    const memoryUsage = this.estimateMemoryUsage();

    if (memoryUsage > this.MAX_MEMORY_USAGE * 0.8) { // 80% threshold
      console.log('Memory usage high, performing cleanup');

      // Clear oldest preview cache entries first
      this.clearLocalStorage('previews');

      // If still high, clear thumbnails
      if (this.estimateMemoryUsage() > this.MAX_MEMORY_USAGE * 0.6) {
        this.clearLocalStorage('thumbnails');
      }
    }
  }

  private setupMemoryMonitoring(): void {
    // Monitor memory usage and performance
    if (typeof window.PerformanceObserver === 'function') {
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          entries.forEach(entry => {
            if (entry.entryType === 'measure') {
              // Track performance measurements
              console.debug(`Performance: ${entry.name} took ${entry.duration}ms`);
            }
          });
        });

        observer.observe({ entryTypes: ['measure'] });
      } catch (error) {
        console.warn('Performance monitoring not available:', error);
      }
    }
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}

// Export singleton instance
export const snippetCacheManager = SnippetCacheManager.getInstance();
