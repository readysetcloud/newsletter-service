import { useState, useEffect, useCallback, useRef } from 'react';
import { templateService } from '../services/templateService';
import type { Template, TemplateFilters } from '@/types/template';

interface UseInfiniteTemplatesOptions {
  limit?: number;
  category?: string;
  search?: string;
  enabled?: boolean;
}

interface UseInfiniteTemplatesResult {
  templates: Template[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  totalLoaded: number;
}

export const useInfiniteTemplates = (
  options: UseInfiniteTemplatesOptions = {}
): UseInfiniteTemplatesResult => {
  const {
    limit = 20,
    category,
    search,
    enabled = true
  } = options;

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);

  // Use refs to track current values for callbacks
  const currentCursor = useRef<string | null>(null);
  const isLoadingRef = useRef(false);

  const loadTemplates = useCallback(async (
    isRefresh = false,
    currentCursorValue: string | null = null
  ) => {
    if (!enabled || isLoadingRef.current) return;

    isLoadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const params: any = { limit };

      if (category) params.category = category;
      if (search) params.search = search;
      if (currentCursorValue && !isRefresh) params.cursor = currentCursorValue;

      const response = await templateService.getTemplates(params);

      if (response.success && response.data) {
        if (isRefresh) {
          setTemplates(response.data.templates);
          setCursor(null);
          currentCursor.current = null;
        } else {
          setTemplates(prev => [...prev, ...response.data!.templates]);
          setCursor(null);
          currentCursor.current = null;
        }

        setHasMore(response.data.templates.length === params.limit);

        // Log cache performance
        if (false) {
          console.log('Templates loaded from cache');
        }
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load templates';
      setError(errorMessage);
      console.error('Error loading templates:', err);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, [enabled, limit, category, search]);

  const loadMore = useCallback(() => {
    if (hasMore && !isLoadingRef.current && currentCursor.current) {
      loadTemplates(false, currentCursor.current);
    }
  }, [hasMore, loadTemplates]);

  const refresh = useCallback(() => {
    setTemplates([]);
    setCursor(null);
    currentCursor.current = null;
    setHasMore(true);
    loadTemplates(true);
  }, [loadTemplates]);

  // Initial load and reload when dependencies change
  useEffect(() => {
    if (enabled) {
      refresh();
    }
  }, [enabled, category, search, refresh]);

  return {
    templates,
    loading,
    error,
    hasMore,
    loadMore,
    refresh,
    totalLoaded: templates.length
  };
};
