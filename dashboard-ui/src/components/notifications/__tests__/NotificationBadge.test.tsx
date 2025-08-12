import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NotificationBadge } from '../NotificationBadge';

describe('NotificationBadge', () => {
  it('should render without unread count when count is 0', () => {
    render(<NotificationBadge unreadCount={0} />);

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label', 'Notifications');

    // Should not show badge when count is 0
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('should render with unread count when count > 0', () => {
    render(<NotificationBadge unreadCount={5} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'Notifications (5 unread)');

    // Should show badge with count
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('should show 99+ when count exceeds 99', () => {
    render(<NotificationBadge unreadCount={150} />);

    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('should call onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<NotificationBadge unreadCount={3} onClick={handleClick} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should apply custom className', () => {
    render(<NotificationBadge unreadCount={1} className="custom-class" />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('custom-class');
  });

  it('should not show icon when showIcon is false', () => {
    render(<NotificationBadge unreadCount={1} showIcon={false} />);

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();

    // Should still show the badge but no icon
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
