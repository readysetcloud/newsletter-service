import { useState, useEffect } from 'react';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import type { Notification } from '../../types';

interface NotificationToastProps {
  notification: Notification;
  onClose: (id: string) => void;
  autoClose?: boolean;
  autoCloseDelay?: number;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

/**
 * NotificationToast component displays a temporary notification overlay
 * with auto-close functionality and smooth animations
 */
export function NotificationToast({
  notification,
  onClose,
  autoClose = true,
  autoCloseDelay = 5000,
  position = 'top-right'
}: NotificationToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const { id, type, title, message, actionUrl } = notification;

  // Get styling based on notification type
  const getToastStyle = () => {
    switch (type) {
      case 'success':
        return {
          icon: CheckCircleIcon,
          iconColor: 'text-green-500',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
          titleColor: 'text-green-800',
          messageColor: 'text-green-700'
        };
      case 'error':
        return {
          icon: ExclamationCircleIcon,
          iconColor: 'text-red-500',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          titleColor: 'text-red-800',
          messageColor: 'text-red-700'
        };
      case 'warning':
        return {
          icon: ExclamationTriangleIcon,
          iconColor: 'text-yellow-500',
          bgColor: 'bg-yellow-50',
          borderColor: 'border-yellow-200',
          titleColor: 'text-yellow-800',
          messageColor: 'text-yellow-700'
        };
      case 'info':
      default:
        return {
          icon: InformationCircleIcon,
          iconColor: 'text-blue-500',
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-200',
          titleColor: 'text-blue-800',
          messageColor: 'text-blue-700'
        };
    }
  };

  // Get position classes
  const getPositionClasses = () => {
    switch (position) {
      case 'top-left':
        return 'top-4 left-4';
      case 'bottom-right':
        return 'bottom-4 right-4';
      case 'bottom-left':
        return 'bottom-4 left-4';
      case 'top-right':
      default:
        return 'top-4 right-4';
    }
  };

  const style = getToastStyle();
  const Icon = style.icon;
  const positionClasses = getPositionClasses();

  // Handle entrance animation
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Handle auto-close
  useEffect(() => {
    if (autoClose) {
      const timer = setTimeout(() => {
        handleClose();
      }, autoCloseDelay);

      return () => clearTimeout(timer);
    }
  }, [autoClose, autoCloseDelay]);

  // Handle close with exit animation
  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose(id);
    }, 300); // Match animation duration
  };

  // Handle action click
  const handleActionClick = () => {
    if (actionUrl) {
      window.open(actionUrl, '_blank');
    }
    handleClose();
  };

  return (
    <div
      className={`fixed ${positionClasses} z-50 max-w-sm w-full transform transition-all duration-300 ease-in-out ${
        isVisible && !isExiting
          ? 'translate-x-0 opacity-100 scale-100'
          : position.includes('right')
          ? 'translate-x-full opacity-0 scale-95'
          : '-translate-x-full opacity-0 scale-95'
      }`}
    >
      <div
        className={`${style.bgColor} ${style.borderColor} border rounded-lg shadow-lg p-4 relative overflow-hidden`}
      >
        {/* Progress bar for auto-close */}
        {autoClose && (
          <div className="absolute top-0 left-0 h-1 bg-gray-200 w-full">
            <div
              className="h-full bg-gray-400 transition-all ease-linear"
              style={{
                width: '100%',
                animation: `shrink ${autoCloseDelay}ms linear forwards`
              }}
            />
          </div>
        )}

        <div className="flex items-start space-x-3">
          {/* Icon */}
          <div className="flex-shrink-0">
            <Icon className={`w-6 h-6 ${style.iconColor}`} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <h4 className={`text-sm font-medium ${style.titleColor}`}>
              {title}
            </h4>
            <p className={`text-sm ${style.messageColor} mt-1`}>
              {message}
            </p>

            {/* Action button */}
            {actionUrl && (
              <button
                onClick={handleActionClick}
                className={`text-sm ${style.titleColor} hover:underline mt-2 font-medium`}
              >
                View Details →
              </button>
            )}
          </div>

          {/* Close button */}
          <button
            onClick={handleClose}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * NotificationToastContainer manages multiple toast notifications
 */
interface NotificationToastContainerProps {
  notifications: Notification[];
  onClose: (id: string) => void;
  maxToasts?: number;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

export function NotificationToastContainer({
  notifications,
  onClose,
  maxToasts = 5,
  position = 'top-right'
}: NotificationToastContainerProps) {
  // Show only the most recent notifications
  const visibleNotifications = notifications.slice(0, maxToasts);

  return (
    <>
      {visibleNotifications.map((notification, index) => (
        <div
          key={notification.id}
          style={{
            zIndex: 50 - index, // Stack toasts properly
            transform: position.includes('top')
              ? `translateY(${index * 80}px)`
              : `translateY(${-index * 80}px)`
          }}
        >
          <NotificationToast
            notification={notification}
            onClose={onClose}
            position={position}
          />
        </div>
      ))}
    </>
  );
}

// Add CSS animation for progress bar
const style = document.createElement('style');
style.textContent = `
  @keyframes shrink {
    from { width: 100%; }
    to { width: 0%; }
  }

  @keyframes fade-in {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }

  .animate-fade-in {
    animation: fade-in 0.3s ease-out;
  }
`;
document.head.appendChild(style);
