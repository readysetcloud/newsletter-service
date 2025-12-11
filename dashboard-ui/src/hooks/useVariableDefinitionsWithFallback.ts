import { useState, useEffect, useCallback, useRef } from 'react';
import { VARIABLE_DEFINITIONS } from '@/data/variableDefinitions';
import { useNetworkErrorHandler } from './useNetworkErrorHandler';
import { retryWithBackoff, isNetworkError } from '@/utils/errorHandling';
import type { VariableDefinitions, Variable, ControlFlowHelper } from '@/types/variable';
import { VariableCategory } from '@/types/variable';

interface VariableDefinitionsState {
  definitions: VariableDefinitions | null;
  isLoading: boolean;
  error: Error | null;
  isUsingFallback: boolean;
  lastUpdated?: Date;
  retryCount: number;
}

interface UseVariableDefinitionsOptions {
  enableFallback?: boolean;
  fallbackDefinitions?: Partial<VariableDefinitions>;
  maxRetries?: number;
  retryDelay?: number;
  enableCaching?: boolean;
  cacheKey?: string;
  onError?: (error: Error) => void;
  onFallback?: () => void;
  onRecovery?: () => void;
}

interface UseVariableDefinitionsResult {
  // State
  definitions: VariableDefinitions | null;
  isLoading: boolean;
  error: Error | null;
  isUsingFallback: boolean;
  lastUpdated?: Date;
  retryCount: number;

  // Actions
  refetch: () => Promise<void>;
  clearError: () => void;
  enableFallbackMode: () => void;
  disableFallbackMode: () => void;

  // Utilities
  getVariablesByCategory: (category: VariableCategory) => Variable[];
  getControlFlowHelpers: () => ControlFlowHelper[];
  searchVariables: (query: string) => Variable[];
  isVariableAvailable: (path: string) => boolean;
}

const DEFAULT_OPTIONS: Required<UseVariableDefinitionsOptions> = {
  enableFallback: true,
  fallbackDefinitions: {},
  maxRetries: 3,
  retryDelay: 1000,
  enableCaching: true,
  cacheKey: 'variable-definitions',
  onError: () => {},
  onFallback: () => {},
  onRecovery: () => {}
};

// Minimal fallback definitions for when the main definitions fail to load
const MINIMAL_FALLBACK_DEFINITIONS: VariableDefinitions = {
  categories: {
    newsletter: {
      label: 'Newsletter',
      description: 'Newsletter-related variables',
      variables: [
        {
          id: 'newsletter-title',
          name: 'Title',
          path: 'newsletter.title',
          category: VariableCategory.NEWSLETTER,
          type: 'string',
          sampleValue: 'Weekly Newsletter',
          description: 'Newsletter title',
          isCustom: false
        },
        {
          id: 'newsletter-date',
          name: 'Date',
          path: 'newsletter.date',
          category: VariableCategory.NEWSLETTER,
          type: 'date',
          sampleValue: '2024-01-15',
          description: 'Newsletter date',
          isCustom: false
        }
      ]
    },
    subscriber: {
      label: 'Subscriber',
      description: 'Subscriber information',
      variables: [
        {
          id: 'subscriber-name',
          name: 'Name',
          path: 'subscriber.firstName',
          category: VariableCategory.SUBSCRIBER,
          type: 'string',
          sampleValue: 'John',
          description: 'Subscriber first name',
          isCustom: false
        },
        {
          id: 'subscriber-email',
          name: 'Email',
          path: 'subscriber.email',
          category: VariableCategory.SUBSCRIBER,
          type: 'string',
          sampleValue: 'john@example.com',
          description: 'Subscriber email address',
          isCustom: false
        }
      ]
    },
    brand: {
      label: 'Brand',
      description: 'Brand information',
      variables: [
        {
          id: 'brand-name',
          name: 'Name',
          path: 'brand.name',
          category: VariableCategory.BRAND,
          type: 'string',
          sampleValue: 'Your Brand',
          description: 'Brand name',
          isCustom: false
        }
      ]
    },
    custom: {
      label: 'Custom',
      description: 'Custom variables',
      variables: []
    },
    system: {
      label: 'System',
      description: 'System variables',
      variables: []
    },
    control_flow: {
      label: 'Control Flow',
      description: 'Control flow helpers',
      variables: []
    }
  },
  contextualMappings: {},
  controlFlowHelpers: [
    {
      id: 'if',
      name: 'Conditional (if)',
      syntax: '{{#if condition}}',
      closingSyntax: '{{/if}}',
      description: 'Show content only when condition is true',
      category: 'conditional',
      parameters: [
        {
          name: 'condition',
          type: 'variable',
          required: true,
          description: 'Variable or expression to evaluate',
          examples: ['newsletter.hasSponsors', 'subscriber.isPremium']
        }
      ],
      examples: [
        {
          title: 'Basic conditional',
          code: '{{#if newsletter.hasSponsors}}\n  Sponsor content\n{{/if}}',
          description: 'Show content when condition is true',
          variables: ['newsletter.hasSponsors']
        }
      ]
    }
  ]
};

