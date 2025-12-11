import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useOptimizedDebounce } from '@/utils/performanceOptimizations';
import { variableCacheManager } from '@/utils/variableCacheManager';
import { measureAsync } from '@/utils/performance';
import type { Variable, ComponentType } from '@/types/variable';

interface UseOptimizedVariableSearchOptions {
  debounceDelay?: number;
  minQueryLength?: number;
  maxResults?: number;
  contextType?: ComponentType;
  enableCaching?: boolean;
  enablePreloading?: boolean;
  onSearchStart?: () => void;
  onSearchComplete?: (results: Variable[], duration: number) => void;
  onError?: (error: Error) => void;
}

interface UseOptimizedVariableSearchResult {
  // State
  query: string;
  results: Variable[];
  isSearching: boolean;
  error: string | null;
  hasMore: boolean;
  searchStats: {
    totalResults: number;
    searchTime: number;
    cacheHit: boolean;
  };

  // Actions
  setQuery: (query: string) => void;
  clearQuery: () => void;
  clearResults: () => void;
  retrySearch: () => void;

  // Utilities
  getResultsByCategory: () => Record<string, Variable[]>;
  getHighlightedResults: (highlightQuery?: string) => Array<Variable & { highlighted: string }>;
}

const DEFAULT_OPTIONS: Required<UseOptimizedVariableSearchOptions> = {
  debounceDelay: 300,
  minQueryLength: 1,
  maxResults: 50,
  contextType: undefined as any,
  enableCaching: true,
  enablePreloading: true,
  onSearchStart: () => {},
  onSearchComplete: () => {},
  onError: () => {}
};

export const useOptimizedVariableSearch = (
  options: UseOptimizedVariableSearchOptions = {}
): UseOptimizedVariableSearchResult => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // State
  const [query, setQueryState] = useState('');
  const [results, setResults] = useState<Variable[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchStats, setSearchStats] = useState({
    totalResults: 0,
    searchTime: 0,
    cacheHit: false
  });

  // Refs for tracking
  const searchAbortController = useRef<AbortController | null>(null);
  const lastSearchQuery = useRef<string>('');
  const searchStartTime = useRef<number>(0);

  // Debounced query for actual searching
  const debouncedQuery = useOptimizedDebounce(query, opts.debounceDelay);

  // Memoized search function
  const performSearch = useCallback(async (searchQuery: string): Promise<Variable[]> => {
    if (!searchQuery || searchQuery.length < opts.minQueryLength) {
      return [];
    }

    // Cancel any ongoing search
    if (searchAbortController.current) {
      searchAbortController.current.abort();
    }

    searchAbortController.current = new AbortController();
    const signal = searchAbortController.current.signal;

    try {
      setIsSearching(true);
      setError(null);
      opts.onSearchStart();

      searchStartTime.current = performance.now();

      // Perform the search with caching if enabled
      const searchResults = await measureAsync(
        'variable-search',
        async () => {
          if (signal.aborted) {
            throw new Error('Search aborted');
          }

          if (opts.enableCaching) {
            return variableCacheManager.searchVariables(
              searchQuery,
              opts.contextType,
              false // Don't force refresh
            );
          } else {
            // Direct search without caching
            const { searchVariables } = await import('@/data/variableDefinitions');
            return searchVariables(searchQuery, opts.contextType);
          }
        }
      );

      if (signal.aborted) {
        return [];
      }

      // Limit results if specified
      const limitedResults = opts.maxResults > 0
        ? searchResults.slice(0, opts.maxResults)
        : searchResults;

      const searchTime = performance.now() - searchStartTime.current;
      const cacheStats = variableCacheManager.getStats();

      setSearchStats({
        totalResults: searchResults.length,
        searchTime,
        cacheHit: cacheStats.search.hitRate > 0
      });

      opts.onSearchComplete(limitedResults, searchTime);

      return limitedResults;

    } catch (err) {
      if (signal.aborted) {
        return [];
      }

      const error = err instanceof Error ? err : new Error('Search failed');
      setError(error.message);
      opts.onError(error);
      return [];
    } finally {
      setIsSearching(false);
    }
  }, [opts]);

  // Effect to perform search when debounced query changes
  useEffect(() => {
    if (debouncedQuery !== lastSearchQuery.current) {
      lastSearchQuery.current = debouncedQuery;

      performSearch(debouncedQuery).then(searchResults => {
        setResults(searchResults);
      });
    }
  }, [debouncedQuery, performSearch]);

  // Preload common searches on mount
  useEffect(() => {
    if (opts.enablePreloading && opts.enableCaching) {
      const preloadCommonSearches = async () => {
        const commonQueries = ['newsletter', 'subscriber', 'brand', 'title', 'name'];
        const contextTypes = opts.contextType ? [opts.contextType] : [];

        try {
          await variableCacheManager.preloadVariableData(
            ['newsletter', 'subscriber', 'brand', 'system'],
            contextTypes
          );
        } catch (error) {
          console.warn('Failed to preload variable data:', error);
        }
      };

      // Use requestIdleCallback for non-blocking preloading
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(preloadCommonSearches);
      } else {
        setTimeout(preloadCommonSearches, 100);
      }
    }
  }, [opts.enablePreloading, opts.enableCaching, opts.contextType]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (searchAbortController.current) {
        searchAbortController.current.abort();
      }
    };
  }, []);

  // Actions
  const setQuery = useCallback((newQuery: string) => {
    setQueryState(newQuery);
    setError(null);
  }, []);

  const clearQuery = useCallback(() => {
    setQueryState('');
    setResults([]);
    setError(null);
    setSearchStats({
      totalResults: 0,
      searchTime: 0,
      cacheHit: false
    });
  }, []);

  const clearResults = useCallback(() => {
    setResults([]);
    setSearchStats(prev => ({ ...prev, totalResults: 0 }));
  }, []);

  const retrySearch = useCallback(() => {
    if (query) {
      setError(null);
      performSearch(query).then(searchResults => {
        setResults(searchResults);
      });
    }
  }, [query, performSearch]);

  // Utility functions
  const getResultsByCategory = useCallback((): Record<string, Variable[]> => {
    const categorized: Record<string, Variable[]> = {};

    results.forEach(variable => {
      const category = variable.category;
      if (!categorized[category]) {
        categorized[category] = [];
      }
      categorized[category].push(variable);
    });

    return categorized;
  }, [results]);

  const getHighlightedResults = useCallback((highlightQuery?: string): Array<Variable & { highlighted: string }> => {
    const queryToHighlight = highlightQuery || query;

    if (!queryToHighlight) {
      return results.map(variable => ({
        ...variable,
        highlighted: variable.name
      }));
    }

    const regex = new RegExp(`(${queryToHighlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');

    return results.map(variable => ({
      ...variable,
      highlighted: variable.name.replace(regex, '<mark>$1</mark>')
    }));
  }, [results, query]);

  // Memoized computed values
  const hasMore = useMemo(() => {
    return opts.maxResults > 0 && searchStats.totalResults > opts.maxResults;
  }, [opts.maxResults, searchStats.totalResults]);

  return {
    // State
    query,
    results,
    isSearching,
    error,
    hasMore,
    searchStats,

    // Actions
    setQuery,
    clearQuery,
    clearResults,
    retrySearch,

    // Utilities
    getResultsByCategory,
    getHighlightedResults
  };
};
