import { PerformanceCache } from './performanceOptimizations';
import { VARIABLE_DEFINITIONS, searchVariables as baseSearchVariables } from '@/data/variableDefinitions';
import type { Variable, VariableDefinitions, ControlFlowHelper, ComponentType } from '@/types/variable';

interface VariableSearchCacheEntry {
  results: Variable[];
  timestamp: number;
  query: string;
  contextType?: ComponentType;
}

interface VariableFilterCacheEntry {
  variables: Variable[];
  timestamp: number;
  category: string;
  contextType?: ComponentType;
}

interface DefinitionsCacheEntry {
  definitions: VariableDefinitions;
  timestamp: number;
  version: '1.0.0'
}

interface CacheStats {
  search: {
    total: number;
    hitRate: number;
    avgResponseTime: number;
  };
  filter: {
    total: number;
    hitRate: number;
  };
  definitions: {
    total: number;
    hitRate: number;
    lastUpdated?: Date;
  };
  memory: {
    used: number;
    limit: number;
    percentage: number;
  };
}

export class VariableCacheManager {
  private static instance: VariableCacheManager;

  // Cache instances with different configurations
  private searchCache: PerformanceCache<VariableSearchCacheEntry>;
  private filterCache: PerformanceCache<VariableFilterCacheEntry>;
  private definitionsCache: PerformanceCache<DefinitionsCacheEntry>;

  // Performance tracking
  private searchHits = 0;
  private searchMisses = 0;
  private filterHits = 0;
  private filterMisses = 0;
  private definitionsHits = 0;
  private definitionsMisses = 0;
  private searchTimes: number[] = [];

  // Configuration
  private readonly SEARCH_CACHE_SIZE = 100;
  private readonly FILTER_CACHE_SIZE = 50;
  private readonly DEFINITIONS_CACHE_SIZE = 10;
  private readonly SEARCH_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly FILTER_TTL = 10 * 60 * 1000; // 10 minutes
  private readonly DEFINITIONS_TTL = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_MEMORY_USAGE = 10 * 1024 * 1024; // 10MB

  private constructor() {
    this.searchCache = new PerformanceCache<VariableSearchCacheEntry>(
      this.SEARCH_CACHE_SIZE,
      this.SEARCH_TTL
    );
    this.filterCache = new PerformanceCache<VariableFilterCacheEntry>(
      this.FILTER_CACHE_SIZE,
      this.FILTER_TTL
    );
    this.definitionsCache = new PerformanceCache<DefinitionsCacheEntry>(
      this.DEFINITIONS_CACHE_SIZE,
      this.DEFINITIONS_TTL
    );

    this.setupMemoryMonitoring();
  }

  public static getInstance(): VariableCacheManager {
    if (!VariableCacheManager.instance) {
      VariableCacheManager.instance = new VariableCacheManager();
    }
    return VariableCacheManager.instance;
  }

  // Variable search with caching
  public searchVariables(
    query: string,
    contextType?: ComponentType,
    forceRefresh = false
  ): Variable[] {
    const startTime = performance.now();
    const cacheKey = this.getSearchCacheKey(query, contextType);

    // Check cache first (unless forcing refresh)
    if (!forceRefresh) {
      const cached = this.searchCache.get(cacheKey);
      if (cached) {
        this.searchHits++;
        const responseTime = performance.now() - startTime;
        this.trackSearchTime(responseTime);
        return cached.results;
      }
    }

    // Cache miss - perform search
    this.searchMisses++;
    const results = baseSearchVariables(query, contextType);

    // Cache the results
    const entry: VariableSearchCacheEntry = {
      results,
      timestamp: Date.now(),
      query,
      contextType
    };

    this.searchCache.set(cacheKey, entry);

    const responseTime = performance.now() - startTime;
    this.trackSearchTime(responseTime);

    return results;
  }

