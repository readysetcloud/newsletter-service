import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import type { Notification } from '../types';
import { notificationService } from '../services/notificationService';
import { useAuth } from './AuthContext';

// Notification Context Types
interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (notificationId: string) => void;
  markAllAsRead: () => void;
  removeNotification: (notificationId: string) => void;
  clearAllNotifications: () => void;
  isSubscribed: boolean;
}

// Notification State
interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  isSubscribed: boolean;
}

// Notification Actions
type NotificationAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_SUBSCRIBED'; payload: boolean }
  | { type: 'ADD_NOTIFICATION'; payload: Notification }
  | { type: 'MARK_AS_READ'; payload: string }
  | { type: 'MARK_ALL_AS_READ' }
  | { type: 'REMOVE_NOTIFICATION'; payload: string }
  | { type: 'CLEAR_ALL_NOTIFICATIONS' }
  | { type: 'LOAD_NOTIFICATIONS'; payload: Notification[] }
  | { type: 'UPDATE_UNREAD_COUNT' };

// Initial state
const initialState: NotificationState = {
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  error: null,
  isSubscribed: false,
};

// Notification reducer
function notificationReducer(state: NotificationState, action: NotificationAction): NotificationState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };

    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };

    case 'SET_SUBSCRIBED':
      return { ...state, isSubscribed: action.payload };

    case 'ADD_NOTIFICATION': {
      const newNotifications = [action.payload, ...state.notifications];
      const unreadCount = newNotifications.filter(n => !n.read).length;
      return {
        ...state,
        notifications: newNotifications,
        unreadCount,
      };
    }

    case 'MARK_AS_READ': {
      const updatedNotifications = state.notifications.map(notification =>
        notification.id === action.payload
          ? { ...notification, read: true }
          : notification
      );
      const unreadCount = updatedNotifications.filter(n => !n.read).length;
      return {
        ...state,
        notifications: updatedNotifications,
        unreadCount,
      };
    }

    case 'MARK_ALL_AS_READ': {
      const updatedNotifications = state.notifications.map(notification => ({
        ...notification,
        read: true,
      }));
      return {
        ...state,
        notifications: updatedNotifications,
        unreadCount: 0,
      };
    }

    case 'REMOVE_NOTIFICATION': {
      const filteredNotifications = state.notifications.filter(
        notification => notification.id !== action.payload
      );
      const unreadCount = filteredNotifications.filter(n => !n.read).length;
      return {
        ...state,
        notifications: filteredNotifications,
        unreadCount,
      };
    }

    case 'CLEAR_ALL_NOTIFICATIONS':
      return {
        ...state,
        notifications: [],
        unreadCount: 0,
      };

    case 'LOAD_NOTIFICATIONS': {
      const unreadCount = action.payload.filter(n => !n.read).length;
      return {
        ...state,
        notifications: action.payload,
        unreadCount,
      };
    }

    case 'UPDATE_UNREAD_COUNT': {
      const unreadCount = state.notifications.filter(n => !n.read).length;
      return { ...state, unreadCount };
    }

    default:
      return state;
  }
}

// Local storage key for notifications
const NOTIFICATIONS_STORAGE_KEY = 'newsletter-notifications';

// Create context
const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// NotificationProvider component
interface NotificationProviderProps {
  children: React.ReactNode;
}

export function NotificationProvider({ children }: NotificationProviderProps) {
  const [state, dispatch] = useReducer(notificationReducer, initialState);
  const { user, isAuthenticated, getToken } = useAuth();

  // Load notifications from local storage on mount
  useEffect(() => {
    const loadStoredNotifications = () => {
      try {
        const stored = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
        if (stored) {
          const notifications: Notification[] = JSON.parse(stored);
          dispatch({ type: 'LOAD_NOTIFICATIONS', payload: notifications });
        }
      } catch (error) {
        console.error('Failed to load stored notifications:', error);
      }
    };

    loadStoredNotifications();
  }, []);

  // Save notifications to local storage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(state.notifications));
    } catch (error) {
      console.error('Failed to save notifications to storage:', error);
    }
  }, [state.notifications]);

  // Handle incoming notifications from Momento
  const handleIncomingNotification = useCallback((notification: Notification) => {
    dispatch({ type: 'ADD_NOTIFICATION', payload: notification });
  }, []);

  // Subscribe to notifications when user is authenticated
  useEffect(() => {
    const subscribeToNotifications = async () => {
      if (!isAuthenticated || !user?.userId) {
        return;
      }

      try {
        dispatch({ type: 'SET_LOADING', payload: true });
        dispatch({ type: 'SET_ERROR', payload: null });

        // Get auth token for Momento
        const authToken = await getToken();

        // Initialize notification service
        await notificationService.initialize({
          authToken,
          cacheName: 'newsletter-notifications',
          topicName: 'user-notifications',
        });

        // Add message handler
        notificationService.addMessageHandler(handleIncomingNotification);

        // Subscribe to user-specific topic
        await notificationService.subscribe(user.userId);

        dispatch({ type: 'SET_SUBSCRIBED', payload: true });
        dispatch({ type: 'SET_LOADING', payload: false });

        console.log('Successfully subscribed to notifications');
      } catch (error) {
        console.error('Failed to subscribe to notifications:', error);
        dispatch({ type: 'SET_ERROR', payload: 'Failed to connect to notifications' });
        dispatch({ type: 'SET_SUBSCRIBED', payload: false });
      }
    };

    subscribeToNotifications();

    // Cleanup on unmount or when user changes
    return () => {
      if (state.isSubscribed) {
        notificationService.removeMessageHandler(handleIncomingNotification);
        notificationService.unsubscribe();
        dispatch({ type: 'SET_SUBSCRIBED', payload: false });
      }
    };
  }, [isAuthenticated, user?.userId, getToken, handleIncomingNotification]);

  // Context value functions
  const addNotification = useCallback((notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    const newNotification: Notification = {
      ...notification,
      id: `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      read: false,
    };
    dispatch({ type: 'ADD_NOTIFICATION', payload: newNotification });
  }, []);

  const markAsRead = useCallback((notificationId: string) => {
    dispatch({ type: 'MARK_AS_READ', payload: notificationId });
  }, []);

  const markAllAsRead = useCallback(() => {
    dispatch({ type: 'MARK_ALL_AS_READ' });
  }, []);

  const removeNotification = useCallback((notificationId: string) => {
    dispatch({ type: 'REMOVE_NOTIFICATION', payload: notificationId });
  }, []);

  const clearAllNotifications = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL_NOTIFICATIONS' });
  }, []);

  const contextValue: NotificationContextType = {
    notifications: state.notifications,
    unreadCount: state.unreadCount,
    isLoading: state.isLoading,
    error: state.error,
    isSubscribed: state.isSubscribed,
    addNotification,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAllNotifications,
  };

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  );
}

// Custom hook to use notification context
export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
