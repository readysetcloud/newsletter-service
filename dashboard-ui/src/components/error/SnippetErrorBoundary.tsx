import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Undo2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { getUserFriendlyErrorMessage, getDetailedErrorInfo } from '@/utils/errorHandling';
import type { ErrorContext } from '@/utils/errorHandling';

interface Props {
  children: ReactNode;
  context?: ErrorContext;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onRetry?: () => void;
  onRollback?: () => void;
  fallbackComponent?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
  errorDetails?: ReturnType<typeof getDetailedErrorInfo>;
}

export class SnippetErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const context = this.props.context || 'snippet';
    const errorDetails = getDetailedErrorInfo(error, context);

    this.setState({
      error,
      errorInfo,
      errorDetails,
    });

    // Log error details
    console.error('SnippetErrorBoundary caught an error:', {
      error,
      errorInfo,
      context,
      errorDetails
    });

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);

    // In production, send to error reporting service
    if (process.env.NODE_ENV === 'production') {
      // Example: Send to error reporting service with snippet context
      // errorReportingService.captureException(error, {
      //   tags: { errorType: 'snippet', context },
      //   extra: { ...errorInfo, errorDetails }
      // });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined, errorDetails: undefined });
    this.props.onRetry?.();
  };

  handleRollback = () => {
    this.props.onRollback?.();
    this.setState({ hasError: false, error: undefined, errorInfo: undefined, errorDetails: undefined });
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback component if provided
      if (this.props.fallbackComponent) {
        return this.props.fallbackComponent;
      }

      const { error, errorDetails } = this.state;
      const context = this.props.context || 'snippet';

      return (
        <div className="bg-white rounded-lg border border-red-200 p-6 shadow-sm">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-6 w-6 text-red-500" />
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Snippet Error
              </h3>

              <p className="text-gray-600 mb-4">
                {errorDetails?.message || getUserFriendlyErrorMessage(error, context)}
              </p>

              {/* Error details for development */}
              {process.env.NODE_ENV === 'development' && error && (
                <details className="mb-4">
                  <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 mb-2">
                    Technical Details (Development Only)
                  </summary>
                  <div className="bg-gray-50 rounded p-3 text-xs font-mono text-gray-800 overflow-auto max-h-32">
                    <div className="font-semibold mb-1">Error:</div>
                    <div className="mb-2">{error.message}</div>
                    {errorDetails?.code && (
                      <>
                        <div className="font-semibold mb-1">Code:</div>
                        <div className="mb-2">{errorDetails.code}</div>
                      </>
                    )}
                    {this.state.errorInfo && (
                      <>
                        <div className="font-semibold mb-1">Component Stack:</div>
                        <div>{this.state.errorInfo.componentStack}</div>
                      </>
                    )}
                  </div>
                </details>
              )}

              {/* Error suggestions */}
              {errorDetails?.suggestions && errorDetails.suggestions.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Suggestions:</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    {errorDetails.suggestions.map((suggestion, index) => (
                      <li key={index} className="flex items-start">
                        <span className="text-gray-400 mr-2">•</span>
                        {suggestion}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={this.handleRetry}
                  variant="primary"
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Try Again
                </Button>

                {this.props.onRollback && (
                  <Button
                    onClick={this.handleRollback}
                    variant="secondary"
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Undo2 className="h-4 w-4" />
                    Undo Changes
                  </Button>
                )}

                <Button
                  onClick={() => window.location.reload()}
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <FileText className="h-4 w-4" />
                  Reload Page
                </Button>
              </div>

              {/* Severity indicator */}
              {errorDetails?.severity && (
                <div className="mt-4 flex items-center text-xs text-gray-500">
                  <span className={`inline-block w-2 h-2 rounded-full mr-2 ${
                    errorDetails.severity === 'critical' ? 'bg-red-500' :
                    errorDetails.severity === 'error' ? 'bg-orange-500' :
                    errorDetails.severity === 'warning' ? 'bg-yellow-500' :
                    'bg-blue-500'
                  }`} />
                  Severity: {errorDetails.severity}
                  {errorDetails.retryable && (
                    <span className="ml-2 text-green-600">• Retryable</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
