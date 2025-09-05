import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UsageDisplay } from '../UsageDisplay';
import type { UsageMetrics, SubscriptionPlan } from '@/types';

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
    apiAccess: true,
    analytics: true,
  },
  features: ['Feature 1', 'Feature 2'],
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

describe('UsageDisplay', () => {
  it('renders usage metrics correctly', () => {
    render(
      <UsageDisplay
        usage={mockUsage}
        plan={mockPlan}
      />
    );

    expect(screen.getByText('Usage & Limits')).toBeInTheDocument();
    expect(screen.getByText('Subscribers')).toBeInTheDocument();
    expect(screen.getByText('Monthly Emails')).toBeInTheDocument();
    expect(screen.getByText('250 / 1,000 (25%)')).toBeInTheDocument();
    expect(screen.getByText('1,500 / 10,000 (15%)')).toBeInTheDocument();
  });

  it('renders plan features correctly', () => {
    render(
      <UsageDisplay
        usage={mockUsage}
        plan={mockPlan}
      />
    );

    expect(screen.getByText('Plan Features')).toBeInTheDocument();
    expect(screen.getByText('Custom Domain')).toBeInTheDocument();
    expect(screen.getByText('Sponsor Reminders')).toBeInTheDocument();
    expect(screen.getByText('API Access')).toBeInTheDocument();
    expect(screen.getByText('Advanced Analytics')).toBeInTheDocument();
  });

  it('shows warning when approaching limits', () => {
    const warningUsage: UsageMetrics = {
      subscribers: {
        current: 850,
        limit: 1000,
        percentage: 85,
      },
      monthlyEmails: {
        current: 1500,
        limit: 10000,
        percentage: 15,
        resetDate: '2024-02-01T00:00:00Z',
      },
    };

    render(
      <UsageDisplay
        usage={warningUsage}
        plan={mockPlan}
        onUpgrade={vi.fn()}
      />
    );

    expect(screen.getByText('Approaching limit')).toBeInTheDocument();
    expect(screen.getByText('Consider Upgrading')).toBeInTheDocument();
  });

  it('shows critical alert when near limits', () => {
    const criticalUsage: UsageMetrics = {
      subscribers: {
        current: 970,
        limit: 1000,
        percentage: 97,
      },
      monthlyEmails: {
        current: 1500,
        limit: 10000,
        percentage: 15,
        resetDate: '2024-02-01T00:00:00Z',
      },
    };

    render(
      <UsageDisplay
        usage={criticalUsage}
        plan={mockPlan}
        onUpgrade={vi.fn()}
      />
    );

    expect(screen.getByText('Near limit - consider upgrading')).toBeInTheDocument();
  });

  it('shows blocked state when limit reached', () => {
    const blockedUsage: UsageMetrics = {
      subscribers: {
        current: 1000,
        limit: 1000,
        percentage: 100,
      },
      monthlyEmails: {
        current: 1500,
        limit: 10000,
        percentage: 15,
        resetDate: '2024-02-01T00:00:00Z',
      },
    };

    render(
      <UsageDisplay
        usage={blockedUsage}
        plan={mockPlan}
        onUpgrade={vi.fn()}
      />
    );

    expect(screen.getByText('Limit reached')).toBeInTheDocument();
    expect(screen.getByText('Limit Reached')).toBeInTheDocument();
    expect(screen.getByText(/You cannot add more subscribers/)).toBeInTheDocument();
  });

  it('calls onUpgrade when upgrade button is clicked', () => {
    const onUpgrade = vi.fn();
    const warningUsage: UsageMetrics = {
      subscribers: {
        current: 850,
        limit: 1000,
        percentage: 85,
      },
      monthlyEmails: {
        current: 1500,
        limit: 10000,
        percentage: 15,
        resetDate: '2024-02-01T00:00:00Z',
      },
    };

    render(
      <UsageDisplay
        usage={warningUsage}
        plan={mockPlan}
        onUpgrade={onUpgrade}
      />
    );

    fireEvent.click(screen.getByText('View Plans'));
    expect(onUpgrade).toHaveBeenCalled();
  });

  it('shows reset date for monthly emails', () => {
    render(
      <UsageDisplay
        usage={mockUsage}
        plan={mockPlan}
      />
    );

    expect(screen.getByText('Resets on Jan 31')).toBeInTheDocument();
  });

  it('does not show upgrade prompt when showUpgradePrompt is false', () => {
    const warningUsage: UsageMetrics = {
      subscribers: {
        current: 850,
        limit: 1000,
        percentage: 85,
      },
      monthlyEmails: {
        current: 1500,
        limit: 10000,
        percentage: 15,
        resetDate: '2024-02-01T00:00:00Z',
      },
    };

    render(
      <UsageDisplay
        usage={warningUsage}
        plan={mockPlan}
        showUpgradePrompt={false}
        onUpgrade={vi.fn()}
      />
    );

    expect(screen.queryByText('Consider Upgrading')).not.toBeInTheDocument();
  });
});
