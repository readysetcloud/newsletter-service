/**
 * @fileoverview Unit tests for subscription data types and validation schemas
 */

import { describe, it, expect } from '@jest/globals';
import {
  SUBSCRIPTION_STATUS,
  COGNITO_GROUPS,
  SUBSCRIPTION_PLANS,
  VALID_STATUS_TRANSITIONS,
  isValidSubscriptionStatus,
  isValidStatusTransition,
  isValidPlanId,
  getPlanById,
  getPlanByPriceId,
  validateSubscriptionRecord,
  createSubscriptionRecord
} from '../functions/billing/types.mjs';

describe('Subscription Types and Validation', () => {
  describe('Constants', () => {
    it('should have correct subscription status values', () => {
      expect(SUBSCRIPTION_STATUS.ACTIVE).toBe('active');
      expect(SUBSCRIPTION_STATUS.CANCELLED).toBe('cancelled');
      expect(SUBSCRIPTION_STATUS.PAST_DUE).toBe('past_due');
      expect(SUBSCRIPTION_STATUS.UNPAID).toBe('unpaid');
      expect(SUBSCRIPTION_STATUS.INCOMPLETE).toBe('incomplete');
      expect(SUBSCRIPTION_STATUS.INCOMPLETE_EXPIRED).toBe('incomplete_expired');
      expect(SUBSCRIPTION_STATUS.TRIALING).toBe('trialing');
    });

    it('should have correct Cognito group values', () => {
      expect(COGNITO_GROUPS.FREE_TIER).toBe('free-tier');
      expect(COGNITO_GROUPS.CREATOR_TIER).toBe('creator-tier');
      expect(COGNITO_GROUPS.PRO_TIER).toBe('pro-tier');
    });

    it('should have subscription plans with correct structure', () => {
      expect(SUBSCRIPTION_PLANS.free).toEqual({
        name: "Free",
        priceId: null,
        cognitoGroup: 'free-tier',
        limits: {
          subscribers: 500,
          monthlyEmails: 2500,
          customDomain: false,
          sponsorReminders: false
        }
      });

      expect(SUBSCRIPTION_PLANS.creator).toEqual({
        name: "Creator",
        priceId: "price_creator_monthly",
        cognitoGroup: 'creator-tier',
        limits: {
          subscribers: 1000,
          monthlyEmails: 10000,
          customDomain: true,
          sponsorReminders: true
        }
      });

      expect(SUBSCRIPTION_PLANS.pro).toEqual({
        name: "Pro",
        priceId: "price_pro_monthly",
        cognitoGroup: 'pro-tier',
        limits: {
          subscribers: 10000,
          monthlyEmails: 100000,
          customDomain: true,
          sponsorReminders: true
        }
      });
    });
  });

  describe('isValidSubscriptionStatus', () => {
    it('should return true for valid statuses', () => {
      expect(isValidSubscriptionStatus('active')).toBe(true);
      expect(isValidSubscriptionStatus('cancelled')).toBe(true);
      expect(isValidSubscriptionStatus('past_due')).toBe(true);
      expect(isValidSubscriptionStatus('unpaid')).toBe(true);
      expect(isValidSubscriptionStatus('incomplete')).toBe(true);
      expect(isValidSubscriptionStatus('incomplete_expired')).toBe(true);
      expect(isValidSubscriptionStatus('trialing')).toBe(true);
    });

    it('should return false for invalid statuses', () => {
      expect(isValidSubscriptionStatus('invalid')).toBe(false);
      expect(isValidSubscriptionStatus('')).toBe(false);
      expect(isValidSubscriptionStatus(null)).toBe(false);
      expect(isValidSubscriptionStatus(undefined)).toBe(false);
    });
  });

  describe('isValidStatusTransition', () => {
    it('should allow valid transitions from incomplete', () => {
      expect(isValidStatusTransition('incomplete', 'active')).toBe(true);
      expect(isValidStatusTransition('incomplete', 'incomplete_expired')).toBe(true);
      expect(isValidStatusTransition('incomplete', 'cancelled')).toBe(true);
    });

    it('should allow valid transitions from active', () => {
      expect(isValidStatusTransition('active', 'cancelled')).toBe(true);
      expect(isValidStatusTransition('active', 'past_due')).toBe(true);
      expect(isValidStatusTransition('active', 'unpaid')).toBe(true);
    });

    it('should allow valid transitions from cancelled', () => {
      expect(isValidStatusTransition('cancelled', 'active')).toBe(true);
    });

    it('should reject invalid transitions', () => {
      expect(isValidStatusTransition('active', 'incomplete')).toBe(false);
      expect(isValidStatusTransition('cancelled', 'past_due')).toBe(false);
      expect(isValidStatusTransition('unpaid', 'incomplete')).toBe(false);
    });

    it('should reject transitions with invalid statuses', () => {
      expect(isValidStatusTransition('invalid', 'active')).toBe(false);
      expect(isValidStatusTransition('active', 'invalid')).toBe(false);
      expect(isValidStatusTransition('invalid', 'invalid')).toBe(false);
    });
  });

  describe('isValidPlanId', () => {
    it('should return true for valid plan IDs', () => {
      expect(isValidPlanId('free')).toBe(true);
      expect(isValidPlanId('creator')).toBe(true);
      expect(isValidPlanId('pro')).toBe(true);
    });

    it('should return false for invalid plan IDs', () => {
      expect(isValidPlanId('invalid')).toBe(false);
      expect(isValidPlanId('')).toBe(false);
      expect(isValidPlanId(null)).toBe(false);
      expect(isValidPlanId(undefined)).toBe(false);
    });
  });

  describe('getPlanById', () => {
    it('should return plan details for valid plan IDs', () => {
      const freePlan = getPlanById('free');
      expect(freePlan).toEqual(SUBSCRIPTION_PLANS.free);

      const creatorPlan = getPlanById('creator');
      expect(creatorPlan).toEqual(SUBSCRIPTION_PLANS.creator);

      const proPlan = getPlanById('pro');
      expect(proPlan).toEqual(SUBSCRIPTION_PLANS.pro);
    });

    it('should return null for invalid plan IDs', () => {
      expect(getPlanById('invalid')).toBeNull();
      expect(getPlanById('')).toBeNull();
      expect(getPlanById(null)).toBeNull();
      expect(getPlanById(undefined)).toBeNull();
    });
  });

  describe('getPlanByPriceId', () => {
    it('should return plan ID for valid price IDs', () => {
      expect(getPlanByPriceId('price_creator_monthly')).toBe('creator');
      expect(getPlanByPriceId('price_pro_monthly')).toBe('pro');
    });

    it('should return null for free plan (no price ID)', () => {
      // Free plan has null priceId, so searching for null should not return the free plan
      // because we're looking for plans BY their priceId, not plans WITH null priceId
      expect(getPlanByPriceId(null)).toBeNull();
    });

    it('should return null for invalid price IDs', () => {
      expect(getPlanByPriceId('invalid_price')).toBeNull();
      expect(getPlanByPriceId('')).toBeNull();
      expect(getPlanByPriceId(undefined)).toBeNull();
    });
  });

  describe('validateSubscriptionRecord', () => {
    const validRecord = {
      pk: 'tenant123',
      sk: 'subscription',
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_123',
      status: 'active',
      planId: 'pro',
      currentPeriodStart: '2024-01-01T00:00:00Z',
      currentPeriodEnd: '2024-02-01T00:00:00Z',
      cancelAtPeriodEnd: false,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    };

    it('should validate a correct subscription record', () => {
      const result = validateSubscriptionRecord(validRecord);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject record with missing required fields', () => {
      const invalidRecord = { ...validRecord };
      delete invalidRecord.pk;
      delete invalidRecord.status;

      const result = validateSubscriptionRecord(invalidRecord);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required field: pk');
      expect(result.errors).toContain('Missing required field: status');
    });

    it('should reject record with invalid sort key', () => {
      const invalidRecord = { ...validRecord, sk: 'invalid' };

      const result = validateSubscriptionRecord(invalidRecord);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Sort key must be "subscription"');
    });

    it('should reject record with invalid status', () => {
      const invalidRecord = { ...validRecord, status: 'invalid_status' };

      const result = validateSubscriptionRecord(invalidRecord);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid subscription status: invalid_status');
    });

    it('should reject record with invalid plan ID', () => {
      const invalidRecord = { ...validRecord, planId: 'invalid_plan' };

      const result = validateSubscriptionRecord(invalidRecord);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid plan ID: invalid_plan');
    });

    it('should reject record with invalid cancelAtPeriodEnd type', () => {
      const invalidRecord = { ...validRecord, cancelAtPeriodEnd: 'not_boolean' };

      const result = validateSubscriptionRecord(invalidRecord);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('cancelAtPeriodEnd must be a boolean');
    });

    it('should reject record with invalid date formats', () => {
      const invalidRecord = {
        ...validRecord,
        currentPeriodStart: 'invalid_date',
        createdAt: 'another_invalid_date'
      };

      const result = validateSubscriptionRecord(invalidRecord);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid date format for currentPeriodStart: invalid_date');
      expect(result.errors).toContain('Invalid date format for createdAt: another_invalid_date');
    });

    it('should accept false as valid value for cancelAtPeriodEnd', () => {
      const recordWithFalse = { ...validRecord, cancelAtPeriodEnd: false };

      const result = validateSubscriptionRecord(recordWithFalse);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('createSubscriptionRecord', () => {
    const params = {
      tenantId: 'tenant123',
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_123',
      status: 'active',
      planId: 'pro',
      currentPeriodStart: '2024-01-01T00:00:00Z',
      currentPeriodEnd: '2024-02-01T00:00:00Z'
    };

    it('should create a valid subscription record with default values', () => {
      const record = createSubscriptionRecord(params);

      expect(record.pk).toBe('tenant123');
      expect(record.sk).toBe('subscription');
      expect(record.stripeSubscriptionId).toBe('sub_123');
      expect(record.stripeCustomerId).toBe('cus_123');
      expect(record.status).toBe('active');
      expect(record.planId).toBe('pro');
      expect(record.currentPeriodStart).toBe('2024-01-01T00:00:00Z');
      expect(record.currentPeriodEnd).toBe('2024-02-01T00:00:00Z');
      expect(record.cancelAtPeriodEnd).toBe(false);
      expect(record.createdAt).toBeDefined();
      expect(record.updatedAt).toBeDefined();
      expect(new Date(record.createdAt)).toBeInstanceOf(Date);
      expect(new Date(record.updatedAt)).toBeInstanceOf(Date);
    });

    it('should create a record with custom cancelAtPeriodEnd value', () => {
      const paramsWithCancel = { ...params, cancelAtPeriodEnd: true };
      const record = createSubscriptionRecord(paramsWithCancel);

      expect(record.cancelAtPeriodEnd).toBe(true);
    });

    it('should create a record that passes validation', () => {
      const record = createSubscriptionRecord(params);
      const validation = validateSubscriptionRecord(record);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });
});
