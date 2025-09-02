import { useState, useEffect } from 'react';
import { useNotifications } from '../../hooks/useNotifications';
import { useAuth } from '../../contexts/AuthContext';
import { notificationService } from '../../services/notificationService';
import {
  WifiIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

interface NotificationStatusProps {
  showDetails?: boolean;
  showRetryButton?: boolean;
  className?: string;
}

/**
 * Comprehensive notification status component that shows connection state,
 * error information, and provides retry functionality
 */
export function NotificationStatus({
  showDetails = false,
  showRetryButton = true,
  className = ''
}: NotificationStatusProps) {
  const { isSubscribed, error, isLoading } = useNotifications();
  const { user, isAuthenticated } = useAuth();
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [lastRetryTime, setLastRetryTime] = useState<Date | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Get connection status details
  const getConnectionStatus = () => {
    if (!isAuthenticated) {
      return {
        status: 'unauthenticated',
        icon: XMarkIcon,
        color: 'gray',
        title: 'Not Signed In',
        message: 'Sign in to receive real-time notifications',
        canRetry: false
      };
    }

    if (isLoading) {
      return {
        status: 'connecting',
        icon: ArrowPathIcon,
        color: 'blue',
        title: 'Connecting',
        message: 'Establishing connection to notification service...',
        canRetry: false
      };
    }

    if (error) {
      return {
        status: 'error',
        icon: ExclamationTriangleIcon,
        color: 'red',
        title: 'Connection Failed',
        message: 'Real-time notifications are unavailable',
        canRetry: true
      };
    }

    if (isSubscribed) {
      return {
        status: 'connected',
        icon: CheckCircleIcon,
        color: 'green',
        title: 'Connected',
        message: 'Real-time notifications are active',
        canRetry: false
      };
    }

    return {
      status: 'disconnected',
      icon: WifiIcon,
      color: 'gray',
      title: 'Disconnected',
      message: 'Not connected to real-time notifications',
      canRetry: true
    };
  };

  const connectionStatus = getConnectionStatus();
  const Icon = connectionStatus.icon;

  // Handle retry connection
  const handleRetry = async () => {
    if (!user || isRetrying) return;

    setIsRetrying(true);
    setRetryCount(prev => prev + 1);
    setLastRetryTime(new Date());

    try {
      // Get fresh JWT token
      const { fetchAuthSession } = await import('aws-amplify/auth');
      const session = await fetchAuthSession();
      const jwtToken = session.tokens?.idToken?.toString();

      if (jwtToken) {
        await notificationService.refreshToken(jwtToken);
      }
    } catch (error) {
      console.error('Retry failed:', error);
    } finally {
      setIsRetrying(false);
    }
  };

  // Auto-retry logic
  useEffect(() => {
    if (error && retryCount < 3 && !isRetrying) {
      const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 10000);
      const timer = setTimeout(handleRetry, retryDelay);
      return () => clearTimeout(timer);
    }
  }, [error, retryCount, isRetrying]);

  // Reset retry count when connection is restored
  useEffect(() => {
    if (isSubscribed) {
      setRetryCount(0);
    }
  }, [isSubscribed]);

  const getColorClasses = (color: string) => {
    const colorMap = {
      green: {
        bg: 'bg-green-50',
        border: 'border-green-200',
        text: 'text-green-800',
        icon: 'text-green-500',
        button: 'bg-green-100 hover:bg-green-200 text-green-800'
      },
      red: {
        bg: 'bg-red-50',
        border: 'border-red-200',
        text: 'text-red-800',
        icon: 'text-red-500',
        button: 'bg-red-100 hover:bg-red-200 text-red-800'
      },
      blue: {
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        text: 'text-blue-800',
        icon: 'text-blue-500',
        button: 'bg-blue-100 hover:bg-blue-200 text-blue-800'
      },
      gray: {
        bg: 'bg-gray-50',
        border: 'border-gray-200',
        text: 'text-gray-800',
        icon: 'text-gray-500',
        button: 'bg-gray-100 hover:bg-gray-200 text-gray-800'
      }
    };
    return colorMap[color as keyof typeof colorMap] || colorMap.gray;
  };

  const colors = getColorClasses(connectionStatus.color);

  return (
    <div className={`${colors.bg} ${colors.border} border rounded-lg p-3 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Icon
            className={`w-4 h-4 ${colors.icon} ${
              connectionStatus.status === 'connecting' || isRetrying ? 'animate-spin' : ''
            }`}
          />
          <span className={`text-sm font-medium ${colors.text}`}>
            {connectionStatus.title}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {showRetryButton && connectionStatus.canRetry && (
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className={`px-2 py-1 text-xs font-medium rounded ${colors.button} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isRetrying ? 'Retrying...' : 'Retry'}
            </button>
          )}

          {showDetails && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={`text-xs ${colors.text} hover:underline`}
            >
              {isExpanded ? 'Less' : 'Details'}
            </button>
          )}
        </div>
      </div>

      <p className={`text-xs ${colors.text} mt-1 opacity-75`}>
        {connectionStatus.message}
      </p>

      {/* Expanded details */}
      {showDetails && isExpanded && (
        <div className={`mt-3 pt-3 border-t ${colors.border} space-y-2`}>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className={`font-medium ${colors.text}`}>Status:</span>
              <span className={`ml-1 ${colors.text} opacity-75`}>
                {connectionStatus.status}
              </span>
            </div>
            <div>
              <span className={`font-medium ${colors.text}`}>User:</span>
              <span className={`ml-1 ${colors.text} opacity-75`}>
                {user?.email || 'Not signed in'}
              </span>
            </div>
            <div>
              <span className={`font-medium ${colors.text}`}>Tenant:</span>
              <span className={`ml-1 ${colors.text} opacity-75`}>
                {user?.tenantId || 'None'}
              </span>
            </div>
            <div>
              <span className={`font-medium ${colors.text}`}>Retries:</span>
              <span className={`ml-1 ${colors.text} opacity-75`}>
                {retryCount}
              </span>
            </div>
          </div>

          {lastRetryTime && (
            <div className="text-xs">
              <span className={`font-medium ${colors.text}`}>Last Retry:</span>
              <span className={`ml-1 ${colors.text} opacity-75`}>
                {lastRetryTime.toLocaleTimeString()}
              </span>
            </div>
          )}

          {error && (
            <div className="text-xs">
              <span className={`font-medium ${colors.text}`}>Error:</span>
              <span className={`ml-1 ${colors.text} opacity-75`}>
                {error}
              </span>
            </div>
          )}

          {/* Service status */}
          <div className="text-xs">
            <span className={`font-medium ${colors.text}`}>Service:</span>
            <span className={`ml-1 ${colors.text} opacity-75`}>
              {notificationService.getConnectionStatus ?
                JSON.stringify(notificationService.getConnectionStatus()) :
                'Status unavailable'
              }
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact notification status indicator for headers/toolbars
 */
export function NotificationStatusIndicator({ className = '' }: { className?: string }) {
  const { isSubscribed, error, isLoading } = useNotifications();
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) return null;

  const getStatusConfig = () => {
    if (isLoading) {
      return {
        color: 'bg-blue-500',
        animation: 'animate-pulse',
        tooltip: 'Connecting to notifications...'
      };
    }

    if (error) {
      return {
        color: 'bg-red-500',
        animation: '',
        tooltip: 'Notifications unavailable'
      };
    }

    if (isSubscribed) {
      return {
        color: 'bg-green-500',
        animation: 'animate-pulse',
        tooltip: 'Real-time notifications active'
      };
    }

    return {
      color: 'bg-gray-400',
      animation: '',
      tooltip: 'Notifications disconnected'
    };
  };

  const status = getStatusConfig();

  return (
    <div className={`relative ${className}`} title={status.tooltip}>
      <div className={`w-2 h-2 rounded-full ${status.color} ${status.animation}`} />
    </div>
  );
}

/**
 * Notification status banner for critical errors
 */
export function NotificationStatusBanner() {
  const { error, isSubscribed } = useNotifications();
  const { isAuthenticated } = useAuth();
  const [isDismissed, setIsDismissed] = useState(false);

  // Only show banner for critical errors when authenticated
  if (!isAuthenticated || !error || isSubscribed || isDismissed) {
    return null;
  }

  return (
    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400" />
          <div className="ml-3">
            <p className="text-sm text-yellow-700">
              <strong>Limited Functionality:</strong> Real-time notifications are temporarily unavailable.
              Some features may not update automatically.
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsDismissed(true)}
          className="text-yellow-400 hover:text-yellow-600"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
