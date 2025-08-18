import { useEffect, useCallback, useState } from 'react';
import { useNotifications } from '../../hooks/useNotifications';
import { useAuth } from '../../contexts/AuthContext';
import { notificationService } from '../../services/notificationService';
import {
  ExclamationTriangleIcon,
  XCircleIcon,
  InformationCircleIcon,
  CheckCircleIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';

interface SystemError {
  id: string;
  type: 'service_outage' | 'degradede' | 'maintenance' | 'security_alert' | 'api_error';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  timestamp: string;
  affectedServices?: string[];
  estimatedResolution?: string;
  actionRequired?: boolean;
  actionUrl?: string;
  retryable?: boolean;
}

/**
 * System error handler that manages global system alerts and service status notifications
 */
export function SystemErrorHandler() {
  const { showError, showWarning, showInfo, addNotification } = useNotifications();
  const { isAuthenticated } = useAuth();
  const [activeSystemErrors, setActiveSystemErrors] = useState<Map<string, SystemError>>(new Map());
  const [isMonitoring, setIsMonitoring] = useState(false);

  // Handle system error notifications
  const handleSystemError = useCallback((errorData: SystemError) => {
    const { id, type, severity, title, message, affectedServices, estimatedResolution, actionRequired, actionUrl, retryable } = errorData;

    // Update active errors tracking
    setActiveSystemErrors(prev => new Map(prev.set(id, errorData)));

    // Create enhanced notification based on error type and severity
    let enhancedTitle = title;
    let enhancedMessage = message;
    let notificationHandler = showInfo;

    // Determine notification handler based on severity
    switch (severity) {
      case 'critical':
        notificationHandler = showError;
        break;
      case 'high':
        notificationHandler = showError;
        break;
      case 'medium':
        notificationHandler = showWarning;
        break;
      case 'low':
      default:
        notificationHandler = showInfo;
        break;
    }

    // Enhance message based on error type
    switch (type) {
      case 'service_outage':
        enhancedTitle = `Service Outage: ${title}`;
        if (affectedServices?.length) {
          enhancedMessage += ` Affected services: ${affectedServices.join(', ')}.`;
        }
        if (estimatedResolution) {
          enhancedMessage += ` Estimated resolution: ${estimatedResolution}.`;
        }
        break;

      case 'degraded_performance':
        enhancedTitle = `Performance Issue: ${title}`;
        enhancedMessage += ' Some features may be slower than usual.';
        if (estimatedResolution) {
          enhancedMessage += ` Expected resolution: ${estimatedResolution}.`;
        }
        break;

      case 'maintenance':
        enhancedTitle = `Scheduled Maintenance: ${title}`;
        enhancedMessage += ' Some features may be temporarily unavailable.';
        break;

      case 'security_alert':
        enhancedTitle = `Security Alert: ${title}`;
        if (actionRequired) {
          enhancedMessage += ' Immediate action may be required.';
        }
        break;

      case 'api_error':
        enhancedTitle = `API Service Issue: ${title}`;
        if (retryable) {
          enhancedMessage += ' The system will automatically retry failed requests.';
        }
        break;
    }

    // Show notification
    notificationHandler(enhancedTitle, enhancedMessage, actionUrl);

    // Log for debugging
    console.error('System error handled:', {
      id,
      type,
      severity,
      title: enhancedTitle,
      message: enhancedMessage,
      timestamp: errorData.timestamp
    });
  }, [showError, showWarning, showInfo]);

  // Handle error resolution notifications
  const handleErrorResolution = useCallback((errorId: string, resolutionMessage?: string) => {
    const resolvedError = activeSystemErrors.get(errorId);
    if (resolvedError) {
      setActiveSystemErrors(prev => {
        const newMap = new Map(prev);
        newMap.delete(errorId);
        return newMap;
      });

      showInfo(
        'Issue Resolved',
        resolutionMessage || `The system issue "${resolvedError.title}" has been resolved.`,
        undefined
      );
    }
  }, [activeSystemErrors, showInfo]);

  // Monitor system health and connection status
  useEffect(() => {
    if (!isAuthenticated || isMonitoring) return;

    setIsMonitoring(true);

    // Set up periodic health checks
    const healthCheckInterval = setInterval(async () => {
      try {
        const connectionStatus = notificationService.getConnectionStatus();

        if (connectionStatus.isTokenExpired) {
          handleSystemError({
            id: 'token-expired',
            type: 'api_error',
            severity: 'medium',
            title: 'Session Expired',
            message: 'Your session has expired and needs to be refreshed.',
            timestamp: new Date().toISOString(),
            actionRequired: true,
            actionUrl: window.location.href,
            retryable: true
          });
        }

        if (!connectionStatus.isSubscribed && connectionStatus.reconnectAttempts > 3) {
          handleSystemError({
            id: 'connection-failed',
            type: 'service_outage',
            severity: 'high',
            title: 'Real-time Service Unavailable',
            message: 'Unable to connect to real-time notifications after multiple attempts.',
            timestamp: new Date().toISOString(),
            affectedServices: ['Real-time notifications', 'Live updates'],
            actionRequired: false,
            retryable: true
          });
        }
      } catch (error) {
        console.error('Health check failed:', error);
      }
    }, 30000); // Check every 30 seconds

    return () => {
      clearInterval(healthCheckInterval);
      setIsMonitoring(false);
    };
  }, [isAuthenticated, isMonitoring, handleSystemError]);

  // Clean up old errors (remove after 1 hour)
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const oneHourAgo = Date.now() - (60 * 60 * 1000);

      setActiveSystemErrors(prev => {
        const newMap = new Map();
        for (const [id, error] of prev.entries()) {
          if (new Date(error.timestamp).getTime() > oneHourAgo) {
            newMap.set(id, error);
          }
        }
        return newMap;
      });
    }, 5 * 60 * 1000); // Clean up every 5 minutes

    return () => clearInterval(cleanupInterval);
  }, []);

  // This component doesn't render anything
  return null;
}

