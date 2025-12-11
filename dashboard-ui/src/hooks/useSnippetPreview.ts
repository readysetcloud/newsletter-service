import { useState, useCallback, useEffect, useRef } from 'react';
import { snippetPreviewService } from '@/services/snippetPreviewService';
import type { Snippet } from '@/types/template';

interface UseSnippetPreviewOptions {
  autoGenerate?: boolean;
  generateThumbnail?: boolean;
  cacheTimeout?: number;
  enableRetry?: boolean;
  maxRetries?: number;
}

interface PreviewState {
  html: string;
  loading: boolean;
  error: string | null;
  success: boolean;
  fromCache: boolean;
  renderTime?: number;
  thumbnailUrl?: string;
}

interface UseSnippetPreviewResult {
  // State
  preview: PreviewState;

  // Actions
  generatePreview: (snippet: Snippet, parameters?: Record<string, any>) => Promise<void>;
  generateThumbnail: (snippet: Snippet, parameters?: Record<string, any>) => Promise<string | null>;
  clearPreview: () => void;
  retryPreview: () => Promise<void>;

  // Validation
  validateParameters: (snippet: Snippet, parameters: Record<string, any>) => {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  };

  // Cache management
  clearCache: (snippetId?: string) => void;
  invalidateCache: (snippetId: string, newVersion?: number) => void;
}

export const useSnippetPreview = (options: UseSnippetPreviewOptions = {}): UseSnippetPreviewResult => {
  const {
    autoGenerate = false,
    generateThumbnail = true,
    enableRetry = true,
    maxRetries = 2
  } = options;

  const [preview, setPreview] = useState<PreviewState>({
    html: '',
    loading: false,
    error: null,
    success: false,
    fromCache: false
  });

  // Keep track of the last request to avoid race conditions
  const lastRequestRef = useRef<{ snippet: Snippet; parameters: Record<string, any> } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const generatePreview = useCallback(async (
    snippet: Snippet,
    parameters: Record<string, any> = {}
  ) => {
    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();
    const currentRequest = { snippet, parameters };
    lastRequestRef.current = currentRequest;

    setPreview(prev => ({
      ...prev,
      loading: true,
      error: null
    }));

    try {
      const result = enableRetry
        ? await snippetPreviewService.generatePreviewWithRetry(snippet, parameters, {
            maxRetries,
            generateThumbnail
          })
        : await snippetPreviewService.generatePreview(snippet, parameters, {
            generateThumbnail
          });

      // Check if this is still the current request
      if (lastRequestRef.current === currentRequest && !abortControllerRef.current?.signal.aborted) {
        setPreview({
          html: result.html,
          loading: false,
          error: result.error || null,
          success: result.success,
          fromCache: result.fromCache || false,
          renderTime: result.renderTime,
          thumbnailUrl: result.thumbnailUrl
        });
      }
    } catch (error) {
      // Check if this is still the current request and not aborted
      if (lastRequestRef.current === currentRequest && !abortControllerRef.current?.signal.aborted) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setPreview(prev => ({
          ...prev,
          loading: false,
          error: errorMessage,
          success: false
        }));
      }
    }
  }, [enableRetry, maxRetries, generateThumbnail]);

  const generateThumbnailOnly = useCallback(async (
    snippet: Snippet,
    parameters: Record<string, any> = {}
  ): Promise<string | null> => {
    try {
      return await snippetPreviewService.generateThumbnail(snippet, parameters);
    } catch (error) {
      console.error('Thumbnail generation failed:', error);
      return null;
    }
  }, []);

  const clearPreview = useCallback(() => {
    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    lastRequestRef.current = null;
    setPreview({
      html: '',
      loading: false,
      error: null,
      success: false,
      fromCache: false
    });
  }, []);

  const retryPreview = useCallback(async () => {
    if (lastRequestRef.current) {
      await generatePreview(lastRequestRef.current.snippet, lastRequestRef.current.parameters);
    }
  }, [generatePreview]);

  const validateParameters = useCallback((
    snippet: Snippet,
    parameters: Record<string, any>
  ) => {
    return snippetPreviewService.validateParameters(snippet, parameters);
  }, []);

  const clearCache = useCallback((snippetId?: string) => {
    snippetPreviewService.clearCache(snippetId);
  }, []);

  const invalidateCache = useCallback((snippetId: string, newVersion?: number) => {
    snippetPreviewService.invalidateSnippetCache(snippetId, newVersion);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    preview,
    generatePreview,
    generateThumbnail: generateThumbnailOnly,
    clearPreview,
    retryPreview,
    validateParameters,
    clearCache,
    invalidateCache
  };
};

// Hook for batch preview generation
interface UseBatchPreviewOptions {
  batchSize?: number;
  generateThumbnails?: boolean;
  onProgress?: (completed: number, total: number) => void;
}

interface BatchPreviewState {
  results: Map<string, PreviewState>;
  loading: boolean;
  error: string | null;
  progress: { completed: number; total: number };
}

interface UseBatchPreviewResult {
  state: BatchPreviewState;
  generatePreviews: (requests: Array<{ snippet: Snippet; parameters?: Record<string, any> }>) => Promise<void>;
  clearResults: () => void;
  getPreview: (snippetId: string) => PreviewState | undefined;
}

export const useBatchSnippetPreview = (options: UseBatchPreviewOptions = {}): UseBatchPreviewResult => {
  const {
    batchSize = 5,
    generateThumbnails = true,
    onProgress
  } = options;

  const [state, setState] = useState<BatchPreviewState>({
    results: new Map(),
    loading: false,
    error: null,
    progress: { completed: 0, total: 0 }
  });

  const generatePreviews = useCallback(async (
    requests: Array<{ snippet: Snippet; parameters?: Record<string, any> }>
  ) => {
    setState(prev => ({
      ...prev,
      loading: true,
      error: null,
      progress: { completed: 0, total: requests.length }
    }));

    try {
      const results = await snippetPreviewService.generatePreviewBatch(requests, {
        batchSize,
        generateThumbnails,
        onProgress: (completed, total) => {
          setState(prev => ({
            ...prev,
            progress: { completed, total }
          }));
          onProgress?.(completed, total);
        }
      });

      // Convert service results to preview states
      const previewResults = new Map<string, PreviewState>();
      results.forEach((result, snippetId) => {
        previewResults.set(snippetId, {
          html: result.html,
          loading: false,
          error: result.error || null,
          success: result.success,
          fromCache: result.fromCache || false,
          renderTime: result.renderTime,
          thumbnailUrl: result.thumbnailUrl
        });
      });

      setState(prev => ({
        ...prev,
        results: previewResults,
        loading: false
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Batch preview generation failed';
      setState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage
      }));
    }
  }, [batchSize, generateThumbnails, onProgress]);

  const clearResults = useCallback(() => {
    setState({
      results: new Map(),
      loading: false,
      error: null,
      progress: { completed: 0, total: 0 }
    });
  }, []);

  const getPreview = useCallback((snippetId: string): PreviewState | undefined => {
    return state.results.get(snippetId);
  }, [state.results]);

  return {
    state,
    generatePreviews,
    clearResults,
    getPreview
  };
};
