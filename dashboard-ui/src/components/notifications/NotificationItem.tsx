import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import type { Notification } from '../../types';

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead?: (notificationId: string) => void;
  onRemove?: (notificationId: string) => void;
  showActions?: boolean;
  compact?: boolean;
}

/**
 * NotificationItem component displays an individual notification
 * with appropriate styling based on type and read status
 */
export function NotificationItem({
  notification,
  onMarkAsRead,
  onRemove,
  showActions = true,
  compact = false
}: NotificationItemProps) {
  const { id, type, title, message, timestamp, read, actionUrl } = notification;

  // Get icon and colors based on notification type
  const getNotificationStyle = () => {
    switch (type) {
      case 'success':
        return {
          icon: CheckCircleIcon,
          iconColor: 'text-green-500',
          bgColor: read ? 'bg-green-50' : 'bg-green-100',
          borderColor: 'border-green-200'
        };
      case 'error':
        return {
          icon: ExclamationCircleIcon,
          iconColor: 'text-red-500',
          bgColor: read ? 'bg-red-50' : 'bg-red-100',
          borderColor: 'border-red-200'
        };
      case 'warning':
        return {
          icon: ExclamationTriangleIcon,
          iconColor: 'text-yellow-500',
          bgColor: read ? 'bg-yellow-50' : 'bg-yellow-100',
          borderColor: 'border-yellow-200'
        };
      case 'info':
      default:
        return {
          icon: InformationCircleIcon,
          iconColor: 'text-blue-500',
          bgColor: read ? 'bg-blue-50' : 'bg-blue-100',
          borderColor: 'border-blue-200'
        };
    }
  };

  const style = getNotificationStyle();
  const Icon = style.icon;

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    if (diffInMinutes < 10080) return `${Math.floor(diffInMinutes / 1440)}d ago`;

    return date.toLocaleDateString();
  };

  const handleMarkAsRead = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!read && onMarkAsRead) {
      onMarkAsRead(id);
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRemove) {
      onRemove(id);
    }
  };

  const handleActionClick = () => {
    if (actionUrl) {
      window.open(actionUrl, '_blank');
    }
    if (!read && onMarkAsRead) {
      onMarkAsRead(id);
    }
  };

  return (
    <div
      className={`relative border-l-4 ${style.borderColor} ${style.bgColor} ${
        compact ? 'p-3' : 'p-4'
      } ${actionUrl ? 'cursor-pointer hover:bg-opacity-80' : ''} ${
        !read ? 'shadow-sm' : ''
      } transition-colors`}
      onClick={actionUrl ? handleActionClick : undefined}
    >
      <div className="flex items-start space-x-3">
        {/* Notification Icon */}
        <div className="flex-shrink-0">
          <Icon className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} ${style.iconColor}`} />
        </div>

        {/* Notification Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h4 className={`${compact ? 'text-sm' : 'text-base'} font-medium text-gray-900 ${
                !read ? 'font-semibold' : ''
              }`}>
                {title}
              </h4>
              <p className={`${compact ? 'text-xs' : 'text-sm'} text-gray-600 mt-1`}>
                {message}
              </p>
              <p className="text-xs text-gray-400 mt-2">
                {formatTimestamp(timestamp)}
              </p>
            </div>

            {/* Actions */}
            {showActions && (
              <div className="flex items-center space-x-2 ml-4">
                {!read && (
                  <button
                    onClick={handleMarkAsRead}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    title="Mark as read"
                  >
                    Mark read
                  </button>
                )}
                <button
                  onClick={handleRemove}
                  className="text-gray-400 hover:text-gray-600"
                  title="Remove notification"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Unread indicator */}
        {!read && (
          <div className="absolute top-4 right-4">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
          </div>
        )}
      </div>

      {/* Action URL indicator */}
      {actionUrl && (
        <div className="mt-2 text-xs text-blue-600 hover:text-blue-800">
          Click to view details →
        </div>
      )}
    </div>
  );
}
