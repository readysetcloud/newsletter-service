import React from 'react';
import { NavigationItem } from './NavigationItem';
import { StatusIndicator } from '@/components/ui';
import { useSenderStatus } from '@/hooks/useSenderStatus';
import type { NavigationItem as NavigationItemType } from '@/types/sidebar';

interface SenderNavigationItemProps {
  item: NavigationItemType;
  collapsed: boolean;
  isActive?: boolean;
  onClick?: () => void;
  showTooltip?: boolean;
  groupIndex?: number;
  itemIndex?: number;
}

export const SenderNavigationItem: React.FC<SenderNavigationItemProps> = (props) => {
  const senderStatus = useSenderStatus();
  const { item, collapsed, showTooltip } = props;

  // If this is not the sender emails item or we don't have status data, use regular NavigationItem
  if (item.id !== 'senders' || senderStatus.loading || !item.badge) {
    return <NavigationItem {...props} />;
  }

  // Create enhanced item with status indicator
  const enhancedItem = {
    ...item,
    badge: item.badge
  };

  // For collapsed state with tooltip, we want to show detailed status information
  if (collapsed && showTooltip && item.badge) {
    const statusDetails = {
      total: senderStatus.totalCount,
      verified: senderStatus.verifiedCount,
      pending: senderStatus.pendingCount,
      failed: senderStatus.failedCount,
      timedOut: senderStatus.timedOutCount
    };

    // We'll override the tooltip content by creating a custom NavigationItem
    // that uses StatusIndicator for the badge
    return (
      <NavigationItem
        {...props}
        item={enhancedItem}
      />
    );
  }

  return <NavigationItem {...props} item={enhancedItem} />;
};

export default SenderNavigationItem;
