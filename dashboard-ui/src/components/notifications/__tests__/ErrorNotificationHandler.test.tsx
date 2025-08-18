import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ErrorNotificationHandler, FallbackUI, useErrorNotificationHandling } from '../ErrorNotificationHandler';
import { SystemErrorHandler, useSystemErrorHandling } from '../SystemErrorHandler';
import ErrorNotificationManager, { useErrorNotificationManager } from '../ErrorNotificationManager';
import { useNotifications } from '../../../hooks/useNotifications';
import { useAuth } from '../../../contexts/AuthContext';
import { notificationService } from '../../../services/notificationService';

// Mock dependencies
vi.mock('../../../hooks/useNotifications');
vi.mock('../../../contexts/AuthContext');
vi.mock('../../../services/notificationService');

const mockUseNotifications = vi.mocked(useNotifications);
const mockUseAuth = vi.mocked(useAuth);
const mockNotificationService = vi.mocked(notificationService);

describe('ErrorNotificationHandler', () => {
  const mockShowError = vi.fn();
  const mockShowWarning = vi.fn();
  const mockShowInfo = vi.fn();
  const mockAddNotification = vi.fn();

  beforeEach(() => {
    mockUseNotifications.mockReturnValue({
      showError: mockShowError,
      showWarning: mockShowWarning,
      showInfo: mockShowInfo,
      addNotification: mockAddNotification,
      isSubscribed: false,
      error: 'Connection failed',
      isLoading: false,
      notifications: [],
      unreadCount: 0,
      markAsRead: vi.fn(),
      markAllAsRead: vi.fn(),
      removeNotification: vi.fn(),
      clearAllNotifications: vi.fn()
    });

    mockUseAuth.mockReturnValue({
      user: {
        userId: 'test-user',
        email: 'test@example.com',
        tenantId: 'test-tenant'
      },
      isAuthenticated: true,
      isLoading: false,
      error: null,
      getToken: vi.fn()
    });

    mockNotificationService.refreshToken = vi.fn().mockResolvedValue(undefined);
    mockNotificationService.getConnectionStatus = vi.fn().mockReturnValue({
      isSubscribed: false,
      isTokenExpired: false,
      reconnectAttempts: 0,
      tenantId: 'test-tenant'
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ErrorNotificationHandler Component', () => {
    it('should handle connection errors', async () => {
      render(<ErrorNotificationHandler />);

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(
          'Connection Lost',
          'Real-time notifications are temporarily unavailable. Some features may not work as expected.',
          undefined
        );
      });
    });

    it('should attempt automatic retry with exponential backoff', async () => {
      vi.useFakeTimers();

      render(<ErrorNotificationHandler />);

      // Wait for initial error handling
      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalled();
      });

      // Fast-forward to trigger retry
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(mockNotificationService.refreshToken).toHaveBeenCalled();
      });

      vi.useRealTimers();
    });

    it('should stop retrying after max attempts', async () => {
      vi.useFakeTimers();

      // Mock refresh token to fail
      mockNotificationService.refreshToken = vi.fn().mockRejectedValue(new Error('Connection failed'));

      render(<ErrorNotificationHandler />);

      // Fast-forward through multiple retry attempts
      for (let i = 0; i < 4; i++) {
        act(() => {
          vi.advanceTimersByTime(10000);
        });
        await waitFor(() => {});
      }

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(
          'Connection Failed',
          'Unable to restore real-time notifications. Please refresh the page.',
          undefined
        );
      });

      vi.useRealTimers();
    });
  });

  describe('FallbackUI Component', () => {
    it('should render fallback UI when real-time features are unavailable', () => {
      const mockOnRetry = vi.fn().mockResolvedValue({ success: true });

      render(
        <FallbackUI
          feature="Dashboard updates"
          onRetry={mockOnRetry}
          showRetry={true}
          severity="medium"
        />
      );

      expect(screen.getByText('Limited Functionality')).toBeInTheDocument();
      expect(screen.getByText(/Dashboard updates may not update automatically/)).toBeInTheDocument();
      expect(screen.getByText('Retry Connection')).toBeInTheDocument();
    });

    it('should handle retry button click', async () => {
      const mockOnRetry = vi.fn().mockResolvedValue({ success: true });

      render(
        <FallbackUI
          feature="Dashboard updates"
          onRetry={mockOnRetry}
          showRetry={true}
        />
      );

      const retryButton = screen.getByText('Retry Connection');
      fireEvent.click(retryButton);

      await waitFor(() => {
        expect(mockOnRetry).toHaveBeenCalled();
      });
    });

    it('should not render when real-time features are available', () => {
      mockUseNotifications.mockReturnValue({
        ...mockUseNotifications(),
        isSubscribed: true,
        error: null
      });

      const { container } = render(
        <FallbackUI
          feature="Dashboard updates"
          onRetry={vi.fn()}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should show different severity styles', () => {
      const { rerender } = render(
        <FallbackUI
          feature="Test"
          severity="high"
        />
      );

      expect(screen.getByText('Service Unavailable')).toBeInTheDocument();

      rerender(
        <FallbackUI
          feature="Test"
          severity="low"
        />
      );

      expect(screen.getByText('Limited Functionality')).toBeInTheDocument();
    });

    it('should allow dismissing the fallback UI', () => {
      render(
        <FallbackUI
          feature="Test"
          showRetry={true}
        />
      );

      const dismissButton = screen.getByTitle('Dismiss this notice');
      fireEvent.click(dismissButton);

      expect(screen.queryByText('Limited Functionality')).not.toBeInTheDocument();
    });
  });

  describe('useErrorNotificationHandling Hook', () => {
    it('should provide error handling utilities', () => {
      const TestComponent = () => {
        const {
          isRealTimeAvailable,
          retryConnection,
          showConnectionError
        } = useErrorNotificationHandling();

        return (
          <div>
            <span data-testid="realtime-status">
              {isRealTimeAvailable ? 'Available' : 'Unavailable'}
            </span>
            <button onClick={() => retryConnection()}>Retry</button>
            <button onClick={() => showConnectionError('Test error')}>Show Error</button>
          </div>
        );
      };

      render(<TestComponent />);

      expect(screen.getByTestId('realtime-status')).toHaveTextContent('Unavailable');
      expect(screen.getByText('Retry')).toBeInTheDocument();
      expect(screen.getByText('Show Error')).toBeInTheDocument();
    });
  });

  describe('SystemErrorHandler', () => {
    it('should handle system error notifications', async () => {
      vi.useFakeTimers();

      render(<SystemErrorHandler />);

      // Fast-forward to trigger health check
      act(() => {
        vi.advanceTimersByTime(30000);
      });

      await waitFor(() => {
        // Should perform health checks
        expect(mockNotificationService.getConnectionStatus).toHaveBeenCalled();
      });

      vi.useRealTimers();
    });
  });

  describe('ErrorNotificationManager', () => {
    it('should render system status banner and connection status', () => {
      render(
        <ErrorNotificationManager showSystemBanner={true} showConnectionStatus={true}>
          <div>Test Content</div>
        </ErrorNotificationManager>
      );

      expect(screen.getByText('Test Content')).toBeInTheDocument();
      expect(screen.getByText('Limited functionality')).toBeInTheDocument();
    });

    it('should handle global errors', async () => {
      const { container } = render(
        <ErrorNotificationManager>
          <div>Test Content</div>
        </ErrorNotificationManager>
      );

      // Simulate a global error
      const errorEvent = new ErrorEvent('error', {
        message: 'Test error',
        filename: 'test.js',
        lineno: 1,
        colno: 1,
        error: new Error('Test error')
      });

      act(() => {
        window.dispatchEvent(errorEvent);
      });

      await waitFor(() => {
        expect(mockShowWarning).toHaveBeenCalled();
      });
    });

    it('should handle unhandled promise rejections', async () => {
      render(
        <ErrorNotificationManager>
          <div>Test Content</div>
        </ErrorNotificationManager>
      );

      // Simulate an unhandled promise rejection
      const rejectionEvent = new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.reject(new Error('Test rejection')),
        reason: new Error('Test rejection')
      });

      act(() => {
        window.dispatchEvent(rejectionEvent);
      });

      await waitFor(() => {
        expect(mockShowWarning).toHaveBeenCalled();
      });
    });
  });

  describe('useErrorNotificationManager Hook', () => {
    it('should provide error management utilities', () => {
      const TestComponent = () => {
        const {
          showRetryableError,
          dismissToast,
          activeToasts
        } = useErrorNotificationManager();

        return (
          <div>
            <button
              onClick={() => showRetryableError(
                'Test Error',
                'Test message',
                async () => { console.log('retry'); }
              )}
            >
              Show Error
            </button>
            <span data-testid="toast-count">{activeToasts.length}</span>
          </div>
        );
      };

      render(<TestComponent />);

      const showErrorButton = screen.getByText('Show Error');
      fireEvent.click(showErrorButton);

      expect(screen.getByTestId('toast-count')).toHaveTextContent('1');
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete error flow with retry', async () => {
      vi.useFakeTimers();

      const TestApp = () => (
        <ErrorNotificationManager enableAutoRetry={true}>
          <FallbackUI
            feature="Test Feature"
            onRetry={async () => ({ success: true })}
            showRetry={true}
          />
        </ErrorNotificationManager>
      );

      render(<TestApp />);

      // Should show fallback UI
      expect(screen.getByText('Limited Functionality')).toBeInTheDocument();

      // Click retry button
      const retryButton = screen.getByText('Retry Connection');
      fireEvent.click(retryButton);

      // Fast-forward for auto-retry
      act(() => {
        vi.advanceTimersByTime(30000);
      });

      await waitFor(() => {
        expect(mockNotificationService.refreshToken).toHaveBeenCalled();
      });

      vi.useRealTimers();
    });

    it('should handle authentication errors correctly', async () => {
      mockNotificationService.refreshToken = vi.fn().mockRejectedValue(
        new Error('authentication required')
      );

      render(<ErrorNotificationHandler />);

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(
          expect.stringContaining('Authentication'),
          expect.any(String),
          '/auth/signin'
        );
      });
    });
  });
});

