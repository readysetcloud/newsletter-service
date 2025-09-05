import type { SubscriptionPlan } from '../types/billing';

// Subscription Plans Configuration
export const SUBSCRIPTION_PLANS: Record<string, SubscriptionPlan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceId: null,
    cognitoGroup: 'free-tier',
    price: 0,
    currency: 'USD',
    limits: {
      subscribers: 500,
      monthlyEmails: 2500,
      customDomain: false,
      sponsorReminders: false,
      apiAccess: false,
      analytics: false,
      support: 'community'
    },
    features: [
      'Up to 500 subscribers',
      '2,500 emails per month',
      'Basic analytics',
      'Community support',
      'Newsletter templates'
    ]
  },
  creator: {
    id: 'creator',
    name: 'Creator',
    priceId: 'price_creator_monthly', // This should match Stripe price ID
    cognitoGroup: 'creator-tier',
    price: 2900, // $29.00 in cents
    currency: 'USD',
    limits: {
      subscribers: 1000,
      monthlyEmails: 10000,
      customDomain: true,
      sponsorReminders: true,
      apiAccess: true,
      analytics: true,
      support: 'email'
    },
    features: [
      'Up to 1,000 subscribers',
      '10,000 emails per month',
      'Custom domain support',
      'Sponsor reminders',
      'API access',
      'Advanced analytics',
      'Email support'
    ],
    popular: true
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceId: 'price_pro_monthly', // This should match Stripe price ID
    cognitoGroup: 'pro-tier',
    price: 9900, // $99.00 in cents
    currency: 'USD',
    limits: {
      subscribers: 10000,
      monthlyEmails: 100000,
      customDomain: true,
      sponsorReminders: true,
      apiAccess: true,
      analytics: true,
      support: 'priority'
    },
    features: [
      'Up to 10,000 subscribers',
      '100,000 emails per month',
      'Custom domain support',
      'Sponsor reminders',
      'API access',
      'Advanced analytics',
      'Priority support',
      'Custom integrations'
    ]
  }
};

// Plan ordering for display
export const PLAN_ORDER = ['free', 'creator', 'pro'];

// Get plans in display order
export const getPlansInOrder = (): SubscriptionPlan[] => {
  return PLAN_ORDER.map(planId => SUBSCRIPTION_PLANS[planId]);
};

// Get plan by ID
export const getPlanById = (planId: string): SubscriptionPlan | null => {
  return SUBSCRIPTION_PLANS[planId] || null;
};

// Billing cycle options
export const BILLING_CYCLES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly (Save 20%)' }
] as const;

// Usage warning thresholds
export const USAGE_THRESHOLDS = {
  WARNING: 80, // Show warning at 80%
  CRITICAL: 95, // Show critical alert at 95%
  BLOCKED: 100 // Block usage at 100%
} as const;

// Billing alert types
export const BILLING_ALERT_TYPES = {
  PAYMENT_FAILED: 'payment_failed',
  USAGE_LIMIT: 'usage_limit',
  SUBSCRIPTION_CANCELLED: 'subscription_cancelled',
  TRIAL_ENDING: 'trial_ending'
} as const;

// Subscription statuses with display information
export const SUBSCRIPTION_STATUS_INFO = {
  active: {
    label: 'Active',
    color: 'green',
    description: 'Your subscription is active and up to date'
  },
  past_due: {
    label: 'Past Due',
    color: 'yellow',
    description: 'Payment is past due. Please update your payment method'
  },
  unpaid: {
    label: 'Unpaid',
    color: 'red',
    description: 'Payment failed. Please update your payment method'
  },
  cancelled: {
    label: 'Cancelled',
    color: 'gray',
    description: 'Subscription cancelled. Access continues until period end'
  },
  incomplete: {
    label: 'Incomplete',
    color: 'yellow',
    description: 'Payment requires additional action'
  },
  incomplete_expired: {
    label: 'Expired',
    color: 'red',
    description: 'Payment incomplete and expired'
  },
  trialing: {
    label: 'Trial',
    color: 'blue',
    description: 'Free trial period'
  }
} as const;

// Format price for display
export const formatPrice = (priceInCents: number, currency = 'USD'): string => {
  if (priceInCents === 0) return 'Free';

  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });

  return formatter.format(priceInCents / 100);
};

// Calculate usage percentage
export const calculateUsagePercentage = (current: number, limit: number): number => {
  if (limit === 0) return 0;
  return Math.min(Math.round((current / limit) * 100), 100);
};

// Get usage status based on percentage
export const getUsageStatus = (percentage: number): 'normal' | 'warning' | 'critical' | 'blocked' => {
  if (percentage >= USAGE_THRESHOLDS.BLOCKED) return 'blocked';
  if (percentage >= USAGE_THRESHOLDS.CRITICAL) return 'critical';
  if (percentage >= USAGE_THRESHOLDS.WARNING) return 'warning';
  return 'normal';
};

// Format usage display
export const formatUsage = (current: number, limit: number): string => {
  const formatter = new Intl.NumberFormat('en-US');
  return `${formatter.format(current)} / ${formatter.format(limit)}`;
};
