import React from 'react';
import { Badge, BadgeConfig } from './Badge';
import { Tooltip } from './Tooltip';
import { cn } from '@/utils/cn';

export interface StatusDetails {
  verified?: number;
  pending?: number;
  failed?: number;
  timedOut?: number;
  total?: number;
}

export interface StatusIndicatorProps {
  badge: BadgeConfig;
  details?: StatusDetails;
  label: string;
  className?: string;
  showTooltip?: boolean;
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
}

const formatStatusDetails = (details: StatusDetails, label: string): string => {
  const parts: string[] = [];

  if (details.total !== undefined) {
    parts.push(`${details.total} total ${label.toLowerCase()}`);
  }

  if (details.verified !== undefined && details.verified > 0) {
    parts.push(`${details.verified} verified`);
  }

  if (details.pending !== undefined && details.pending > 0) {
    parts.push(`${details.pending} pending verification`);
  }

  if (details.failed !== undefined && details.failed > 0) {
    parts.push(`${details.failed} failed verification`);
  }

  if (details.timedOut !== undefined && details.timedOut > 0) {
    parts.push(`${details.timedOut} verification timed out`);
  }

  return parts.join(', ');
};

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  badge,
  details,
  label,
  className,
  showTooltip = true,
  tooltipPosition = 'right'
}) => {
  const getVariantFromStatus = (status?: string) => {
    switch (status) {
      case 'success': return 'success';
      case 'error': return 'error';
      case 'warning': return 'warning';
      default: return 'default';
    }
  };

  const badgeElement = (
    <Badge
      variant={badge.variant || getVariantFromStatus(badge.status)}
      className={cn('transition-all duration-200', className)}
    >
      {badge.text || badge.count?.toString() || ''}
    </Badge>
  );

  if (!showTooltip || !details) {
    return badgeElement;
  }

  const tooltipContent = formatStatusDetails(details, label);

  if (!tooltipContent) {
    return badgeElement;
  }

  return (
    <Tooltip
      content={tooltipContent}
      position={tooltipPosition}
      delay={300}
    >
      {badgeElement}
    </Tooltip>
  );
};

export default StatusIndicator;
