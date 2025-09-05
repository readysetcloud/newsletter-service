import { z } from 'zod';

// Plan Selection Schema
export const planSelectionSchema = z.object({
  planId: z
    .string()
    .min(1, 'Please select a plan'),

  billingCycle: z
    .enum(['monthly', 'yearly'], {
      required_error: 'Please select a billing cycle'
    })
    .default('monthly')
});

export type PlanSelectionFormData = z.infer<typeof planSelectionSchema>;

// Billing Preferences Schema
export const billingPreferencesSchema = z.object({
  emailNotifications: z
    .boolean()
    .default(true),

  usageAlerts: z
    .boolean()
    .default(true),

  billingReminders: z
    .boolean()
    .default(true)
});

export type BillingPreferencesFormData = z.infer<typeof billingPreferencesSchema>;

// Checkout Session Request Schema
export const checkoutSessionRequestSchema = z.object({
  planId: z
    .string()
    .min(1, 'Plan ID is required'),

  successUrl: z
    .string()
    .url('Invalid success URL')
    .optional(),

  cancelUrl: z
    .string()
    .url('Invalid cancel URL')
    .optional()
});

export type CheckoutSessionRequestData = z.infer<typeof checkoutSessionRequestSchema>;

// Customer Portal Request Schema
export const customerPortalRequestSchema = z.object({
  returnUrl: z
    .string()
    .url('Invalid return URL')
    .optional()
});

export type CustomerPortalRequestData = z.infer<typeof customerPortalRequestSchema>;

// Plan Change Request Schema
export const planChangeRequestSchema = z.object({
  newPlanId: z
    .string()
    .min(1, 'New plan ID is required'),

  prorationBehavior: z
    .enum(['create_prorations', 'none', 'always_invoice'])
    .default('create_prorations')
    .optional()
});

export type PlanChangeRequestData = z.infer<typeof planChangeRequestSchema>;

// Subscription Status Validation
export const subscriptionStatusSchema = z.enum([
  'active',
  'past_due',
  'unpaid',
  'cancelled',
  'incomplete',
  'incomplete_expired',
  'trialing'
]);

// Plan Limits Schema
export const planLimitsSchema = z.object({
  subscribers: z.number().min(0),
  monthlyEmails: z.number().min(0),
  customDomain: z.boolean(),
  sponsorReminders: z.boolean(),
  apiAccess: z.boolean().optional(),
  analytics: z.boolean().optional(),
  support: z.enum(['community', 'email', 'priority']).optional()
});

// Subscription Plan Schema
export const subscriptionPlanSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  priceId: z.string().nullable(),
  cognitoGroup: z.enum(['free-tier', 'creator-tier', 'pro-tier']),
  price: z.number().min(0),
  currency: z.string().length(3),
  limits: planLimitsSchema,
  features: z.array(z.string()),
  popular: z.boolean().optional()
});

// Usage Metrics Schema
export const usageMetricsSchema = z.object({
  subscribers: z.object({
    current: z.number().min(0),
    limit: z.number().min(0),
    percentage: z.number().min(0).max(100)
  }),
  monthlyEmails: z.object({
    current: z.number().min(0),
    limit: z.number().min(0),
    percentage: z.number().min(0).max(100),
    resetDate: z.string()
  })
});

// Subscription Schema
export const subscriptionSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  stripeSubscriptionId: z.string().min(1),
  stripeCustomerId: z.string().min(1),
  status: subscriptionStatusSchema,
  planId: z.string().min(1),
  plan: subscriptionPlanSchema,
  currentPeriodStart: z.string(),
  currentPeriodEnd: z.string(),
  cancelAtPeriodEnd: z.boolean(),
  cancelledAt: z.string().optional(),
  trialEnd: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

// Billing Alert Schema
export const billingAlertSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['payment_failed', 'usage_limit', 'subscription_cancelled', 'trial_ending']),
  severity: z.enum(['info', 'warning', 'error']),
  title: z.string().min(1),
  message: z.string().min(1),
  actionRequired: z.boolean(),
  actionUrl: z.string().url().optional(),
  createdAt: z.string(),
  dismissedAt: z.string().optional()
});

// API Response Schemas
export const billingApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.string().optional(),
    message: z.string().optional()
  });

export const subscriptionStatusResponseSchema = z.object({
  subscription: subscriptionSchema.nullable(),
  hasActiveSubscription: z.boolean(),
  currentPlan: subscriptionPlanSchema,
  usage: usageMetricsSchema,
  billingInfo: z.object({
    nextBillingDate: z.string().optional(),
    lastPaymentDate: z.string().optional(),
    paymentMethod: z.object({
      type: z.literal('card'),
      card: z.object({
        brand: z.string(),
        last4: z.string(),
        expMonth: z.number(),
        expYear: z.number()
      })
    }).optional(),
    billingAddress: z.object({
      line1: z.string(),
      line2: z.string().optional(),
      city: z.string(),
      state: z.string().optional(),
      postalCode: z.string(),
      country: z.string()
    }).optional()
  }).optional()
});

export const checkoutSessionResponseSchema = z.object({
  sessionId: z.string().min(1),
  url: z.string().url()
});

export const customerPortalResponseSchema = z.object({
  url: z.string().url()
});

export const planChangeResponseSchema = z.object({
  success: z.boolean(),
  subscription: subscriptionSchema,
  message: z.string().optional()
});

// Validation helpers
export const validatePlanSelection = (data: unknown) => {
  return planSelectionSchema.safeParse(data);
};

export const validateCheckoutRequest = (data: unknown) => {
  return checkoutSessionRequestSchema.safeParse(data);
};

export const validatePortalRequest = (data: unknown) => {
  return customerPortalRequestSchema.safeParse(data);
};

export const validatePlanChangeRequest = (data: unknown) => {
  return planChangeRequestSchema.safeParse(data);
};

export const validateSubscriptionStatus = (data: unknown) => {
  return subscriptionStatusResponseSchema.safeParse(data);
};