export const useVariableDefinitionsWithFallback = (
  options: UseVariableDefinitionsOptions = {}
): UseVariableDefinitionsResult => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const [state, setState] = useState<VariableDefinitionsState>({
    definitions: null,
    isLoading: true,
    error: null,
    isUsingFallback: false,
    retryCount: 0
  });

  const { executeWithRetry } = useNetworkErrorHandler({
    maxRetries: opts.maxRetries,
    baseRetryDelay: opts.retryDelay,
    onRetryFailed: opts.onError
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, { data: VariableDefinitions; timestamp: Date }>>(new Map());

  // Load variable definitions with fallback support
  const loadDefinitions = useCallback(async (forceRefresh = false): Promise<void> => {
    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Check cache first (if enabled and not forcing refresh)
      if (opts.enableCaching && !forceRefresh) {
        const cached = cacheRef.current.get(opts.cacheKey);
        if (cached && Date.now() - cached.timestamp.getTime() < 5 * 60 * 1000) { // 5 minutes
          setState(prev => ({
            ...prev,
            definitions: cached.data,
            isLoading: false,
            isUsingFallback: false,
            lastUpdated: cached.timestamp,
            retryCount: 0
          }));
          return;
        }
      }

      // Try to load definitions with retry logic
      const definitions = await executeWithRetry(async () => {
        if (signal.aborted) {
          throw new Error('Request aborted');
        }

        // In a real implementation, this would be an API call
        // For now, we'll simulate potential failure and use static definitions
        const shouldSimulateFailure = Math.random() < 0.1; // 10% chance of failure in development

        if (process.env.NODE_ENV === 'development' && shouldSimulateFailure) {
          throw new Error('Simulated variable definitions loading failure');
        }

        // Return the static definitions (in real app, this would be an API call)
        return VARIABLE_DEFINITIONS;
      });

      // Cache the successful result
      if (opts.enableCaching) {
        cacheRef.current.set(opts.cacheKey, {
          data: definitions,
          timestamp: new Date()
        });
      }

      setState(prev => ({
        ...prev,
        definitions,
        isLoading: false,
        error: null,
        isUsingFallback: false,
        lastUpdated: new Date(),
        retryCount: 0
      }));

      // Call recovery callback if we were previously in fallback mode
      if (state.isUsingFallback) {
        opts.onRecovery();
      }

    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');

      console.error('Failed to load variable definitions:', err);

      setState(prev => {
        const newState = {
          ...prev,
          error: err,
          isLoading: false,
          retryCount: prev.retryCount + 1
        };

        // Enable fallback mode if enabled and this is a network error
        if (opts.enableFallback && (isNetworkError(err) || prev.retryCount >= (opts.maxRetries || 3) - 1)) {
          setTimeout(() => enableFallbackMode(), 0);
        }

        return newState;
      });

      opts.onError?.(err);
    }
  }, [opts, state.isUsingFallback, executeWithRetry]);

  // Enable fallback mode
  const enableFallbackMode = useCallback(() => {
    const fallbackDefinitions = {
      ...MINIMAL_FALLBACK_DEFINITIONS,
      ...opts.fallbackDefinitions
    };

    setState(prev => ({
      ...prev,
      definitions: fallbackDefinitions,
      isLoading: false,
      isUsingFallback: true,
      lastUpdated: new Date()
    }));

    opts.onFallback();
  }, [opts]);

  // Disable fallback mode and retry loading
  const disableFallbackMode = useCallback(async () => {
    setState(prev => ({ ...prev, isUsingFallback: false }));
    await loadDefinitions(true);
  }, [loadDefinitions]);

  // Clear error state
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  // Utility functions
  const getVariablesByCategory = useCallback((category: VariableCategory): Variable[] => {
    if (!state.definitions?.categories[category]) {
      return [];
    }
    return state.definitions.categories[category].variables;
  }, [state.definitions]);

  const getControlFlowHelpers = useCallback((): ControlFlowHelper[] => {
    return state.definitions?.controlFlowHelpers || [];
  }, [state.definitions]);

  const searchVariables = useCallback((query: string): Variable[] => {
    if (!state.definitions || !query.trim()) {
      return [];
    }

    const lowerQuery = query.toLowerCase();
    const results: Variable[] = [];

    Object.values(state.definitions.categories).forEach(category => {
      category.variables.forEach(variable => {
        if (
          variable.name.toLowerCase().includes(lowerQuery) ||
          variable.path.toLowerCase().includes(lowerQuery) ||
          variable.description?.toLowerCase().includes(lowerQuery)
        ) {
          results.push(variable);
        }
      });
    });

    return results;
  }, [state.definitions]);

  const isVariableAvailable = useCallback((path: string): boolean => {
    if (!state.definitions) {
      return false;
    }

    return Object.values(state.definitions.categories).some(category =>
      category.variables.some(variable => variable.path === path)
    );
  }, [state.definitions]);

  // Initial load
  useEffect(() => {
    loadDefinitions();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
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
    // State
    definitions: state.definitions,
    isLoading: state.isLoading,
    error: state.error,
    isUsingFallback: state.isUsingFallback,
    lastUpdated: state.lastUpdated,
    retryCount: state.retryCount,

    // Actions
    refetch: () => loadDefinitions(true),
    clearError,
    enableFallbackMode,
    disableFallbackMode,

    // Utilities
    getVariablesByCategory,
    getControlFlowHelpers,
    searchVariables,
    isVariableAvailable
  };
};
