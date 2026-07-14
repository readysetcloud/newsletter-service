import React from 'react';
import { cn } from '@/utils/cn';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import {
  EmptyState,
  InlineLoading,
  LoadingOverlay,
  LoadingSpinner,
  ProgressIndicator,
  SkeletonLoader,
} from '@readysetcloud/ui';

export {
  EmptyState,
  InlineLoading,
  LoadingOverlay,
  LoadingSpinner,
  ProgressIndicator,
  SkeletonLoader,
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
          icon: <CheckCircleIcon className="w-6 h-6 text-success-600" />,
          title: `${type === 'email' ? 'Email' : 'Domain'} Verified`,
          message: `${email || domain} has been successfully verified and is ready for sending.`,
          bgColor: 'bg-success-50',
          borderColor: 'border-success-200',
          textColor: 'text-success-800'
        };
      case 'failed':
        return {
          icon: <ExclamationTriangleIcon className="w-6 h-6 text-error-600" />,
          title: `${type === 'email' ? 'Email' : 'Domain'} Verification Failed`,
          message: type === 'email'
            ? 'Please check your email for the verification link or try again.'
            : 'Please check your DNS records and try again.',
          bgColor: 'bg-error-50',
          borderColor: 'border-error-200',
          textColor: 'text-error-800'
        };
      case 'verification_timed_out':
        return {
          icon: <ExclamationTriangleIcon className="w-6 h-6 text-warning-600" />,
          title: `${type === 'email' ? 'Email' : 'Domain'} Verification Expired`,
          message: 'The verification process timed out after 24 hours. You can retry verification to start the process again.',
          bgColor: 'bg-warning-50',
          borderColor: 'border-warning-200',
          textColor: 'text-warning-800'
        };
      default:
        return {
          icon: <LoadingSpinner size="md" />,
          title: `Verifying ${type === 'email' ? 'Email' : 'Domain'}`,
          message: type === 'email'
            ? 'Check your email for a verification link.'
            : 'We\'re checking your DNS records. This may take up to 72 hours.',
          bgColor: 'bg-primary-50',
          borderColor: 'border-primary-200',
          textColor: 'text-primary-800'
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
            <p className="text-xs text-muted-foreground mb-2">
              <InformationCircleIcon className="w-3 h-3 inline mr-1" />
              {estimatedTime}
            </p>
          )}
          {status === 'failed' && onRetry && (
            <button
              onClick={onRetry}
              className="text-sm font-medium text-primary-600 hover:text-primary-700 underline"
            >
              Try Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

