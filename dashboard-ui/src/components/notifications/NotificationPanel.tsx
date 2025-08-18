import { useState, useRef, useEffect } from 'react';
import { NotificationItem } from './NotificationItem';
import { useNotifications } from '../../hooks/useNotifications';
import {
  CheckIcon,
  TrashIcon,
  EllipsisHorizontalIcon
} from '@heroicons/react/24/outline';

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  maxHeight?: string;
  maxNotifications?: number;
}

/**
 * NotificationPanel component displays a dropdown panel with recent notifications
 * Includes actions for marking as read and clearing notifications
 */
export function NotificationPanel({
  isOpen,
  onClose,
  maxHeight = 'max-h-96',
  maxNotifications = 10
}: NotificationPanelProps) {
  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAllNotifications,
    getRecentNotifications
  } = useNotifications();

  const [showActions, setShowActions] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Get recent notifications for display
  const recentNotifications = getRecentNotifications(maxNotifications);

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose]);

  // Handle mark as read with optimistic updates
  const handleMarkAsRead = (notificationId: string) => {
    markAsRead(notificationId);
  };

  // Handle remove notification
  const handleRemoveNotification = (notificationId: string) => {
    removeNotification(notificationId);
  };

  // Handle mark all as read
  const handleMarkAllAsRead = () => {
    markAllAsRead();
    setShowActions(false);
  };

  // Handle clear all notifications
  const handleClearAll = () => {
    clearAllNotifications();
    setShowActions(false);
  };

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-w-[calc(100vw-2rem)] mr-4 sm:mr-0"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
          {unreadCount > 0 && (
            <p className="text-sm text-gray-500">
              {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Actions Menu */}
        <div className="relative">
          <button
            onClick={() => setShowActions(!showActions)}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
            disabled={notifications.length === 0}
          >
            <EllipsisHorizontalIcon className="w-5 h-5" />
          </button>

          {showActions && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-10">
              <div className="py-1">
                <button
                  onClick={handleMarkAllAsRead}
                  disabled={unreadCount === 0}
                  className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  <CheckIcon className="w-4 h-4 mr-2" />
                  Mark all as read
                </button>
                <button
                  onClick={handleClearAll}
                  disabled={notifications.length === 0}
                  className="flex items-center w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  <TrashIcon className="w-4 h-4 mr-2" />
                  Clear all
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className={`${maxHeight} overflow-y-auto`}>
        {isLoading && (
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <span className="ml-2 text-sm text-gray-500">Loading notifications...</span>
          </div>
        )}

        {error && (
          <div className="p-4 text-center">
            <p className="text-sm text-red-600">Failed to load notifications</p>
            <p className="text-xs text-gray-500 mt-1">{error}</p>
          </div>
        )}

        {!isLoading && !error && recentNotifications.length === 0 && (
          <div className="p-8 text-center">
            <div className="text-gray-400 mb-2">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 17h5l-5 5-5-5h5v-12h5v12z" />
              </svg>
            </div>
            <p className="text-sm text-gray-500">No notifications yet</p>
            <p className="text-xs text-gray-400 mt-1">
              You'll see updates about your newsletter here
            </p>
          </div>
        )}

        {!isLoading && !error && recentNotifications.length > 0 && (
          <div className="divide-y divide-gray-100">
            {recentNotifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkAsRead={handleMarkAsRead}
                onRemove={handleRemoveNotification}
                showActions={true}
                compact={true}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {recentNotifications.length > 0 && notifications.length > maxNotifications && (
        <div className="p-3 border-t border-gray-200 text-center">
          <p className="text-xs text-gray-500">
            Showing {maxNotifications} of {notifications.length} notifications
          </p>
        </div>
      )}
    </div>
  );
}
