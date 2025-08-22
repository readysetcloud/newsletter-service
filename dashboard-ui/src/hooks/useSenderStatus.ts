import { useState, useEffect } from 'react';
import { senderService } from '@/services/senderService';
import type { SenderEmail, TierLimits } from '@/types';

interface SenderStatus {
  senders: SenderEmail[];
  tierLimits: TierLimits | null;
  hasUnverified: boolean;
  hasFailed: boolean;
  totalCount: number;
  verifiedCount: number;
  pendingCount: number;
  failedCount: number;
  loading: boolean;
  error: string | null;
}

/**
 * Hook to fetch and track sender email status for navigation indicators
 */
export const useSenderStatus = (refreshInterval: number = 30000) => {
  const [status, setStatus] = useState<SenderStatus>({
    senders: [],
    tierLimits: null,
    hasUnverified: false,
    hasFailed: false,
    totalCount: 0,
    verifiedCount: 0,
    pendingCount: 0,
    failedCount: 0,
    loading: true,
    error: null,
  });

  const fetchSenderStatus = async () => {
    try {
      const response = await senderService.getSenders();

      if (response.success && response.data) {
        const { senders, tierLimits } = response.data;

        const verifiedCount = senders.filter(s => s.verificationStatus === 'verified').length;
        const pendingCount = senders.filter(s => s.verificationStatus === 'pending').length;
        const failedCount = senders.filter(s => s.verificationStatus === 'failed').length;

        setStatus({
          senders,
          tierLimits,
          hasUnverified: pendingCount > 0,
          hasFailed: failedCount > 0,
          totalCount: senders.length,
          verifiedCount,
          pendingCount,
          failedCount,
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
  };

  useEffect(() => {
    fetchSenderStatus();

    // Set up periodic refresh
    const interval = setInterval(fetchSenderStatus, refreshInterval);

    return () => {
      clearInterval(interval);
    };
  }, [refreshInterval]);

  return {
    ...status,
    refresh: fetchSenderStatus,
  };
};
