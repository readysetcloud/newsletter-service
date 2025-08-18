import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { NotificationProvider, useNotifications } from '../NotificationContext';
import { AuthProvider } from '../AuthContext';

// Mock the notification service
vi.mock('../../services/notificationService', () => ({
  notificationService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    addMessageHandler: vi.fn(),
    removeMessageHandler: vi.fn(),
    getSubscriptionStatus: vi.fn().mockReturnValue(false),
  },
}));

// Mock AWS Amplify
vi.mock('aws-amplify/auth', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  getCurrentUser: vi.fn().mockResolvedValue(null),
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: {
      accessToken: { toString: () => 'mock-access-token' },
      idToken: { toString: () => 'mock-id-token' }
    }
  }),
}));

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Test component that uses the notification context
function TestComponent() {
  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    isSubscribed,
    addNotification,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAllNotifications,
  } = useNotifications();

  return (
    <div>
      <div data-testid="notification-count">{notifications.length}</div>
      <div data-testid="unread-count">{unreadCount}</div>
      <div data-testid="loading">{isLoading.toString()}</div>
      <div data-testid="error">{error || 'no-error'}</div>
      <div data-testid="subscribed">{isSubscribed.toString()}</div>

      <button
        onClick={() => addNotification({
          type: 'info',
          title: 'Test',
          message: 'Test message',
        })}
        data-testid="add-notification"
      >
        Add Notification
      </button>

      <button
        onClick={() => markAsRead('test-id')}
        data-testid="mark-read"
      >
        Mark Read
      </button>

      <button
        onClick={markAllAsRead}
        data-testid="mark-all-read"
      >
        Mark All Read
      </button>

      <button
        onClick={() => removeNotification('test-id')}
        data-testid="remove-notification"
      >
        Remove
      </button>

      <button
        onClick={clearAllNotifications}
        data-testid="clear-all"
      >
        Clear All
      </button>
    </div>
  );
}

function renderWithProviders(component: React.ReactElement) {
  return render(
    <AuthProvider>
      <NotificationProvider>
        {component}
      </NotificationProvider>
    </AuthProvider>
  );
}

describe('NotificationContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  it('should provide initial state', () => {
    renderWithProviders(<TestComponent />);

    expect(screen.getByTestId('notification-count')).toHaveTextContent('0');
    expect(screen.getByTestId('unread-count')).toHaveTextContent('0');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('error')).toHaveTextContent('no-error');
    expect(screen.getByTestId('subscribed')).toHaveTextContent('false');
  });

  it('should add notifications', async () => {
    renderWithProviders(<TestComponent />);

    const addButton = screen.getByTestId('add-notification');

    await act(async () => {
      addButton.click();
    });

    expect(screen.getByTestId('notification-count')).toHaveTextContent('1');
    expect(screen.getByTestId('unread-count')).toHaveTextContent('1');
  });

  it('should mark notifications as read', async () => {
    renderWithProviders(<TestComponent />);

    // Add a notification first
    const addButton = screen.getByTestId('add-notification');
    await act(async () => {
      addButton.click();
    });

    expect(screen.getByTestId('unread-count')).toHaveTextContent('1');

    // Mark all as read
    const markAllReadButton = screen.getByTestId('mark-all-read');
    await act(async () => {
      markAllReadButton.click();
    });

    expect(screen.getByTestId('unread-count')).toHaveTextContent('0');
  });

  it('should clear all notifications', async () => {
    renderWithProviders(<TestComponent />);

    // Add a notification first
    const addButton = screen.getByTestId('add-notification');
    await act(async () => {
      addButton.click();
    });

    expect(screen.getByTestId('notification-count')).toHaveTextContent('1');

    // Clear all notifications
    const clearAllButton = screen.getByTestId('clear-all');
    await act(async () => {
      clearAllButton.click();
    });

    expect(screen.getByTestId('notification-count')).toHaveTextContent('0');
    expect(screen.getByTestId('unread-count')).toHaveTextContent('0');
  });

  it('should load notifications from localStorage', () => {
    const storedNotifications = [
      {
        id: 'test-1',
        type: 'info' as const,
        title: 'Stored Notification',
        message: 'This was stored',
        timestamp: new Date().toISOString(),
        read: false,
      },
    ];

    localStorageMock.getItem.mockReturnValue(JSON.stringify(storedNotifications));

    renderWithProviders(<TestComponent />);

    expect(screen.getByTestId('notification-count')).toHaveTextContent('1');
    expect(screen.getByTestId('unread-count')).toHaveTextContent('1');
  });

  it('should handle localStorage errors gracefully', () => {
    localStorageMock.getItem.mockImplementation(() => {
      throw new Error('localStorage error');
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderWithProviders(<TestComponent />);

    expect(screen.getByTestId('notification-count')).toHaveTextContent('0');
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to load stored notifications:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it('should throw error when used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useNotifications must be used within a NotificationProvider');

    consoleSpy.mockRestore();
  });
});