describe('Error Notification Accessibility', () => {
  beforeEach(() => {
    mockUseNotifications.mockReturnValue({
      showError: vi.fn(),
      showWarning: vi.fn(),
      showInfo: vi.fn(),
      addNotification: vi.fn(),
      isSubscribed: false,
      error: 'Connection failed',
      isLoading: false,
      notifications: [],
      unreadCount: 0,
      markAsRead: vi.fn(),
      markAllAsRead: vi.fn(),
      removeNotification: vi.fn(),
      clearAllNotifications: vi.fn()
    });

    mockUseAuth.mockReturnValue({
      user: { userId: 'test', email: 'test@example.com', tenantId: 'test' },
      isAuthenticated: true,
      isLoading: false,
      error: null,
      getToken: vi.fn()
    });
  });

  it('should have proper ARIA labels and roles', () => {
    render(
      <FallbackUI
        feature="Test Feature"
        onRetry={vi.fn()}
        showRetry={true}
      />
    );

    const retryButton = screen.getByText('Retry Connection');
    expect(retryButton).toHaveAttribute('type', 'button');

    const dismissButton = screen.getByTitle('Dismiss this notice');
    expect(dismissButton).toBeInTheDocument();
  });

  it('should support keyboard navigation', () => {
    render(
      <FallbackUI
        feature="Test Feature"
        onRetry={vi.fn()}
        showRetry={true}
      />
    );

    const retryButton = screen.getByText('Retry Connection');
    retryButton.focus();
    expect(document.activeElement).toBe(retryButton);
  });

  it('should provide screen reader friendly content', () => {
    render(
      <FallbackUI
        feature="Dashboard updates"
        onRetry={vi.fn()}
        severity="high"
        customMessage="Custom error message"
      />
    );

    expect(screen.getByText('Service Unavailable')).toBeInTheDocument();
    expect(screen.getByText('Custom error message')).toBeInTheDocument();
  });
});
