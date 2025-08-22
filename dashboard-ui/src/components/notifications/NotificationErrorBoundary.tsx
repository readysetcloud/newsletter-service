import React, { Component, ReactNode } from 'react';
import { ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

interface NotificationErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  retryCount: number;
}

interface NotificationErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  maxRetries?: number;
}

/**
 * Error boundary specifically for notification-related components
 * Provides graceful degradation when notification features fail
 */
export class NotificationErrorBoundary extends Component<
  NotificationErrorBoundaryProps,
  NotificationErrorBoundaryState
> {
  private retryTimeoutId: NodeJS.Timeout | null = null;

  constructor(props: NotificationErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0
    };
  }

  static getDerivedStateFromError(error: Error): Partial<NotificationErrorBoundaryState> {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({
      error,
      errorInfo
    });

    // Log error for debugging
    console.error('Notification Error Boundary caught an error:', error, errorInfo);

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Auto-retry after a delay if under retry limit
    const maxRetries = this.props.maxRetries || 3;
    if (this.state.retryCount < maxRetries) {
      this.scheduleRetry();
    }
  }

  componentWillUnmount() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
  }

  private scheduleRetry = () => {
    const retryDelay = Math.min(1000 * Math.pow(2, this.state.retryCount), 10000); // Exponential backoff

    this.retryTimeoutId = setTimeout(() => {
      this.handleRetry();
    }, retryDelay);
  };

  private handleRetry = () => {
    this.setState(prevState => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prevState.retryCount + 1
    }));
  };

  private handleManualRetry = () => {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
    this.handleRetry();
  };

  private renderErrorFallback() {
    const { fallback, maxRetries = 3 } = this.props;
    const { error, retryCount } = this.state;

    // Use custom fallback if provided
    if (fallback) {
      return fallback;
    }

    // Default error UI
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 m-4">
        <div className="flex items-start space-x-3">
          <ExclamationTriangleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-medium text-red-800">
              Notification System Error
            </h3>
            <p className="text-sm text-red-700 mt-1">
              The notification system encountered an error and is temporarily unavailable.
              You can continue using the application, but real-time updates may not work.
            </p>

            {/* Error details in development */}
            {process.env.NODE_ENV === 'development' && error && (
              <details className="mt-3">
                <summary className="text-xs text-red-600 cursor-pointer hover:text-red-800">
                  Error Details (Development)
                </summary>
                <pre className="text-xs text-red-600 mt-2 p-2 bg-red-100 rounded overflow-auto max-h-32">
                  {error.toString()}
                </pre>
              </details>
            )}

            {/* Retry button */}
            <div className="mt-3 flex items-center space-x-3">
              {retryCount < maxRetries ? (
                <button
                  onClick={this.handleManualRetry}
                  className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-red-800 bg-red-100 hover:bg-red-200 rounded-md transition-colors"
                >
                  <ArrowPathIcon className="w-3 h-3 mr-1" />
                  Retry ({retryCount}/{maxRetries})
                </button>
              ) : (
                <span className="text-xs text-red-600">
                  Maximum retry attempts reached. Please refresh the page.
                </span>
              )}

              <button
                onClick={() => window.location.reload()}
                className="text-xs text-red-600 hover:text-red-800 underline"
              >
                Refresh Page
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  render() {
    if (this.state.hasError) {
      return this.renderErrorFallback();
    }

    return this.props.children;
  }
}

/**
 * Higher-order component that wraps components with notification error boundary
 */
export function withNotificationErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<NotificationErrorBoundaryProps, 'children'>
) {
  const WrappedComponent = (props: P) => (
    <NotificationErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </NotificationErrorBoundary>
  );

  WrappedComponent.displayName = `withNotificationErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
}

/**
 * Hook for handling notification errors in functional components
 */
export function useNotificationErrorHandler() {
  const [error, setError] = React.useState<Error | null>(null);
  const [retryCount, setRetryCount] = React.useState(0);

  const handleError = React.useCallback((error: Error) => {
    console.error('Notification error:', error);
    setError(error);
  }, []);

  const clearError = React.useCallback(() => {
    setError(null);
  }, []);

  const retry = React.useCallback(() => {
    setRetryCount(prev => prev + 1);
    setError(null);
  }, []);

  const reset = React.useCallback(() => {
    setError(null);
    setRetryCount(0);
  }, []);

  return {
    error,
    retryCount,
    handleError,
    clearError,
    retry,
    reset,
    hasError: error !== null
  };
}
