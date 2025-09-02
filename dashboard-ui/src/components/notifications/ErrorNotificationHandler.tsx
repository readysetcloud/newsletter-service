import { useEffect, useCallback, useState, useRef } from 'react';
import { useNotifications } from '../../hooks/useNotifications';
import { useAuth } from '../../contexts/AuthContext';
import { notificationService } from '../../services/notificationService';
import {
  ExclamationTriangleIcon,
  WifiIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';

/**
 * Error notification handler that manages system errors and connection issues
 */
export function ErrorNotificationHandler() {
  const { showError, showWarning, showInfo, isSubscribed, error, addNotification } = useNotifications();
  const { user, isAuthenticated } = useAuth();
  const [retryAttempts, setRetryAttempts] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [systemErrors, setSystemErrors] = useState<Set<string>>(new Set());
  const [lastErrorTime, setLastErrorTime] = useState<Date | null>(null);
  const lastErrorRef = useRef<string | null>(null);

  // Handle system error notifications with enhanced categorization
  const handleSystemError = useCallback((errorData: {
    type: 'SYSTEM_ERROR' | 'SERVICE_UNAVAILABLE' | 'RATE_LIMIT_EXCEEDED' | 'AUTHENTICATION_FAILED' | 'MOMENTO_ERROR' | 'API_ERROR';
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    actionUrl?: string;
    retryable?: boolean;
    correlationId?: string;
    timestamp?: string;
  }) => {
    const { type, message, severity, actionUrl, retryable, correlationId } = errorData;

    // Track unique errors to avoid spam
    const errorKey = `${type}-${message.substring(0, 50)}`;
    if (systemErrors.has(errorKey)) {
      console.log('Duplicate errorion suppressed:', errorKey);
      return;
    }

    setSystemErrors(prev => new Set([...prev, errorKey]));
    setLastErrorTime(new Date());

    // Clear error tracking after 5 minutes
    setTimeout(() => {
      setSystemErrors(prev => {
        const newSet = new Set(prev);
        newSet.delete(errorKey);
        return newSet;
      });
    }, 5 * 60 * 1000);

    // Determine notification type based on severity
    const notificationHandler = severity === 'critical' || severity === 'high'
      ? showError
      : severity === 'medium' ? showWarning : showInfo;

    // Create user-friendly error messages with enhanced context
    let title = 'System Error';
    let userMessage = message;
    let enhancedActionUrl = actionUrl;

    switch (type) {
      case 'SERVICE_UNAVAILABLE':
        title = 'Service Temporarily Unavailable';
        userMessage = 'Some features may not be available right now. We\'re working to restore service.';
        if (retryable) {
          userMessage += ' The system will automatically retry the connection.';
        }
        break;
      case 'RATE_LIMIT_EXCEEDED':
        title = 'Rate Limit Exceeded';
        userMessage = 'You\'re making requests too quickly. Please wait a moment before trying again.';
        break;
      case 'AUTHENTICATION_FAILED':
        title = 'Authentication Issue';
        userMessage = 'There was an authentication problem. You may need to sign in again.';
        enhancedActionUrl = '/auth/signin';
        break;
      case 'MOMENTO_ERROR':
        title = 'Real-time Service Issue';
        userMessage = 'The real-time notification service is experiencing issues. Some updates may be delayed.';
        break;
      case 'API_ERROR':
        title = 'API Service Error';
        userMessage = 'There was an issue communicating with our servers. Please try again.';
        break;
      case 'SYSTEM_ERROR':
      default:
        title = 'System Error';
        userMessage = message || 'An unexpected error occurred. Please try again later.';
        break;
    }

    // Add correlation ID to message if available
    if (correlationId && severity === 'critical') {
      userMessage += ` (Error ID: ${correlationId.substring(0, 8)})`;
    }

    // Create enhanced notification with retry capability
    if (retryable && severity !== 'low') {
      addNotification({
        type: severity === 'critical' || severity === 'high' ? 'error' : 'warning',
        title,
        message: userMessage,
        actionUrl: enhancedActionUrl
      });
    } else {
      notificationHandler(title, userMessage, enhancedActionUrl);
    }

    // Log error for debugging with enhanced context
    console.error('System error notification:', {
      type,
      message,
      severity,
      correlationId,
      timestamp: errorData.timestamp || new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href
    });
  }, [showError, showWarning, showInfo, addNotification, systemErrors]);

  // Handle connection errors
  const handleConnectionError = useCallback(() => {
    showError(
      'Connection Lost',
      'Real-time notifications are temporarily unavailable. Some features may not work as expected.',
      undefined
    );
  }, [showError]);

  // Enhanced retry logic with exponential backoff and circuit breaker pattern
  const handleRetry = useCallback(async (operation?: 'connection' | 'api' | 'auth') => {
    if (!user || isRetrying) return { success: false, error: 'Already retrying or no user' };

    const maxRetries = operation === 'auth' ? 1 : 5; // Auth errors get fewer retries
    const baseDelay = operation === 'connection' ? 2000 : 1000;

    if (retryAttempts >= maxRetries) {
      showError(
        'Maximum Retries Exceeded',
        'Unable to restore service after multiple attempts. Please refresh the page or contact support.',
        undefined
      );
      return { success: false, error: 'Max retries exceeded' };
    }

    setIsRetrying(true);
    setRetryAttempts(prev => prev + 1);

    // Calculate exponential backoff delay
    const delay = Math.min(baseDelay * Math.pow(2, retryAttempts), 30000); // Max 30 seconds

    try {
      // Show retry notification
      showInfo(
        'Retrying Connection',
        `Attempting to restore service (${retryAttempts + 1}/${maxRetries})...`,
        undefined
      );

      // Wait for backoff delay
      if (retryAttempts > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Get fresh JWT token
      const { fetchAuthSession } = await import('aws-amplify/auth');
      const session = await fetchAuthSession();
      const jwtToken = session.tokens?.idToken?.toString();

      if (!jwtToken) {
        throw new Error('No JWT token available - authentication may be required');
      }

      // Attempt to refresh the notification service
      await notificationService.refreshToken(jwtToken);

      // Success - reset retry counter and show success message
      setRetryAttempts(0);
      showInfo(
        'Connection Restored',
        'Real-time notifications have been successfully restored.',
        undefined
      );

      return { success: true };
    } catch (error) {
      console.error(`Retry attempt ${retryAttempts + 1} failed:`, error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (retryAttempts + 1 < maxRetries) {
        const nextDelay = Math.min(baseDelay * Math.pow(2, retryAttempts + 1), 30000);
        showWarning(
          'Retry Failed',
          `Attempt ${retryAttempts + 1} failed. Next retry in ${Math.round(nextDelay / 1000)} seconds...`,
          undefined
        );
      } else {
        // Final attempt failed
        if (errorMessage.includes('authentication') || errorMessage.includes('JWT')) {
          showError(
            'Authentication Required',
            'Your session has expired. Please sign in again to restore notifications.',
            '/auth/signin'
          );
        } else {
          showError(
            'Connection Failed',
            'Unable to restore real-time notifications after multiple attempts. Please refresh the page.',
            undefined
          );
        }
      }

      return { success: false, error: errorMessage };
    } finally {
      setIsRetrying(false);
    }
  }, [user, isRetrying, retryAttempts, showWarning, showError, showInfo]);

  // Monitor connection status and handle errors
  useEffect(() => {
    if (!isAuthenticated || !error || isSubscribed) return;

    if (lastErrorRef.current !== error) {
      lastErrorRef.current = error;
      handleConnectionError();
    }

  }, [isAuthenticated, error, isSubscribed, handleConnectionError]);

  // Auto-retry connection after a delay
  useEffect(() => {
    if (error && retryAttempts < 3 && !isRetrying) {
      const retryDelay = Math.min(1000 * Math.pow(2, retryAttempts), 10000); // Exponential backoff, max 10s

      const timer = setTimeout(() => {
        handleRetry();
      }, retryDelay);

      return () => clearTimeout(timer);
    }
  }, [error, retryAttempts, isRetrying, handleRetry]);

  // This component doesn't render anything
  return null;
}

/**
 * Enhanced fallback UI component that shows when real-time features are unavailable
 */
interface FallbackUIProps {
  feature: string;
  onRetry?: () => Promise<{ success: boolean; error?: string }>;
  showRetry?: boolean;
  severity?: 'low' | 'medium' | 'high';
  customMessage?: string;
  showRefreshOption?: boolean;
}

export function FallbackUI({
  feature,
  onRetry,
  showRetry = true,
  severity = 'medium',
  customMessage,
  showRefreshOption = true
}: FallbackUIProps) {
  const { error, isLoading, isSubscribed } = useNotifications();
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [lastRetryTime, setLastRetryTime] = useState<Date | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  // Don't show fallback if everything is working or if dismissed
  if ((isSubscribed && !error) || isDismissed) {
    return null;
  }

  const handleRetry = async () => {
    if (!onRetry || isRetrying) return;

    setIsRetrying(true);
    setRetryCount(prev => prev + 1);
    setLastRetryTime(new Date());

    try {
      const result = await onRetry();
      if (result.success) {
        setRetryCount(0);
        // Component will automatically hide when isSubscribed becomes true
      }
    } catch (error) {
      console.error('Fallback UI retry failed:', error);
    } finally {
      setIsRetrying(false);
    }
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  // Determine styling based on severity
  const getSeverityStyles = () => {
    switch (severity) {
      case 'high':
        return {
          bg: 'bg-red-50',
          border: 'border-red-200',
          icon: 'text-red-500',
          title: 'text-red-800',
          text: 'text-red-700',
          button: 'bg-red-100 hover:bg-red-200 text-red-800'
        };
      case 'low':
        return {
          bg: 'bg-blue-50',
          border: 'border-blue-200',
          icon: 'text-blue-500',
          title: 'text-blue-800',
          text: 'text-blue-700',
          button: 'bg-blue-100 hover:bg-blue-200 text-blue-800'
        };
      case 'medium':
      default:
        return {
          bg: 'bg-yellow-50',
          border: 'border-yellow-200',
          icon: 'text-yellow-500',
          title: 'text-yellow-800',
          text: 'text-yellow-700',
          button: 'bg-yellow-100 hover:bg-yellow-200 text-yellow-800'
        };
    }
  };

  const styles = getSeverityStyles();

  return (
    <div className={`${styles.bg} ${styles.border} border rounded-lg p-4 mb-4 relative`}>
      {/* Dismiss button */}
      <button
        onClick={() => setIsDismissed(true)}
        className={`absolute top-2 right-2 ${styles.text} hover:opacity-75`}
        title="Dismiss this notice"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="flex items-start space-x-3 pr-6">
        <ExclamationTriangleIcon className={`w-5 h-5 ${styles.icon} flex-shrink-0 mt-0.5`} />
        <div className="flex-1">
          <h3 className={`text-sm font-medium ${styles.title}`}>
            {severity === 'high' ? 'Service Unavailable' : 'Limited Functionality'}
          </h3>
          <p className={`text-sm ${styles.text} mt-1`}>
            {customMessage || `${feature} may not update automatically. Real-time features are temporarily unavailable.`}
          </p>

          {/* Status information */}
          <div className={`text-xs ${styles.text} mt-2 space-y-1`}>
            {error && (
              <div>
                <strong>Status:</strong> {error}
              </div>
            )}
            {retryCount > 0 && (
              <div>
                <strong>Retry attempts:</strong> {retryCount}
              </div>
            )}
            {lastRetryTime && (
              <div>
                <strong>Last attempt:</strong> {lastRetryTime.toLocaleTimeString()}
              </div>
            )}
          </div>

          {/* Action buttons */}
          {(showRetry || showRefreshOption) && (
            <div className="mt-3 flex items-center space-x-3 flex-wrap gap-2">
              {showRetry && onRetry && (
                <button
                  onClick={handleRetry}
                  disabled={isLoading || isRetrying}
                  className={`inline-flex items-center px-3 py-1.5 text-xs font-medium ${styles.button} rounded-md disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isRetrying ? (
                    <>
                      <ArrowPathIcon className="w-3 h-3 mr-1 animate-spin" />
                      Retrying...
                    </>
                  ) : (
                    <>
                      <WifiIcon className="w-3 h-3 mr-1" />
                      Retry Connection
                    </>
                  )}
                </button>
              )}

              {showRefreshOption && (
                <button
                  onClick={handleRefresh}
                  className={`inline-flex items-center px-3 py-1.5 text-xs font-medium ${styles.button} rounded-md`}
                >
                  <ArrowPathIcon className="w-3 h-3 mr-1" />
                  Refresh Page
                </button>
              )}

              <span className={`text-xs ${styles.text}`}>
                {showRefreshOption
                  ? 'or refresh the page to restore functionality'
                  : 'Some features may work with reduced functionality'
                }
              </span>
            </div>
          )}

          {/* Fallback suggestions */}
          <div className={`mt-3 text-xs ${styles.text} bg-white bg-opacity-50 rounded p-2`}>
            <strong>While offline:</strong>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>Data may not update automatically</li>
              <li>Manual refresh may be needed to see changes</li>
              <li>Some interactive features may be limited</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Connection status indicator component
 */
export function ConnectionStatusIndicator() {
  const { isSubscribed, error, isLoading } = useNotifications();
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="flex items-center space-x-2 text-xs text-blue-600">
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
        <span>Connecting...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center space-x-2 text-xs text-red-600">
        <div className="w-2 h-2 bg-red-500 rounded-full"></div>
        <span>Offline</span>
      </div>
    );
  }

  if (isSubscribed) {
    return (
      <div className="flex items-center space-x-2 text-xs text-green-600">
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
        <span>Live</span>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-2 text-xs text-gray-500">
      <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
      <span>Disconnected</span>
    </div>
  );
}

/**
 * Hook for handling error notifications and retry logic
 */
export function useErrorNotificationHandling() {
  const { error, isSubscribed, showError, showWarning } = useNotifications();
  const { user } = useAuth();
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);

  // Check if real-time features are available
  const isRealTimeAvailable = isSubscribed && !error;

  // Retry connection
  const retryConnection = useCallback(async () => {
    if (!user || isRetrying) return { success: false, error: 'Already retrying or user not authenticated' };

    setIsRetrying(true);
    setRetryCount(prev => prev + 1);

    try {
      // Get fresh JWT token
      const { fetchAuthSession } = await import('aws-amplify/auth');
      const session = await fetchAuthSession();
      const jwtToken = session.tokens?.idToken?.toString();

      if (jwtToken) {
        await notificationService.refreshToken(jwtToken);
        setRetryCount(0);
        return { success: true };
      }
      return { success: false, error: 'No valid JWT token available' };
    } catch (error) {
      console.error('Connection retry failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Connection retry failed' };
    } finally {
      setIsRetrying(false);
    }
  }, [user, isRetrying]);

  // Show appropriate error messages
  const showConnectionError = useCallback((customMessage?: string) => {
    showError(
      'Connection Issue',
      customMessage || 'Real-time features are temporarily unavailable.',
      undefined
    );
  }, [showError]);

  const showRetryWarning = useCallback(() => {
    showWarning(
      'Retrying Connection',
      'Attempting to restore real-time notifications...',
      undefined
    );
  }, [showWarning]);

  return {
    isRealTimeAvailable,
    retryCount,
    isRetrying,
    retryConnection,
    showConnectionError,
    showRetryWarning
  };
}
