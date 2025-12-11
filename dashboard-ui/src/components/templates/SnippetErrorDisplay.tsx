import React from 'react';
import { AlertTriangle, AlertCircle, Info, X, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { ValidationError, ValidationWarning } from '@/hooks/useSnippetValidation';

interface SnippetErrorDisplayProps {
  errors?: ValidationError[];
  warnings?: ValidationWarning[];
  networkError?: {
    message: string;
    isRetryable: boolean;
    isOffline: boolean;
    onRetry?: () => void;
    onDismiss?: () => void;
  };
  validationSummary?: {
    errorCount: number;
    warningCount: number;
    validFieldCount: number;
    totalFieldCount: number;
  };
  className?: string;
  showSummary?: boolean;
  collapsible?: boolean;
  onDismiss?: () => void;
}

interface ErrorGroupProps {
  title: string;
  items: (ValidationError | ValidationWarning)[];
  icon: React.ReactNode;
  variant: 'error' | 'warning' | 'info';
  onDismiss?: () => void;
}

const ErrorGroup: React.FC<ErrorGroupProps> = ({
  title,
  items,
  icon,
  variant,
  onDismiss
}) => {
  if (items.length === 0) return null;

  const variantStyles = {
    error: {
      container: 'bg-red-50 border-red-200',
      header: 'text-red-800',
      text: 'text-red-700',
      icon: 'text-red-500'
    },
    warning: {
      container: 'bg-yellow-50 border-yellow-200',
      header: 'text-yellow-800',
      text: 'text-yellow-700',
      icon: 'text-yellow-500'
    },
    info: {
      container: 'bg-blue-50 border-blue-200',
      header: 'text-blue-800',
      text: 'text-blue-700',
      icon: 'text-blue-500'
    }
  };

  const styles = variantStyles[variant];

  return (
    <div className={`rounded-lg border p-4 ${styles.container}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3 flex-1">
          <div className={`flex-shrink-0 ${styles.icon}`}>
            {icon}
          </div>

          <div className="flex-1 min-w-0">
            <h4 className={`text-sm font-medium ${styles.header} mb-2`}>
              {title} ({items.length})
            </h4>

            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={index} className="text-sm">
                  <div className={`font-medium ${styles.text}`}>
                    {item.field}: {item.message}
                  </div>

                  {/* Show suggestion for warnings */}
                  {'suggestion' in item && item.suggestion && (
                    <div className={`text-xs mt-1 ${styles.text} opacity-75`}>
                      💡 {item.suggestion}
                    </div>
                  )}

                  {/* Show error code */}
                  {item.code && (
                    <div className={`text-xs mt-1 ${styles.text} opacity-60 font-mono`}>
                      Code: {item.code}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className={`flex-shrink-0 ml-2 ${styles.icon} hover:opacity-75`}
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};

const NetworkErrorDisplay: React.FC<{
  error: NonNullable<SnippetErrorDisplayProps['networkError']>;
}> = ({ error }) => {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">
          {error.isOffline ? (
            <WifiOff className="h-5 w-5 text-red-500" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-red-500" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-red-800 mb-1">
            {error.isOffline ? 'Connection Lost' : 'Network Error'}
          </h4>

          <p className="text-sm text-red-700 mb-3">
            {error.message}
          </p>

          <div className="flex items-center space-x-2">
            {error.isRetryable && error.onRetry && (
              <Button
                onClick={error.onRetry}
                variant="outline"
                size="sm"
                className="flex items-center gap-2 text-red-700 border-red-300 hover:bg-red-100"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </Button>
            )}

            {error.onDismiss && (
              <Button
                onClick={error.onDismiss}
                variant="ghost"
                size="sm"
                className="text-red-700 hover:bg-red-100"
              >
                Dismiss
              </Button>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 flex items-center text-xs text-red-600">
          {error.isOffline ? (
            <span className="flex items-center gap-1">
              <WifiOff className="h-3 w-3" />
              Offline
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Wifi className="h-3 w-3" />
              Online
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const ValidationSummary: React.FC<{
  summary: NonNullable<SnippetErrorDisplayProps['validationSummary']>;
}> = ({ summary }) => {
  const { errorCount, warningCount, validFieldCount, totalFieldCount } = summary;

  if (errorCount === 0 && warningCount === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
        <div className="flex items-center space-x-2 text-green-800">
          <Info className="h-4 w-4" />
          <span className="text-sm font-medium">
            All parameters are valid ({validFieldCount}/{totalFieldCount})
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-900">Validation Summary</span>

        <div className="flex items-center space-x-4 text-xs">
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-red-600">
              <AlertTriangle className="h-3 w-3" />
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </span>
          )}

          {warningCount > 0 && (
            <span className="flex items-center gap-1 text-yellow-600">
              <AlertCircle className="h-3 w-3" />
              {warningCount} warning{warningCount !== 1 ? 's' : ''}
            </span>
          )}

          <span className="text-gray-600">
            {validFieldCount}/{totalFieldCount} valid
          </span>
        </div>
      </div>
    </div>
  );
};

export const SnippetErrorDisplay: React.FC<SnippetErrorDisplayProps> = ({
  errors = [],
  warnings = [],
  networkError,
  validationSummary,
  className = '',
  showSummary = true,
  collapsible = false,
  onDismiss
}) => {
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  const hasNetworkError = !!networkError;
  const hasAnyIssues = hasErrors || hasWarnings || hasNetworkError;

  if (!hasAnyIssues && !validationSummary) {
    return null;
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Summary */}
      {showSummary && validationSummary && (
        <ValidationSummary summary={validationSummary} />
      )}

      {/* Collapsible header */}
      {collapsible && hasAnyIssues && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center space-x-2 text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            <span>
              {hasErrors ? 'Errors' : 'Warnings'}
              {hasErrors && hasWarnings && ' & Warnings'}
            </span>
            <span className="text-gray-500">
              ({(errors.length + warnings.length + (hasNetworkError ? 1 : 0))})
            </span>
          </button>

          {onDismiss && (
            <Button
              onClick={onDismiss}
              variant="ghost"
              size="sm"
              className="text-gray-500 hover:text-gray-700"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {/* Error details */}
      {(!collapsible || !isCollapsed) && (
        <div className="space-y-3">
          {/* Network errors */}
          {networkError && (
            <NetworkErrorDisplay error={networkError} />
          )}

          {/* Validation errors */}
          <ErrorGroup
            title="Validation Errors"
            items={errors}
            icon={<AlertTriangle className="h-5 w-5" />}
            variant="error"
          />

          {/* Validation warnings */}
          <ErrorGroup
            title="Validation Warnings"
            items={warnings}
            icon={<AlertCircle className="h-5 w-5" />}
            variant="warning"
          />
        </div>
      )}
    </div>
  );
};
