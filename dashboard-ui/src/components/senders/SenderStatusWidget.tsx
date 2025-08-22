import React from 'react';
import { Link } from 'react-router-dom';
import { useSenderStatus } from '@/hooks/useSenderStatus';
import { SenderStatusIndicator } from './SenderStatusIndicator';
import { Loading } from '@/components/ui/Loading';
import {
  EnvelopeIcon,
  PlusIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  ArrowRightIcon,
  CogIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';

interface SenderStatusWidgetProps {
  className?: string;
}

/**
 * Dashboard widget showing current sender email status with quick actions
 */
export const SenderStatusWidget: React.FC<SenderStatusWidgetProps> = ({
  className,
}) => {
  const senderStatus = useSenderStatus();

  const getStatusMessage = () => {
    if (senderStatus.totalCount === 0) {
      return {
        title: 'No sender emails configured',
        description: 'Set up your first sender email to start sending newsletters',
        action: 'Add sender email',
        actionHref: '/senders',
        priority: 'info' as const,
      };
    }

    if (senderStatus.failedCount > 0) {
      return {
        title: `${senderStatus.failedCount} sender${senderStatus.failedCount !== 1 ? 's' : ''} failed verification`,
        description: 'Some sender emails need attention to continue sending',
        action: 'Fix issues',
        actionHref: '/senders',
        priority: 'error' as const,
      };
    }

    if (senderStatus.pendingCount > 0) {
      return {
        title: `${senderStatus.pendingCount} sender${senderStatus.pendingCount !== 1 ? 's' : ''} pending verification`,
        description: 'Verification in progress, check your email or DNS settings',
        action: 'View status',
        actionHref: '/senders',
        priority: 'warning' as const,
      };
    }

    if (senderStatus.verifiedCount === senderStatus.totalCount) {
      return {
        title: 'All sender emails verified',
        description: `${senderStatus.verifiedCount} verified sender${senderStatus.verifiedCount !== 1 ? 's' : ''} ready for sending`,
        action: 'Manage senders',
        actionHref: '/senders',
        priority: 'success' as const,
      };
    }

    return {
      title: 'Sender emails configured',
      description: `${senderStatus.verifiedCount} of ${senderStatus.totalCount} verified`,
      action: 'View details',
      actionHref: '/senders',
      priority: 'info' as const,
    };
  };

  const statusInfo = getStatusMessage();

  const getStatusIcon = () => {
    switch (statusInfo.priority) {
      case 'error':
        return <ExclamationTriangleIcon className="w-6 h-6 text-red-500" />;
      case 'warning':
        return <ClockIcon className="w-6 h-6 text-amber-500" />;
      case 'success':
        return <CheckCircleIcon className="w-6 h-6 text-green-500" />;
      default:
        return <EnvelopeIcon className="w-6 h-6 text-gray-400" />;
    }
  };

  const getStatusColor = () => {
    switch (statusInfo.priority) {
      case 'error':
        return 'border-red-200 bg-red-50';
      case 'warning':
        return 'border-amber-200 bg-amber-50';
      case 'success':
        return 'border-green-200 bg-green-50';
      default:
        return 'border-gray-200 bg-white';
    }
  };

  if (senderStatus.loading) {
    return (
      <div className={cn('bg-white rounded-lg shadow p-6', className)}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900">Sender Emails</h3>
          <EnvelopeIcon className="w-6 h-6 text-gray-400" />
        </div>
        <div className="flex items-center justify-center py-8">
          <Loading size="sm" />
        </div>
      </div>
    );
  }

  if (senderStatus.error) {
    return (
      <div className={cn('bg-white rounded-lg shadow p-6', className)}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900">Sender Emails</h3>
          <EnvelopeIcon className="w-6 h-6 text-gray-400" />
        </div>
        <div className="text-center py-8">
          <ExclamationTriangleIcon className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-gray-600">Failed to load sender status</p>
          <button
            onClick={senderStatus.refresh}
            className="mt-2 text-sm text-blue-600 hover:text-blue-500"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('bg-white rounded-lg shadow p-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">Sender Emails</h3>
        <div className="flex items-center gap-2">
          <SenderStatusIndicator
            verifiedCount={senderStatus.verifiedCount}
            pendingCount={senderStatus.pendingCount}
            failedCount={senderStatus.failedCount}
            totalCount={senderStatus.totalCount}
            size="md"
          />
          <Link
            to="/senders"
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
            title="Manage sender emails"
          >
            <CogIcon className="w-5 h-5" />
          </Link>
        </div>
      </div>

      {/* Status Content */}
      <div className={cn('rounded-lg border p-4 mb-4', getStatusColor())}>
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            {getStatusIcon()}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium text-gray-900 mb-1">
              {statusInfo.title}
            </h4>
            <p className="text-sm text-gray-600">
              {statusInfo.description}
            </p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      {senderStatus.totalCount > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center">
            <div className="text-lg font-semibold text-green-600">
              {senderStatus.verifiedCount}
            </div>
            <div className="text-xs text-gray-500">Verified</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-amber-600">
              {senderStatus.pendingCount}
            </div>
            <div className="text-xs text-gray-500">Pending</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-red-600">
              {senderStatus.failedCount}
            </div>
            <div className="text-xs text-gray-500">Failed</div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex gap-2">
        <Link
          to={statusInfo.actionHref}
          className={cn(
            'flex-1 inline-flex items-center justify-center px-3 py-2 border border-transparent text-sm font-medium rounded-md transition-colors',
            statusInfo.priority === 'error'
              ? 'text-red-700 bg-red-100 hover:bg-red-200'
              : statusInfo.priority === 'warning'
              ? 'text-amber-700 bg-amber-100 hover:bg-amber-200'
              : statusInfo.priority === 'success'
              ? 'text-green-700 bg-green-100 hover:bg-green-200'
              : 'text-blue-700 bg-blue-100 hover:bg-blue-200'
          )}
        >
          {statusInfo.action}
          <ArrowRightIcon className="w-4 h-4 ml-1" />
        </Link>

        {senderStatus.tierLimits &&
         senderStatus.totalCount < senderStatus.tierLimits.maxSenders && (
          <Link
            to="/senders"
            className="inline-flex items-center justify-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 transition-colors"
            title="Add new sender email"
          >
            <PlusIcon className="w-4 h-4" />
          </Link>
        )}
      </div>

      {/* Tier Info */}
      {senderStatus.tierLimits && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex justify-between items-center text-xs text-gray-500">
            <span>
              {senderStatus.totalCount} of {senderStatus.tierLimits.maxSenders} senders used
            </span>
            <span className="capitalize">
              {senderStatus.tierLimits.tier.replace('-', ' ')}
            </span>
          </div>
          {senderStatus.totalCount < senderStatus.tierLimits.maxSenders && (
            <div className="mt-1 w-full bg-gray-200 rounded-full h-1">
              <div
                className="bg-blue-600 h-1 rounded-full transition-all duration-300"
                style={{
                  width: `${(senderStatus.totalCount / senderStatus.tierLimits.maxSenders) * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
