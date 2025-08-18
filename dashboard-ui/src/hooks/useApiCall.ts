import { useState, useCallback } from 'react';
import type { ApiResponse } from '@/types';

export interface UseApiCallState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  isSuccess: boolean;
}

export interface UseApiCallReturn<T> extends UseApiCallState<T> {
  execute: (...args: any[]) => Promise<T | null>;
  reset: () => void;
  setData: (data: T | null) => void;
}

/**
 * Custom hook for managing API call state with loading, error, and success states
 */
export function useApiCall<T = any>(
  apiFunction: (...args: any[]) => Promise<ApiResponse<T>>,
  options: {
    onSuccess?: (data: T) => void;
    onError?: (error: string) => void;
    initialData?: T | null;
  } = {}
): UseApiCallReturn<T> {
  const { onSuccess, onError, initialData = null } = options;

  const [state, setState] = useState<UseApiCallState<T>>({
    data: initialData,
    isLoading: false,
    error: null,
    isSuccess: false,
  });

  const execute = useCallback(
    async (...args: any[]): Promise<T | null> => {
      setState(prev => ({
        ...prev,
        isLoading: true,
        error: null,
        isSuccess: false,
      }));

      try {
        const response = await apiFunction(...args);

        if (response.success && response.data) {
          setState({
            data: response.data,
            isLoading: false,
            error: null,
            isSuccess: true,
          });

          onSuccess?.(response.data);
          return response.data;
        } else {
          const errorMessage = response.error || 'An unexpected error occurred';
          setState({
            data: null,
            isLoading: false,
            error: errorMessage,
            isSuccess: false,
          });

          onError?.(errorMessage);
          return null;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
        setState({
          data: null,
          isLoading: false,
          error: errorMessage,
          isSuccess: false,
        });

        onError?.(errorMessage);
        return null;
      }
    },
    [apiFunction, onSuccess, onError]
  );

  const reset = useCallback(() => {
    setState({
      data: initialData,
      isLoading: false,
      error: null,
      isSuccess: false,
    });
  }, [initialData]);

  const setData = useCallback((data: T | null) => {
    setState(prev => ({
      ...prev,
      data,
      isSuccess: data !== null,
      error: data === null ? prev.error : null,
    }));
  }, []);

  return {
    ...state,
    execute,
    reset,
    setData,
  };
}

/**
 * Hook for managing multiple API calls with a single loading state
 */
export function useApiCallGroup() {
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const executeGroup = useCallback(
    async (
      calls: Array<{
        key: string;
        apiFunction: () => Promise<ApiResponse<any>>;
        onSuccess?: (data: any) => void;
        onError?: (error: string) => void;
      }>
    ): Promise<Record<string, any | null>> => {
      setIsLoading(true);
      setErrors({});

      const results: Record<string, any | null> = {};
      const newErrors: Record<string, string> = {};

      await Promise.allSettled(
        calls.map(async ({ key, apiFunction, onSuccess, onError }) => {
          try {
            const response = await apiFunction();

            if (response.success && response.data) {
              results[key] = response.data;
              onSuccess?.(response.data);
            } else {
              const errorMessage = response.error || 'An unexpected error occurred';
              results[key] = null;
              newErrors[key] = errorMessage;
              onError?.(errorMessage);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
            results[key] = null;
            newErrors[key] = errorMessage;
            onError?.(errorMessage);
          }
        })
      );

      setErrors(newErrors);
      setIsLoading(false);

      return results;
    },
    []
  );

  const clearError = useCallback((key: string) => {
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[key];
      return newErrors;
    });
  }, []);

  const clearAllErrors = useCallback(() => {
    setErrors({});
  }, []);

  return {
    isLoading,
    errors,
    executeGroup,
    clearError,
    clearAllErrors,
    hasErrors: Object.keys(errors).length > 0,
  };
}
