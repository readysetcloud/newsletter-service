import { useState, useCallback } from 'react';
import { apiClient } from '@/services/api';
import type { ApiResponse } from '@/types';

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseApiReturn<T> extends UseApiState<T> {
  execute: (...args: any[]) => Promise<T | null>;
  reset: () => void;
}

export function useApi<T = any>(
  apiFunction: (...args: any[]) => Promise<ApiResponse<T>>
): UseApiReturn<T> {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const execute = useCallback(
    async (...args: any[]): Promise<T | null> => {
      setState(prev => ({ ...prev, loading: true, error: null }));

      try {
        const response = await apiFunction(...args);

        if (response.success && response.data) {
          setState({
            data: response.data,
            loading: false,
            error: null,
          });
          return response.data;
        } else {
          setState({
            data: null,
            loading: false,
            error: response.error || 'An error occurred',
          });
          return null;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
        setState({
          data: null,
          loading: false,
          error: errorMessage,
        });
        return null;
      }
    },
    [apiFunction]
  );

  const reset = useCallback(() => {
    setState({
      data: null,
      loading: false,
      error: null,
    });
  }, []);

  return {
    ...state,
    execute,
    reset,
  };
}

// Convenience hooks for common API operations
export function useApiGet<T = any>(endpoint: string) {
  return useApi<T>(() => apiClient.get<T>(endpoint));
}

export function useApiPost<T = any>(endpoint: string) {
  return useApi<T>((data?: any) => apiClient.post<T>(endpoint, data));
}

export function useApiPut<T = any>(endpoint: string) {
  return useApi<T>((data?: any) => apiClient.put<T>(endpoint, data));
}

export function useApiDelete<T = any>(endpoint: string) {
  return useApi<T>(() => apiClient.delete<T>(endpoint));
}
