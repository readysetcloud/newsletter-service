import { senderService } from '../senderService';
import { apiClient } from '../api';
import type { TierLimits, SenderEmail, DomainVerification } from '@/types/api';

// Mock dependencies
vi.mock('../api');
vi.mock('@/utils/errorHandling', () => ({
  getUserFriendlyErrorMessage: vi.fn((error) => error || 'Unknown error'),
  shouldRetryError: vi.fn(() => true),
  getRetryDelay: vi.fn((attempt, baseDelay) => baseDelay * attempt)
}));

const mockApiClient = vi.mocked(apiClient);

const mockTierLimits: TierLimits = {
  tier: 'creator-tier',
  maxSenders: 2,
  currentCount: 1,
  canUseDNS: true,
  canUseMailbox: true
};

const mockSender: SenderEmail = {
  senderId: 'sender-123',
  email: 'test@example.com',
  name: 'Test Sender',
  verificationType: 'mailbox',
  verificationStatus: 'verified',
  isDefault: true,
  domain: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  verifiedAt: '2024-01-01T01:00:00Z',
  failureReason: null
};

const mockDomainVerification: DomainVerification = {
  domain: 'example.com',
  verificationStatus: 'pending',
  dnsRecords: [
    {
      name: '_amazonses.example.com',
      type: 'TXT',
      value: 'verification-token',
      description: 'Domain ownership verification'
    }
  ],
  instructions: ['Add DNS records'],
  estimatedVerificationTime: '15-30 minutes',
  troubleshooting: ['Check DNS records'],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  verifiedAt: null
};