/**
 * System status banner that shows critical system-wide issues
 */
export function SystemStatusBanner() {
  const { isAuthenticated } = useAuth();
  const [systemStatus, setSystemStatus] = useState<{
    status: 'operational' | 'degraded' | 'outage' | 'maintenance';
    message?: string;
    lastUpdated: string;
  }>({
    status: 'operational',
    lastUpdated: new Date().toISOString()
  });
  const [isDismissed, setIsDismissed] = useState(false);

  // Don't show banner if not authenticated or dismissed
  if (!isAuthenticated || isDismissed || systemStatus.status === 'operational') {
    return null;
  }

  const getStatusConfig = () => {
    switch (systemStatus.status) {
      case 'outage':
        return {
          bg: 'bg-red-50',
          border: 'border-red-200',
          icon: XCircleIcon,
          iconColor: 'text-red-500',
          textColor: 'text-red-800',
          title: 'Service Outage'
        };
      case 'degraded':
        return {
          bg: 'bg-yellow-50',
          border: 'border-yellow-200',
          icon: ExclamationTriangleIcon,
          iconColor: 'text-yellow-500',
          textColor: 'text-yellow-800',
          title: 'Degraded Performance'
        };
      case 'maintenance':
        return {
          bg: 'bg-blue-50',
          border: 'border-blue-200',
          icon: InformationCircleIcon,
          iconColor: 'text-blue-500',
          textColor: 'text-blue-800',
          title: 'Scheduled Maintenance'
        };
      default:
        return {
          bg: 'bg-green-50',
          border: 'border-green-200',
          icon: CheckCircleIcon,
          iconColor: 'text-green-500',
          textColor: 'text-green-800',
          title: 'All Systems Operational'
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <div className={`${config.bg} ${config.border} border-l-4 p-4 mb-4`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <Icon className={`w-5 h-5 ${config.iconColor} mr-3`} />
          <div>
            <h3 className={`text-sm font-medium ${config.textColor}`}>
              {config.title}
            </h3>
            {systemStatus.message && (
              <p className={`text-sm ${config.textColor} mt-1`}>
                {systemStatus.message}
              </p>
            )}
            <p className={`text-xs ${config.textColor} opacity-75 mt-1`}>
              Last updated: {new Date(systemStatus.lastUpdated).toLocaleString()}
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsDismissed(true)}
          className={`${config.textColor} hover:opacity-75`}
          title="Dismiss"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Hook for handling system errors with retry logic
 */
export function useSystemErrorHandling() {
  const [retryQueue, setRetryQueue] = useState<Map<string, () => Promise<void>>>(new Map());
  const [isRetrying, setIsRetrying] = useState(false);

  // Add operation to retry queue
  const addToRetryQueue = useCallback((operationId: string, operation: () => Promise<void>) => {
    setRetryQueue(prev => new Map(prev.set(operationId, operation)));
  }, []);

  // Remove operation from retry queue
  const removeFromRetryQueue = useCallback((operationId: string) => {
    setRetryQueue(prev => {
      const newMap = new Map(prev);
      newMap.delete(operationId);
      return newMap;
    });
  }, []);

  // Retry all failed operations
  const retryAllOperations = useCallback(async () => {
    if (isRetrying || retryQueue.size === 0) return;

    setIsRetrying(true);
    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const [operationId, operation] of retryQueue.entries()) {
      try {
        await operation();
        results.push({ id: operationId, success: true });
        removeFromRetryQueue(operationId);
      } catch (error) {
        results.push({
          id: operationId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    setIsRetrying(false);
    return results;
  }, [isRetrying, retryQueue, removeFromRetryQueue]);

  // Get retry queue status
  const getRetryQueueStatus = useCallback(() => {
    return {
      pendingOperations: retryQueue.size,
      isRetrying,
      operations: Array.from(retryQueue.keys())
    };
  }, [retryQueue, isRetrying]);

  return {
    addToRetryQueue,
    removeFromRetryQueue,
    retryAllOperations,
    getRetryQueueStatus
  };
}
