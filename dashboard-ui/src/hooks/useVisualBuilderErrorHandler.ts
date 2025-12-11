import { useState, useCallback, useRef, useEffect } from 'react';
import { useNetworkErrorHandler } from './useNetworkErrorHandler';
import { useVariableDefinitionsWithFallback } from './useVariableDefinitionsWithFallback';
import { validateVariableSyntax, autoFixVariableSyntax } from '@/utils/variableSyntaxErrorHandler';
import { getUserFriendlyErrorMessage, isNetworkError, isValidationError } from '@/utils/errorHandling';

interface VisualBuilderError {
  id: string;
  type: 'variable-picker' | 'drop-zone' | 'variable-validation' | 'network' | 'unknown';
  message: string;
  severity: 'error' | 'warning' | 'info';
  timestamp: Date;
  context?: string;
  recoverable: boolean;
  autoFixable?: boolean;
  originalError?: Error;
}

interface ErrorState {
  errors: VisualBuilderError[];
  hasErrors: boolean;
  errorCount: number;
  warningCount: number;
  lastError?: VisualBuilderError;
}

interface UseVisualBuilderErrorHandlerOptions {
  enableAutoRecovery?: boolean;
  enableFallbackMode?: boolean;
  maxRetries?: number;
  onError?: (error: VisualBuilderError) => void;
  onRecovery?: (errorId: string) => void;
  onFallbackModeEnabled?: () => void;
  onAutoFix?: (fixes: string[]) => void;
}

interface UseVisualBuilderErrorHandlerResult {
  // Error state
  errorState: ErrorState;

  // Error management
  addError: (error: Error, type?: VisualBuilderError['type'], context?: string) => string;
  removeError: (errorId: string) => void;
  clearErrors: () => void;
  clearErrorsByType: (type: VisualBuilderError['type']) => void;

  // Recovery actions
  retryAll: () => Promise<void>;
  enableFallbackMode: () => void;
  disableFallbackMode: () => Promise<void>;
  autoFixSyntaxErrors: (text: string) => { fixed: string; changes: string[] };

  // Error boundaries integration
  handleVariablePickerError: (error: Error, errorInfo: React.ErrorInfo) => void;
  handleDropZoneError: (error: Error, errorInfo: React.ErrorInfo) => void;
  handleValidationError: (error: Error, context?: string) => void;

  // Network and definitions
  networkState: ReturnType<typeof useNetworkErrorHandler>['networkState'];
  variableDefinitionsState: {
    isLoading: boolean;
    isUsingFallback: boolean;
    error: Error | null;
  };

  // Utilities
  validateAndReportSyntax: (text: string) => boolean;
  getErrorsByType: (type: VisualBuilderError['type']) => VisualBuilderError[];
  hasErrorType: (type: VisualBuilderError['type']) => boolean;
}

const DEFAULT_OPTIONS: Required<UseVisualBuilderErrorHandlerOptions> = {
  enableAutoRecovery: true,
  enableFallbackMode: true,
  maxRetries: 3,
  onError: () => {},
  onRecovery: () => {},
  onFallbackModeEnabled: () => {},
  onAutoFix: () => {}
};