  // Variable filtering by category with caching
  public getVariablesByCategory(
    category: string,
    contextType?: ComponentType,
    forceRefresh = false
  ): Variable[] {
    const cacheKey = this.getFilterCacheKey(category, contextType);

    // Check cache first (unless forcing refresh)
    if (!forceRefresh) {
      const cached = this.filterCache.get(cacheKey);
      if (cached) {
        this.filterHits++;
        return cached.variables;
      }
    }

    // Cache miss - perform filtering
    this.filterMisses++;

    const definitions = this.getVariableDefinitions();
    let variables = definitions.categories[category as keyof typeof definitions.categories]?.variables || [];

    // Apply contextual filtering if specified
    if (contextType && definitions.contextualMappings[contextType]) {
      const mapping = definitions.contextualMappings[contextType];
      const excludedPaths = new Set(mapping.excluded);

      variables = variables.filter((variable: Variable) => !excludedPaths.has(variable.path));

      // Sort by priority
      variables.sort((a: Variable, b: Variable) => {
        const aIndex = mapping.priority.indexOf(a.path);
        const bIndex = mapping.priority.indexOf(b.path);

        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return a.name.localeCompare(b.name);
      });
    }

    // Cache the results
    const entry: VariableFilterCacheEntry = {
      variables,
      timestamp: Date.now(),
      category,
      contextType
    };

    this.filterCache.set(cacheKey, entry);

    return variables;
  }

  // Variable definitions with caching
  public getVariableDefinitions(forceRefresh = false): VariableDefinitions {
    const cacheKey = 'definitions';

    // Check cache first (unless forcing refresh)
    if (!forceRefresh) {
      const cached = this.definitionsCache.get(cacheKey);
      if (cached) {
        this.definitionsHits++;
        return cached.definitions;
      }
    }

    // Cache miss - load definitions
    this.definitionsMisses++;

    // In a real implementation, this might be an API call
    const definitions = VARIABLE_DEFINITIONS;

    // Cache the definitions
    const entry: DefinitionsCacheEntry = {
      definitions,
      timestamp: Date.now(),
      version: '1.0.0' // Would be from API response
    };

    this.definitionsCache.set(cacheKey, entry);

    return definitions;
  }

  // Control flow helpers with caching
  public getControlFlowHelpers(forceRefresh = false): ControlFlowHelper[] {
    const definitions = this.getVariableDefinitions(forceRefresh);
    return definitions.controlFlowHelpers;
  }

