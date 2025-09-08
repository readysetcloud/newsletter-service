import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils/cn';
import {
  CheckCircleIcon,
 ExclamationTriangleIcon,
  XCircleIcon,
  InformationCircleIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

/**
 * Notification types
 */
export type NotificationType = 'success' | 'error' | 'warning' | 'info';

/**
 * Notification interface
 */
export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number;
  persistent?: boolean;
  actions?: Array<{
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
  }>;
  onDismiss?: () => void;
  createdAt: Date;
}

/**
 * Notification state
 */
interface NotificationState {
  notifications: Notification[];
}

/**
 * Notification actions
 */
type NotificationAction =
  | { type: 'ADD_NOTIFICATION'; payload: Notification }
  | { type: 'REMOVE_NOTIFICATION'; payload: string }
  | { type: 'CLEAR_ALL' };

/**
 * Notification context
 */
interface NotificationContextType {
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt'>) => string;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  success: (title: string, message?: string, options?: Partial<Notification>) => string;
  error: (title: string, message?: string, options?: Partial<Notification>) => string;
  warning: (title: string, message?: string, options?: Partial<Notification>) => string;
  info: (title: string, message?: string, options?: Partial<Notification>) => string;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

/**
 * Notification reducer
 */
const notificationReducer = (
  state: NotificationState,
  action: NotificationAction
): NotificationState => {
  switch (action.type) {
    case 'ADD_NOTIFICATION':
      return {
        ...state,
        notifications: [...state.notifications, action.payload]
      };
    case 'REMOVE_NOTIFICATION':
      return {
        ...state,
        notifications: state.notifications.filter(n => n.id !== action.payload)
      };
    case 'CLEAR_ALL':
      return {
        ...state,
        notifications: []
      };
    default:
      return state;
  }
};

/**
 * Generate unique notification ID
 */
const generateId = (): string => {
  return `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Notification provider component
 */
export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(notificationReducer, { notifications: [] });

  const addNotification = useCallback((notification: Omit<Notification, 'id' | 'createdAt'>): string => {
    const id = generateId();
    const newNotification: Notification = {
      ...notification,
      id,
      createdAt: new Date(),
      duration: notification.duration ?? (notification.persistent ? undefined : 5000)
    };

    dispatch({ type: 'ADD_NOTIFICATION', payload: newNotification });
    return id;
  }, []);

  const removeNotification = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_NOTIFICATION', payload: id });
  }, []);

  const clearAll = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL' });
  }, []);

  const success = useCallback((
    title: string,
    message?: string,
    options?: Partial<Notification>
  ): string => {
    return addNotification({
      type: 'success',
      title,
      message,
      ...options
    });
  }, [addNotification]);

  const error = useCallback((
    title: string,
    message?: string,
    options?: Partial<Notification>
  ): string => {
    return addNotification({
      type: 'error',
      title,
      message,
      persistent: true, // Errors are persistent by default
      ...options
    });
  }, [addNotification]);

  const warning = useCallback((
    title: string,
    message?: string,
    options?: Partial<Notification>
  ): string => {
    return addNotification({
      type: 'warning',
      title,
      message,
      ...options
    });
  }, [addNotification]);

  const info = useCallback((
    title: string,
    message?: string,
    options?: Partial<Notification>
  ): string => {
    return addNotification({
      type: 'info',
      title,
      message,
      ...options
    });
  }, [addNotification]);

  const contextValue: NotificationContextType = {
    notifications: state.notifications,
    addNotification,
    removeNotification,
    clearAll,
    success,
    error,
    warning,
    info
  };

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
      <NotificationContainer />
    </NotificationContext.Provider>
  );
};

/**
 * Hook to use notifications
 */
export const useNotifications = (): NotificationContextType => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

/**
 * Notification container component
 */
const NotificationContainer: React.FC = () => {
  const { notifications } = useNotifications();
  const [portalElement, setPortalElement] = React.useState<HTMLElement | null>(null);

  useEffect(() => {
    // Create or get the portal element
    let element = document.getElementById('notification-portal');
    if (!element) {
      element = document.createElement('div');
      element.id = 'notification-portal';
      element.className = 'fixed top-4 right-4 z-50 space-y-2 pointer-events-none';
      document.body.appendChild(element);
    }
    setPortalElement(element);

    return () => {
      // Clean up empty portal element
      if (element && element.children.length === 0) {
        document.body.removeChild(element);
      }
    };
  }, []);

  if (!portalElement) {
    return null;
  }

  return createPortal(
    <div className="space-y-2">
      {notifications.map(notification => (
        <NotificationItem key={notification.id} notification={notification} />
      ))}
    </div>,
    portalElement
  );
};

/**
 * Individual notification item component
 */
const NotificationItem: React.FC<{ notification: Notification }> = ({ notification }) => {
  const { removeNotification } = useNotifications();
  const [isVisible, setIsVisible] = React.useState(false);
  const [isExiting, setIsExiting] = React.useState(false);
  const timeoutRef = React.useRef<NodeJS.Timeout>();

  // Auto-dismiss logic
  useEffect(() => {
    if (notification.duration && !notification.persistent) {
      timeoutRef.current = setTimeout(() => {
        handleDismiss();
      }, notification.duration);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [notification.duration, notification.persistent]);

  // Animation logic
  useEffect(() => {
    // Trigger entrance animation
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = useCallback(() => {
    if (isExiting) return;

    setIsExiting(true);
    setIsVisible(false);

    // Remove from state after animation
    setTimeout(() => {
      removeNotification(notification.id);
      notification.onDismiss?.();
    }, 300);
  }, [isExiting, removeNotification, notification.id, notification.onDismiss]);

  const getNotificationConfig = () => {
    switch (notification.type) {
      case 'success':
        return {
          icon: <CheckCircleIcon className="w-5 h-5" />,
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
          iconColor: 'text-green-600',
          titleColor: 'text-green-800',
          messageColor: 'text-green-700'
        };
      case 'error':
        return {
          icon: <XCircleIcon className="w-5 h-5" />,
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          iconColor: 'text-red-600',
          titleColor: 'text-red-800',
          messageColor: 'text-red-700'
        };
      case 'warning':
        return {
          icon: <ExclamationTriangleIcon className="w-5 h-5" />,
          bgColor: 'bg-yellow-50',
          borderColor: 'border-yellow-200',
          iconColor: 'text-yellow-600',
          titleColor: 'text-yellow-800',
          messageColor: 'text-yellow-700'
        };
      case 'info':
        return {
          icon: <InformationCircleIcon className="w-5 h-5" />,
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-200',
          iconColor: 'text-blue-600',
          titleColor: 'text-blue-800',
          messageColor: 'text-blue-700'
        };
    }
  };

  const config = getNotificationConfig();

  return (
    <div
      className={cn(
        'max-w-sm w-full shadow-lg rounded-lg border pointer-events-auto transform transition-all duration-300 ease-in-out',
        config.bgColor,
        config.borderColor,
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0',
        isExiting && 'translate-x-full opacity-0'
      )}
    >
      <div className="p-4">
        <div className="flex items-start">
          <div className={cn('flex-shrink-0', config.iconColor)}>
            {config.icon}
          </div>
          <div className="ml-3 w-0 flex-1">
            <p className={cn('text-sm font-medium', config.titleColor)}>
              {notification.title}
            </p>
            {notification.message && (
              <p className={cn('mt-1 text-sm', config.messageColor)}>
                {notification.message}
              </p>
            )}
            {notification.actions && notification.actions.length > 0 && (
              <div className="mt-3 flex space-x-2">
                {notification.actions.map((action, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      action.onClick();
                      handleDismiss();
                    }}
                    className={cn(
                      'text-sm font-medium rounded-md px-3 py-1 transition-colors',
                      action.variant === 'primary'
                        ? cn(
                            'text-white',
                            notification.type === 'success' && 'bg-green-600 hover:bg-green-700',
                            notification.type === 'error' && 'bg-red-600 hover:bg-red-700',
                            notification.type === 'warning' && 'bg-yellow-600 hover:bg-yellow-700',
                            notification.type === 'info' && 'bg-blue-600 hover:bg-blue-700'
                          )
                        : cn(
                            'bg-white border',
                            config.titleColor,
                            config.borderColor,
                            'hover:bg-gray-50'
                          )
                    )}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="ml-4 flex-shrink-0 flex">
            <button
              onClick={handleDismiss}
              className={cn(
                'rounded-md inline-flex text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2',
                notification.type === 'success' && 'focus:ring-green-500',
                notification.type === 'error' && 'focus:ring-red-500',
                notification.type === 'warning' && 'focus:ring-yellow-500',
                notification.type === 'info' && 'focus:ring-blue-500'
              )}
            >
              <span className="sr-only">Close</span>
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Template-specific notification helpers
 */
export const useTemplateNotifications = () => {
  const notifications = useNotifications();

  return {
    ...notifications,
    templateSaved: (templateName: string) =>
      notifications.success(
        'Template Saved',
        `${templateName} has been saved successfully.`
      ),
    templateDeleted: (templateName: string) =>
      notifications.success(
        'Template Deleted',
        `${templateName} has been deleted.`
      ),
    templateError: (templateName: string, error: string) =>
      notifications.error(
        'Template Error',
        `Failed to process ${templateName}: ${error}`
      ),
    snippetSaved: (snippetName: string) =>
      notifications.success(
        'Snippet Saved',
        `${snippetName} has been saved successfully.`
      ),
    snippetDeleted: (snippetName: string) =>
      notifications.success(
        'Snippet Deleted',
        `${snippetName} has been deleted.`
      ),
    snippetError: (snippetName: string, error: string) =>
      notifications.error(
        'Snippet Error',
        `Failed to process ${snippetName}: ${error}`
      ),
    validationError: (message: string) =>
      notifications.warning(
        'Validation Error',
        message
      ),
    previewReady: () =>
      notifications.success(
        'Preview Ready',
        'Your template preview has been generated.'
      ),
    exportComplete: (count: number) =>
      notifications.success(
        'Export Complete',
        `${count} template${count !== 1 ? 's' : ''} exported successfully.`
      ),
    importComplete: (imported: number, skipped: number) =>
      notifications.success(
        'Import Complete',
        `${imported} template${imported !== 1 ? 's' : ''} imported${skipped > 0 ? `, ${skipped} skipped` : ''}.`
      ),
    autoSaved: () =>
      notifications.info(
        'Auto-saved',
        'Your changes have been automatically saved.',
        { duration: 2000 }
      )
  };
};
