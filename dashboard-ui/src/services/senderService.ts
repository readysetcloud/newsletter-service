import { apiClient } from './api';
import { getUserFriendlyErrorMessage, shouldRetryError, getRetryDelay } from '@/utils/errorHandling';
import type {
  ApiResponse,
  SenderEmail,
  TierLimits,
  DomainVerification,
  CreateSenderRequest,
  UpdateSenderRequest,
  VerifyDomainRequest,
  GetSendersResponse,
} from '@/types/api';

/**
 * Sender Service - Handles all sender email management operations
 */
export class SenderService {
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Get all sender emails for the authenticated tenant
   */
  async getSenders(): Promise<ApiResponse<GetSendersResponse>> {
    return apiClient.get<GetSendersResponse>('/senders');
  }

  /**
   * Create a new sender email
   */
  async createSender(data: CreateSenderRequest): Promise<ApiResponse<SenderEmail>> {
    return apiClient.post<SenderEmail>('/senders', data);
  }

  /**
   * Update an existing sender email
   */
  async updateSender(senderId: string, data: UpdateSenderRequest): Promise<ApiResponse<SenderEmail>> {
    return apiClient.put<SenderEmail>(`/senders/${senderId}`, data);
  }

  /**
   * Delete a sender email
   */
  async deleteSender(senderId: string): Promise<ApiResponse<void>> {
    return apiClient.delete<void>(`/senders/${senderId}`);
  }

  /**
   * Initiate domain verification for DNS-based verification
   */
  async verifyDomain(data: VerifyDomainRequest): Promise<ApiResponse<DomainVerification>> {
    return apiClient.post<DomainVerification>('/senders/verify-domain', data);
  }

  /**
   * Get domain verification records and status
   */
  async getDomainVerification(domain: string): Promise<ApiResponse<DomainVerification>> {
    return apiClient.get<DomainVerification>(`/senders/domain-verification/${encodeURIComponent(domain)}`);
  }

  /**
   * Start polling for verification status updates
   * @param senderId - The sender ID to poll for
   * @param onStatusUpdate - Callback function called when status changes
   * @param intervalMs - Polling interval in milliseconds (default: 5000)
   */
  startVerificationPolling(
    senderId: string,
    onStatusUpdate: (sender: SenderEmail | null, error?: string) => void,
    intervalMs: number = 5000
  ): void {
    // Clear existing polling for this sender
    this.stopVerificationPolling(senderId);

    const pollStatus = async () => {
      try {
        const response = await this.getSenders();
        if (response.success && response.data) {
          const sender = response.data.senders.find(s => s.senderId === senderId);
          onStatusUpdate(sender || null);

          // Stop polling if verification is complete or failed
          if (sender && (sender.verificationStatus === 'verified' || sender.verificationStatus === 'failed')) {
            this.stopVerificationPolling(senderId);
          }
        } else {
          onStatusUpdate(null, response.error || 'Failed to fetch sender status');
        }
      } catch (error) {
        onStatusUpdate(null, error instanceof Error ? error.message : 'Unknown error occurred');
      }
    };

    // Start polling
    const intervalId = setInterval(pollStatus, intervalMs);
    this.pollingIntervals.set(senderId, intervalId);

    // Initial poll
    pollStatus();
  }

  /**
   * Stop polling for verification status updates
   * @param senderId - The sender ID to stop polling for
   */
  stopVerificationPolling(senderId: string): void {
    const intervalId = this.pollingIntervals.get(senderId);
    if (intervalId) {
      clearInterval(intervalId);
      this.pollingIntervals.delete(senderId);
    }
  }

  /**
   * Stop all active polling
   */
  stopAllPolling(): void {
    this.pollingIntervals.forEach((intervalId) => {
      clearInterval(intervalId);
    });
    this.pollingIntervals.clear();
  }

  /**
   * Start polling for domain verification status
   * @param domain - The domain to poll for
   * @param onStatusUpdate - Callback function called when status changes
   * @param intervalMs - Polling interval in milliseconds (default: 10000)
   */
  startDomainVerificationPolling(
    domain: string,
    onStatusUpdate: (verification: DomainVerification | null, error?: string) => void,
    intervalMs: number = 10000
  ): void {
    const pollingKey = `domain:${domain}`;

    // Clear existing polling for this domain
    this.stopVerificationPolling(pollingKey);

    const pollStatus = async () => {
      try {
        const response = await this.getDomainVerification(domain);
        if (response.success && response.data) {
          onStatusUpdate(response.data);

          // Stop polling if verification is complete or failed
          if (response.data.verificationStatus === 'verified' || response.data.verificationStatus === 'failed') {
            this.stopVerificationPolling(pollingKey);
          }
        } else {
          onStatusUpdate(null, response.error || 'Failed to fetch domain verification status');
        }
      } catch (error) {
        onStatusUpdate(null, error instanceof Error ? error.message : 'Unknown error occurred');
      }
    };

    // Start polling
    const intervalId = setInterval(pollStatus, intervalMs);
    this.pollingIntervals.set(pollingKey, intervalId);

    // Initial poll
    pollStatus();
  }