  // Batch operations for performance
  public async preloadVariableData(
    categories: string[],
    contextTypes: ComponentType[] = [],
    onProgress?: (completed: number, total: number) => void
  ): Promise<void> {
    const operations: Array<() => void> = [];

    // Preload category filters
    categories.forEach(category => {
      operations.push(() => this.getVariablesByCategory(category));

      // Also preload with context types
      contextTypes.forEach(contextType => {
        operations.push(() => this.getVariablesByCategory(category, contextType));
      });
    });

    // Preload common searches
    const commonQueries = ['newsletter', 'subscriber', 'brand', 'title', 'name', 'url', 'date'];
    commonQueries.forEach(query => {
      operations.push(() => this.searchVariables(query));

      // Also preload with context types
      contextTypes.forEach(contextType => {
        operations.push(() => this.searchVariables(query, contextType));
      });
    });

    // Execute operations in batches to avoid blocking
    const batchSize = 5;
    let completed = 0;

    for (let i = 0; i < operations.length; i += batchSize) {
      const batch = operations.slice(i, i + batchSize);

      await new Promise<void>(resolve => {
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(() => {
            batch.forEach(op => op());
            completed += batch.length;
            onProgress?.(completed, operations.length);
            resolve();
          });
        } else {
          setTimeout(() => {
            batch.forEach(op => op());
            completed += batch.length;
            onProgress?.(completed, operations.length);
            resolve();
          }, 0);
        }
      });
    }
  }

  // Cache invalidation
  public invalidateSearchCache(pattern?: string): void {
    if (pattern) {
      // Would need to implement pattern-based invalidation
      // For now, clear all search cache
      this.searchCache.clear();
    } else {
      this.searchCache.clear();
    }
  }

  public invalidateFilterCache(category?: string): void {
    if (category) {
      // Would need to implement category-based invalidation
      // For now, clear all filter cache
      this.filterCache.clear();
    } else {
      this.filterCache.clear();
    }
  }

  public invalidateDefinitionsCache(): void {
    this.definitionsCache.clear();
  }

  public invalidateAllCaches(): void {
    this.searchCache.clear();
    this.filterCache.clear();
    this.definitionsCache.clear();

    // Reset statistics
    this.searchHits = 0;
    this.searchMisses = 0;
    this.filterHits = 0;
    this.filterMisses = 0;
    this.definitionsHits = 0;
    this.definitionsMisses = 0;
    this.searchTimes = [];
  }

  // Cache statistics
  public getStats(): CacheStats {
    const memoryUsage = this.estimateMemoryUsage();

    return {
      search: {
        total: this.searchCache.getStats().size,
        hitRate: this.calculateHitRate(this.searchHits, this.searchMisses),
        avgResponseTime: this.calculateAverageSearchTime()
      },
      filter: {
        total: this.filterCache.getStats().size,
        hitRate: this.calculateHitRate(this.filterHits, this.filterMisses)
      },
      definitions: {
        total: this.definitionsCache.getStats().size,
        hitRate: this.calculateHitRate(this.definitionsHits, this.definitionsMisses),
        lastUpdated: this.getLastDefinitionsUpdate()
      },
      memory: {
        used: memoryUsage,
        limit: this.MAX_MEMORY_USAGE,
        percentage: (memoryUsage / this.MAX_MEMORY_USAGE) * 100
      }
    };
  }

  // Utility methods
  private getSearchCacheKey(query: string, contextType?: ComponentType): string {
    const normalizedQuery = query.toLowerCase().trim();
    return contextType ? `${normalizedQuery}:${contextType}` : normalizedQuery;
  }

  private getFilterCacheKey(category: string, contextType?: ComponentType): string {
    return contextType ? `${category}:${contextType}` : category;
  }

  private trackSearchTime(time: number): void {
    this.searchTimes.push(time);

    // Keep only last 100 measurements
    if (this.searchTimes.length > 100) {
      this.searchTimes = this.searchTimes.slice(-100);
    }
  }

  private calculateHitRate(hits: number, misses: number): number {
    const total = hits + misses;
    return total > 0 ? (hits / total) * 100 : 0;
  }

  private calculateAverageSearchTime(): number {
    if (this.searchTimes.length === 0) return 0;

    const sum = this.searchTimes.reduce((a, b) => a + b, 0);
    return sum / this.searchTimes.length;
  }

  private getLastDefinitionsUpdate(): Date | undefined {
    const cached = this.definitionsCache.get('definitions');
    return cached ? new Date(cached.timestamp) : undefined;
  }

  private estimateMemoryUsage(): number {
    // Rough estimation of memory usage
    const searchSize = this.searchCache.getStats().size * 1024; // ~1KB per search result
    const filterSize = this.filterCache.getStats().size * 2048; // ~2KB per filter result
    const definitionsSize = this.definitionsCache.getStats().size * 50 * 1024; // ~50KB per definition set

    return searchSize + filterSize + definitionsSize;
  }

  private setupMemoryMonitoring(): void {
    // Monitor memory usage periodically
    setInterval(() => {
      const stats = this.getStats();

      if (stats.memory.percentage > 80) {
        console.warn('Variable cache memory usage high:', stats.memory.percentage + '%');

        // Clear oldest search cache entries first
        this.searchCache.clear();

        // If still high, clear filter cache
        if (this.estimateMemoryUsage() > this.MAX_MEMORY_USAGE * 0.6) {
          this.filterCache.clear();
        }
      }
    }, 60000); // Check every minute
  }

  public destroy(): void {
    this.invalidateAllCaches();
  }
}

// Export singleton instance
export const variableCacheManager = VariableCacheManager.getInstance();
