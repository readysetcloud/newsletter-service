import React from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClockIcon,
} from '@heroicons/react/24/solid';
import { cn } from '@/utils/cn';

interface SenderStatusIndicatorProps {
  verifiedCount: number;
  pendingCount: number;
  failedCount: number;
  timedOutCount?: number;
  totalCount: number;
  size?: 'sm' | 'md';
  showText?: boolean;
  className?: string;
}

/**
 * Status indicator component for sender email verification states
 * Shows different indicators based on verification status
 */
export const SenderStatusIndicator: React.FC<SenderStatusIndicatorProps> = ({
  verifiedCount,
  pendingCount,
  failedCount,
  timedOutCount = 0,
  totalCount,
  size = 'sm',
  showText = false,
  className,
}) => {
  // Don't show indicator if no senders configured
  if (totalCount === 0) {
    return null;
  }

  // Determine primary status and styling
  const getStatusInfo = () => {
    if (failedCount > 0) {
      return {
        icon: ExclamationTriangleIcon,
        color: 'text-red-500',
        bgColor: 'bg-red-100',
        text: `${failedCount} failed`,
        priority: 'error' as const,
      };
    }

    if (timedOutCount > 0) {
      return {
        icon: ExclamationTriangleIcon,
        color: 'text-orange-500',
        bgColor: 'bg-orange-100',
        text: `${timedOutCount} expired`,
        priority: 'warning' as const,
      };
    }

    if (pendingCount > 0) {
      return {
        icon: ClockIcon,
        color: 'text-amber-500',
        bgColor: 'bg-amber-100',
        text: `${pendingCount} pending`,
        priority: 'warning' as const,
      };
    }

    if (verifiedCount === totalCount) {
      return {
        icon: CheckCircleIcon,
        color: 'text-green-500',
        bgColor: 'bg-green-100',
        text: 'All verified',
        priority: 'success' as const,
      };
    }

    return null;
  };

  const statusInfo = getStatusInfo();

  if (!statusInfo) {
    return null;
  }

  const { icon: Icon, color, bgColor, text } = statusInfo;

  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  const containerSize = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <div
        className={cn(
          'flex items-center justify-center rounded-full',
          bgColor,
          containerSize
        )}
        title={`${verifiedCount} verified, ${pendingCount} pending, ${failedCount} failed, ${timedOutCount} expired`}
      >
        <Icon className={cn(iconSize, color)} aria-hidden="true" />
      </div>

      {showText && (
        <span className={cn('text-xs font-medium', color)}>
          {text}
        </span>
      )}
    </div>
  );
};
