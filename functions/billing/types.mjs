/**
 * @fileoverview Subscription data types and validation schemas for Stripe payment integration
 */

/**
 * Subscription status enum
 * @readonly
 * @enum {string}
 */
export const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  CANCELLED: 'cancelled',
  PAST_DUE: 'past_due',
  UNPAID: 'unpaid',
  INCOMPLETE: 'incomplete',
  INCOMPLETE_EXPIRED: 'incomplete_expired',
  TRIALING: 'trialing'
};

/**
 * Cognito group tiers
 * @readonly
 * @enum {string}
 */
export const COGNITO_GROUPS = {
  FREE_TIER: 'free-tier',
  CREATOR_TIER: 'creator-tier',
  PRO_TIER: 'pro-tier'
};

/**
 * Subscription plan configuration
 * @readonly
 */
export const SUBSCRIPTION_PLANS = {
  free: {
    name: "Free",
    priceId: null,
    cognitoGroup: COGNITO_GROUPS.FREE_TIER,
    limits: {
      subscribers: 500,
      monthlyEmails: 2500,
      customDomain: false,
      sponsorReminders: false
    }
  },
  creator: {
    name: "Creator",
    priceId: "price_creator_monthly",
    cognitoGroup: COGNITO_GROUPS.CREATOR_TIER,
    limits: {
      subscribers: 1000,
      monthlyEmails: 10000,
      customDomain: true,
      sponsorReminders: true
    }
  },
  pro: {
    name: "Pro",
    priceId: "price_pro_monthly",
    cognitoGroup: COGNITO_GROUPS.PRO_TIER,
    limits: {
      subscribers: 10000,
      monthlyEmails: 100000,
      customDomain: true,
      sponsorReminders: true
    }
  }
};

/**
 * Valid subscription status transitions
 * @readonly
 */
export const VALID_STATUS_TRANSITIONS = {
  [SUBSCRIPTION_STATUS.INCOMPLETE]: [
    SUBSCRIPTION_STATUS.ACTIVE,
    SUBSCRIPTION_STATUS.INCOMPLETE_EXPIRED,
    SUBSCRIPTION_STATUS.CANCELLED
  ],
  [SUBSCRIPTION_STATUS.INCOMPLETE_EXPIRED]: [
    SUBSCRIPTION_STATUS.ACTIVE,
    SUBSCRIPTION_STATUS.CANCELLED
  ],
  [SUBSCRIPTION_STATUS.TRIALING]: [
    SUBSCRIPTION_STATUS.ACTIVE,
    SUBSCRIPTION_STATUS.CANCELLED,
    SUBSCRIPTION_STATUS.PAST_DUE
  ],
  [SUBSCRIPTION_STATUS.ACTIVE]: [
    SUBSCRIPTION_STATUS.CANCELLED,
    SUBSCRIPTION_STATUS.PAST_DUE,
    SUBSCRIPTION_STATUS.UNPAID
  ],
  [SUBSCRIPTION_STATUS.PAST_DUE]: [
    SUBSCRIPTION_STATUS.ACTIVE,
    SUBSCRIPTION_STATUS.CANCELLED,
    SUBSCRIPTION_STATUS.UNPAID
  ],
  [SUBSCRIPTION_STATUS.UNPAID]: [
    SUBSCRIPTION_STATUS.ACTIVE,
    SUBSCRIPTION_STATUS.CANCELLED
  ],
  [SUBSCRIPTION_STATUS.CANCELLED]: [
    SUBSCRIPTION_STATUS.ACTIVE
  ]
};

/**
 * Subscription record structure for DynamoDB
 * @typedef {Object} SubscriptionRecord
 * @property {string} pk - Partition key: tenant ID
 * @property {string} sk - Sort key: "subscription"
 * @property {string} stripeSubscriptionId - Stripe subscription ID
 * @property {string} stripeCustomerId - Stripe customer ID
 * @property {string} status - Current subscription status
 * @property {string} planId - Plan identifier (free, creator, pro)
 * @property {string} currentPeriodStart - ISO string of period start
 * @property {string} currentPeriodEnd - ISO string of period end
 * @property {boolean} cancelAtPeriodEnd - Whether subscription cancels at period end
 * @property {string} createdAt - ISO string of creation date
 * @property {string} updatedAt - ISO string of last update
 */

/**
 * Subscription plan details
 * @typedef {Object} SubscriptionPlan
 * @property {string} name - Display name of the plan
 * @property {string|null} priceId - Stripe price ID (null for free)
 * @property {string} cognitoGroup - Associated Cognito group
 * @property {Object} limits - Plan usage limits
 * @property {number} limits.subscribers - Maximum subscribers
 * @property {number} limits.monthlyEmails - Maximum monthly emails
 * @property {boolean} limits.customDomain - Custom domain allowed
 * @property {boolean} limits.sponsorReminders - Sponsor reminders enabled
 */

