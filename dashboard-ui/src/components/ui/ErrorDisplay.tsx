import React from 'react';
import { Button } from './Button';
import { cn } from '@/utils/cn';
import {
  ExclamationTriangleIcon,
  XCircleIcon,
  InformationCircleIcon,
  ArrowPathIcon,
  ExclamationCircleIcon,
  ShieldExclamationIcon,
} from '@heroicons/react/24/outline';

/**
 * Error severity levels
 */
export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Error display configuration
 */
interface ErrorConfig {
  icon: React.ReactNode;
  bgColor: string;
  borderColor: string;
  textColor: string;
  iconColor: string;
}

/**
 * Props for ErrorDisplay component
 */
interface ErrorDisplayProps {
  title: string;
  message: string;
  severity?: ErrorSeverity;
  errorCode?: string;
  retryable?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
  details?: Array<{ label: string; value: string }>;
  suggestions?: string[];
  className?: string;
  compact?: boolean;
}

/**
 * Get error configuration based on severity
 */
const getErrorConfig = (severity: ErrorSeverity): ErrorConfig => {
  switch (severity) {
    case 'info':
      return {
        icon: <InformationCircleIcon className="w-5 h-5" />,
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-200',
        textColor: 'text-blue-800',
        iconColor: 'text-blue-600'
      };
    case 'warning':
      return {
        icon: <ExclamationTriangleIcon className="w-5 h-5" />,
        bgColor: 'bg-yellow-50',
        borderColor: 'border-yellow-200',
        textColor: 'text-yellow-800',
        iconColor: 'text-yellow-600'
      };
    case 'critical':
      return {
        icon: <ShieldExclamationIcon className="w-5 h-5" />,
        bgColor: 'bg-red-50',
        borderColor: 'border-red-300',
        textColor: 'text-red-900',
        iconColor: 'text-red-700'
      };
    default: // error
      return {
        icon: <XCircleIcon className="w-5 h-5" />,
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200',
        textColor: 'text-red-800',
        iconColor: 'text-red-600'
      };
  }
};

/**
 * Comprehensive error display component
 */
