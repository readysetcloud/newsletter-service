import React, { useEffect } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useNavigate } from 'react-router-dom';

interface RouteErrorBoundaryProps {
  children: React.ReactNode;
  routeName?: string;
}

const RouteErrorFallback: React.FC<{ routeName?: string }> = ({ routeName }) => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-lg w-full bg-surface rounded-lg shadow-lg p-8 text-center">
        <div className="flex justify-center mb-6">
          <AlertCircle className="h-16 w-16 text-warning-500" />
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-3">
          Page Error
        </h1>

        <p className="text-muted-foreground mb-2">
          There was an error loading {routeName ? `the ${routeName} page` : 'this page'}.
        </p>

        <p className="text-sm text-muted-foreground mb-8">
          This might be a temporary issue. Please try navigating back or refreshing the page.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            onClick={() => navigate(-1)}
            variant="primary"
            className="flex items-center justify-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Button>

          <Button
            onClick={() => window.location.reload()}
            variant="secondary"
          >
            Refresh Page
          </Button>
        </div>
      </div>
    </div>
  );
};

export const RouteErrorBoundary: React.FC<RouteErrorBoundaryProps> = ({
  children,
  routeName
}) => {
  useEffect(() => {
    const pageTitle = routeName ? `${routeName} | Outboxed` : 'Outboxed';
    document.title = pageTitle;
  }, [routeName]);

  return (
    <ErrorBoundary
      fallback={<RouteErrorFallback routeName={routeName} />}
      onError={(error, errorInfo) => {
        // Log route-specific errors
        console.error(`Route Error in ${routeName || 'Unknown Route'}:`, error, errorInfo);

        // In production, send to error reporting with route context
        if (import.meta.env.PROD) {
          // Example: Send to error reporting service with route context
          // errorReportingService.captureException(error, {
          //   tags: { route: routeName },
          //   extra: errorInfo
          // });
        }
      }}
    >
      {children}
    </ErrorBoundary>
  );
};
