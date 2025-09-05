import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubscriptionStatusCard } from '../SubscriptionStatusCard';
import type { Subscription, SubscriptionPlan, UsageMetrics, BillingInfo } from '@/types';

const mockPlan: SubscriptionPlan = {
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
};

const mockSubscription: Subscription = {
  id: 'sub_123',
  tenantId: 'tenant_123',
  stripeSubscriptionId: 'sub_stripe_123',
  stripeCustomerId: 'cus_123',
  status: 'active',
  planId: 'creator',
  plan: mockPlan,
  currentPeriodStart: '2024-01-01T00:00:00Z',
  currentPeriodEnd: '2024-02-01T00:00:00Z',
  cancelAtPeriodEnd: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockUsage: UsageMetrics = {
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

describe('SubscriptionStatusCard', () => {
  it('renders loading state', () => {
    render(
      <SubscriptionStatusCard
        subscription={null}
        plan={mockPlan}
        loading={true}
      />
    );

    expect(screen.getByText('Subscription Status')).toBeInTheDocument();
    expect(screen.getByText('Subscription Status')).toBeInTheDocument();
    // Check for loading skeleton
    expect(screen.getByText('Subscription Status')).toBeInTheDocument();
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders free plan without subscription', () => {
    const freePlan = { ...mockPlan, id: 'free', name: 'Free', price: 0 };

    render(
      <SubscriptionStatusCard
        subscription={null}
        plan={freePlan}
      />
    );

    expect(screen.getByText('Free Plan')).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('renders active subscription', () => {
    render(
      <SubscriptionStatusCard
        subscription={mockSubscription}
        plan={mockPlan}
        usage={mockUsage}
        billingInfo={mockBillingInfo}
      />
    );

    expect(screen.getByText('Creator Plan')).toBeInTheDocument();
    expect(screen.getByText('$29')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('January 31, 2024')).toBeInTheDocument();
    expect(screen.getByText('VISA ••••4242')).toBeInTheDocument();
  });

  it('renders cancelled subscription notice', () => {
    const cancelledSubscription = { ...mockSubscription, cancelAtPeriodEnd: true };

    render(
      <SubscriptionStatusCard
        subscription={cancelledSubscription}
        plan={mockPlan}
      />
    );

    expect(screen.getByText('Subscription Cancelled')).toBeInTheDocument();
    expect(screen.getByText(/will end on January 31, 2024/)).toBeInTheDocument();
  });

  it('renders usage information', () => {
    render(
      <SubscriptionStatusCard
        subscription={mockSubscription}
        plan={mockPlan}
        usage={mockUsage}
      />
    );

    expect(screen.getByText('Current Usage')).toBeInTheDocument();
    expect(screen.getByText('250 / 1,000')).toBeInTheDocument();
    expect(screen.getByText('1,500 / 10,000')).toBeInTheDocument();
  });

  it('calls onUpgrade when upgrade button is clicked', () => {
    const onUpgrade = vi.fn();

    render(
      <SubscriptionStatusCard
        subscription={null}
        plan={mockPlan}
        onUpgrade={onUpgrade}
      />
    );

    fireEvent.click(screen.getByText('Subscribe Now'));
    expect(onUpgrade).toHaveBeenCalled();
  });

  it('calls onManage when manage button is clicked', () => {
    const onManage = vi.fn();

    render(
      <SubscriptionStatusCard
        subscription={mockSubscription}
        plan={mockPlan}
        onManage={onManage}
      />
    );

    fireEvent.click(screen.getByText('Manage Subscription'));
    expect(onManage).toHaveBeenCalled();
  });

  it('renders past due status correctly', () => {
    const pastDueSubscription = { ...mockSubscription, status: 'past_due' as const };

    render(
      <SubscriptionStatusCard
        subscription={pastDueSubscription}
        plan={mockPlan}
        onManage={vi.fn()}
      />
    );

    expect(screen.getByText('Past Due')).toBeInTheDocument();
    expect(screen.getByText('Update Payment')).toBeInTheDocument();
  });
});
