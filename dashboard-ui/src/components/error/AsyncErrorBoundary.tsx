import React, { useState, useEffect } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface AsyncErrorBoundaryProps {
  children: React.ReactNode;
  onRetry?: () => void;
}

const AsyncErrorFallback: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    } else {
      window.location.reload();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 bg-surface rounded-lg shadow-sm border border-border">
      <div className="flex justify-center mb-4">
        {isOnline ? (
          <RefreshCw className="h-12 w-12 text-primary-500" />
        ) : (
          <WifiOff className="h-12 w-12 text-error-500" />
        )}
      </div>

      <h3 className="text-lg font-semibold text-foreground mb-2">
        {isOnline ? 'Loading Error' : 'Connection Lost'}
      </h3>

      <p className="text-muted-foreground text-center mb-6 max-w-md">
        {isOnline
          ? 'There was an error loading this content. This might be a temporary issue with the server.'
          : 'Please check your internet connection and try again.'
        }
      </p>

      <div className="flex items-center gap-2 mb-4">
        {isOnline ? (
          <Wifi className="h-4 w-4 text-success-500" />
        ) : (
          <WifiOff className="h-4 w-4 text-error-500" />
        )}
        <span className="text-sm text-muted-foreground">
          {isOnline ? 'Connected' : 'Offline'}
        </span>
      </div>

      <Button
        onClick={handleRetry}
        variant="primary"
        className="flex items-center gap-2"
        disabled={!isOnline}
      >
        <RefreshCw className="h-4 w-4" />
        {isOnline ? 'Try Again' : 'Waiting for connection...'}
      </Button>
    </div>
  );
};

export const AsyncErrorBoundary: React.FC<AsyncErrorBoundaryProps> = ({
  children,
  onRetry
}) => {
  return (
    <ErrorBoundary
      fallback={<AsyncErrorFallback onRetry={onRetry} />}
      onError={(error, errorInfo) => {
        // Log async/network errors
        console.error('Async Error:', error, errorInfo);

        // In production, categorize and send async errors
        if (import.meta.env.PROD) {
          // Example: Send to error reporting service with async context
          // errorReportingService.captureException(error, {
          //   tags: { errorType: 'async' },
          //   extra: { ...errorInfo, isOnline: navigator.onLine }
          // });
        }
      }}
    >
      {children}
    </ErrorBoundary>
  );
};
