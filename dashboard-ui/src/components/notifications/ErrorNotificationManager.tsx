import React, { useEffect, useCallback, useState } from 'react';
import { useNotifications } from '../../hooks/useNotifications';
import { useAuth } from '../../contexts/AuthContext';
import { NotificationService } from '../../services/notificationService';
import { parseApiError, shouldRetryError, getRetryDelay } from '../../utils/errorHandling';
import {
  ErrorNotificationHandler,
  FallbackUI,
  ConnectionStatusIndicator,
  useErrorNotificationHandling
} from './ErrorNotificationHandler';
import {
  SystemErrorHandler,
  SystemStatusBanner,
  useSystemErrorHandling
} from './SystemErrorHandler';
import {
  ExclamationTriangleIcon,
  ArrowPathIcon,
  XMarkIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';

interface ErrorNotificationManagerProps {
  children: React.ReactNode;
  showSystemBanner?: boolean;
  showConnectionStatus?: boolean;
  enableAutoRetry?: boolean;
  maxRetryAttempts?: number;
}

/**
 * Comprehensive error notification manager that handles all types of errors
 * and provides fallback UI when real-time features are unavailable
 */
export function ErrorNotificationManager({
  children,
  showSystemBanner = true,
  showConnectionStatus = true,
  enableAutoRetry = true,
  maxRetryAttempts = 5
}: ErrorNotificationManagerProps) {
  const { isSubscribed, error, showError, showWarning, showInfo } = useNotifications();
  const { isAuthenticated, user } = useAuth();
  const { isRealTimeAvailable, retryConnection } = useErrorNotificationHandling();
  const { addToRetryQueue, retryAllOperations, getRetryQueueStatus } = useSystemErrorHandling();

  const [globalErrors, setGlobalErrors] = useState<Map<string, any>>(new Map());
  const [isRetryingAll, setIsRetryingAll] = useState(false);

  // Handle global error events
  const handleGlobalError = useCallback((error: ErrorEvent) => {
    const errorInfo = parseApiError(error.error);
    const errorId = `global-${Date.now()}`;

    setGlobalErrors(prev => new Map(prev.set(errorId, {
      id: errorId,
      error: error.error,
      info: errorInfo,
      timestamp: new Date().toISOString(),
      url: error.filename,
      line: error.lineno,
      column: error.colno
    })));

    // Show user-friendly error notification
    if (errorInfo.type === 'network' || errorInfo.retryable) {
      showWarning(
        'Connection Issue',
        errorInfo.userFriendly,
        undefined
      );

      // Add to retry queue if retryable
      if (shouldRetryError(error.error)) {
        addToRetryQueue(errorId, async () => {
          // Attempt to reconnect notification service
          await retryConnection();
        });
      }
    } else {
      showError(
        'Application Error',
        errorInfo.userFriendly,
        undefined
      );
    }

    // Log for debugging
    console.error('Global error handled:', {
      errorId,
      message: error.message,
      filename: error.filename,
      line: error.lineno,
      column: error.colno,
      error: error.error
    });
  }, [showError, showWarning, addToRetryQueue, retryConnection]);

  // Handle unhandled promise rejections
  const handleUnhandledRejection = useCallback((event: PromiseRejectionEvent) => {
    const errorInfo = parseApiError(event.reason);
    const errorId = `promise-${Date.now()}`;

    setGlobalErrors(prev => new Map(prev.set(errorId, {
      id: errorId,
      reason: event.reason,
      info: errorInfo,
      timestamp: new Date().toISOString()
    })));

    // Only show critical errors to avoid spam
    if (errorInfo.type === 'authentication' || errorInfo.type === 'authorization') {
      showError(
        'Authentication Error',
        errorInfo.userFriendly,
        '/auth/signin'
      );
    } else if (errorInfo.type === 'network' && errorInfo.retryable) {
      showWarning(
        'Network Error',
        errorInfo.userFriendly,
        undefined
      );

      // Add to retry queue
      addToRetryQueue(errorId, async () => {
        // Attempt to reconnect
        await retryConnection();
      });
    }

    console.error('Unhandled promise rejection:', {
      errorId,
      reason: event.reason,
      errorInfo
    });
  }, [showError, showWarning, addToRetryQueue, retryConnection]);

  // Set up global error handlers
  useEffect(() => {
    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [handleGlobalError, handleUnhandledRejection]);

  // Auto-retry failed operations
  useEffect(() => {
    if (!enableAutoRetry) return;

    const retryInterval = setInterval(async () => {
      const queueStatus = getRetryQueueStatus();

      if (queueStatus.pendingOperations > 0 && !queueStatus.isRetrying) {
        console.log(`Auto-retrying ${queueStatus.pendingOperations} failed operations...`);

        try {
          const results = await retryAllOperations();
          const successful = results?.filter(r => r.success).length || 0;
          const failed = results?.filter(r => !r.success).length || 0;

          if (successful > 0) {
            showInfo(
              'Operations Restored',
              `Successfully restored ${successful} failed operation${successful > 1 ? 's' : ''}.`,
              undefined
            );
          }

          if (failed > 0) {
            console.warn(`${failed} operations still failing after retry`);
          }
        } catch (error) {
          console.error('Auto-retry failed:', error);
        }
      }
    }, 30000); // Retry every 30 seconds

    return () => clearInterval(retryInterval);
  }, [enableAutoRetry, getRetryQueueStatus, retryAllOperations, showInfo]);

  // Manual retry all operations
  const handleRetryAll = async () => {
    setIsRetryingAll(true);
    try {
      const results = await retryAllOperations();
      const successful = results?.filter(r => r.success).length || 0;

      if (successful > 0) {
        showInfo(
          'Retry Complete',
          `Successfully restored ${successful} operation${successful > 1 ? 's' : ''}.`,
          undefined
        );
      }
    } catch (error) {
      showError(
        'Retry Failed',
        'Unable to restore failed operations. Please refresh the page.',
        undefined
      );
    } finally {
      setIsRetryingAll(false);
    }
  };

  const queueStatus = getRetryQueueStatus();

  return (
    <div className="error-notification-manager">
      {/* System status banner */}
      {showSystemBanner && <SystemStatusBanner />}

      {/* Connection status indicator */}
      {showConnectionStatus && isAuthenticated && (
        <div className="flex items-center justify-between p-2 bg-gray-50 border-b">
          <div className="flex items-center space-x-2">
            <ConnectionStatusIndicator />
            <span className="text-xs text-gray-600">
              {isRealTimeAvailable ? 'Real-time updates active' : 'Limited functionality'}
            </span>
          </div>

          {/* Retry queue status */}
          {queueStatus.pendingOperations > 0 && (
            <div className="flex items-center space-x-2">
              <span className="text-xs text-orange-600">
                {queueStatus.pendingOperations} operation{queueStatus.pendingOperations > 1 ? 's' : ''} pending retry
              </span>
              <button
                onClick={handleRetryAll}
                disabled={isRetryingAll || queueStatus.isRetrying}
                className="inline-flex items-center px-2 py-1 text-xs font-medium text-orange-800 bg-orange-100 hover:bg-orange-200 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRetryingAll || queueStatus.isRetrying ? (
                  <>
                    <ArrowPathIcon className="w-3 h-3 mr-1 animate-spin" />
                    Retrying...
                  </>
                ) : (
                  <>
                    <ArrowPathIcon className="w-3 h-3 mr-1" />
                    Retry All
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Fallback UI for when real-time features are unavailable */}
      {!isRealTimeAvailable && isAuthenticated && (
        <FallbackUI
          feature="Dashboard updates"
          onRetry={retryConnection}
          showRetry={true}
          severity={error ? 'high' : 'medium'}
          customMessage={
            error
              ? 'Real-time features are currently unavailable. Data may not update automatically.'
              : 'Connecting to real-time services...'
          }
          showRefreshOption={true}
        />
      )}

      {/* Error notification handlers */}
      <ErrorNotificationHandler />
      <SystemErrorHandler />

      {/* Main content */}
      {children}
    </div>
  );
}

/**
 * Error notification toast that appears for critical errors
 */
interface ErrorToastProps {
  error: {
    id: string;
    title: string;
    message: string;
    type: 'error' | 'warning' | 'info';
    retryable?: boolean;
    onRetry?: () => Promise<void>;
  };
  onDismiss: (id: string) => void;
  autoHide?: boolean;
  duration?: number;
}

export function ErrorToast({
  error,
  onDismiss,
  autoHide = true,
  duration = 8000
}: ErrorToastProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  // Auto-hide toast
  useEffect(() => {
    if (autoHide && duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => onDismiss(error.id), 300); // Allow fade out animation
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [autoHide, duration, error.id, onDismiss]);

  const handleRetry = async () => {
    if (!error.onRetry || isRetrying) return;

    setIsRetrying(true);
    try {
      await error.onRetry();
      onDismiss(error.id);
    } catch (retryError) {
      console.error('Toast retry failed:', retryError);
    } finally {
      setIsRetrying(false);
    }
  };

  const getToastStyles = () => {
    switch (error.type) {
      case 'error':
        return {
          bg: 'bg-red-50',
          border: 'border-red-200',
          icon: 'text-red-500',
          text: 'text-red-800',
          button: 'bg-red-100 hover:bg-red-200 text-red-800'
        };
      case 'warning':
        return {
          bg: 'bg-yellow-50',
          border: 'border-yellow-200',
          icon: 'text-yellow-500',
          text: 'text-yellow-800',
          button: 'bg-yellow-100 hover:bg-yellow-200 text-yellow-800'
        };
      case 'info':
      default:
        return {
          bg: 'bg-blue-50',
          border: 'border-blue-200',
          icon: 'text-blue-500',
          text: 'text-blue-800',
          button: 'bg-blue-100 hover:bg-blue-200 text-blue-800'
        };
    }
  };

  const styles = getToastStyles();

  if (!isVisible) return null;

  return (
    <div className={`fixed bottom-4 right-4 max-w-sm w-full ${styles.bg} ${styles.border} border rounded-lg shadow-lg z-50 transform transition-all duration-300 ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}>
      <div className="p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            {error.type === 'error' ? (
              <ExclamationTriangleIcon className={`w-5 h-5 ${styles.icon}`} />
            ) : (
              <InformationCircleIcon className={`w-5 h-5 ${styles.icon}`} />
            )}
          </div>
          <div className="ml-3 w-0 flex-1">
            <p className={`text-sm font-medium ${styles.text}`}>
              {error.title}
            </p>
            <p className={`mt-1 text-sm ${styles.text} opacity-75`}>
              {error.message}
            </p>
            {error.retryable && error.onRetry && (
              <div className="mt-3">
                <button
                  onClick={handleRetry}
                  disabled={isRetrying}
                  className={`inline-flex items-center px-3 py-1.5 text-xs font-medium ${styles.button} rounded-md disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isRetrying ? (
                    <>
                      <ArrowPathIcon className="w-3 h-3 mr-1 animate-spin" />
                      Retrying...
                    </>
                  ) : (
                    <>
                      <ArrowPathIcon className="w-3 h-3 mr-1" />
                      Retry
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
          <div className="ml-4 flex-shrink-0 flex">
            <button
              onClick={() => onDismiss(error.id)}
              className={`inline-flex ${styles.text} hover:opacity-75`}
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook for managing error notifications with enhanced retry logic
 */
export function useErrorNotificationManager() {
  const { showError, showWarning, showInfo } = useNotifications();
  const { addToRetryQueue, removeFromRetryQueue } = useSystemErrorHandling();
  const [activeToasts, setActiveToasts] = useState<Map<string, any>>(new Map());

  // Show error with retry capability
  const showRetryableError = useCallback((
    title: string,
    message: string,
    retryOperation: () => Promise<void>,
    options?: {
      maxRetries?: number;
      retryDelay?: number;
      showToast?: boolean;
    }
  ) => {
    const errorId = `retryable-${Date.now()}`;
    const { maxRetries = 3, retryDelay = 1000, showToast = true } = options || {};

    // Add to retry queue
    addToRetryQueue(errorId, retryOperation);

    // Show notification
    if (showToast) {
      const toastError = {
        id: errorId,
        title,
        message,
        type: 'error' as const,
        retryable: true,
        onRetry: async () => {
          await retryOperation();
          removeFromRetryQueue(errorId);
        }
      };

      setActiveToasts(prev => new Map(prev.set(errorId, toastError)));
    } else {
      showError(title, message, undefined);
    }

    return errorId;
  }, [showError, addToRetryQueue, removeFromRetryQueue]);

  // Dismiss toast
  const dismissToast = useCallback((toastId: string) => {
    setActiveToasts(prev => {
      const newMap = new Map(prev);
      newMap.delete(toastId);
      return newMap;
    });
  }, []);

  // Get active toasts
  const getActiveToasts = useCallback(() => {
    return Array.from(activeToasts.values());
  }, [activeToasts]);

  return {
    showRetryableError,
    dismissToast,
    getActiveToasts,
    activeToasts: Array.from(activeToasts.values())
  };
}

export default ErrorNotificationManager;
