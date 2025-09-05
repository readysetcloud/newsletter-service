import { apiClient } from './api';
import type {
  ApiResponse,
  SubscriptionStatusResponse,
  CheckoutSessionRequest,
  CheckoutSessionResponse,
  CustomerPortalRequest,
  CustomerPortalResponse,
  PlanChangeRequest,
  PlanChangeResponse,
  BillingAlert,
  SubscriptionPlan,
  UsageMetrics,
} from '@/types';
import {
  validateCheckoutRequest,
  validatePortalRequest,
  validatePlanChangeRequest,
  validateSubscriptionStatus,
} from '@/schemas';

/**
 * Billing Service - Handles all billing and subscription-related API operations
 */
export class BillingService {
  /**
   * Get the current subscription status and billing information
   */
  async getSubscriptionStatus(): Promise<ApiResponse<SubscriptionStatusResponse>> {
    try {
      const response = await apiClient.get<SubscriptionStatusResponse>('/billing/subscription-status');

      if (response.success && response.data) {
        // Validate the response data structure
        const validation = validateSubscriptionStatus(response.data);
        if (!validation.success) {
          console.error('Invalid subscription status response:', validation.error);
          return {
            success: false,
            error: 'Invalid response format from server',
          };
        }
      }

      return response;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get subscription status',
      };
    }
  }

  /**
   * Create a Stripe checkout session for subscription
   */
  async createCheckoutSession(request: CheckoutSessionRequest): Promise<ApiResponse<CheckoutSessionResponse>> {
    try {
      // Validate request data
      const validation = validateCheckoutRequest(request);
      if (!validation.success) {
        return {
          success: false,
          error: validation.error.errors[0]?.message || 'Invalid checkout request',
        };
      }

      const response = await apiClient.post<CheckoutSessionResponse>('/billing/checkout-session', request);

      if (response.success && response.data) {
        // Validate response structure
        if (!response.data.sessionId || !response.data.url) {
          return {
            success: false,
            error: 'Invalid checkout session response',
          };
        }
      }

      return response;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create checkout session',
      };
    }
  }

  /**
   * Create a Stripe customer portal session
   */
  async createCustomerPortalSession(request: CustomerPortalRequest = {}): Promise<ApiResponse<CustomerPortalResponse>> {
    try {
      // Validate request data
      const validation = validatePortalRequest(request);
      if (!validation.success) {
        return {
          success: false,
          error: validation.error.errors[0]?.message || 'Invalid portal request',
        };
      }

      const response = await apiClient.post<CustomerPortalResponse>('/billing/customer-portal', request);

      if (response.success && response.data) {
        // Validate response structure
        if (!response.data.url) {
          return {
            success: false,
            error: 'Invalid customer portal response',
          };
        }
      }

      return response;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create customer portal session',
      };
    }
  }

  /**
   * Change subscription plan
   */
  async changePlan(request: PlanChangeRequest): Promise<ApiResponse<PlanChangeResponse>> {
    try {
      // Validate request data
      const validation = validatePlanChangeRequest(request);
      if (!validation.success) {
        return {
          success: false,
          error: validation.error.errors[0]?.message || 'Invalid plan change request',
        };
      }

      return apiClient.post<PlanChangeResponse>('/billing/subscription/change-plan', request);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to change subscription plan',
      };
    }
  }

  /**
   * Cancel subscription (will remain active until period end)
   */
  async cancelSubscription(): Promise<ApiResponse<{ message: string; subscription: any }>> {
    try {
      return apiClient.post<{ message: string; subscription: any }>('/billing/subscription/cancel');
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel subscription',
      };
    }
  }

  /**
   * Reactivate a cancelled subscription
   */
  async reactivateSubscription(): Promise<ApiResponse<{ message: string; subscription: any }>> {
    try {
      return apiClient.post<{ message: string; subscription: any }>('/billing/subscription/reactivate');
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reactivate subscription',
      };
    }
  }

  /**
   * Get available subscription plans
   */
  async getAvailablePlans(): Promise<ApiResponse<SubscriptionPlan[]>> {
    try {
      return apiClient.get<SubscriptionPlan[]>('/billing/plans');
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get available plans',
      };
    }
  }

  /**
   * Get current usage metrics
   */
  async getUsageMetrics(): Promise<ApiResponse<UsageMetrics>> {
    try {
      return apiClient.get<UsageMetrics>('/billing/usage');
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get usage metrics',
      };
    }
  }

  /**
   * Get billing alerts for the current tenant
   */
  async getBillingAlerts(): Promise<ApiResponse<BillingAlert[]>> {
    try {
      return apiClient.get<BillingAlert[]>('/billing/alerts');
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get billing alerts',
      };
    }
  }

  /**
   * Dismiss a billing alert
   */
  async dismissAlert(alertId: string): Promise<ApiResponse<{ message: string }>> {
    try {
      if (!alertId) {
        return {
          success: false,
          error: 'Alert ID is required',
        };
      }

      return apiClient.post<{ message: string }>(`/billing/alerts/${alertId}/dismiss`);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to dismiss alert',
      };
    }
  }

  /**
   * Get billing history/invoices (redirects to Stripe customer portal)
   */
  async getBillingHistory(): Promise<ApiResponse<CustomerPortalResponse>> {
    try {
      // This will redirect to the customer portal where users can view their billing history
      return this.createCustomerPortalSession({
        returnUrl: `${window.location.origin}/billing`
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to access billing history',
      };
    }
  }

  /**
   * Retry failed payment (redirects to Stripe customer portal)
   */
  async retryPayment(): Promise<ApiResponse<CustomerPortalResponse>> {
    try {
      // This will redirect to the customer portal where users can update payment methods
      return this.createCustomerPortalSession({
        returnUrl: `${window.location.origin}/billing`
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retry payment',
      };
    }
  }

  /**
   * Update payment method (redirects to Stripe customer portal)
   */
  async updatePaymentMethod(): Promise<ApiResponse<CustomerPortalResponse>> {
    try {
      // This will redirect to the customer portal where users can update payment methods
      return this.createCustomerPortalSession({
        returnUrl: `${window.location.origin}/billing`
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update payment method',
      };
    }
  }

  /**
   * Helper method to redirect to Stripe checkout
   */
  redirectToCheckout(sessionUrl: string): void {
    window.location.href = sessionUrl;
  }

  /**
   * Helper method to redirect to Stripe customer portal
   */
  redirectToCustomerPortal(portalUrl: string): void {
    window.location.href = portalUrl;
  }

  /**
   * Helper method to open customer portal in new tab
   */
  openCustomerPortalInNewTab(portalUrl: string): void {
    window.open(portalUrl, '_blank', 'noopener,noreferrer');
  }
}

// Export singleton instance
export const billingService = new BillingService();
