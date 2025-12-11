import { useState, useCallback, useEffect, useRef } from 'react';
import { retryWithBackoff, shouldRetryError, isNetworkError, getRetryDelay } from '@/utils/errorHandling';

interface NetworkState {
  isOnline: boolean;
  isConnecting: boolean;
  lastConnected?: Date;
  connectionQuality: 'good' | 'poor' | 'offline';
}

interface RetryState {
  isRetrying: boolean;
  retryCount: number;
  maxRetries: number;
  nextRetryIn?: number;
  lastError?: Error;
}

interface NetworkErrorHandlerOptions {
  maxRetries?: number;
  baseRetryDelay?: number;
  enableOfflineQueue?: boolean;
  enableConnectionMonitoring?: boolean;
  onNetworkChange?: (isOnline: boolean) => void;
  onRetryAttempt?: (attempt: number, maxRetries: number) => void;
  onRetrySuccess?: () => void;
  onRetryFailed?: (error: Error) => void;
}

interface QueuedRequest {
  id: string;
  fn: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timestamp: Date;
  retryCount: number;
}

interface UseNetworkErrorHandlerResult {
  networkState: NetworkState;
  retryState: RetryState;

  // Core functions
  executeWithRetry: <T>(fn: () => Promise<T>) => Promise<T>;
  retryLastOperation: () => Promise<void>;
  clearRetryState: () => void;

  // Queue management
  queuedRequestCount: number;
  processQueue: () => Promise<void>;
  clearQueue: () => void;

  // Network utilities
  checkConnection: () => Promise<boolean>;
  waitForConnection: (timeout?: number) => Promise<boolean>;
}

const DEFAULT_OPTIONS: Required<NetworkErrorHandlerOptions> = {
  maxRetries: 3,
  baseRetryDelay: 1000,
  enableOfflineQueue: true,
  enableConnectionMonitoring: true,
  onNetworkChange: () => {},
  onRetryAttempt: () => {},
  onRetrySuccess: () => {},
  onRetryFailed: () => {}
};

