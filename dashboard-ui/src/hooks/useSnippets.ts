import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { templateService } from '../services/templateService';
import { useLocalStorage } from './useLocalStorage';
import { useOptimizedDebounce, useIdleCallback } from '@/utils/performanceOptimizations';
import { snippetCacheManager } from '@/utils/snippetCacheManager';
import type { Snippet, SnippetFilters } from '@/types/template';

interface SnippetUsage {
  snippetId: string;
  parameters: Record<string, any>;
  timestamp: Date;
  templateId?: string;
}

interface SnippetCache {
  snippets: Map<string, Snippet>;
  lastUpdated: Date | string; // Can be string when loaded from localStorage
  version: number;
}

interface UseSnippetsOptions {
  enableCache?: boolean;
  cacheTimeout?: number; // in milliseconds
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
}

interface UseSnippetsResult {
  // Data
  snippets: Snippet[];
  loading: boolean;
  error: string | null;

  // Filtered data
  filteredSnippets: Snippet[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Favorites and history
  favorites: string[];
  recentlyUsed: SnippetUsage[];

  // Actions
  loadSnippets: () => Promise<void>;
  refreshSnippets: () => Promise<void>;
  toggleFavorite: (snippetId: string) => void;
  addToHistory: (usage: SnippetUsage) => void;
  clearHistory: () => void;

  // Cache management
  invalidateCache: (snippetId?: string) => void;
  getCachedSnippet: (snippetId: string) => Snippet | null;
  preloadSnippets: (snippets: Snippet[]) => Promise<void>;
}

const CACHE_KEY = 'snippet-cache';
const FAVORITES_KEY = 'snippet-favorites';
const HISTORY_KEY = 'snippet-history';
const DEFAULT_CACHE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const MAX_HISTORY_ITEMS = 50;

export const useSnippets = (options: UseSnippetsOptions = {}): UseSnippetsResult => {
  const {
    enableCache = true,
    cacheTimeout = DEFAULT_CACHE_TIMEOUT,
    autoRefresh = false,
    refreshInterval = 30000 // 30 seconds
  } = options;

  // State
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Optimized debounced search for performance
  const debouncedSearchQuery = useOptimizedDebounce(searchQuery, 300);

  // Persistent storage
  const [favorites, setFavorites] = useLocalStorage<string[]>(FAVORITES_KEY, []);
  const [recentlyUsed, setRecentlyUsed] = useLocalStorage<SnippetUsage[]>(HISTORY_KEY, []);
  const [cache, setCache] = useLocalStorage<SnippetCache | null>(CACHE_KEY, null);

  // Use ref to avoid cache dependency in loadSnippets
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  // Use ref for setCache to avoid dependency issues
  const setCacheRef = useRef(setCache);
  setCacheRef.current = setCache;

  // Cache management
  const isCacheValid = useCallback((cacheData: SnippetCache | null): boolean => {
    if (!cacheData || !enableCache) return false;

    try {
      const now = new Date();

      // Handle case where lastUpdated might be a string from localStorage
      const lastUpdated = cacheData.lastUpdated instanceof Date
        ? cacheData.lastUpdated
        : new Date(cacheData.lastUpdated);

      // Validate that we have a valid date
      if (isNaN(lastUpdated.getTime())) {
        console.warn('Invalid cache date detected, treating cache as invalid');
        return false;
      }

      const cacheAge = now.getTime() - lastUpdated.getTime();
      return cacheAge < cacheTimeout;
    } catch (error) {
      console.warn('Error validating cache:', error);
      return false;
    }
  }, [enableCache, cacheTimeout]);

  const updateCache = useCallback((newSnippets: Snippet[]) => {
    if (!enableCache) return;

    try {
      // Use the enhanced cache manager
      newSnippets.forEach(snippet => {
        snippetCacheManager.cacheSnippet(snippet);
      });

      const snippetMap = new Map<string, Snippet>();
      newSnippets.forEach(snippet => {
        snippetMap.set(snippet.id, snippet);
      });

      setCacheRef.current(prevCache => {
        const newCache: SnippetCache = {
          snippets: snippetMap,
          lastUpdated: new Date(),
          version: (prevCache?.version || 0) + 1
        };
        return newCache;
      });
    } catch (error) {
      console.warn('Error updating snippet cache:', error);
    }
  }, [enableCache]);

  const getCachedSnippet = useCallback((snippetId: string): Snippet | null => {
    // Try enhanced cache manager first
    const cachedSnippet = snippetCacheManager.getSnippet(snippetId);
    if (cachedSnippet) return cachedSnippet;

    // Fallback to local cache
    const currentCache = cacheRef.current;
    if (!currentCache || !isCacheValid(currentCache)) return null;

    const snippetsMap = currentCache.snippets instanceof Map
      ? currentCache.snippets
      : new Map(Object.entries(currentCache.snippets as any)) as Map<string, Snippet>;

    return snippetsMap.get(snippetId) || null;
  }, [isCacheValid]);

  const invalidateCache = useCallback((snippetId?: string) => {
    // Invalidate enhanced cache manager
    if (snippetId) {
      snippetCacheManager.invalidateSnippet(snippetId);
    } else {
      snippetCacheManager.clearCache();
    }

    // Also handle local cache
    const currentCache = cacheRef.current;
    if (snippetId && currentCache) {
      // Remove specific snippet from cache
      const snippetsMap = currentCache.snippets instanceof Map
        ? currentCache.snippets
        : new Map(Object.entries(currentCache.snippets as any));

      const newSnippets = new Map(snippetsMap);
      newSnippets.delete(snippetId);
      setCacheRef.current({
        ...currentCache,
        snippets: newSnippets as any,
        version: currentCache.version + 1
      });
    } else {
      // Clear entire cache
      setCacheRef.current(null);
    }
  }, []);

  // Load snippets from API or cache
  const loadSnippets = useCallback(async (forceRefresh = false) => {
    const currentCache = cacheRef.current;

    // Check cache first if not forcing refresh
    if (!forceRefresh && currentCache && isCacheValid(currentCache)) {
      // Handle case where snippets might be serialized as object instead of Map
      const snippetsMap = currentCache.snippets instanceof Map
        ? currentCache.snippets
        : new Map(Object.entries(currentCache.snippets as any));

      const cachedSnippets = Array.from(snippetsMap.values());
      setSnippets(cachedSnippets as any);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await templateService.getSnippets();

      if (response.success && response.data) {
        const loadedSnippets = response.data.snippets;
        setSnippets(loadedSnippets);

        // Update cache inline to avoid circular dependency
        if (enableCache) {
          try {
            // Use the enhanced cache manager
            loadedSnippets.forEach(snippet => {
              snippetCacheManager.cacheSnippet(snippet);
            });

            const snippetMap = new Map<string, Snippet>();
            loadedSnippets.forEach(snippet => {
              snippetMap.set(snippet.id, snippet);
            });

            setCacheRef.current(prevCache => ({
              snippets: snippetMap,
              lastUpdated: new Date(),
              version: (prevCache?.version || 0) + 1
            }));
          } catch (error) {
            console.warn('Error updating snippet cache:', error);
          }
        }
      } else {
        throw new Error(response.error || 'Failed to load snippets');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load snippets';
      setError(errorMessage);
      console.error('Error loading snippets:', err);

      // Fallback to cache if available
      const fallbackCache = cacheRef.current;
      if (fallbackCache && fallbackCache.snippets) {
        const snippetsMap = fallbackCache.snippets instanceof Map
          ? fallbackCache.snippets
          : new Map(Object.entries(fallbackCache.snippets as any));

        if (snippetsMap.size > 0) {
          const cachedSnippets = Array.from(snippetsMap.values());
          setSnippets(cachedSnippets as any);
          console.warn('Using cached snippets due to API error');
        }
      }
    } finally {
      setLoading(false);
    }
  }, [isCacheValid, enableCache]);

  const refreshSnippets = useCallback(async () => {
    await loadSnippets(true);
  }, [loadSnippets]);

  // Favorites management
  const toggleFavorite = useCallback((snippetId: string) => {
    setFavorites(prev => {
      const isFavorite = prev.includes(snippetId);
      if (isFavorite) {
        return prev.filter(id => id !== snippetId);
      } else {
        return [...prev, snippetId];
      }
    });
  }, [setFavorites]);

  // History management
  const addToHistory = useCallback((usage: SnippetUsage) => {
    setRecentlyUsed(prev => {
      // Remove existing entry for this snippet if it exists
      const filtered = prev.filter(item => item.snippetId !== usage.snippetId);

      // Add new entry at the beginning
      const updated = [usage, ...filtered];

      // Limit history size
      return updated.slice(0, MAX_HISTORY_ITEMS);
    });
  }, [setRecentlyUsed]);

  const clearHistory = useCallback(() => {
    setRecentlyUsed([]);
  }, [setRecentlyUsed]);

  // Filtered snippets based on search query
  const filteredSnippets = useMemo(() => {
    if (!debouncedSearchQuery.trim()) {
      return snippets;
    }

    const query = debouncedSearchQuery.toLowerCase();
    return snippets.filter(snippet => {
      const matchesName = snippet.name.toLowerCase().includes(query);
      const matchesDescription = snippet.description?.toLowerCase().includes(query);
      const matchesParameters = snippet.parameters?.some(param =>
        param.name.toLowerCase().includes(query) ||
        param.description?.toLowerCase().includes(query)
      );

      return matchesName || matchesDescription || matchesParameters;
    });
  }, [snippets, debouncedSearchQuery]);

  // Auto-refresh functionality
  useEffect(() => {
    if (autoRefresh && refreshInterval > 0) {
      const interval = setInterval(() => {
        refreshSnippets();
      }, refreshInterval);

      return () => clearInterval(interval);
    }
  }, [autoRefresh, refreshInterval, refreshSnippets]);

  // Preload snippets in background
  const preloadSnippets = useCallback(async (snippets: Snippet[]) => {
    await snippetCacheManager.preloadSnippets(snippets);
  }, []);

  // Background preloading using idle callback
  useIdleCallback(() => {
    if (snippets.length > 0) {
      preloadSnippets(snippets);
    }
  }, [snippets]);

  // Initial load
  useEffect(() => {
    loadSnippets();
  }, [loadSnippets]);

  return {
    // Data
    snippets,
    loading,
    error,

    // Filtered data
    filteredSnippets,
    searchQuery,
    setSearchQuery,

    // Favorites and history
    favorites,
    recentlyUsed,

    // Actions
    loadSnippets,
    refreshSnippets,
    toggleFavorite,
    addToHistory,
    clearHistory,

    // Cache management
    invalidateCache,
    getCachedSnippet,
    preloadSnippets
  };
};
