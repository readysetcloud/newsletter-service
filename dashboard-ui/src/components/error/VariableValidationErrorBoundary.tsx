import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Code, BookOpen, FileText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { getUserFriendlyErrorMessage, getDetailedErrorInfo, isValidationError } from '@/utils/errorHandling';
import type { ErrorContext } from '@/utils/errorHandling';

interface Props {
  children: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onRetry?: () => void;
  onClearValidation?: () => void;
  fallbackComponent?: ReactNode;
  showSyntaxHelp?: boolean;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
  errorDetails?: ReturnType<typeof getDetailedErrorInfo>;
  showSyntaxHelp: boolean;
}

export class VariableValidationErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      showSyntaxHelp: false
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      showSyntaxHelp: false
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const context: ErrorContext = 'validation';
    const errorDetails = getDetailedErrorInfo(error, context);

    this.setState({
      error,
      errorInfo,
      errorDetails,
    });

    // Log error details with validation context
    console.error('VariableValidationErrorBoundary caught an error:', {
      error,
      errorInfo,
      context: 'variable-validation',
      errorDetails,
      isValidationError: isValidationError(error),
      componentStack: errorInfo.componentStack
    });

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);

    // In production, send to error reporting service
    if (process.env.NODE_ENV === 'production') {
      // Example: Send to error reporting service with validation context
      // errorReportingService.captureException(error, {
      //   tags: { errorType: 'variable-validation', component: 'visual-builder' },
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
      showSyntaxHelp: false
    });
    this.props.onRetry?.();
  };

  handleClearValidation = () => {
    this.props.onClearValidation?.();
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      errorDetails: undefined,
      showSyntaxHelp: false
    });
  };

  toggleSyntaxHelp = () => {
    this.setState(prev => ({ showSyntaxHelp: !prev.showSyntaxHelp }));
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback component if provided
      if (this.props.fallbackComponent) {
        return this.props.fallbackComponent;
      }

      const { error, errorDetails } = this.state;
      const isValidation = isValidationError(error);

      return (
        <div className={`rounded-lg border p-6 shadow-sm ${
          isValidation ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <AlertTriangle className={`h-6 w-6 ${
                isValidation ? 'text-yellow-500' : 'text-red-500'
              }`} />
            </div>

            <div className="flex-1 min-w-0">
              <h3 className={`text-lg font-medium mb-2 ${
                isValidation ? 'text-yellow-900' : 'text-red-900'
              }`}>
                {isValidation ? 'Variable Syntax Error' : 'Variable Validation Error'}
              </h3>

              <p className={`mb-4 ${
                isValidation ? 'text-yellow-700' : 'text-red-700'
              }`}>
                {errorDetails?.message || getUserFriendlyErrorMessage(error, 'validation')}
              </p>

              {/* Validation-specific error details */}
              {isValidation && errorDetails?.details && errorDetails.details.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-yellow-900 mb-2">Validation Issues:</h4>
                  <ul className="text-sm text-yellow-800 space-y-1">
                    {errorDetails.details.map((detail, index) => (
                      <li key={index} className="flex items-start">
                        <Code className="h-4 w-4 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" />
                        <span className="font-mono bg-yellow-100 px-1 rounded">{detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Error details for development */}
              {process.env.NODE_ENV === 'development' && error && (
                <details className="mb-4">
                  <summary className={`cursor-pointer text-sm hover:text-opacity-80 mb-2 ${
                    isValidation ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    Technical Details (Development Only)
                  </summary>
                  <div className="bg-white bg-opacity-50 rounded p-3 text-xs font-mono text-gray-800 overflow-auto max-h-32">
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

              {/* Syntax help section */}
              {(this.props.showSyntaxHelp || this.state.showSyntaxHelp) && (
                <div className="mb-4 bg-white bg-opacity-50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                    <BookOpen className="h-4 w-4 mr-2" />
                    Variable Syntax Reference
                  </h4>
                  <div className="space-y-3 text-sm">
                    <div>
                      <div className="font-medium text-gray-800 mb-1">Basic Variables:</div>
                      <code className="bg-gray-100 px-2 py-1 rounded text-xs">{'{{newsletter.title}}'}</code>
                      <span className="text-gray-600 ml-2">- Simple variable insertion</span>
                    </div>
                    <div>
                      <div className="font-medium text-gray-800 mb-1">Conditional Blocks:</div>
                      <code className="bg-gray-100 px-2 py-1 rounded text-xs">{'{{#if condition}}...{{/if}}'}</code>
                      <span className="text-gray-600 ml-2">- Show content conditionally</span>
                    </div>
                    <div>
                      <div className="font-medium text-gray-800 mb-1">Loops:</div>
                      <code className="bg-gray-100 px-2 py-1 rounded text-xs">{'{{#each items}}...{{/each}}'}</code>
                      <span className="text-gray-600 ml-2">- Repeat content for each item</span>
                    </div>
                    <div>
                      <div className="font-medium text-gray-800 mb-1">Context:</div>
                      <code className="bg-gray-100 px-2 py-1 rounded text-xs">{'{{#with object}}...{{/with}}'}</code>
                      <span className="text-gray-600 ml-2">- Change variable context</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Error suggestions */}
              {errorDetails?.suggestions && errorDetails.suggestions.length > 0 && (
                <div className="mb-4">
                  <h4 className={`text-sm font-medium mb-2 ${
                    isValidation ? 'text-yellow-900' : 'text-red-900'
                  }`}>Suggestions:</h4>
                  <ul className={`text-sm space-y-1 ${
                    isValidation ? 'text-yellow-800' : 'text-red-800'
                  }`}>
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

                {this.props.onClearValidation && (
                  <Button
                    onClick={this.handleClearValidation}
                    variant="secondary"
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Code className="h-4 w-4" />
                    Clear Validation
                  </Button>
                )}

                <Button
                  onClick={this.toggleSyntaxHelp}
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <BookOpen className="h-4 w-4" />
                  {this.state.showSyntaxHelp ? 'Hide' : 'Show'} Syntax Help
                </Button>

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
