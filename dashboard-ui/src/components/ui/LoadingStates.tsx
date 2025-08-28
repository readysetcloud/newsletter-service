import React from 'react';
import { cn } from '@/utils/cn';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';

/**
 * Generic loading spinner component
 */
interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  className
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };

  return (
    <ArrowPathIcon
      className={cn(
        'animate-spin text-blue-600',
        sizeClasses[size],
        className
      )}
    />
  );
};

/**
 * Skeleton loader for list items
 */
interface SkeletonLoaderProps {
  count?: number;
  className?: string;
}

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  count = 3,
  className
}) => {
  return (
    <div className={cn('space-y-4', className)}>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="bg-white border border-gray-200 rounded-lg p-6 animate-pulse"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
              <div className="space-y-2">
                <div className="w-48 h-4 bg-gray-200 rounded"></div>
                <div className="w-32 h-3 bg-gray-200 rounded"></div>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-20 h-6 bg-gray-200 rounded"></div>
              <div className="w-8 h-8 bg-gray-200 rounded"></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Progress indicator for multi-step processes
 */
interface ProgressIndicatorProps {
  steps: Array<{
    id: string;
    label: string;
    status: 'pending' | 'in-progress' | 'completed' | 'failed';
    description?: string;
  }>;
  className?: string;
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  steps,
  className
}) => {
  const getStepIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon className="w-5 h-5 text-green-600" />;
      case 'in-progress':
        return <LoadingSpinner size="sm" />;
      case 'failed':
        return <ExclamationTriangleIcon className="w-5 h-5 text-red-600" />;
      default:
        return <ClockIcon className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStepColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-600';
      case 'in-progress':
        return 'text-blue-600';
      case 'failed':
        return 'text-red-600';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className={cn('space-y-4', className)}>
      {steps.map((step, index) => (
        <div key={step.id} className="flex items-start space-x-3">
          <div className="flex-shrink-0 mt-0.5">
            {getStepIcon(step.status)}
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn('text-sm font-medium', getStepColor(step.status))}>
              {step.label}
            </p>
            {step.description && (
              <p className="text-xs text-gray-500 mt-1">
                {step.description}
              </p>
            )}
          </div>
          {index < steps.length - 1 && (
            <div className="absolute left-2.5 mt-6 w-0.5 h-4 bg-gray-200"></div>
          )}
        </div>
      ))}
    </div>
  );
};

/**
 * Verification progress component specifically for email/domain verification
 */
interface VerificationProgressProps {
  type: 'email' | 'domain';
  status: 'pending' | 'verified' | 'failed' | 'verification_timed_out';
  email?: string;
  domain?: string;
  estimatedTime?: string;
  onRetry?: () => void;
  className?: string;
}

export const VerificationProgress: React.FC<VerificationProgressProps> = ({
  type,
  status,
  email,
  domain,
  estimatedTime,
  onRetry,
  className
}) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'verified':
        return {
          icon: <CheckCircleIcon className="w-6 h-6 text-green-600" />,
          title: `${type === 'email' ? 'Email' : 'Domain'} Verified`,
          message: `${email || domain} has been successfully verified and is ready for sending.`,
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
          textColor: 'text-green-800'
        };
      case 'failed':
        return {
          icon: <ExclamationTriangleIcon className="w-6 h-6 text-red-600" />,
          title: `${type === 'email' ? 'Email' : 'Domain'} Verification Failed`,
          message: type === 'email'
            ? 'Please check your email for the verification link or try again.'
            : 'Please check your DNS records and try again.',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          textColor: 'text-red-800'
        };
      case 'verification_timed_out':
        return {
          icon: <ExclamationTriangleIcon className="w-6 h-6 text-orange-600" />,
          title: `${type === 'email' ? 'Email' : 'Domain'} Verification Expired`,
          message: 'The verification process timed out after 24 hours. You can retry verification to start the process again.',
          bgColor: 'bg-orange-50',
          borderColor: 'border-orange-200',
          textColor: 'text-orange-800'
        };
      default:
        return {
          icon: <LoadingSpinner size="md" />,
          title: `Verifying ${type === 'email' ? 'Email' : 'Domain'}`,
          message: type === 'email'
            ? 'Check your email for a verification link from Amazon SES.'
            : 'We\'re checking your DNS records. This may take up to 72 hours.',
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-200',
          textColor: 'text-blue-800'
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className={cn(
      'rounded-lg border p-4',
      config.bgColor,
      config.borderColor,
      className
    )}>
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">
          {config.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className={cn('text-sm font-medium mb-1', config.textColor)}>
            {config.title}
          </h4>
          <p className={cn('text-sm mb-2', config.textColor)}>
            {config.message}
          </p>
          {estimatedTime && status === 'pending' && (
            <p className="text-xs text-gray-600 mb-2">
              <InformationCircleIcon className="w-3 h-3 inline mr-1" />
              {estimatedTime}
            </p>
          )}
          {status === 'failed' && onRetry && (
            <button
              onClick={onRetry}
              className="text-sm font-medium text-blue-600 hover:text-blue-700 underline"
            >
              Try Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Loading overlay for forms and containers
 */
interface LoadingOverlayProps {
  isLoading: boolean;
  message?: string;
  children: React.ReactNode;
  className?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  isLoading,
  message = 'Loading...',
  children,
  className
}) => {
  return (
    <div className={cn('relative', className)}>
      {children}
      {isLoading && (
        <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10 rounded-lg">
          <div className="flex flex-col items-center space-y-3">
            <LoadingSpinner size="lg" />
            <p className="text-sm text-gray-600 font-medium">{message}</p>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Inline loading state for buttons and small components
 */
interface InlineLoadingProps {
  isLoading: boolean;
  loadingText?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}

export const InlineLoading: React.FC<InlineLoadingProps> = ({
  isLoading,
  loadingText,
  children,
  size = 'sm',
  className
}) => {
  if (!isLoading) {
    return <>{children}</>;
  }

  return (
    <div className={cn('flex items-center space-x-2', className)}>
      <LoadingSpinner size={size} />
      {loadingText && (
        <span className="text-sm text-gray-600">{loadingText}</span>
      )}
    </div>
  );
};

/**
 * Empty state with loading option
 */
interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
    isLoading?: boolean;
  };
  isLoading?: boolean;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  action,
  isLoading = false,
  className
}) => {
  if (isLoading) {
    return <SkeletonLoader count={3} className={className} />;
  }

  return (
    <div className={cn(
      'text-center py-12 bg-white border border-gray-200 rounded-lg',
      className
    )}>
      {icon && (
        <div className="flex justify-center mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-600 mb-6 max-w-md mx-auto">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          disabled={action.isLoading}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {action.isLoading ? (
            <>
              <LoadingSpinner size="sm" className="mr-2" />
              Loading...
            </>
          ) : (
            action.label
          )}
        </button>
      )}
    </div>
  );
};
