import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, MousePointer, Grid, FileText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { getUserFriendlyErrorMessage, getDetailedErrorInfo } from '@/utils/errorHandling';
import type { ErrorContext } from '@/utils/errorHandling';

interface Props {
  children: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onRetry?: () => void;
  onFallbackMode?: () => void;
  fallbackComponent?: ReactNode;
  enableFallbackMode?: boolean;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
  errorDetails?: ReturnType<typeof getDetailedErrorInfo>;
  fallbackMode: boolean;
}

export class DropZoneErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      fallbackMode: false
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      fallbackMode: false
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const context: ErrorContext = 'template';
    const errorDetails = getDetailedErrorInfo(error, context);

    this.setState({
      error,
      errorInfo,
      errorDetails,
    });

    // Log error details with drop zone context
    console.error('DropZoneErrorBoundary caught an error:', {
      error,
      errorInfo,
      context: 'drop-zone',
      errorDetails,
      componentStack: errorInfo.componentStack
    });

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);

    // In production, send to error reporting service
    if (process.env.NODE_ENV === 'production') {
      // Example: Send to error reporting service with drop zone context
      // errorReportingService.captureException(error, {
      //   tags: { errorType: 'drop-zone', component: 'visual-builder' },
      //   extra: { ...errorInfo, errorDetails }
      // });
    }
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      errorDetails: undefined,
      fallbackMode: false
    });
    this.props.onRetry?.();
  };

  handleFallbackMode = () => {
    this.setState({ fallbackMode: true });
    this.props.onFallbackMode?.();
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback component if provided
      if (this.props.fallbackComponent) {
        return this.props.fallbackComponent;
      }

      // If in fallback mode, render basic drop zone
      if (this.state.fallbackMode) {
        return (
          <div className="bg-blue-50 border-2 border-dashed border-blue-300 rounded-lg p-8 text-center">
            <div className="flex flex-col items-center space-y-3">
              <Grid className="h-8 w-8 text-blue-500" />
              <div>
                <h4 className="text-sm font-medium text-blue-800 mb-1">
                  Basic Drop Zone Active
                </h4>
                <p className="text-sm text-blue-700 mb-3">
                  Enhanced drop zones are temporarily unavailable. You can still drag and drop components here.
                </p>
                <Button
                  onClick={this.handleRetry}
                  variant="outline"
                  size="sm"
                  className="text-blue-800 border-blue-300 hover:bg-blue-100"
                >
                  Try Enhanced Drop Zones Again
                </Button>
              </div>
            </div>
          </div>
        );
      }

      const { error, errorDetails } = this.state;

      return (
        <div className="bg-white rounded-lg border border-red-200 p-6 shadow-sm">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-6 w-6 text-red-500" />
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Drop Zone Error
              </h3>

              <p className="text-gray-600 mb-4">
                {errorDetails?.message || getUserFriendlyErrorMessage(error, 'template')}
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

              {/* Drop zone specific suggestions */}
              <div className="mb-4">
                <h4 className="text-sm font-medium text-gray-900 mb-2">Drop Zone Tips:</h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li className="flex items-start">
                    <MousePointer className="h-4 w-4 text-gray-400 mr-2 mt-0.5" />
                    Try refreshing the page to reset drag and drop functionality
                  </li>
                  <li className="flex items-start">
                    <Grid className="h-4 w-4 text-gray-400 mr-2 mt-0.5" />
                    Use fallback mode for basic drag and drop if enhanced features fail
                  </li>
                </ul>
              </div>

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

                {this.props.enableFallbackMode && (
                  <Button
                    onClick={this.handleFallbackMode}
                    variant="secondary"
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Grid className="h-4 w-4" />
                    Use Basic Drop Zone
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
