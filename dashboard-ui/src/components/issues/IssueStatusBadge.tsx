/* eslint-disable react/prop-types */
import React from 'react';
import { cn } from '../../utils/cn';
import type { IssueStatus } from '../../types/issues';

/**
 * Props for the IssueStatusBadge component
 */
export interface IssueStatusBadgeProps {
  /** The current status of the issue */
  status: IssueStatus;
  /** Optional additional CSS classes to apply */
  className?: string;
}

const statusConfig: Record<IssueStatus, { label: string; className: string }> = {
  draft: {
    label: 'Draft',
    className: 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600'
  },
  scheduled: {
    label: 'Scheduled',
    className: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700'
  },
  published: {
    label: 'Published',
    className: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700'
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700'
  }
};

/**
 * Badge component that displays the status of an issue with appropriate styling
 * Supports draft, scheduled, published, and failed statuses with color-coded indicators
 */
export const IssueStatusBadge: React.FC<IssueStatusBadgeProps> = React.memo(({ status, className }) => {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
        config.className,
        className
      )}
      role="status"
      aria-label={`Issue status: ${config.label}`}
    >
      {config.label}
    </span>
  );
});

IssueStatusBadge.displayName = 'IssueStatusBadge';
