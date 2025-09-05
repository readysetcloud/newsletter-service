import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BillingManagement } from '../BillingManagement';
import { billingService } from '@/services';
import type { Subscription, BillingInfo } from '@/types';

// Mock the billing service
vi.mock('@/services', () => ({
  billingService: {
    createCustomerPortalSession: vi.fn(),
    redirectToCustomerPortal: vi.fn(),
  },
}));

const mockSubscription: Subscription = {
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
};

const mockBillingInfo: BillingInfo = {
  nextBillingDate: '2024-02-01T00:00:00Z',
  paymentMethod: {
    type: 'card',
    card: {
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2025,
    },
  },
};

describe('BillingManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', () => {
    render(
      <BillingManagement
        subscription={null}
        loading={true}
      />
    );

    expect(screen.getByText('Billing Management')).toBeInTheDocument();
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders billing management interface', () => {
    render(
      <BillingManagement
        subscription={mockSubscription}
        billingInfo={mockBillingInfo}
      />
    );

    expect(screen.getByText('Billing Management')).toBeInTheDocument();
    expect(screen.getByText('Update Payment Method')).toBeInTheDocument();
    expect(screen.getAllByText('View Invoices')).toHaveLength(2); // Title and button
    expect(screen.getByText('Manage Subscription')).toBeInTheDocument();
  });

  it('shows current payment method', () => {
    render(
      <BillingManagement
        subscription={mockSubscription}
        billingInfo={mockBillingInfo}
      />
    );

    expect(screen.getByText('Current Payment Method')).toBeInTheDocument();
    expect(screen.getByText('VISA ••••4242 expires 12/2025')).toBeInTheDocument();
  });

  it('shows active subscription info', () => {
    render(
      <BillingManagement
        subscription={mockSubscription}
        billingInfo={mockBillingInfo}
      />
    );

    expect(screen.getByText('Active Subscription')).toBeInTheDocument();
    expect(screen.getByText(/Creator plan/)).toBeInTheDocument();
  });

  it('handles customer portal access for payment method', async () => {
    const mockResponse = {
      success: true,
      data: { url: 'https://billing.stripe.com/session/123' }
    };

    vi.mocked(billingService.createCustomerPortalSession).mockResolvedValue(mockResponse);

    render(
      <BillingManagement
        subscription={mockSubscription}
        billingInfo={mockBillingInfo}
      />
    );

    fireEvent.click(screen.getByText('Manage Payment'));

    await waitFor(() => {
      expect(billingService.createCustomerPortalSession).toHaveBeenCalledWith({
        returnUrl: expect.stringContaining('/billing')
      });
    });

    expect(billingService.redirectToCustomerPortal).toHaveBeenCalledWith(
      'https://billing.stripe.com/session/123'
    );
  });

  it('handles customer portal access for invoices', async () => {
    const mockResponse = {
      success: true,
      data: { url: 'https://billing.stripe.com/session/123' }
    };

    vi.mocked(billingService.createCustomerPortalSession).mockResolvedValue(mockResponse);

    render(
      <BillingManagement
        subscription={mockSubscription}
        billingInfo={mockBillingInfo}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /view invoices/i }));

    await waitFor(() => {
      expect(billingService.createCustomerPortalSession).toHaveBeenCalled();
    });
  });

  it('handles customer portal access for subscription management', async () => {
    const mockResponse = {
      success: true,
      data: { url: 'https://billing.stripe.com/session/123' }
    };

    vi.mocked(billingService.createCustomerPortalSession).mockResolvedValue(mockResponse);

    render(
      <BillingManagement
        subscription={mockSubscription}
        billingInfo={mockBillingInfo}
      />
    );

    fireEvent.click(screen.getByText('Manage Plan'));

    await waitFor(() => {
      expect(billingService.createCustomerPortalSession).toHaveBeenCalled();
    });
  });

  it('handles customer portal errors', async () => {
    const onError = vi.fn();
    const mockResponse = {
      success: false,
      error: 'Failed to create portal session'
    };

    vi.mocked(billingService.createCustomerPortalSession).mockResolvedValue(mockResponse);

    render(
      <BillingManagement
        subscription={mockSubscription}
        billingInfo={mockBillingInfo}
        onError={onError}
      />
    );

    fireEvent.click(screen.getByText('Manage Payment'));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Failed to create portal session');
    });
  });

  it('shows security information', () => {
    render(
      <BillingManagement
        subscription={mockSubscription}
        billingInfo={mockBillingInfo}
      />
    );

    expect(screen.getByText('Secure Billing Management')).toBeInTheDocument();
    expect(screen.getByText(/All billing operations are handled securely/)).toBeInTheDocument();
  });

  it('works without billing info', () => {
    render(
      <BillingManagement
        subscription={mockSubscription}
      />
    );

    expect(screen.getByText('Billing Management')).toBeInTheDocument();
    expect(screen.queryByText('Current Payment Method')).not.toBeInTheDocument();
  });

  it('works without subscription', () => {
    render(
      <BillingManagement
        subscription={null}
      />
    );

    expect(screen.getByText('Billing Management')).toBeInTheDocument();
    expect(screen.queryByText('Active Subscription')).not.toBeInTheDocument();
  });
});
