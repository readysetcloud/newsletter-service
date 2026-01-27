import { describe, it, expect, vi, beforeEach } from 'vitest';
import { billingService } from '../billingService';
import { apiClient } from '../api';
import type {
  SubscriptionStatusResponse,
  CheckoutSessionRequest,
  CheckoutSessionResponse,
  CustomerPortalRequest,
  PlanChangeRequest,
} from '@/types';

// Mock the API client
vi.mock('../api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// Mock window.location
const mockLocation = {
  href: '',
  origin: 'http://localhost:3000',
};
Object.defineProperty(window, 'location', {
  value: mockLocation,
  writable: true,
});

// Mock window.open
const mockOpen = vi.fn();
Object.defineProperty(window, 'open', {
  value: mockOpen,
  writable: true,
});

describe('BillingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.href = '';
  });

  describe('getSubscriptionStatus', () => {
    it('should return subscription status successfully', async () => {
      const mockResponse: SubscriptionStatusResponse = {
        subscription: {
          id: 'sub_123',
          tenantId: 'tenant_123',
          stripeSubscriptionId: 'sub_stripe_123',
          stripeCustomerId: 'cus_123',
          status: 'active',
          planId: 'creator',
          plan: {
            id: 'creator',
            name: 'Creator',
            priceId: 'price_123',
            cognitoGroup: 'creator-tier',
            price: 2900,
            currency: 'USD',
            limits: {
              subscribers: 1000,
              monthlyEmails: 10000,
              customDomain: true,
              sponsorReminders: true,
            },
            features: ['Feature 1', 'Feature 2'],
          },
          currentPeriodStart: '2024-01-01T00:00:00Z',
          currentPeriodEnd: '2024-02-01T00:00:00Z',
          cancelAtPeriodEnd: false,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        hasActiveSubscription: true,
        currentPlan: {
          id: 'creator',
          name: 'Creator',
          priceId: 'price_123',
          cognitoGroup: 'creator-tier',
          price: 2900,
          currency: 'USD',
          limits: {
            subscribers: 1000,
            monthlyEmails: 10000,
            customDomain: true,
            sponsorReminders: true,
          },
          features: ['Feature 1', 'Feature 2'],
        },
        usage: {
          subscribers: {
            current: 250,
            limit: 1000,
            percentage: 25,
          },
          monthlyEmails: {
            current: 1500,
            limit: 10000,
            percentage: 15,
            resetDate: '2024-02-01T00:00:00Z',
          },
        },
      };

      vi.mocked(apiClient.get).mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await billingService.getSubscriptionStatus();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(apiClient.get).toHaveBeenCalledWith('/billing/subscription/status');
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        success: false,
        error: 'API Error',
      });

      const result = await billingService.getSubscriptionStatus();

      expect(result.success).toBe(false);
      expect(result.error).toBe('API Error');
    });
  });

  describe('createCheckoutSession', () => {
    it('should create checkout session successfully', async () => {
      const request: CheckoutSessionRequest = {
        planId: 'creator',
        successUrl: 'http://localhost:3000/billing/success',
        cancelUrl: 'http://localhost:3000/billing/cancel',
      };

      const mockResponse: CheckoutSessionResponse = {
        sessionId: 'cs_123',
        url: 'https://checkout.stripe.com/pay/cs_123',
      };

      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await billingService.createCheckoutSession(request);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(apiClient.post).toHaveBeenCalledWith('/billing/checkout/create', request);
    });

    it('should validate request data', async () => {
      const invalidRequest = {
        planId: '', // Invalid: empty string
      };

      const result = await billingService.createCheckoutSession(invalidRequest as CheckoutSessionRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Plan ID is required');
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('should handle invalid response format', async () => {
      const request: CheckoutSessionRequest = {
        planId: 'creator',
      };

      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: { sessionId: 'cs_123' }, // Missing url
      });

      const result = await billingService.createCheckoutSession(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid checkout session response');
    });
  });

  describe('createCustomerPortalSession', () => {
    it('should create customer portal session successfully', async () => {
      const request: CustomerPortalRequest = {
        returnUrl: 'http://localhost:3000/billing',
      };

      const mockResponse: CustomerPortalResponse = {
        url: 'https://billing.stripe.com/session/123',
      };

      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await billingService.createCustomerPortalSession(request);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(apiClient.post).toHaveBeenCalledWith('/billing/portal/create', request);
    });

    it('should work with empty request', async () => {
      const mockResponse: CustomerPortalResponse = {
        url: 'https://billing.stripe.com/session/123',
      };

      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await billingService.createCustomerPortalSession();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(apiClient.post).toHaveBeenCalledWith('/billing/portal/create', {});
    });
  });

  describe('changePlan', () => {
    it('should change plan successfully', async () => {
      const request: PlanChangeRequest = {
        newPlanId: 'pro',
        prorationBehavior: 'create_prorations',
      };

      const mockResponse = {
        success: true,
        subscription: { id: 'sub_123' },
        message: 'Plan changed successfully',
      };

      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await billingService.changePlan(request);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(apiClient.post).toHaveBeenCalledWith('/billing/subscription/change-plan', request);
    });

    it('should validate request data', async () => {
      const invalidRequest = {
        newPlanId: '', // Invalid: empty string
      };

      const result = await billingService.changePlan(invalidRequest as PlanChangeRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('New plan ID is required');
      expect(apiClient.post).not.toHaveBeenCalled();
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel subscription successfully', async () => {
      const mockResponse = {
        message: 'Subscription cancelled successfully',
        subscription: { id: 'sub_123', cancelAtPeriodEnd: true },
      };

      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await billingService.cancelSubscription();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(apiClient.post).toHaveBeenCalledWith('/billing/subscription/cancel');
    });
  });

  describe('dismissAlert', () => {
    it('should dismiss alert successfully', async () => {
      const alertId = 'alert_123';
      const mockResponse = {
        message: 'Alert dismissed successfully',
      };

      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await billingService.dismissAlert(alertId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(apiClient.post).toHaveBeenCalledWith(`/billing/alerts/${alertId}/dismiss`);
    });

    it('should validate alert ID', async () => {
      const result = await billingService.dismissAlert('');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Alert ID is required');
      expect(apiClient.post).not.toHaveBeenCalled();
    });
  });

  describe('redirect methods', () => {
    it('should redirect to checkout', () => {
      const sessionUrl = 'https://checkout.stripe.com/pay/cs_123';

      billingService.redirectToCheckout(sessionUrl);

      expect(mockLocation.href).toBe(sessionUrl);
    });

    it('should redirect to customer portal', () => {
      const portalUrl = 'https://billing.stripe.com/session/123';

      billingService.redirectToCustomerPortal(portalUrl);

      expect(mockLocation.href).toBe(portalUrl);
    });

    it('should open customer portal in new tab', () => {
      const portalUrl = 'https://billing.stripe.com/session/123';

      billingService.openCustomerPortalInNewTab(portalUrl);

      expect(mockOpen).toHaveBeenCalledWith(portalUrl, '_blank', 'noopener,noreferrer');
    });
  });

  describe('helper methods', () => {
    it('should get billing history via customer portal', async () => {
      const mockResponse: CustomerPortalResponse = {
        url: 'https://billing.stripe.com/session/123',
      };

      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await billingService.getBillingHistory();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(apiClient.post).toHaveBeenCalledWith('/billing/portal/create', {
        returnUrl: 'http://localhost:3000/billing'
      });
    });

    it('should retry payment via customer portal', async () => {
      const mockResponse: CustomerPortalResponse = {
        url: 'https://billing.stripe.com/session/123',
      };

      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await billingService.retryPayment();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(apiClient.post).toHaveBeenCalledWith('/billing/portal/create', {
        returnUrl: 'http://localhost:3000/billing'
      });
    });
  });
});