  /**
   * Retry verification for a failed sender
   * @param senderId - The sender ID to retry verification for
   */
  async retryVerification(senderId: string): Promise<ApiResponse<SenderEmail>> {
    try {
      // Get current sender details
      const sendersResponse = await this.getSenders();
      if (!sendersResponse.success || !sendersResponse.data) {
        return {
          success: false,
          error: getUserFriendlyErrorMessage(sendersResponse.error, 'sender'),
        };
      }

      const sender = sendersResponse.data.senders.find(s => s.senderId === senderId);
      if (!sender) {
        return {
          success: false,
          error: 'Sender not found',
        };
      }

      // For domain verification, retry domain verification
      if (sender.verificationType === 'domain' && sender.domain) {
        const domainResponse = await this.verifyDomain({ domain: sender.domain });
        if (!domainResponse.success) {
          return {
            success: false,
            error: getUserFriendlyErrorMessage(domainResponse.error, 'sender'),
          };
        }
        return {
          success: true,
          data: sender, // Return the existing sender as domain verification doesn't create a new one
        };
      }

      // For mailbox verification, we need to recreate the sender
      // This will trigger a new verification email
      const retryResponse = await this.createSender({
        email: sender.email,
        name: sender.name,
        verificationType: sender.verificationType,
      });

      if (retryResponse.success) {
        // Delete the old failed sender
        await this.deleteSender(senderId);
      }

      return retryResponse;
    } catch (error) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error, 'sender'),
      };
    }
  }

  /**
   * Retry operation with exponential backoff and enhanced error handling
   * @param operation - The async operation to retry
   * @param maxRetries - Maximum number of retry attempts
   * @param baseDelay - Base delay in milliseconds
   * @param context - Context for error reporting
   */
  private async retryOperation<T>(
    operation: () => Promise<ApiResponse<T>>,
    maxRetries: number = 3,
    baseDelay: number = 1000,
    context: string = 'operation'
  ): Promise<ApiResponse<T>> {
    let lastError: any;
    let lastResponse: ApiResponse<T> | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const result = await operation();
        lastResponse = result;

        // If successful, return immediately
        if (result.success) {
          return result;
        }

        // Check if error is retryable based on error code or type
        const isRetryable = this.isErrorRetryable(result.error, result);
        if (!isRetryable) {
          return result;
        }

        lastError = result.error;

        // If this was the last attempt, break
        if (attempt > maxRetries) {
          break;
        }

        // Log retry attempt
        console.warn(`Retrying ${context} (attempt ${attempt}/${maxRetries}):`, result.error);

        // Wait before retrying with exponential backoff
        const delay = getRetryDelay(attempt, baseDelay);
        await new Promise(resolve => setTimeout(resolve, delay));
      } catch (error) {
        lastError = error;

        // If this was the last attempt or error is not retryable, break
        if (attempt > maxRetries || !shouldRetryError(error)) {
          break;
        }

        // Log retry attempt
        console.warn(`Retrying ${context} (attempt ${attempt}/${maxRetries}):`, error);

        // Wait before retrying
        const delay = getRetryDelay(attempt, baseDelay);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Return the last response if available, otherwise create error response
    if (lastResponse && !lastResponse.success) {
      return {
        ...lastResponse,
        error: getUserFriendlyErrorMessage(lastError, 'sender'),
        retryAttempts: maxRetries
      };
    }

    return {
      success: false,
      error: getUserFriendlyErrorMessage(lastError, 'sender'),
      retryAttempts: maxRetries
    };
  }

  /**
   * Check if an error is retryable based on error code and response
   */
  private isErrorRetryable(error: any, response?: ApiResponse<any>): boolean {
    // Check for specific error codes that should not be retried
    if (response?.errorCode) {
      const nonRetryableErrorCodes = [
        'INVALID_EMAIL',
        'INVALID_DOMAIN',
        'EMAIL_ALREADY_EXISTS',
        'DOMAIN_ALREADY_EXISTS',
        'SENDER_LIMIT_EXCEEDED',
        'DNS_VERIFICATION_NOT_ALLOWED',
        'MAILBOX_VERIFICATION_NOT_ALLOWED',
        'SENDER_NOT_FOUND',
        'DOMAIN_NOT_FOUND',
        'TENANT_ACCESS_REQUIRED',
        'INSUFFICIENT_PERMISSIONS'
      ];

      if (nonRetryableErrorCodes.includes(response.errorCode)) {
        return false;
      }

      // Retryable error codes
      const retryableErrorCodes = [
        'SES_IDENTITY_CREATION_FAILED',
        'SES_IDENTITY_DELETION_FAILED',
        'SES_VERIFICATION_FAILED',
        'SES_QUOTA_EXCEEDED',
        'DNS_RECORD_GENERATION_FAILED',
        'TOO_MANY_REQUESTS'
      ];

      if (retryableErrorCodes.includes(response.errorCode)) {
        return true;
      }
    }

    // Fall back to generic retry logic
    return shouldRetryError(error);
  }

  /**
   * Create sender with retry logic and enhanced error handling
   * @param data - Sender creation data
   */
  async createSenderWithRetry(data: CreateSenderRequest): Promise<ApiResponse<SenderEmail>> {
    // Pre-validation
    const validationError = this.validateCreateSenderRequest(data);
    if (validationError) {
      return {
        success: false,
        error: validationError,
        errorCode: 'VALIDATION_ERROR'
      };
    }

    return this.retryOperation(
      () => this.createSender(data),
      3,
      1000,
      'create sender'
    );
  }

  /**
   * Update sender with retry logic
   * @param senderId - Sender ID to update
   * @param data - Update data
   */
  async updateSenderWithRetry(senderId: string, data: UpdateSenderRequest): Promise<ApiResponse<SenderEmail>> {
    if (!senderId) {
      return {
        success: false,
        error: 'Sender ID is required',
        errorCode: 'MISSING_SENDER_ID'
      };
    }

    return this.retryOperation(
      () => this.updateSender(senderId, data),
      2,
      1000,
      'update sender'
    );
  }

  /**
   * Verify domain with retry logic
   * @param data - Domain verification data
   */
  async verifyDomainWithRetry(data: VerifyDomainRequest): Promise<ApiResponse<DomainVerification>> {
    // Pre-validation
    if (!data.domain) {
      return {
        success: false,
        error: 'Domain is required',
        errorCode: 'MISSING_DOMAIN'
      };
    }

    if (!this.validateDomain(data.domain)) {
      return {
        success: false,
        error: 'Please enter a valid domain name',
        errorCode: 'INVALID_DOMAIN'
      };
    }

    return this.retryOperation(
      () => this.verifyDomain(data),
      2,
      2000,
      'verify domain'
    );
  }

  /**
   * Delete sender with enhanced error handling
   * @param senderId - Sender ID to delete
   */
  async deleteSenderWithRetry(senderId: string): Promise<ApiResponse<void>> {
    if (!senderId) {
      return {
        success: false,
        error: 'Sender ID is required',
        errorCode: 'MISSING_SENDER_ID'
      };
    }

    return this.retryOperation(
      () => this.deleteSender(senderId),
      2,
      1000,
      'delete sender'
    );
  }

  /**
   * Get senders with retry logic
   */
  async getSendersWithRetry(): Promise<ApiResponse<GetSendersResponse>> {
    return this.retryOperation(
      () => this.getSenders(),
      3,
      1000,
      'get senders'
    );
  }

  /**
   * Get domain verification with retry logic
   */
  async getDomainVerificationWithRetry(domain: string): Promise<ApiResponse<DomainVerification>> {
    if (!domain) {
      return {
        success: false,
        error: 'Domain is required',
        errorCode: 'MISSING_DOMAIN'
      };
    }

    return this.retryOperation(
      () => this.getDomainVerification(domain),
      3,
      1000,
      'get domain verification'
    );
  }

  /**
   * Validate create sender request
   */
  private validateCreateSenderRequest(data: CreateSenderRequest): string | null {
    if (!data.email) {
      return 'Email address is required';
    }

    if (!this.validateEmail(data.email)) {
      return 'Please enter a valid email address';
    }

    if (data.verificationType && !['mailbox', 'domain'].includes(data.verificationType)) {
      return 'Verification type must be either "mailbox" or "domain"';
    }

    if (data.name && data.name.length > 100) {
      return 'Sender name must be less than 100 characters';
    }

    return null;
  }

  /**
   * Validate domain format
   */
  private validateDomain(domain: string): boolean {
    if (!domain) return false;

    // Basic domain validation
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!domainRegex.test(domain)) return false;

    // Ensure domain doesn't contain protocol
    if (domain.includes('://') || domain.includes('/')) return false;

    return true;
  }

  /**
   * Check if a tier can add more senders
   * @param tierLimits - Current tier limits
   * @returns boolean indicating if more senders can be added
   */
  canAddSender(tierLimits: TierLimits): boolean {
    return tierLimits.currentCount < tierLimits.maxSenders;
  }

  /**
   * Get the next available sender slot count
   * @param tierLimits - Current tier limits
   * @returns number of available slots
   */
  getAvailableSlots(tierLimits: TierLimits): number {
    return Math.max(0, tierLimits.maxSenders - tierLimits.currentCount);
  }

  /**
   * Validate email format
   * @param email - Email address to validate
   * @returns boolean indicating if email is valid
   */
  validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Extract domain from email address
   * @param email - Email address
   * @returns domain part of the email
   */
  extractDomain(email: string): string {
    return email.split('@')[1] || '';
  }

  /**
   * Check if domain verification is supported for the tier
   * @param tierLimits - Current tier limits
   * @returns boolean indicating if DNS verification is available
   */
  isDomainVerificationAvailable(tierLimits: TierLimits): boolean {
    return tierLimits.canUseDNS;
  }

  /**
   * Check if mailbox verification is supported for the tier
   * @param tierLimits - Current tier limits
   * @returns boolean indicating if mailbox verification is available
   */
  isMailboxVerificationAvailable(tierLimits: TierLimits): boolean {
    return tierLimits.canUseMailbox;
  }
}

// Export singleton instance
export const senderService = new SenderService();