export const useNetworkErrorHandler = (
  options: NetworkErrorHandlerOptions = {}
): UseNetworkErrorHandlerResult => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const [networkState, setNetworkState] = useState<NetworkState>({
    isOnline: navigator.onLine,
    isConnecting: false,
    connectionQuality: navigator.onLine ? 'good' : 'offline'
  });

  const [retryState, setRetryState] = useState<RetryState>({
    isRetrying: false,
    retryCount: 0,
    maxRetries: opts.maxRetries
  });

  const [queuedRequests, setQueuedRequests] = useState<QueuedRequest[]>([]);

  // Refs for cleanup and state management
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionCheckRef = useRef<NodeJS.Timeout | null>(null);
  const lastOperationRef = useRef<(() => Promise<any>) | null>(null);

  // Network monitoring
  useEffect(() => {
    if (!opts.enableConnectionMonitoring) return;

    const handleOnline = () => {
      setNetworkState(prev => ({
        ...prev,
        isOnline: true,
        lastConnected: new Date(),
        connectionQuality: 'good'
      }));
      opts.onNetworkChange(true);

      // Process queued requests when coming back online
      if (opts.enableOfflineQueue) {
        processQueue();
      }
    };

    const handleOffline = () => {
      setNetworkState(prev => ({
        ...prev,
        isOnline: false,
        connectionQuality: 'offline'
      }));
      opts.onNetworkChange(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [opts.enableConnectionMonitoring, opts.enableOfflineQueue, opts.onNetworkChange]);

  // Connection quality monitoring
  useEffect(() => {
    if (!opts.enableConnectionMonitoring || !networkState.isOnline) return;

    const checkConnectionQuality = async () => {
      try {
        const start = Date.now();
        const response = await fetch('/api/health', {
          method: 'HEAD',
          cache: 'no-cache'
        });
        const duration = Date.now() - start;

        if (response.ok) {
          const quality = duration < 1000 ? 'good' : 'poor';
          setNetworkState(prev => ({ ...prev, connectionQuality: quality }));
        }
      } catch (error) {
        setNetworkState(prev => ({ ...prev, connectionQuality: 'poor' }));
      }
    };

    // Check connection quality every 30 seconds
    connectionCheckRef.current = setInterval(checkConnectionQuality, 30000);

    return () => {
      if (connectionCheckRef.current) {
        clearInterval(connectionCheckRef.current);
      }
    };
  }, [networkState.isOnline, opts.enableConnectionMonitoring]);

  const executeWithRetry = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    lastOperationRef.current = fn;

    // If offline and queueing is enabled, add to queue
    if (!networkState.isOnline && opts.enableOfflineQueue) {
      return new Promise<T>((resolve, reject) => {
        const queuedRequest: QueuedRequest = {
          id: Math.random().toString(36).substr(2, 9),
          fn,
          resolve,
          reject,
          timestamp: new Date(),
          retryCount: 0
        };

        setQueuedRequests(prev => [...prev, queuedRequest]);
      });
    }

    setRetryState(prev => ({ ...prev, isRetrying: true, retryCount: 0 }));

    try {
      const result = await retryWithBackoff(fn, opts.maxRetries, opts.baseRetryDelay);

      setRetryState(prev => ({
        ...prev,
        isRetrying: false,
        retryCount: 0,
        lastError: undefined
      }));

      opts.onRetrySuccess();
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');

      setRetryState(prev => ({
        ...prev,
        isRetrying: false,
        lastError: err
      }));

      opts.onRetryFailed(err);
      throw err;
    }
  }, [networkState.isOnline, opts.enableOfflineQueue, opts.maxRetries, opts.baseRetryDelay, opts.onRetrySuccess, opts.onRetryFailed]);

  const retryLastOperation = useCallback(async (): Promise<void> => {
    if (!lastOperationRef.current) {
      throw new Error('No operation to retry');
    }

    await executeWithRetry(lastOperationRef.current);
  }, [executeWithRetry]);

  const clearRetryState = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    setRetryState({
      isRetrying: false,
      retryCount: 0,
      maxRetries: opts.maxRetries,
      nextRetryIn: undefined,
      lastError: undefined
    });
  }, [opts.maxRetries]);

  const processQueue = useCallback(async (): Promise<void> => {
    if (!networkState.isOnline || queuedRequests.length === 0) {
      return;
    }

    const requestsToProcess = [...queuedRequests];
    setQueuedRequests([]);

    for (const request of requestsToProcess) {
      try {
        const result = await request.fn();
        request.resolve(result);
      } catch (error) {
        // If the request fails and it's retryable, put it back in the queue
        if (shouldRetryError(error) && request.retryCount < opts.maxRetries) {
          const updatedRequest = {
            ...request,
            retryCount: request.retryCount + 1
          };

          setQueuedRequests(prev => [...prev, updatedRequest]);
        } else {
          request.reject(error);
        }
      }
    }
  }, [networkState.isOnline, queuedRequests, opts.maxRetries]);

  const clearQueue = useCallback(() => {
    // Reject all queued requests
    queuedRequests.forEach(request => {
      request.reject(new Error('Request queue cleared'));
    });

    setQueuedRequests([]);
  }, [queuedRequests]);

  const checkConnection = useCallback(async (): Promise<boolean> => {
    setNetworkState(prev => ({ ...prev, isConnecting: true }));

    try {
      const response = await fetch('/api/health', {
        method: 'HEAD',
        cache: 'no-cache',
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      const isConnected = response.ok;

      setNetworkState(prev => ({
        ...prev,
        isOnline: isConnected,
        isConnecting: false,
        lastConnected: isConnected ? new Date() : prev.lastConnected,
        connectionQuality: isConnected ? 'good' : 'offline'
      }));

      return isConnected;
    } catch (error) {
      setNetworkState(prev => ({
        ...prev,
        isOnline: false,
        isConnecting: false,
        connectionQuality: 'offline'
      }));

      return false;
    }
  }, []);

  const waitForConnection = useCallback(async (timeout: number = 30000): Promise<boolean> => {
    if (networkState.isOnline) {
      return true;
    }

    return new Promise((resolve) => {
      const startTime = Date.now();

      const checkInterval = setInterval(async () => {
        const elapsed = Date.now() - startTime;

        if (elapsed >= timeout) {
          clearInterval(checkInterval);
          resolve(false);
          return;
        }

        const isConnected = await checkConnection();
        if (isConnected) {
          clearInterval(checkInterval);
          resolve(true);
        }
      }, 1000);
    });
  }, [networkState.isOnline, checkConnection]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (connectionCheckRef.current) {
        clearInterval(connectionCheckRef.current);
      }

      // Reject any pending queued requests
      queuedRequests.forEach(request => {
        request.reject(new Error('Component unmounted'));
      });
    };
  }, [queuedRequests]);

  return {
    networkState,
    retryState,
    executeWithRetry,
    retryLastOperation,
    clearRetryState,
    queuedRequestCount: queuedRequests.length,
    processQueue,
    clearQueue,
    checkConnection,
    waitForConnection
  };
};
