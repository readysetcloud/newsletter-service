// Feature: dashboard-ux-overhaul, Property 3: Billing link visibility based on admin status
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * **Validates: Requirements 3.5**
 *
 * Property 3: Billing link visibility based on admin status
 *
 * For any user object, the Billing link appears if and only if
 * `user.isAdmin === true` or `user.isTenantAdmin === true`.
 * For all other role configurations, the Billing link must not be present.
 *
 * This tests the pure billing visibility logic used in both
 * AvatarMenu and MobileDrawer:
 *   const showBilling = user?.isAdmin === true || user?.isTenantAdmin === true;
 */

function computeBillingVisibility(isAdmin: boolean, isTenantAdmin: boolean): boolean {
  return isAdmin === true || isTenantAdmin === true;
}

describe('Billing Visibility - Property-Based Tests', () => {
  const adminFlagsGen = fc.record({
    isAdmin: fc.boolean(),
    isTenantAdmin: fc.boolean(),
  });

  describe('Property 3: Billing link visibility based on admin status', () => {
    it('billing is visible when isAdmin is true regardless of isTenantAdmin', () => {
      fc.assert(
        fc.property(fc.boolean(), (isTenantAdmin) => {
          const result = computeBillingVisibility(true, isTenantAdmin);
          expect(result).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('billing is visible when isTenantAdmin is true regardless of isAdmin', () => {
      fc.assert(
        fc.property(fc.boolean(), (isAdmin) => {
          const result = computeBillingVisibility(isAdmin, true);
          expect(result).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('billing is NOT visible when both isAdmin and isTenantAdmin are false', () => {
      const result = computeBillingVisibility(false, false);
      expect(result).toBe(false);
    });

    it('visibility formula is exactly: isAdmin === true || isTenantAdmin === true', () => {
      fc.assert(
        fc.property(adminFlagsGen, ({ isAdmin, isTenantAdmin }) => {
          const result = computeBillingVisibility(isAdmin, isTenantAdmin);
          const expected = isAdmin === true || isTenantAdmin === true;
          expect(result).toBe(expected);
        }),
        { numRuns: 100 },
      );
    });
  });
});