export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  title,
  message,
  severity = 'error',
  errorCode,
  retryable = false,
  onRetry,
  onDismiss,
  details,
  suggestions,
  className,
  compact = false
}) => {
  const config = getErrorConfig(severity);

  if (compact) {
    return (
      <div className={cn(
        'rounded-md border p-3',
        config.bgColor,
        config.borderColor,
        className
      )}>
        <div className="flex items-start space-x-2">
          <div className={cn('flex-shrink-0', config.iconColor)}>
            {config.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn('text-sm font-medium', config.textColor)}>
              {title}
            </p>
            <p className={cn('text-sm mt-1', config.textColor)}>
              {message}
            </p>
          </div>
          <div className="flex-shrink-0 flex space-x-2">
            {retryable && onRetry && (
              <button
                onClick={onRetry}
                className={cn(
                  'text-sm font-medium underline hover:no-underline',
                  config.textColor
                )}
              >
                Retry
              </button>
            )}
            {onDismiss && (
              <button
                onClick={onDismiss}
                className={cn('hover:opacity-75', config.iconColor)}
              >
                <XCircleIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'rounded-lg border p-6',
      config.bgColor,
      config.borderColor,
      className
    )}>
      <div className="flex items-start space-x-4">
        <div className={cn('flex-shrink-0', config.iconColor)}>
          {config.icon}
        </div>

        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className={cn('text-lg font-medium', config.textColor)}>
                {title}
              </h3>
              {errorCode && (
                <p className="text-xs text-gray-500 mt-1">
                  Error Code: {errorCode}
                </p>
              )}
            </div>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className={cn('hover:opacity-75', config.iconColor)}
              >
                <XCircleIcon className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Message */}
          <p className={cn('text-sm mb-4', config.textColor)}>
            {message}
          </p>

          {/* Details */}
          {details && details.length > 0 && (
            <div className="mb-4">
              <h4 className={cn('text-sm font-medium mb-2', config.textColor)}>
                Details:
              </h4>
              <dl className="grid grid-cols-1 gap-2 text-sm">
                {details.map((detail, index) => (
                  <div key={index} className="flex justify-between">
                    <dt className={cn('font-medium', config.textColor)}>
                      {detail.label}:
                    </dt>
                    <dd className={cn('text-right', config.textColor)}>
                      {detail.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Suggestions */}
          {suggestions && suggestions.length > 0 && (
            <div className="mb-4">
              <h4 className={cn('text-sm font-medium mb-2', config.textColor)}>
                What you can do:
              </h4>
              <ul className={cn('text-sm space-y-1 list-disc list-inside', config.textColor)}>
                {suggestions.map((suggestion, index) => (
                  <li key={index}>{suggestion}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center space-x-3">
            {retryable && onRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                className="border-current text-current hover:bg-current hover:bg-opacity-10"
              >
                <ArrowPathIcon className="w-4 h-4 mr-1" />
                Try Again
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Inline error message for form fields
 */
interface InlineErrorProps {
  message: string;
  className?: string;
}

export const InlineError: React.FC<InlineErrorProps> = ({
  message,
  className
}) => {
  return (
    <p className={cn('text-sm text-red-600 flex items-center mt-1', className)}>
      <ExclamationCircleIcon className="w-4 h-4 mr-1 flex-shrink-0" />
      {message}
    </p>
  );
};

/**
 * Error boundary fallback component
 */
interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
  className?: string;
}

export const ErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  resetError,
  className
}) => {
  return (
    <ErrorDisplay
      title="Something went wrong"
      message="An unexpected error occurred while loading this component."
      severity="error"
      retryable={true}
      onRetry={resetError}
      details={[
        { label: 'Error', value: error.name },
        { label: 'Message', value: error.message }
      ]}
      suggestions={[
        'Try refreshing the page',
        'Check your internet connection',
        'Contact support if the problem persists'
      ]}
      className={className}
    />
  );
};

/**
 * Network error component
 */
interface NetworkErrorProps {
  onRetry?: () => void;
  className?: string;
}

export const NetworkError: React.FC<NetworkErrorProps> = ({
  onRetry,
  className
}) => {
  return (
    <ErrorDisplay
      title="Connection Error"
      message="Unable to connect to the server. Please check your internet connection."
      severity="warning"
      retryable={true}
      onRetry={onRetry}
      suggestions={[
        'Check your internet connection',
        'Try refreshing the page',
        'Wait a moment and try again'
      ]}
      className={className}
    />
  );
};

/**
 * Permission error component
 */
interface PermissionErrorProps {
  resource?: string;
  className?: string;
}

export const PermissionError: React.FC<PermissionErrorProps> = ({
  resource = 'this resource',
  className
}) => {
  return (
    <ErrorDisplay
      title="Access Denied"
      message={`You don't have permission to access ${resource}.`}
      severity="warning"
      suggestions={[
        'Check that you\'re signed in to the correct account',
        'Contact your administrator for access',
        'Refresh the page to update your permissions'
      ]}
      className={className}
    />
  );
};

/**
 * Validation error summary component
 */
interface ValidationErrorSummaryProps {
  errors: Record<string, string>;
  title?: string;
  className?: string;
}

export const ValidationErrorSummary: React.FC<ValidationErrorSummaryProps> = ({
  errors,
  title = "Please fix the following errors:",
  className
}) => {
  const errorList = Object.entries(errors).map(([field, message]) => ({
    field: field.charAt(0).toUpperCase() + field.slice(1),
    message
  }));

  if (errorList.length === 0) {
    return null;
  }

  return (
    <ErrorDisplay
      title={title}
      message={`${errorList.length} error${errorList.length !== 1 ? 's' : ''} found`}
      severity="warning"
      details={errorList.map(error => ({
        label: error.field,
        value: error.message
      }))}
      compact={true}
      className={className}
    />
  );
};
