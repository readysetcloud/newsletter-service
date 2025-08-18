import { useCallback } from 'react';
import { useNotifications as useNotificationContext } from '../contexts/NotificationContext';
import type { Notification } from '../types';

/**
 * Custom hook for managing notifications with additional utility functions
 */
export function useNotifications() {
  const context = useNotificationContext();

  // Helper function to show success notification
  const showSuccess = useCallback((title: string, message: string, actionUrl?: string) => {
    context.addNotification({
      type: 'success',
      title,
      message,
      actionUrl,
    });
  }, [context]);

  // Helper function to show error notification
  const showError = useCallback((title: string, message: string, actionUrl?: string) => {
    context.addNotification({
      type: 'error',
      title,
      message,
      actionUrl,
    });
  }, [context]);

  // Helper function to show info notification
  const showInfo = useCallback((title: string, message: string, actionUrl?: string) => {
    context.addNotification({
      type: 'info',
      title,
      message,
      actionUrl,
    });
  }, [context]);

  // Helper function to show warning notification
  const showWarning = useCallback((title: string, message: string, actionUrl?: string) => {
    context.addNotification({
      type: 'warning',
      title,
      message,
      actionUrl,
    });
  }, [context]);

  // Get recent notifications (last 10)
  const getRecentNotifications = useCallback((limit: number = 10): Notification[] => {
    return context.notifications.slice(0, limit);
  }, [context.notifications]);

  // Get unread notifications
  const getUnreadNotifications = useCallback((): Notification[] => {
    return context.notifications.filter(notification => !notification.read);
  }, [context.notifications]);

  // Check if there are any unread notifications
  const hasUnreadNotifications = useCallback((): boolean => {
    return context.unreadCount > 0;
  }, [context.unreadCount]);

  // Get notifications by type
  const getNotificationsByType = useCallback((type: Notification['type']): Notification[] => {
    return context.notifications.filter(notification => notification.type === type);
  }, [context.notifications]);

  return {
    // Core context functions
    ...context,

    // Helper functions
    showSuccess,
    showError,
    showInfo,
    showWarning,

    // Utility functions
    getRecentNotifications,
    getUnreadNotifications,
    hasUnreadNotifications,
    getNotificationsByType,
  };
}
