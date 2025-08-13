import { useEffect, useState } from 'react';
import { useNotifications } from '../../hooks/useNotifications';
import { useAuth } from '../../contexts/AuthContext';
import { RealTimeNotificationHandler, NotificationFeedback } from './RealTimeNotificationHandler';
import { NotificationToastContainer } from './NotificationToast';
import { ErrorNotificationHandler } from './ErrorNotificationHandler';
import { NotificationErrorBoundary } from './NotificationErrorBoundary';
import { NotificationStatusBanner } from './NotificationStatus';
import type { Notification } from '../../types';

interface NotificationProviderProps {
  children: React.ReactNode;
  showToasts?: boolean;
  showConnectionStatus?: boolean;
  showErrorBanner?: boolean;
  maxToasts?: number;
  toastPosition?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

/**
 * NotificationProvider component that wraps the app with comprehensive
 * notification functionality including real-time updates and toast notifications
 */
export function NotificationProvider({
  children,
  showToasts = true,
  showConnectionStatus = true,
  showErrorBanner = true,
  maxToasts = 5,
  toastPosition = 'top-right'
}: NotificationProviderProps) {
  const { notifications, removeNotification, isSubscribed, error } = useNotifications();
  const { isAuthenticated } = useAuth();
  const [toastNotifications, setToastNotifications] = useState<Notification[]>([]);

  // Filter notifications for toast display (only show recent unread ones)
  useEffect(() => {
    if (showToasts) {
      const recentUnread = notifications
        .filter(notification => !notification.read)
        .slice(0, maxToasts);

      setToastNotifications(recentUnread);
    }
  }, [notifications, showToasts, maxToasts]);

  // Handle toast close
  const handleToastClose = (notificationId: string) => {
    setToastNotifications(prev =>
      prev.filter(notification => notification.id !== notificationId)
    );
    // Optionally mark as read when toast is closed
    // markAsRead(notificationId);
  };

  return (
    <NotificationErrorBoundary>
      {/* Error banner for critical issues */}
      {showErrorBanner && <NotificationStatusBanner />}

      {children}

      {/* Real-time notification handler */}
      {isAuthenticated && <RealTimeNotificationHandler />}

      {/* Error notification handler */}
      {isAuthenticated && <ErrorNotificationHandler />}

      {/* Connection status feedback */}
      {isAuthenticated && showConnectionStatus && <NotificationFeedback />}

      {/* Toast notifications */}
      {showToasts && (
        <NotificationToastContainer
          notifications={toastNotifications}
          onClose={handleToastClose}
          maxToasts={maxToasts}
          position={toastPosition}
        />
      )}
    </NotificationErrorBoundary>
  );
}

/**
 * Hook for managing notification UI state and interactions
 */
export function useNotificationUI() {
  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    isSubscribed,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAllNotifications,
    showSuccess,
    showError,
    showInfo,
    showWarning
  } = useNotifications();

  const { user, isAuthenticated } = useAuth();

  // Get connection status with user-friendly messages
  const getConnectionStatus = () => {
    if (!isAuthenticated) {
      return {
        status: 'disconnected',
        message: 'Sign in to receive real-time notifications',
        color: 'gray'
      };
    }

    if (isLoading) {
      return {
        status: 'connecting',
        message: 'Connecting to notification service...',
        color: 'blue'
      };
    }

    if (error) {
      return {
        status: 'error',
        message: 'Real-time notifications unavailable',
        color: 'red'
      };
    }

    if (isSubscribed) {
      return {
        status: 'connected',
        message: 'Real-time notifications active',
        color: 'green'
      };
    }

    return {
      status: 'disconnected',
      message: 'Not connected to real-time notifications',
      color: 'gray'
    };
  };

  // Show notification for successful operations
  const showOperationSuccess = (operation: string, details?: string) => {
    showSuccess(
      `${operation} Successful`,
      details || `Your ${operation.toLowerCase()} was completed successfully.`
    );
  };

  // Show notification for failed operations
  const showOperationError = (operation: string, error: string) => {
    showError(
      `${operation} Failed`,
      error || `Your ${operation.toLowerCase()} could not be completed.`
    );
  };

  // Show notification for real-time updates
  const showRealTimeUpdate = (type: 'issue' | 'subscriber' | 'brand' | 'system', message: string, actionUrl?: string) => {
    const titles = {
      issue: 'Newsletter Update',
      subscriber: 'Subscriber Update',
      brand: 'Brand Update',
      system: 'System Update'
    };

    showInfo(titles[type], message, actionUrl);
  };

  // Get notification statistics
  const getNotificationStats = () => {
    const total = notifications.length;
    const unread = unreadCount;
    const byType = {
      success: notifications.filter(n => n.type === 'success').length,
      error: notifications.filter(n => n.type === 'error').length,
      warning: notifications.filter(n => n.type === 'warning').length,
      info: notifications.filter(n => n.type === 'info').length
    };

    return {
      total,
      unread,
      read: total - unread,
      byType
    };
  };

  return {
    // Core notification data
    notifications,
    unreadCount,
    isLoading,
    error,
    isSubscribed,

    // User context
    user,
    isAuthenticated,

    // Actions
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAllNotifications,

    // Helper functions
    showSuccess,
    showError,
    showInfo,
    showWarning,
    showOperationSuccess,
    showOperationError,
    showRealTimeUpdate,

    // Status and stats
    getConnectionStatus,
    getNotificationStats
  };
}
