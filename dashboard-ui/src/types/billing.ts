// Billing and Subscription Types

export interface SubscriptionPlan {
  id: string;
  name: string;
  priceId: string | null;
  cognitoGroup: 'free-tier' | 'creator-tier' | 'pro-tier';
  price: number; // Monthly price in cents
  currency: string;
  limits: PlanLimits;
  features: string[];
  popular?: boolean;
}

export interface PlanLimits {
  subscribers: number;
  monthlyEmails: number;
  customDomain: boolean;
  sponsorReminders: boolean;
  apiAccess?: boolean;
  analytics?: boolean;
  support?: 'community' | 'email' | 'priority';
}

export interface Subscription {
  id: string;
  tenantId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: SubscriptionStatus;
  planId: string;
  plan: SubscriptionPlan;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  cancelledAt?: string;
  trialEnd?: string;
  createdAt: string;
  updatedAt: string;
}

export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'cancelled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing';

export interface SubscriptionStatusResponse {
  subscription: Subscription | null;
  hasActiveSubscription: boolean;
  currentPlan: SubscriptionPlan;
  usage: UsageMetrics;
  billingInfo?: BillingInfo;
}

export interface UsageMetrics {
  subscribers: {
    current: number;
    limit: number;
    percentage: number;
  };
  monthlyEmails: {
    current: number;
    limit: number;
    percentage: number;
    resetDate: string;
  };
}

export interface BillingInfo {
  nextBillingDate?: string;
  lastPaymentDate?: string;
  paymentMethod?: PaymentMethod;
  billingAddress?: BillingAddress;
}

export interface PaymentMethod {
  type: 'card';
  card: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
}

export interface BillingAddress {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
}

// Checkout and Portal Types
export interface CheckoutSessionRequest {
  planId: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CheckoutSessionResponse {
  sessionId: string;
  url: string;
}

export interface CustomerPortalRequest {
  returnUrl?: string;
}

export interface CustomerPortalResponse {
  url: string;
}

// Plan Change Types
export interface PlanChangeRequest {
  newPlanId: string;
  prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice';
}

export interface PlanChangeResponse {
  success: boolean;
  subscription: Subscription;
  message?: string;
}

// Billing Alert Types
export interface BillingAlert {
  id: string;
  type: 'payment_failed' | 'usage_limit' | 'subscription_cancelled' | 'trial_ending';
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  actionRequired: boolean;
  actionUrl?: string;
  createdAt: string;
  dismissedAt?: string;
}

// Form Data Types
export interface PlanSelectionFormData {
  planId: string;
  billingCycle: 'monthly' | 'yearly';
}

export interface BillingPreferencesFormData {
  emailNotifications: boolean;
  usageAlerts: boolean;
  billingReminders: boolean;
}

// API Response Types
export interface BillingApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Error Types
export interface BillingError {
  code: string;
  message: string;
  type: 'validation' | 'payment' | 'subscription' | 'system';
  details?: Record<string, unknown>;
}

// Loading States
export interface BillingLoadingState {
  subscription: boolean;
  checkout: boolean;
  portal: boolean;
  planChange: boolean;
  usage: boolean;
}

// Component Props Types
export interface SubscriptionCardProps {
  subscription: Subscription | null;
  loading?: boolean;
  onUpgrade?: () => void;
  onManage?: () => void;
}

export interface PlanSelectorProps {
  plans: SubscriptionPlan[];
  currentPlanId?: string;
  loading?: boolean;
  onSelectPlan: (planId: string) => void;
}

export interface UsageDisplayProps {
  usage: UsageMetrics;
  plan: SubscriptionPlan;
  showUpgradePrompt?: boolean;
  onUpgrade?: () => void;
}

export interface BillingAlertsProps {
  alerts: BillingAlert[];
  onDismiss: (alertId: string) => void;
  onAction: (alert: BillingAlert) => void;
}
