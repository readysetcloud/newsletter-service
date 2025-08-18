import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NotificationItem } from '../NotificationItem';
import type { Notification } from '../../../types';

const mockNotification: Notification = {
  id: 'test-1',
  type: 'info',
  title: 'Test Notification',
  message: 'This is a test message',
  timestamp: new Date().toISOString(),
  read: false,
};

describe('NotificationItem', () => {
  it('should render notification content correctly', () => {
    render(<NotificationItem notification={mockNotification} />);

    expect(screen.getByText('Test Notification')).toBeInTheDocument();
    expect(screen.getByText('This is a test message')).toBeInTheDocument();
  });

  it('should show unread indicator for unread notifications', () => {
    render(<NotificationItem notification={mockNotification} />);

    // Should show the blue dot for unread
    const unreadDot = document.querySelector('.bg-blue-500.rounded-full');
    expect(unreadDot).toBeInTheDocument();
  });

  it('should not show unread indicator for read notifications', () => {
    const readNotification = { ...mockNotification, read: true };
    render(<NotificationItem notification={readNotification} />);

    // Should not show the blue dot for read
    const unreadDot = document.querySelector('.bg-blue-500.rounded-full');
    expect(unreadDot).not.toBeInTheDocument();
  });

  it('should call onMarkAsRead when mark as read is clicked', () => {
    const handleMarkAsRead = vi.fn();
    render(
      <NotificationItem
        notification={mockNotification}
        onMarkAsRead={handleMarkAsRead}
      />
    );

    const markReadButton = screen.getByText('Mark read');
    fireEvent.click(markReadButton);

    expect(handleMarkAsRead).toHaveBeenCalledWith('test-1');
  });

  it('should call onRemove when remove button is clicked', () => {
    const handleRemove = vi.fn();
    render(
      <NotificationItem
        notification={mockNotification}
        onRemove={handleRemove}
      />
    );

    const removeButton = screen.getByTitle('Remove notification');
    fireEvent.click(removeButton);

    expect(handleRemove).toHaveBeenCalledWith('test-1');
  });

  it('should not show mark as read button for read notifications', () => {
    const readNotification = { ...mockNotification, read: true };
    render(<NotificationItem notification={readNotification} />);

    expect(screen.queryByText('Mark read')).not.toBeInTheDocument();
  });

  it('should show different icons for different notification types', () => {
    const successNotification = { ...mockNotification, type: 'success' as const };
    const { rerender } = render(<NotificationItem notification={successNotification} />);

    // Check for success styling
    expect(document.querySelector('.text-green-500')).toBeInTheDocument();

    const errorNotification = { ...mockNotification, type: 'error' as const };
    rerender(<NotificationItem notification={errorNotification} />);

    // Check for error styling
    expect(document.querySelector('.text-red-500')).toBeInTheDocument();
  });

  it('should show action URL indicator when actionUrl is provided', () => {
    const notificationWithAction = {
      ...mockNotification,
      actionUrl: 'https://example.com'
    };
    render(<NotificationItem notification={notificationWithAction} />);

    expect(screen.getByText('Click to view details →')).toBeInTheDocument();
  });

  it('should not show actions when showActions is false', () => {
    render(
      <NotificationItem
        notification={mockNotification}
        showActions={false}
      />
    );

    expect(screen.queryByText('Mark read')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Remove notification')).not.toBeInTheDocument();
  });
});
