import { useState, useEffect, useCallback } from 'react';
import { senderService } from '@/services/senderService';
import { useNotifications } from '@/contexts/NotificationContext';
import type { SenderEmail, TierLimits } from '@/types';

export interface SenderStatus {
  senders: SenderEmail[];
  tierLimits: TierLimits | null;
  hasUnverified: boolean;
  hasFailed: boolean;
  hasTimedOut: boolean;
  totalCount: number;
  verifiedCount: number;
  pendingCount: number;
  failedCount: number;
  timedOutCount: number;
  loading: boolean;
  error: string | null;
}

/**
 * Hook to fetch and track sender email status for navigation indicators
 */
export const useSenderStatus = (refreshInterval: number = 30000) => {
  const { notifications } = useNotifications();
  const [status, setStatus] = useState<SenderStatus>({
    senders: [],
    tierLimits: null,
    hasUnverified: false,
    hasFailed: false,
    hasTimedOut: false,
    totalCount: 0,
    verifiedCount: 0,
    pendingCount: 0,
    failedCount: 0,
    timedOutCount: 0,
    loading: true,
    error: null,
  });

  const fetchSenderStatus = useCallback(async () => {
    try {
      const response = await senderService.getSenders();

      if (response.success && response.data) {
        const { senders, tierLimits } = response.data;

        const verifiedCount = senders.filter(s => s.verificationStatus === 'verified').length;
        const pendingCount = senders.filter(s => s.verificationStatus === 'pending').length;
        const failedCount = senders.filter(s => s.verificationStatus === 'failed').length;
        const timedOutCount = senders.filter(s => s.verificationStatus === 'verification_timed_out').length;

        setStatus({
          senders,
          tierLimits,
          hasUnverified: pendingCount > 0,
          hasFailed: failedCount > 0,
          hasTimedOut: timedOutCount > 0,
          totalCount: senders.length,
          verifiedCount,
          pendingCount,
          failedCount,
          timedOutCount,
          loading: false,
          error: null,
        });
      } else {
        setStatus(prev => ({
          ...prev,
          loading: false,
          error: response.error || 'Failed to fetch sender status',
        }));
      }
    } catch (error) {
      setStatus(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }));
    }
  }, []);

  useEffect(() => {
    fetchSenderStatus();

    // Set up periodic refresh
    const interval = setInterval(fetchSenderStatus, refreshInterval);

    return () => {
      clearInterval(interval);
    };
  }, [fetchSenderStatus, refreshInterval]);

  // Listen for sender-related notifications and trigger immediate refresh
  useEffect(() => {
    const senderNotifications = notifications.filter(notification =>
      notification.title.toLowerCase().includes('sender') ||
      notification.message.toLowerCase().includes('sender') ||
      notification.message.toLowerCase().includes('verification')
    );

    // If we have new sender notifications, refresh status
    if (senderNotifications.length > 0) {
      const latestNotification = senderNotifications[0];
      const notificationTime = new Date(latestNotification.timestamp).getTime();
      const now = Date.now();

      // Only refresh if notification is recent (within last 5 minutes)
      if (now - notificationTime < 5 * 60 * 1000) {
        fetchSenderStatus();
      }
    }
  }, [notifications, fetchSenderStatus]);

  return {
    ...status,
    refresh: fetchSenderStatus,
  };
};
