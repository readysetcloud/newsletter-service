import { useState } from 'react';
import { NotificationBadge } from './NotificationBadge';
import { NotificationPanel } from './NotificationPanel';
import { useNotifications } from '../../hooks/useNotifications';

interface NotificationDropdownProps {
  className?: string;
}

/**
 * NotificationDropdown component combines the badge and panel
 * for a complete notification UI experience
 */
export function NotificationDropdown({ className = '' }: NotificationDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { unreadCount } = useNotifications();

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <NotificationBadge
        unreadCount={unreadCount}
        onClick={handleToggle}
        className={isOpen ? 'bg-gray-50 text-gray-700' : ''}
      />

      <NotificationPanel
        isOpen={isOpen}
        onClose={handleClose}
      />
    </div>
  );
}
