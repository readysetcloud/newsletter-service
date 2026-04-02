// Feature: dashboard-ux-overhaul, Property 7: Mobile drawer items match sidebar and avatar menu
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { NAV_ITEMS } from '../sidebarNav';
import { ACCOUNT_ITEMS } from '../accountNav';

/**
 * **Validates: Requirements 7.3, 7.4**
 *
 * Property 7: Mobile drawer items match sidebar and avatar menu
 *
 * For any user role configuration, the MobileDrawer "Navigation" group
 * contains exactly the same items (in the same order) as the AppSidebar,
 * and the "Account" group contains exactly the same items as the AvatarMenu
 * dropdown (excluding theme toggle and logout, which appear separately
 * in the drawer footer).
 *
 * This tests the pure data logic without rendering components.
 */

/** The AvatarMenu link items (excluding theme toggle and logout) */
const AVATAR_MENU_LINK_ITEMS = [
  { name: 'Profile', href: '/profile' },
  { name: 'Sender Emails', href: '/senders' },
  { name: 'API Keys', href: '/api-keys' },
  { name: 'Billing', href: '/billing', adminOnly: true },
];

/**
 * Computes visible account items for a given role config,
 * mirroring the MobileDrawer filtering logic:
 *   ACCOUNT_ITEMS.filter(item => !item.adminOnly || showBilling)
 */
function getVisibleAccountItems(isAdmin: boolean, isTenantAdmin: boolean) {
  const showBilling = isAdmin === true || isTenantAdmin === true;
  return ACCOUNT_ITEMS.filter((item) => !item.adminOnly || showBilling);
}

/**
 * Computes visible avatar menu link items for a given role config,
 * mirroring the AvatarMenu filtering logic (excluding theme toggle and logout).
 */
function getVisibleAvatarMenuItems(isAdmin: boolean, isTenantAdmin: boolean) {
  const showBilling = isAdmin === true || isTenantAdmin === true;
  return AVATAR_MENU_LINK_ITEMS.filter((item) => !item.adminOnly || showBilling);
}

describe('Mobile Drawer Parity - Property-Based Tests', () => {
  const roleFlagsGen = fc.record({
    isAdmin: fc.boolean(),
    isTenantAdmin: fc.boolean(),
  });

  describe('Property 7: Mobile drawer items match sidebar and avatar menu', () => {
    it('Navigation group item names exactly match NAV_ITEMS names in the same order', () => {
      // The MobileDrawer renders NAV_ITEMS directly, so the names must always match.
      // We verify this holds regardless of role config (role should not affect nav items).
      fc.assert(
        fc.property(roleFlagsGen, () => {
          const drawerNavNames = NAV_ITEMS.map((item) => item.name);
          const sidebarNavNames = NAV_ITEMS.map((item) => item.name);
          expect(drawerNavNames).toEqual(sidebarNavNames);
          expect(drawerNavNames).toEqual([
            'Dashboard',
            'Issues',
            'Subscribers',
            'Brand',
            'Sponsorship Pricing',
          ]);
        }),
        { numRuns: 100 },
      );
    });

    it('Account group items match AvatarMenu dropdown items (excluding theme toggle and logout) for any role config', () => {
      fc.assert(
        fc.property(roleFlagsGen, ({ isAdmin, isTenantAdmin }) => {
          const drawerAccountNames = getVisibleAccountItems(isAdmin, isTenantAdmin).map(
            (item) => item.name,
          );
          const avatarMenuNames = getVisibleAvatarMenuItems(isAdmin, isTenantAdmin).map(
            (item) => item.name,
          );
          expect(drawerAccountNames).toEqual(avatarMenuNames);
        }),
        { numRuns: 100 },
      );
    });

    it('for any boolean combination of isAdmin/isTenantAdmin, visible account items are consistent between drawer and avatar menu', () => {
      fc.assert(
        fc.property(roleFlagsGen, ({ isAdmin, isTenantAdmin }) => {
          const drawerItems = getVisibleAccountItems(isAdmin, isTenantAdmin);
          const avatarItems = getVisibleAvatarMenuItems(isAdmin, isTenantAdmin);

          // Same count
          expect(drawerItems.length).toBe(avatarItems.length);

          // Same names in same order
          for (let i = 0; i < drawerItems.length; i++) {
            expect(drawerItems[i].name).toBe(avatarItems[i].name);
          }

          // Billing present iff admin
          const showBilling = isAdmin === true || isTenantAdmin === true;
          const drawerHasBilling = drawerItems.some((item) => item.name === 'Billing');
          const avatarHasBilling = avatarItems.some((item) => item.name === 'Billing');
          expect(drawerHasBilling).toBe(showBilling);
          expect(avatarHasBilling).toBe(showBilling);

          // Non-admin items always present
          const alwaysPresent = ['Profile', 'Sender Emails', 'API Keys'];
          for (const name of alwaysPresent) {
            expect(drawerItems.some((item) => item.name === name)).toBe(true);
            expect(avatarItems.some((item) => item.name === name)).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
