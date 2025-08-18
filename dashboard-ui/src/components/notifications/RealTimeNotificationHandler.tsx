import { useEffect, useCallback, useState } from 'react';
import { useNotifications } from '../../hooks/useNotifications';
import { useAuth } from '../../contexts/AuthContext';
import type { Notification } from '../../types';

/**
 * Real-time notification handler that processes different types of notifications
 * and updates the UI accordingly
 */
export function RealTimeNotificationHandler() {
  const { showSuccess, showInfo, showWarning, showError, isSubscribed, error } = useNotifications();
  const { user } = useAuth();

  // Handle different types of real-time notifications
  const handleNotification = useCallback((notification: Notification) => {
    // Process notification based on its content and type
    switch (notification.type) {
      case 'success':
        // Handle success notifications (e.g., issue published, subscriber added)
        if (notification.title.includes('Issue Published')) {
          showSuccess(
            'Newsletter Published!',
            `Your newsletter "${notification.message}" has been successfully published.`,
            notification.actionUrl
          );
        } else if (notification.title.includes('Subscriber Added')) {
          showSuccess(
            'New Subscriber!',
            notification.message,
            notification.actionUrl
          );
        } else {
          showSuccess(notification.title, notification.message, notification.actionUrl);
        }
        break;

      case 'info':
        // Handle info notifications (e.g., brand updates, system updates)
        if (notification.title.includes('Brand Updated')) {
          showInfo(
            'Brand Settings Updated',
            notification.message,
            notification.actionUrl
          );
        } else if (notification.title.includes('System')) {
          showInfo(
            'System Update',
            notification.message,
            notification.actionUrl
          );
        } else {
          showInfo(notification.title, notification.message, notification.actionUrl);
        }
        break;

      case 'warning':
        // Handle warning notifications (e.g., quota warnings, validation issues)
        if (notification.title.includes('Quota')) {
          showWarning(
            'Quota Warning',
            notification.message,
            notification.actionUrl
          );
        } else if (notification.title.includes('Validation')) {
          showWarning(
            'Validation Issue',
            notification.message,
            notification.actionUrl
          );
        } else {
          showWarning(notification.title, notification.message, notification.actionUrl);
        }
        break;

      case 'error':
        // Handle error notifications (e.g., system errors, failed operations)
        if (notification.title.includes('Connection')) {
          showError(
            'Connection Issue',
            notification.message,
            notification.actionUrl
          );
        } else if (notification.title.includes('Failed')) {
          showError(
            'Operation Failed',
            notification.message,
            notification.actionUrl
          );
        } else {
          showError(notification.title, notification.message, notification.actionUrl);
        }
        break;

      default:
        // Default to info for unknown types
        showInfo(notification.title, notification.message, notification.actionUrl);
    }
  }, [showSuccess, showInfo, showWarning, showError]);

  // This component doesn't render anything visible
  return null;
}

/**
 * Hook for handling specific notification types with UI updates
 */
export function useRealTimeNotificationHandlers() {
  const { showSuccess, showInfo, showWarning, showError } = useNotifications();

  // Handler for issue-related notifications
  const handleIssueNotification = useCallback((data: {
    type: 'ISSUE_PUBLISHED' | 'ISSUE_DRAFT_SAVED';
    issueId: string;
    title: string;
    publishedAt?: string;
    subscriberCount?: number;
  }) => {
    switch (data.type) {
      case 'ISSUE_PUBLISHED':
        showSuccess(
          'Newsletter Published!',
          `"${data.title}" has been sent to ${data.subscriberCount || 0} subscribers.`,
          `/dashboard/issues/${data.issueId}`
        );
        break;
      case 'ISSUE_DRAFT_SAVED':
        showInfo(
          'Draft Saved',
          `Your draft "${data.title}" has been saved.`,
          `/dashboard/issues/${data.issueId}/edit`
        );
        break;
    }
  }, [showSuccess, showInfo]);

  // Handler for subscriber-related notifications
  const handleSubscriberNotification = useCallback((data: {
    type: 'SUBSCRIBER_ADDED' | 'SUBSCRIBER_REMOVED';
    email?: string;
    totalCount: number;
  }) => {
    switch (data.type) {
      case 'SUBSCRIBER_ADDED':
        showSuccess(
          'New Subscriber!',
          data.email
            ? `${data.email} has subscribed to your newsletter. Total: ${data.totalCount}`
            : `You have a new subscriber! Total: ${data.totalCount}`,
          '/dashboard/subscribers'
        );
        break;
      case 'SUBSCRIBER_REMOVED':
        showInfo(
          'Subscriber Unsubscribed',
          data.email
            ? `${data.email} has unsubscribed. Total: ${data.totalCount}`
            : `A subscriber has unsubscribed. Total: ${data.totalCount}`,
          '/dashboard/subscribers'
        );
        break;
    }
  }, [showSuccess, showInfo]);

  // Handler for brand-related notifications
  const handleBrandNotification = useCallback((data: {
    type: 'BRAND_UPDATED';
    changes: string[];
  }) => {
    showInfo(
      'Brand Settings Updated',
      `Updated: ${data.changes.join(', ')}`,
      '/dashboard/brand'
    );
  }, [showInfo]);

  // Handler for system notifications
  const handleSystemNotification = useCallback((data: {
    type: 'SYSTEM_ALERT';
    level: 'info' | 'warning' | 'error';
    message: string;
    actionUrl?: string;
  }) => {
    switch (data.level) {
      case 'error':
        showError('System Alert', data.message, data.actionUrl);
        break;
      case 'warning':
        showWarning('System Notice', data.message, data.actionUrl);
        break;
      case 'info':
      default:
        showInfo('System Update', data.message, data.actionUrl);
        break;
    }
  }, [showError, showWarning, showInfo]);

  return {
    handleIssueNotification,
    handleSubscriberNotification,
    handleBrandNotification,
    handleSystemNotification
  };
}

/**
 * Component that provides real-time notification feedback for UI actions
 */
export function NotificationFeedback() {
  const { isSubscribed, error, isLoading, refreshNotificationToken } = useNotifications();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshNotificationToken();
    setIsRefreshing(false);
  };

  // Don't show anything while loading - let the app work normally
  if (isLoading) {
    return null;
  }

  // Show error state with refresh option, but don't block the UI
  if (error) {
    return (
      <div className="fixed bottom-4 right-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3 shadow-lg z-50 max-w-sm">
        <div className="flex items-start space-x-2">
          <div className="w-4 h-4 bg-yellow-500 rounded-full mt-0.5"></div>
          <div className="flex-1">
            <span className="text-sm text-yellow-700 block">Limited functionality</span>
            <span className="text-xs text-yellow-600">Real-time updates unavailable</span>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="text-xs text-yellow-800 underline hover:no-underline mt-1 block disabled:opacity-50"
            >
              {isRefreshing ? 'Reconnecting...' : 'Try reconnecting'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show success state briefly, then hide
  if (isSubscribed) {
    return (
      <div className="fixed bottom-4 right-4 bg-green-50 border border-green-200 rounded-lg p-2 shadow-lg z-50 animate-fade-in">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
          <span className="text-xs text-green-700">Real-time updates active</span>
        </div>
      </div>
    );
  }

  return null;
}
