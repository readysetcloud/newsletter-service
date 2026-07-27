import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, PencilLine, Send, SendHorizonal } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { IssueStatus } from '../../types/issues';

/**
 * Props for the IssueStatusBadge component
 */
export interface IssueStatusBadgeProps {
  /** The current status of the issue */
  status: IssueStatus;
  /**
   * `sm` (default) is the inline pill used in lists. `lg` is for a page header,
   * where the status has to be readable at a glance rather than found — a
   * draft that looks like a published issue is how an unsent issue gets
   * mistaken for a sent one.
   */
  size?: 'sm' | 'lg';
  /** Optional additional CSS classes to apply */
  className?: string;
}

type StatusConfig = {
  label: string;
  className: string;
  icon: React.ComponentType<{ className?: string }>;
};

const statusConfig: Record<IssueStatus, StatusConfig> = {
  draft: {
    label: 'Draft',
    // Amber rather than grey: a draft is a state that needs action, and grey
    // reads as "nothing to see here" next to the other statuses.
    className: 'bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-800/60 dark:text-amber-50 dark:border-amber-400',
    icon: PencilLine
  },
  scheduled: {
    label: 'Scheduled',
    className: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-800/60 dark:text-blue-100 dark:border-blue-400',
    icon: Clock
  },
  'in progress': {
    label: 'In Progress',
    className: 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-800/60 dark:text-yellow-100 dark:border-yellow-400',
    icon: Send
  },
  sending: {
    label: 'Sending',
    // Deliberately not green: a local send is still in flight for hours, and
    // reading it as finished is how an issue that is half-delivered gets
    // mistaken for one that is done.
    className: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-800/60 dark:text-sky-100 dark:border-sky-400',
    icon: SendHorizonal
  },
  published: {
    label: 'Published',
    className: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-800/60 dark:text-green-100 dark:border-green-400',
    icon: CheckCircle2
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-800/60 dark:text-red-100 dark:border-red-400',
    icon: AlertTriangle
  }
};

const SIZE_CLASSES = {
  sm: 'px-2.5 py-0.5 text-xs gap-1',
  lg: 'px-3 py-1 text-sm gap-1.5 shadow-sm'
} as const;

const ICON_CLASSES = {
  sm: 'w-3 h-3',
  lg: 'w-4 h-4'
} as const;

/**
 * Badge component that displays the status of an issue with appropriate styling
 * Supports draft, scheduled, published, and failed statuses with color-coded indicators
 */
export const IssueStatusBadge: React.FC<IssueStatusBadgeProps> = React.memo(({ status, size = 'sm', className }) => {
  const config = statusConfig[status];

  // Defensive check: if status is invalid, use a default config
  if (!config) {
    console.warn(`Invalid issue status: ${status}`);
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full font-medium border',
          SIZE_CLASSES[size],
          'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-500',
          className
        )}
        role="status"
        aria-label={`Issue status: ${status || 'Unknown'}`}
      >
        {status || 'Unknown'}
      </span>
    );
  }

  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border',
        size === 'lg' ? 'font-semibold' : 'font-medium',
        SIZE_CLASSES[size],
        config.className,
        className
      )}
      role="status"
      aria-label={`Issue status: ${config.label}`}
    >
      <Icon className={ICON_CLASSES[size]} aria-hidden="true" />
      {config.label}
    </span>
  );
});

IssueStatusBadge.displayName = 'IssueStatusBadge';