describe('SenderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    senderService.stopAllPolling();
  });

  describe('getSenders', () => {
    it('calls API client with correct endpoint', async () => {
      mockApiClient.get.mockResolvedValue({
        success: true,
        data: {
          senders: [mockSender],
          tierLimits: mockTierLimits
        }
      });

      const result = await senderService.getSenders();

      expect(mockApiClient.get).toHaveBeenCalledWith('/senders');
      expect(result.success).toBe(true);
      expect(result.data?.senders).toEqual([mockSender]);
    });

    it('handles API errors', async () => {
      mockApiClient.get.mockResolvedValue({
        success: false,
        error: 'Network error'
      });

      const result = await senderService.getSenders();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('createSender', () => {
    it('calls API client with correct data', async () => {
      const createData = {
        email: 'new@example.com',
        name: 'New Sender',
        verificationType: 'mailbox' as const
      };

      mockApiClient.post.mockResolvedValue({
        success: true,
        data: mockSender
      });

      const result = await senderService.createSender(createData);

      expect(mockApiClient.post).toHaveBeenCalledWith('/senders', createData);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSender);
    });
  });

  describe('updateSender', () => {
    it('calls API client with correct parameters', async () => {
      const updateData = {
        name: 'Updated Name',
        isDefault: true
      };

      mockApiClient.put.mockResolvedValue({
        success: true,
        data: { ...mockSender, name: 'Updated Name' }
      });

      const result = await senderService.updateSender('sender-123', updateData);

      expect(mockApiClient.put).toHaveBeenCalledWith('/senders/sender-123', updateData);
      expect(result.success).toBe(true);
    });
  });

  describe('deleteSender', () => {
    it('calls API client with correct sender ID', async () => {
      mockApiClient.delete.mockResolvedValue({ success: true });

      const result = await senderService.deleteSender('sender-123');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/senders/sender-123');
      expect(result.success).toBe(true);
    });
  });

  describe('verifyDomain', () => {
    it('calls API client with domain data', async () => {
      const domainData = { domain: 'example.com' };

      mockApiClient.post.mockResolvedValue({
        success: true,
        data: mockDomainVerification
      });

      const result = await senderService.verifyDomain(domainData);

      expect(mockApiClient.post).toHaveBeenCalledWith('/senders/verify-domain', domainData);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockDomainVerification);
    });
  });

  describe('getDomainVerification', () => {
    it('calls API client with encoded domain', async () => {
      mockApiClient.get.mockResolvedValue({
        success: true,
        data: mockDomainVerification
      });

      const result = await senderService.getDomainVerification('example.com');

      expect(mockApiClient.get).toHaveBeenCalledWith('/senders/domain-verification/example.com');
      expect(result.success).toBe(true);
    });

    it('encodes special characters in domain', async () => {
      mockApiClient.get.mockResolvedValue({
        success: true,
        data: mockDomainVerification
      });

      await senderService.getDomainVerification('test@domain.com');

      expect(mockApiClient.get).toHaveBeenCalledWith('/senders/domain-verification/test%40domain.com');
    });
  });

  describe('verification polling', () => {
    it('starts polling for sender verification', async () => {
      const mockCallback = vi.fn();
      mockApiClient.get.mockResolvedValue({
        success: true,
        data: {
          senders: [mockSender],
          tierLimits: mockTierLimits
        }
      });

      senderService.startVerificationPolling('sender-123', mockCallback, 1000);

      // Initial poll should happen immediately
      await vi.runOnlyPendingTimersAsync();
      expect(mockCallback).toHaveBeenCalledWith(mockSender);

      // Should poll again after interval
      vi.advanceTimersByTime(1000);
      await vi.runOnlyPendingTimersAsync();
      expect(mockCallback).toHaveBeenCalledTimes(2);
    });

    it('stops polling when verification is complete', async () => {
      const mockCallback = vi.fn();
      const verifiedSender = { ...mockSender, verificationStatus: 'verified' as const };

      mockApiClient.get.mockResolvedValue({
        success: true,
        data: {
          senders: [verifiedSender],
          tierLimits: mockTierLimits
        }
      });

      senderService.startVerificationPolling('sender-123', mockCallback, 1000);

      // Initial poll
      await vi.runOnlyPendingTimersAsync();
      expect(mockCallback).toHaveBeenCalledWith(verifiedSender);

      // Should not poll again since verification is complete
      vi.advanceTimersByTime(1000);
      await vi.runOnlyPendingTimersAsync();
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('stops polling when verification fails', async () => {
      const mockCallback = vi.fn();
      const failedSender = { ...mockSender, verificationStatus: 'failed' as const };

      mockApiClient.get.mockResolvedValue({
        success: true,
        data: {
          senders: [failedSender],
          tierLimits: mockTierLimits
        }
      });

      senderService.startVerificationPolling('sender-123', mockCallback, 1000);

      await vi.runOnlyPendingTimersAsync();
      expect(mockCallback).toHaveBeenCalledWith(failedSender);

      // Should not poll again since verification failed
      vi.advanceTimersByTime(1000);
      await vi.runOnlyPendingTimersAsync();
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('handles polling errors', async () => {
      const mockCallback = vi.fn();
      mockApiClient.get.mockResolvedValue({
        success: false,
        error: 'API error'
      });

      senderService.startVerificationPolling('sender-123', mockCallback, 1000);

      await vi.runOnlyPendingTimersAsync();
      expect(mockCallback).toHaveBeenCalledWith(null, 'API error');
    });

    it('stops polling for specific sender', () => {
      const mockCallback = vi.fn();
      senderService.startVerificationPolling('sender-123', mockCallback, 1000);
      senderService.stopVerificationPolling('sender-123');

      vi.advanceTimersByTime(1000);
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('stops all polling', () => {
      const mockCallback1 = vi.fn();
      const mockCallback2 = vi.fn();

      senderService.startVerificationPolling('sender-1', mockCallback1, 1000);
      senderService.startVerificationPolling('sender-2', mockCallback2, 1000);

      senderService.stopAllPolling();

      vi.advanceTimersByTime(1000);
      expect(mockCallback1).not.toHaveBeenCalled();
      expect(mockCallback2).not.toHaveBeenCalled();
    });
  });

  describe('domain verification polling', () => {
    it('starts polling for domain verification', async () => {
      const mockCallback = vi.fn();
      mockApiClient.get.mockResolvedValue({
        success: true,
        data: mockDomainVerification
      });

      senderService.startDomainVerificationPolling('example.com', mockCallback, 1000);

      await vi.runOnlyPendingTimersAsync();
      expect(mockCallback).toHaveBeenCalledWith(mockDomainVerification);
    });

    it('stops domain polling when verification is complete', async () => {
      const mockCallback = vi.fn();
      const verifiedDomain = { ...mockDomainVerification, verificationStatus: 'verified' as const };

      mockApiClient.get.mockResolvedValue({
        success: true,
        data: verifiedDomain
      });

      senderService.startDomainVerificationPolling('example.com', mockCallback, 1000);

      await vi.runOnlyPendingTimersAsync();
      expect(mockCallback).toHaveBeenCalledWith(verifiedDomain);

      // Should not poll again
      vi.advanceTimersByTime(1000);
      await vi.runOnlyPendingTimersAsync();
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('retryVerification', () => {
    it('refreshes sender status instead of retrying verification', async () => {
      mockApiClient.get.mockResolvedValue({
        success: true,
        data: mockSender
      });

      const result = await senderService.retryVerification('sender-123');

      expect(mockApiClient.get).toHaveBeenCalledWith('/senders/sender-123/status');
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSender);
    });

    it('handles API errors when refreshing status', async () => {
      mockApiClient.get.mockResolvedValue({
        success: false,
        error: 'Sender not found'
      });

      const result = await senderService.retryVerification('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sender not found');
    });

    it('handles network errors', async () => {
      mockApiClient.get.mockRejectedValue(new Error('Network error'));

      const result = await senderService.retryVerification('sender-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });
  });

  describe('retry operations', () => {
    it('retries failed operations', async () => {
      mockApiClient.post
        .mockResolvedValueOnce({ success: false, error: 'Temporary error' })
        .mockResolvedValueOnce({ success: true, data: mockSender });

      const result = await senderService.createSenderWithRetry({
        email: 'test@example.com',
        verificationType: 'mailbox'
      });

      expect(mockApiClient.post).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    it('stops retrying after max attempts', async () => {
      mockApiClient.post.mockResolvedValue({ success: false, error: 'Persistent error' });

      const result = await senderService.createSenderWithRetry({
        email: 'test@example.com',
        verificationType: 'mailbox'
      });

      expect(mockApiClient.post).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
      expect(result.success).toBe(false);
    });
  });

  describe('utility methods', () => {
    it('checks if sender can be added', () => {
      expect(senderService.canAddSender(mockTierLimits)).toBe(true);

      const fullTier = { ...mockTierLimits, currentCount: 2 };
      expect(senderService.canAddSender(fullTier)).toBe(false);
    });

    it('calculates available slots', () => {
      expect(senderService.getAvailableSlots(mockTierLimits)).toBe(1);

      const fullTier = { ...mockTierLimits, currentCount: 2 };
      expect(senderService.getAvailableSlots(fullTier)).toBe(0);

      const overTier = { ...mockTierLimits, currentCount: 3 };
      expect(senderService.getAvailableSlots(overTier)).toBe(0);
    });

    it('validates email format', () => {
      expect(senderService.validateEmail('valid@example.com')).toBe(true);
      expect(senderService.validateEmail('invalid-email')).toBe(false);
      expect(senderService.validateEmail('missing@')).toBe(false);
      expect(senderService.validateEmail('@missing.com')).toBe(false);
    });

    it('extracts domain from email', () => {
      expect(senderService.extractDomain('user@example.com')).toBe('example.com');
      expect(senderService.extractDomain('test@sub.domain.org')).toBe('sub.domain.org');
      expect(senderService.extractDomain('invalid-email')).toBe('');
    });

    it('checks domain verification availability', () => {
      expect(senderService.isDomainVerificationAvailable(mockTierLimits)).toBe(true);

      const freeTier = { ...mockTierLimits, canUseDNS: false };
      expect(senderService.isDomainVerificationAvailable(freeTier)).toBe(false);
    });

    it('checks mailbox verification availability', () => {
      expect(senderService.isMailboxVerificationAvailable(mockTierLimits)).toBe(true);

      const noMailboxTier = { ...mockTierLimits, canUseMailbox: false };
      expect(senderService.isMailboxVerificationAvailable(noMailboxTier)).toBe(false);
    });
  });
});
