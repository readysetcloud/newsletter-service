import React, { Component, ReactNode } from 'react';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { FallbackNavigation } from './FallbackNavigation';
import { useResponsive } from '@/hooks/useResponsive';
import { cn } from '@/utils/cn';
import type { ScreenSize } from '@/types/sidebar';

/**
 * Navigation-specific error boundary props
 */
interface NavigationErrorBoundaryProps {
  children: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  className?: string;
}

/**
 * Navigation error boundary state
 */
interface NavigationErrorState {
  hasNavigationError: boolean;
  hasResponsiveError: boolean;
  hasIconError: boolean;
  errorType: 'navigation' | 'responsive' | 'icon' | 'unknown';
  fallbackScreenSize: ScreenSize;
}

/**
 * Navigation error boundary component for graceful error handling
 * Provides specific fallbacks for different types of navigation errors
 */
export class NavigationErrorBoundary extends Component<NavigationErrorBoundaryProps, NavigationErrorState> {
  constructor(props: NavigationErrorBoundaryProps) {
    super(props);
    this.state = {
      hasNavigationError: false,
      hasResponsiveError: false,
      hasIconError: false,
      errorType: 'unknown',
      fallbackScreenSize: 'desktop'
    };
  }

  static getDerivedStateFromError(error: Error): Partial<NavigationErrorState> {
    // Analyze error to determine type and appropriate fallback
    const errorMessage = error.message.toLowerCase();
    const errorStack = error.stack?.toLowerCase() || '';

    let errorType: NavigationErrorState['errorType'] = 'unknown';
    let fallbackScreenSize: ScreenSize = 'desktop';

    // Detect responsive detection errors
    if (errorMessage.includes('resize') ||
        errorMessage.includes('window') ||
        errorMessage.includes('innerwidth') ||
        errorStack.includes('useresponsive')) {
      errorType = 'responsive';
      fallbackScreenSize = 'mobile'; // Default to mobile menu as safest fallback
    }
    // Detect icon loading errors
    else if (errorMessage.includes('icon') ||
             errorMessage.includes('svg') ||
             errorMessage.includes('heroicons') ||
             errorStack.includes('icon')) {
      errorType = 'icon';
    }
    // Detect navigation configuration errors
    else if (errorMessage.includes('navigation') ||
             errorMessage.includes('sidebar') ||
             errorStack.includes('navigation')) {
      errorType = 'navigation';
    }

    return {
      hasNavigationError: true,
      hasResponsiveError: errorType === 'responsive',
      hasIconError: errorType === 'icon',
      errorType,
      fallbackScreenSize
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log navigation-specific error context
    console.error('Navigation error caught:', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      errorType: this.state.errorType,
      timestamp: new Date().toISOString()
    });

    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // In production, send to error monitoring service with navigation context
    if (process.env.NODE_ENV === 'production') {
      this.logNavigationError(error, errorInfo);
    }
  }

  /**
   * Log navigation error to monitoring service with specific context
   */
  private logNavigationError = (error: Error, errorInfo: React.ErrorInfo) => {
    try {
      const navigationErrorData = {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        errorType: this.state.errorType,
        hasResponsiveError: this.state.hasResponsiveError,
        hasIconError: this.state.hasIconError,
        fallbackScreenSize: this.state.fallbackScreenSize,
        userAgent: navigator.userAgent,
        screenSize: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        timestamp: new Date().toISOString(),
        url: window.location.href,
        component: 'NavigationErrorBoundary'
      };

      // Example: Send to monitoring service
      // monitoringService.captureException(error, {
      //   tags: { component: 'navigation', errorType: this.state.errorType },
      //   extra: navigationErrorData
      // });

      console.error('Navigation error logged to monitoring service:', navigationErrorData);
    } catch (loggingError) {
      console.error('Failed to log navigation error to monitoring service:', loggingError);
    }
  };

  /**
   * Reset error state
   */
  resetError = () => {
    this.setState({
      hasNavigationError: false,
      hasResponsiveError: false,
      hasIconError: false,
      errorType: 'unknown',
      fallbackScreenSize: 'desktop'
    });
  };

  render() {
    const { hasNavigationError } = this.state;
    const { children, className } = this.props;

    if (hasNavigationError) {
      return (
        <div className={cn('navigation-error-boundary', className)}>
          <FallbackNavigation
            errorType={this.state.errorType}
            fallbackScreenSize={this.state.fallbackScreenSize}
            onRetry={this.resetError}
          />
        </div>
      );
    }

    return children;
  }
}

/**
 * Hook-based navigation error boundary for functional components
 */
export const useNavigationErrorHandler = () => {
  const [error, setError] = React.useState<Error | null>(null);
  const [errorType, setErrorType] = React.useState<'navigation' | 'responsive' | 'icon' | 'unknown'>('unknown');

  const resetError = React.useCallback(() => {
    setError(null);
    setErrorType('unknown');
  }, []);

  const captureNavigationError = React.useCallback((error: Error, type?: 'navigation' | 'responsive' | 'icon') => {
    setError(error);
    setErrorType(type || 'unknown');
  }, []);

  // Throw error to be caught by nearest error boundary
  React.useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  return { captureNavigationError, resetError, errorType };
};

/**
 * Higher-order component for adding navigation error boundary
 */
export const withNavigationErrorBoundary = <P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<NavigationErrorBoundaryProps, 'children'>
) => {
  const WrappedComponent = (props: P) => (
    <NavigationErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </NavigationErrorBoundary>
  );

  WrappedComponent.displayName = `withNavigationErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
};

/**
 * Responsive error boundary wrapper
 * Handles errors specifically related to responsive detection
 */
export const ResponsiveErrorBoundary: React.FC<{
  children: ReactNode;
  fallbackScreenSize?: ScreenSize;
  onError?: (error: Error) => void;
}> = ({ children, fallbackScreenSize = 'mobile', onError }) => {
  const handleError = React.useCallback((error: Error, errorInfo: React.ErrorInfo) => {
    console.error('Responsive detection error:', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      fallbackScreenSize
    });

    if (onError) {
      onError(error);
    }
  }, [fallbackScreenSize, onError]);

  const fallback = React.useCallback(({ error, resetError }: { error: Error; resetError: () => void }) => (
    <FallbackNavigation
      errorType="responsive"
      fallbackScreenSize={fallbackScreenSize}
      onRetry={resetError}
    />
  ), [fallbackScreenSize]);

  return (
    <ErrorBoundary
      onError={handleError}
      fallback={fallback}
      resetOnPropsChange
    >
      {children}
    </ErrorBoundary>
  );
};
