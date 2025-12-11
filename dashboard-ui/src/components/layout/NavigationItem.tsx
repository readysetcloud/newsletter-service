import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { ariaPatterns, responsiveA11y } from '@/utils/accessibility';
import { preloadRoute } from '@/utils/lazyImports';
import { SafeIcon } from './SafeIcon';
import { Badge, Tooltip } from '@/components/ui';
import type { NavigationItem as NavigationItemType } from '@/types/sidebar';

interface NavigationItemProps {
  item: NavigationItemType;
  collapsed: boolean;
  isActive?: boolean;
  onClick?: () => void;
  showTooltip?: boolean;
  groupIndex?: number;
  itemIndex?: number;
  tooltipDetails?: {
    total?: number;
    verified?: number;
    pending?: number;
    failed?: number;
    timedOut?: number;
  };
}

interface NavigationBadgeProps {
  badge: NonNullable<NavigationItemType['badge']>;
  collapsed: boolean;
}

const NavigationBadge: React.FC<NavigationBadgeProps> = ({ badge, collapsed }) => {
  const getVariantFromStatus = (status?: string) => {
    switch (status) {
      case 'success': return 'success';
      case 'error': return 'error';
      case 'warning': return 'warning';
      default: return collapsed ? 'dot' : 'pill';
    }
  };

  return (
    <Badge
      variant={getVariantFromStatus(badge.status)}
      size="sm"
    >
      {!collapsed && (badge.text || badge.count?.toString() || '')}
    </Badge>
  );
};

export const NavigationItem: React.FC<NavigationItemProps> = ({
  item,
  collapsed,
  isActive: propIsActive,
  onClick,
  showTooltip = false,
  groupIndex = 0,
  itemIndex = 0,
  tooltipDetails
}) => {
  const location = useLocation();
  const isActive = propIsActive ?? location.pathname === item.href;
  const Icon = item.icon;

  const handleLinkHover = () => {
    if (item.preloadKey && import.meta.env.VITE_PRELOAD_ROUTES === 'true') {
      preloadRoute(item.preloadKey);
    }
  };

  const handleClick = () => {
    onClick?.();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Handle Enter and Space keys for activation
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick();
      // Navigate programmatically if needed
      if (event.key === 'Enter') {
        window.location.href = item.href;
      }
    }
  };

  // Generate accessible description
  const getAccessibleDescription = () => {
    const parts = [];

    if (item.badge) {
      const { count, status, text } = item.badge;
      if (count !== undefined) {
        const itemText = count === 1 ? 'item' : 'items';
        const statusText = status === 'error' ? 'requiring attention' :
                          status === 'warning' ? 'with warnings' :
                          status === 'success' ? 'completed' : 'pending';
        parts.push(`${count} ${itemText} ${statusText}`);
      } else if (text) {
        parts.push(text);
      }
    }

    if (isActive) {
      parts.push('currently active page');
    }

    return parts.length > 0 ? parts.join(', ') : undefined;
  };

  const linkContent = (
    <>
      <SafeIcon
        icon={Icon}
        fallbackId={item.id}
        className={cn(
          'nav-icon',
          collapsed ? 'nav-icon-collapsed' : 'nav-icon-expanded'
        )}
      />

      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge && (
            <NavigationBadge badge={item.badge} collapsed={collapsed} />
          )}
        </>
      )}

      {collapsed && item.badge && (
        <div className="nav-item-badge-collapsed">
          <NavigationBadge badge={item.badge} collapsed={collapsed} />
        </div>
      )}
    </>
  );

  const linkClasses = cn(
    'nav-item',
    collapsed ? 'nav-item-collapsed' : 'nav-item-expanded',
    isActive ? 'nav-item-active' : 'nav-item-default'
  );

  const accessibleDescription = getAccessibleDescription();
  const linkId = `nav-item-${groupIndex}-${itemIndex}`;
  const descriptionId = accessibleDescription ? `${linkId}-desc` : undefined;

  const linkElement = (
    <>
      <Link
        id={linkId}
        to={item.href}
        className={linkClasses}
        onMouseEnter={handleLinkHover}
        onFocus={handleLinkHover}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-current={isActive ? 'page' : undefined}
        aria-describedby={descriptionId}
        aria-label={`${item.label}${accessibleDescription ? `, ${accessibleDescription}` : ''}`}
        role="menuitem"
        tabIndex={0}
      >
        {linkContent}
      </Link>
      {accessibleDescription && (
        <span id={descriptionId} className="sr-only">
          {accessibleDescription}
        </span>
      )}
    </>
  );

  // Add tooltip for collapsed state
  if (collapsed && showTooltip) {
    let tooltipContent = item.label;

    // Add detailed status information if available
    if (tooltipDetails) {
      const statusParts: string[] = [];

      if (tooltipDetails.total !== undefined) {
        statusParts.push(`${tooltipDetails.total} total`);
      }

      if (tooltipDetails.verified !== undefined && tooltipDetails.verified > 0) {
        statusParts.push(`${tooltipDetails.verified} verified`);
      }

      if (tooltipDetails.pending !== undefined && tooltipDetails.pending > 0) {
        statusParts.push(`${tooltipDetails.pending} pending`);
      }

      if (tooltipDetails.failed !== undefined && tooltipDetails.failed > 0) {
        statusParts.push(`${tooltipDetails.failed} failed`);
      }

      if (tooltipDetails.timedOut !== undefined && tooltipDetails.timedOut > 0) {
        statusParts.push(`${tooltipDetails.timedOut} timed out`);
      }

      if (statusParts.length > 0) {
        tooltipContent = `${item.label}: ${statusParts.join(', ')}`;
      }
    } else if (item.badge && (item.badge.count !== undefined || item.badge.text)) {
      // Fallback to basic badge information
      const badgeInfo = item.badge.count !== undefined
        ? ` (${item.badge.count})`
        : item.badge.text ? ` - ${item.badge.text}` : '';
      tooltipContent = `${item.label}${badgeInfo}`;
    }

    return (
      <Tooltip
        content={tooltipContent}
        position="right"
        delay={300}
      >
        {linkElement}
      </Tooltip>
    );
  }

  return linkElement;
};