/**
 * Validates subscription status
 * @param {string} status - Status to validate
 * @returns {boolean} True if valid status
 */
export function isValidSubscriptionStatus(status) {
  return Object.values(SUBSCRIPTION_STATUS).includes(status);
}

/**
 * Validates subscription status transition
 * @param {string} fromStatus - Current status
 * @param {string} toStatus - Target status
 * @returns {boolean} True if transition is valid
 */
export function isValidStatusTransition(fromStatus, toStatus) {
  if (!isValidSubscriptionStatus(fromStatus) || !isValidSubscriptionStatus(toStatus)) {
    return false;
  }

  const validTransitions = VALID_STATUS_TRANSITIONS[fromStatus] || [];
  return validTransitions.includes(toStatus);
}

/**
 * Validates subscription plan ID
 * @param {string} planId - Plan ID to validate
 * @returns {boolean} True if valid plan ID
 */
export function isValidPlanId(planId) {
  return Object.keys(SUBSCRIPTION_PLANS).includes(planId);
}

/**
 * Gets plan details by plan ID
 * @param {string} planId - Plan ID
 * @returns {SubscriptionPlan|null} Plan details or null if not found
 */
export function getPlanById(planId) {
  return SUBSCRIPTION_PLANS[planId] || null;
}

/**
 * Gets plan ID by Stripe price ID
 * @param {string} priceId - Stripe price ID
 * @returns {string|null} Plan ID or null if not found
 */
export function getPlanByPriceId(priceId) {
  // Don't match null/undefined priceIds
  if (!priceId) {
    return null;
  }

  for (const [planId, plan] of Object.entries(SUBSCRIPTION_PLANS)) {
    if (plan.priceId === priceId) {
      return planId;
    }
  }
  return null;
}

/**
 * Validates subscription record structure
 * @param {Object} record - Subscription record to validate
 * @returns {Object} Validation result with isValid boolean and errors array
 */
export function validateSubscriptionRecord(record) {
  const errors = [];

  // Required fields
  const requiredFields = [
    'pk', 'sk', 'stripeSubscriptionId', 'stripeCustomerId',
    'status', 'planId', 'currentPeriodStart', 'currentPeriodEnd',
    'cancelAtPeriodEnd', 'createdAt', 'updatedAt'
  ];

  for (const field of requiredFields) {
    if (!record[field] && record[field] !== false) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate specific fields
  if (record.sk && record.sk !== 'subscription') {
    errors.push('Sort key must be "subscription"');
  }

  if (record.status && !isValidSubscriptionStatus(record.status)) {
    errors.push(`Invalid subscription status: ${record.status}`);
  }

  if (record.planId && !isValidPlanId(record.planId)) {
    errors.push(`Invalid plan ID: ${record.planId}`);
  }

  if (record.cancelAtPeriodEnd && typeof record.cancelAtPeriodEnd !== 'boolean') {
    errors.push('cancelAtPeriodEnd must be a boolean');
  }

  // Validate date formats
  const dateFields = ['currentPeriodStart', 'currentPeriodEnd', 'createdAt', 'updatedAt'];
  for (const field of dateFields) {
    if (record[field] && isNaN(Date.parse(record[field]))) {
      errors.push(`Invalid date format for ${field}: ${record[field]}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Creates a subscription record with default values
 * @param {Object} params - Subscription parameters
 * @param {string} params.tenantId - Tenant ID
 * @param {string} params.stripeSubscriptionId - Stripe subscription ID
 * @param {string} params.stripeCustomerId - Stripe customer ID
 * @param {string} params.status - Subscription status
 * @param {string} params.planId - Plan ID
 * @param {string} params.currentPeriodStart - Period start date
 * @param {string} params.currentPeriodEnd - Period end date
 * @param {boolean} [params.cancelAtPeriodEnd=false] - Cancel at period end
 * @returns {SubscriptionRecord} Formatted subscription record
 */
export function createSubscriptionRecord({
  tenantId,
  stripeSubscriptionId,
  stripeCustomerId,
  status,
  planId,
  currentPeriodStart,
  currentPeriodEnd,
  cancelAtPeriodEnd = false
}) {
  const now = new Date().toISOString();

  return {
    pk: tenantId,
    sk: 'subscription',
    stripeSubscriptionId,
    stripeCustomerId,
    status,
    planId,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    createdAt: now,
    updatedAt: now
  };
}
