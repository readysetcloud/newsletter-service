import { BellIcon } from '@heroicons/react/24/outline';
import { BellIcon as BellSolidIcon } from '@heroicons/react/24/solid';

interface NotificationBadgeProps {
  unreadCount: number;
  onClick?: () => void;
  className?: string;
  showIcon?: boolean;
}

/**
 * NotificationBadge component displays a bell icon with an unread count badge
 * Used in the header navigation to show notification status
 */
export function NotificationBadge({
  unreadCount,
  onClick,
  className = '',
  showIcon = true
}: NotificationBadgeProps) {
  const hasUnread = unreadCount > 0;
  const displayCount = unreadCount > 99 ? '99+' : unreadCount.toString();

  return (
    <button
      onClick={onClick}
      className={`relative inline-flex items-center p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${className}`}
      aria-label={`Notifications${hasUnread ? ` (${unreadCount} unread)` : ''}`}
    >
      {showIcon && (
        <>
          {hasUnread ? (
            <BellSolidIcon className="w-6 h-6 text-blue-600" />
          ) : (
            <BellIcon className="w-6 h-6" />
          )}
        </>
      )}

      {hasUnread && (
        <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-red-500 rounded-full min-w-[1.25rem] h-5">
          {displayCount}
        </span>
      )}
    </button>
  );
}
