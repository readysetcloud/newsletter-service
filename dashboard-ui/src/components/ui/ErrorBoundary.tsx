import React, { Component, ReactNode } from 'react';
import { ErrorFallback } from './ErrorDisplay';

/**
 * Error boundary state
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Error boundary props
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: React.ComponentType<{ error: Error; resetError: () => void }>;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  resetOnPropsChange?: boolean;
  resetKeys?: Array<string | number>;
  className?: string;
}

/**
 * Error boundary component for graceful error handling
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private resetTimeoutId: number | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
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

    // Call onError callback if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Error caught by ErrorBoundary:', error);
      console.error('Error info:', errorInfo);
    }

    // Log error to monitoring service in production
    if (process.env.NODE_ENV === 'production') {
      this.logErrorToService(error, errorInfo);
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    const { resetOnPropsChange, resetKeys } = this.props;
    const { hasError } = this.state;

    // Reset error state if resetKeys have changed
    if (hasError && resetKeys && prevProps.resetKeys) {
      const hasResetKeyChanged = resetKeys.some(
        (key, index) => key !== prevProps.resetKeys![index]
      );

      if (hasResetKeyChanged) {
        this.resetError();
      }
    }

    // Reset error state if any props changed and resetOnPropsChange is true
    if (hasError && resetOnPropsChange && prevProps !== this.props) {
      this.resetError();
    }
  }

  componentWillUnmount() {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }
  }

  /**
   * Reset error state
   */
  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  /**
   * Reset error state with delay
   */
  resetErrorWithDelay = (delay: number = 100) => {
    this.resetTimeoutId = window.setTimeout(() => {
      this.resetError();
    }, delay);
  };

  /**
   * Log error to monitoring service
   */
  private logErrorToService = (error: Error, errorInfo: React.ErrorInfo) => {
    // In a real application, you would send this to your error monitoring service
    // like Sentry, LogRocket, or Bugsnag
    try {
      const errorData = {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href
      };

      // Example: Send to monitoring service
      // monitoringService.captureException(error, { extra: errorData });

      console.error('Error logged to monitoring service:', errorData);
    } catch (loggingError) {
      console.error('Failed to log error to monitoring service:', loggingError);
    }
  };

  render() {
    const { hasError, error } = this.state;
    const { children, fallback: FallbackComponent, className } = this.props;

    if (hasError && error) {
      // Use custom fallback component if provided
      if (FallbackComponent) {
        return <FallbackComponent error={error} resetError={this.resetError} />;
      }

      // Use default error fallback
      return (
        <div className={className}>
          <ErrorFallback error={error} resetError={this.resetError} />
        </div>
      );
    }

    return children;
  }
}

/**
 * Hook-based error boundary for functional components
 */
export const useErrorHandler = () => {
  const [error, setError] = React.useState<Error | null>(null);

  const resetError = React.useCallback(() => {
    setError(null);
  }, []);

  const captureError = React.useCallback((error: Error) => {
    setError(error);
  }, []);

  // Throw error to be caught by nearest error boundary
  React.useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  return { captureError, resetError };
};

/**
 * Higher-order component for adding error boundary
 */
export const withErrorBoundary = <P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
) => {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
};

/**
 * Template-specific error boundary
 */
interface TemplateErrorBoundaryProps {
  children: ReactNode;
  templateName?: string;
  onError?: (error: Error) => void;
  className?: string;
}

export const TemplateErrorBoundary: React.FC<TemplateErrorBoundaryProps> = ({
  children,
  templateName,
  onError,
  className
}) => {
  const handleError = React.useCallback((error: Error, errorInfo: React.ErrorInfo) => {
    // Log template-specific error context
    console.error(`Template error in ${templateName || 'unknown template'}:`, {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack
    });

    if (onError) {
      onError(error);
    }
  }, [templateName, onError]);

  const fallback = React.useCallback(({ error, resetError }: { error: Error; resetError: () => void }) => (
    <ErrorFallback
      error={error}
      resetError={resetError}
      className="border-2 border-red-200 bg-red-50"
    />
  ), []);

  return (
    <ErrorBoundary
      onError={handleError}
      fallback={fallback}
      className={className}
    >
      {children}
    </ErrorBoundary>
  );
};

/**
 * Async error boundary for handling promise rejections
 */
export const AsyncErrorBoundary: React.FC<{
  children: ReactNode;
  onError?: (error: Error, errorInfo?: React.ErrorInfo) => void;
}> = ({ children, onError }) => {
  const { captureError } = useErrorHandler();

  React.useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));

      if (onError) {
        onError(error);
      }

      captureError(error);
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [captureError, onError]);

  return <>{children}</>;
};

/**
 * Error boundary specifically for form components
 */
export const FormErrorBoundary: React.FC<{
  children: ReactNode;
  formName?: string;
  onError?: (error: Error) => void;
}> = ({ children, formName, onError }) => {
  const handleError = React.useCallback((error: Error, errorInfo: React.ErrorInfo) => {
    console.error(`Form error in ${formName || 'unknown form'}:`, {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack
    });

    if (onError) {
      onError(error);
    }
  }, [formName, onError]);

  return (
    <ErrorBoundary onError={handleError} resetOnPropsChange>
      {children}
    </ErrorBoundary>
  );
};

/**
 * Global error boundary for the entire application
 */
export const GlobalErrorBoundary: React.FC<{
  children: ReactNode;
}> = ({ children }) => {
  const handleError = React.useCallback((error: Error, errorInfo?: React.ErrorInfo) => {
    // Log to console
    console.error('Global error caught:', error);
    console.error('Error info:', errorInfo);

    // In production, send to error monitoring service
    if (process.env.NODE_ENV === 'production') {
      // Example: Sentry.captureException(error, { extra: errorInfo });
    }
  }, []);

  const fallback = React.useCallback(({ error, resetError }: { error: Error; resetError: () => void }) => (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full">
        <ErrorFallback
          error={error}
          resetError={resetError}
          className="shadow-lg"
        />
      </div>
    </div>
  ), []);

  return (
    <ErrorBoundary onError={handleError} fallback={fallback}>
      <AsyncErrorBoundary onError={handleError}>
        {children}
      </AsyncErrorBoundary>
    </ErrorBoundary>
  );
};
