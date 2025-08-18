import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRealTimeNotificationHandlers, NotificationFeedback } from '../RealTimeNotificationHandler';
import { useNotifications } from '../../../hooks/useNotifications';
import { useAuth } from '../../../contexts/AuthContext';

// Mock the hooks
vi.mock('../../../hooks/useNotifications');
vi.mock('../../../contexts/AuthContext');

const mockUseNotifications = vi.mocked(useNotifications);
const mockUseAuth = vi.mocked(useAuth);

describe('RealTimeNotificationHandler', () => {
  const mockShowSuccess = vi.fn();
  const mockShowInfo = vi.fn();
  const mockShowWarning = vi.fn();
  const mockShowError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockUseNotifications.mockReturnValue({
      notifications: [],
      unreadCount: 0,
      isLoading: false,
      error: null,
      isSubscribed: false,
      showSuccess: mockShowSuccess,
      showInfo: mockShowInfo,
      showWarning: mockShowWarning,
      showError: mockShowError,
      addNotification: vi.fn(),
      markAsRead: vi.fn(),
      markAllAsRead: vi.fn(),
      removeNotification: vi.fn(),
      clearAllNotifications: vi.fn(),
      getRecentNotifications: vi.fn(),
      getUnreadNotifications: vi.fn(),
      hasUnreadNotifications: vi.fn(),
      getNotificationsByType: vi.fn()
    });

    mockUseAuth.mockReturnValue({
      user: {
        userId: 'test-user',
        email: 'test@example.com',
        emailVerified: true,
        tenantId: 'test-tenant'
      },
      isAuthenticated: true,
      isLoading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      getToken: vi.fn(),
      refreshUser: vi.fn(),
      clearError: vi.fn()
    });
  });

  describe('useRealTimeNotificationHandlers', () => {
    it('should handle issue notifications correctly', () => {
      const TestComponent = () => {
        const { handleIssueNotification } = useRealTimeNotificationHandlers();

        // Simulate issue published notification
        handleIssueNotification({
          type: 'ISSUE_PUBLISHED',
          issueId: 'issue-123',
          title: 'Weekly Newsletter',
          publishedAt: '2024-01-15T10:00:00Z',
          subscriberCount: 100
        });

        return <div>Test</div>;
      };

      render(<TestComponent />);

      expect(mockShowSuccess).toHaveBeenCalledWith(
        'Newsletter Published!',
        '"Weekly Newsletter" has been sent to 100 subscribers.',
        '/dashboard/issues/issue-123'
      );
    });

    it('should handle subscriber notifications correctly', () => {
      const TestComponent = () => {
        const { handleSubscriberNotification } = useRealTimeNotificationHandlers();

        // Simulate subscriber added notification
        handleSubscriberNotification({
          type: 'SUBSCRIBER_ADDED',
          email: 'new@example.com',
          totalCount: 101
        });

        return <div>Test</div>;
      };

      render(<TestComponent />);

      expect(mockShowSuccess).toHaveBeenCalledWith(
        'New Subscriber!',
        'new@example.com has subscribed to your newsletter. Total: 101',
        '/dashboard/subscribers'
      );
    });

    it('should handle brand notifications correctly', () => {
      const TestComponent = () => {
        const { handleBrandNotification } = useRealTimeNotificationHandlers();

        // Simulate brand updated notification
        handleBrandNotification({
          type: 'BRAND_UPDATED',
          changes: ['logo', 'colors', 'name']
        });

        return <div>Test</div>;
      };

      render(<TestComponent />);

      expect(mockShowInfo).toHaveBeenCalledWith(
        'Brand Settings Updated',
        'Updated: logo, colors, name',
        '/dashboard/brand'
      );
    });

    it('should handle system notifications correctly', () => {
      const TestComponent = () => {
        const { handleSystemNotification } = useRealTimeNotificationHandlers();

        // Simulate system error notification
        handleSystemNotification({
          type: 'SYSTEM_ALERT',
          level: 'error',
          message: 'Service temporarily unavailable',
          actionUrl: '/status'
        });

        return <div>Test</div>;
      };

      render(<TestComponent />);

      expect(mockShowError).toHaveBeenCalledWith(
        'System Alert',
        'Service temporarily unavailable',
        '/status'
      );
    });
  });

  describe('NotificationFeedback', () => {
    it('should show loading state', () => {
      mockUseNotifications.mockReturnValue({
        ...mockUseNotifications(),
        isLoading: true
      });

      render(<NotificationFeedback />);

      expect(screen.getByText('Connecting to real-time updates...')).toBeInTheDocument();
    });

    it('should show error state', () => {
      mockUseNotifications.mockReturnValue({
        ...mockUseNotifications(),
        error: 'Connection failed'
      });

      render(<NotificationFeedback />);

      expect(screen.getByText('Real-time updates unavailable')).toBeInTheDocument();
    });

    it('should show connected state', () => {
      mockUseNotifications.mockReturnValue({
        ...mockUseNotifications(),
        isSubscribed: true
      });

      render(<NotificationFeedback />);

      expect(screen.getByText('Real-time updates active')).toBeInTheDocument();
    });

    it('should not render when not subscribed and no error', () => {
      mockUseNotifications.mockReturnValue({
        ...mockUseNotifications(),
        isSubscribed: false,
        error: null,
        isLoading: false
      });

      const { container } = render(<NotificationFeedback />);

      expect(container.firstChild).toBeNull();
    });
  });
});
