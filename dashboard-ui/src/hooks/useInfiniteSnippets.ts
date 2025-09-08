import { useState, useEffect, useCallback, useRef } from 'react';
import { templateService } from '../services/templateService';
import type { Snippet, SnippetFilters } from '@/types/template';

interface UseInfiniteSnippetsOptions {
  limit?: number;
  search?: string;
  enabled?: boolean;
}

interface UseInfiniteSnippetsResult {
  snippets: Snippet[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  totalLoaded: number;
}

export const useInfiniteSnippets = (
  options: UseInfiniteSnippetsOptions = {}
): UseInfiniteSnippetsResult => {
  const {
    limit = 20,
    search,
    enabled = true
  } = options;

  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);

  // Use refs to track current values for callbacks
  const currentCursor = useRef<string | null>(null);
  const isLoadingRef = useRef(false);

  const loadSnippets = useCallback(async (
    isRefresh = false,
    currentCursorValue: string | null = null
  ) => {
    if (!enabled || isLoadingRef.current) return;

    isLoadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const params: any = { limit };

      if (search) params.search = search;
      if (currentCursorValue && !isRefresh) params.cursor = currentCursorValue;

      const response = await templateService.getSnippets(params);

      if (response.success && response.data) {
        if (isRefresh) {
          setSnippets(response.data.snippets);
          setCursor(null);
          currentCursor.current = null;
        } else {
          setSnippets(prev => [...prev, ...response.data!.snippets]);
          setCursor(null);
          currentCursor.current = null;
        }

        setHasMore(response.data.snippets.length === params.limit);

        // Log cache performance
        if (false) {
          console.log('Snippets loaded from cache');
        }
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load snippets';
      setError(errorMessage);
      console.error('Error loading snippets:', err);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, [enabled, limit, search]);

  const loadMore = useCallback(() => {
    if (hasMore && !isLoadingRef.current && currentCursor.current) {
      loadSnippets(false, currentCursor.current);
    }
  }, [hasMore, loadSnippets]);

  const refresh = useCallback(() => {
    setSnippets([]);
    setCursor(null);
    currentCursor.current = null;
    setHasMore(true);
    loadSnippets(true);
  }, [loadSnippets]);

  // Initial load and reload when dependencies change
  useEffect(() => {
    if (enabled) {
      refresh();
    }
  }, [enabled, search, refresh]);

  return {
    snippets,
    loading,
    error,
    hasMore,
    loadMore,
    refresh,
    totalLoaded: snippets.length
  };
};