export const useVisualBuilderErrorHandler = (
  options: UseVisualBuilderErrorHandlerOptions = {}
): UseVisualBuilderErrorHandlerResult => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const [errorState, setErrorState] = useState<ErrorState>({
    errors: [],
    hasErrors: false,
    errorCount: 0,
    warningCount: 0
  });

  const errorIdCounter = useRef(0);
  const retryAttempts = useRef<Map<string, number>>(new Map());

  // Network error handling
  const { networkState, executeWithRetry } = useNetworkErrorHandler({
    maxRetries: opts.maxRetries,
    enableOfflineQueue: true,
    onNetworkChange: (isOnline) => {
      if (isOnline) {
        // Clear network errors when connection is restored
        clearErrorsByType('network');
      }
    },
    onRetryFailed: (error) => {
      addError(error, 'network');
    }
  });

  // Variable definitions with fallback
  const {
    isLoading: isLoadingDefinitions,
    error: definitionsError,
    isUsingFallback,
    enableFallbackMode: enableDefinitionsFallback,
    disableFallbackMode: disableDefinitionsFallback,
    refetch: refetchDefinitions
  } = useVariableDefinitionsWithFallback({
    enableFallback: opts.enableFallbackMode,
    onError: (error) => {
      addError(error, 'variable-picker', 'Failed to load variable definitions');
    },
    onFallback: () => {
      opts.onFallbackModeEnabled();
    },
    onRecovery: () => {
      clearErrorsByType('variable-picker');
    }
  });

  // Generate unique error ID
  const generateErrorId = useCallback(() => {
    return `error-${++errorIdCounter.current}-${Date.now()}`;
  }, []);

  // Add error to state
  const addError = useCallback((
    error: Error,
    type: VisualBuilderError['type'] = 'unknown',
    context?: string
  ): string => {
    const errorId = generateErrorId();

    // Determine if error is recoverable and auto-fixable
    const recoverable = isNetworkError(error) ||
                       isValidationError(error) ||
                       type === 'variable-picker' ||
                       type === 'drop-zone';

    const autoFixable = isValidationError(error) || type === 'variable-validation';

    const visualBuilderError: VisualBuilderError = {
      id: errorId,
      type,
      message: getUserFriendlyErrorMessage(error, 'template'),
      severity: isValidationError(error) ? 'warning' : 'error',
      timestamp: new Date(),
      context,
      recoverable,
      autoFixable,
      originalError: error
    };

    setErrorState(prev => {
      const newErrors = [...prev.errors, visualBuilderError];
      const errorCount = newErrors.filter(e => e.severity === 'error').length;
      const warningCount = newErrors.filter(e => e.severity === 'warning').length;

      return {
        errors: newErrors,
        hasErrors: newErrors.length > 0,
        errorCount,
        warningCount,
        lastError: visualBuilderError
      };
    });

    opts.onError(visualBuilderError);

    // Auto-recovery for certain error types
    if (opts.enableAutoRecovery && recoverable) {
      const attempts = retryAttempts.current.get(errorId) || 0;
      if (attempts < opts.maxRetries) {
        retryAttempts.current.set(errorId, attempts + 1);

        // Delay auto-recovery to avoid immediate retry loops
        setTimeout(() => {
          if (type === 'network') {
            executeWithRetry(async () => {
              // Simulate network operation recovery
              await new Promise(resolve => setTimeout(resolve, 100));
            }).then(() => {
              removeError(errorId);
            }).catch(() => {
              // Auto-recovery failed, keep the error
            });
          }
        }, 1000 * (attempts + 1)); // Exponential backoff
      }
    }

    return errorId;
  }, [generateErrorId, opts, executeWithRetry]);

  // Remove error from state
  const removeError = useCallback((errorId: string) => {
    setErrorState(prev => {
      const newErrors = prev.errors.filter(e => e.id !== errorId);
      const errorCount = newErrors.filter(e => e.severity === 'error').length;
      const warningCount = newErrors.filter(e => e.severity === 'warning').length;

      return {
        errors: newErrors,
        hasErrors: newErrors.length > 0,
        errorCount,
        warningCount,
        lastError: newErrors[newErrors.length - 1]
      };
    });

    retryAttempts.current.delete(errorId);
    opts.onRecovery(errorId);
  }, [opts]);

  // Clear all errors
  const clearErrors = useCallback(() => {
    setErrorState({
      errors: [],
      hasErrors: false,
      errorCount: 0,
      warningCount: 0
    });
    retryAttempts.current.clear();
  }, []);

  // Clear errors by type
  const clearErrorsByType = useCallback((type: VisualBuilderError['type']) => {
    setErrorState(prev => {
      const newErrors = prev.errors.filter(e => e.type !== type);
      const errorCount = newErrors.filter(e => e.severity === 'error').length;
      const warningCount = newErrors.filter(e => e.severity === 'warning').length;

      // Clear retry attempts for removed errors
      prev.errors.forEach(error => {
        if (error.type === type) {
          retryAttempts.current.delete(error.id);
        }
      });

      return {
        errors: newErrors,
        hasErrors: newErrors.length > 0,
        errorCount,
        warningCount,
        lastError: newErrors[newErrors.length - 1]
      };
    });
  }, []);

  // Retry all recoverable errors
  const retryAll = useCallback(async () => {
    const recoverableErrors = errorState.errors.filter(e => e.recoverable);

    for (const error of recoverableErrors) {
      try {
        if (error.type === 'network') {
          await executeWithRetry(async () => {
            // Simulate network operation
            await new Promise(resolve => setTimeout(resolve, 100));
          });
        } else if (error.type === 'variable-picker') {
          await refetchDefinitions();
        }

        removeError(error.id);
      } catch (retryError) {
        console.error(`Failed to retry error ${error.id}:`, retryError);
      }
    }
  }, [errorState.errors, executeWithRetry, refetchDefinitions, removeError]);

  // Enable fallback mode
  const enableFallbackMode = useCallback(() => {
    enableDefinitionsFallback();
    clearErrorsByType('variable-picker');
    clearErrorsByType('drop-zone');
    opts.onFallbackModeEnabled();
  }, [enableDefinitionsFallback, clearErrorsByType, opts]);

  // Disable fallback mode
  const disableFallbackMode = useCallback(async () => {
    try {
      await disableDefinitionsFallback();
    } catch (error) {
      addError(error instanceof Error ? error : new Error('Failed to disable fallback mode'), 'variable-picker');
    }
  }, [disableDefinitionsFallback, addError]);

  // Auto-fix syntax errors
  const autoFixSyntaxErrors = useCallback((text: string) => {
    const { fixed, changes } = autoFixVariableSyntax(text);

    if (changes.length > 0) {
      // Clear validation errors since we've fixed them
      clearErrorsByType('variable-validation');
      opts.onAutoFix(changes);
    }

    return { fixed, changes };
  }, [clearErrorsByType, opts]);

  // Error boundary handlers
  const handleVariablePickerError = useCallback((error: Error, errorInfo: React.ErrorInfo) => {
    addError(error, 'variable-picker', `Component: ${errorInfo.componentStack?.split('\n')[1]?.trim()}`);
  }, [addError]);

  const handleDropZoneError = useCallback((error: Error, errorInfo: React.ErrorInfo) => {
    addError(error, 'drop-zone', `Component: ${errorInfo.componentStack?.split('\n')[1]?.trim()}`);
  }, [addError]);

  const handleValidationError = useCallback((error: Error, context?: string) => {
    addError(error, 'variable-validation', context);
  }, [addError]);

  // Validate syntax and report errors
  const validateAndReportSyntax = useCallback((text: string): boolean => {
    const validation = validateVariableSyntax(text);

    // Clear existing validation errors
    clearErrorsByType('variable-validation');

    // Add new validation errors
    validation.errors.forEach(syntaxError => {
      const error = new Error(syntaxError.message);
      addError(error, 'variable-validation', syntaxError.context);
    });

    return validation.isValid;
  }, [clearErrorsByType, addError]);

  // Utility functions
  const getErrorsByType = useCallback((type: VisualBuilderError['type']) => {
    return errorState.errors.filter(e => e.type === type);
  }, [errorState.errors]);

  const hasErrorType = useCallback((type: VisualBuilderError['type']) => {
    return errorState.errors.some(e => e.type === type);
  }, [errorState.errors]);

  // Auto-clear resolved network errors when connection is restored
  useEffect(() => {
    if (networkState.isOnline && hasErrorType('network')) {
      clearErrorsByType('network');
    }
  }, [networkState.isOnline, hasErrorType, clearErrorsByType]);

  // Auto-clear variable picker errors when definitions are loaded successfully
  useEffect(() => {
    if (!isLoadingDefinitions && !definitionsError && hasErrorType('variable-picker')) {
      clearErrorsByType('variable-picker');
    }
  }, [isLoadingDefinitions, definitionsError, hasErrorType, clearErrorsByType]);

  return {
    // Error state
    errorState,

    // Error management
    addError,
    removeError,
    clearErrors,
    clearErrorsByType,

    // Recovery actions
    retryAll,
    enableFallbackMode,
    disableFallbackMode,
    autoFixSyntaxErrors,

    // Error boundaries integration
    handleVariablePickerError,
    handleDropZoneError,
    handleValidationError,

    // Network and definitions
    networkState,
    variableDefinitionsState: {
      isLoading: isLoadingDefinitions,
      isUsingFallback,
      error: definitionsError
    },

    // Utilities
    validateAndReportSyntax,
    getErrorsByType,
    hasErrorType
  };
};
