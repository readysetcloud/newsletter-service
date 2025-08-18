import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { FallbackUI } from '../ErrorNotificationHandler';
import { useNotifications } from '../../../hooks/useNotifications';
import { useAuth } from '../../../contexts/AuthContext';

// Mock dependencies
vi.mock('../../../hooks/useNotifications');
vi.mock('../../../contexts/AuthContext');

const mockUseNotifications = vi.mocked(useNotifications);
const mockUseAuth = vi.mocked(useAuth);

describe('Error Notification Components - Basic Tests', () => {
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
  });

  it('should render FallbackUI when real-time features are unavailable', () => {
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

  it('should not render FallbackUI when real-time features are available', () => {
    mockUseNotifications.mockReturnValue({
      ...mockUseNotifications(),
      isSubscribed: true,
      error: null
    });

    const { container } = render(
      <FallbackUI
        feature="Dashboard updates"
        showRetry={true}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('should show different severity levels correctly', () => {
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

  it('should display custom messages', () => {
    render(
      <FallbackUI
        feature="Test Feature"
        customMessage="Custom error message for testing"
        severity="medium"
      />
    );

    expect(screen.getByText('Custom error message for testing')).toBeInTheDocument();
  });

  it('should show fallback suggestions', () => {
    render(
      <FallbackUI
        feature="Test Feature"
        showRetry={true}
      />
    );

    expect(screen.getByText('While offline:')).toBeInTheDocument();
    expect(screen.getByText('Data may not update automatically')).toBeInTheDocument();
    expect(screen.getByText('Manual refresh may be needed to see changes')).toBeInTheDocument();
  });
});
