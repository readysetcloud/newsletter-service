// Feature: dashboard-ux-overhaul, Property 5: Header title matches navigation label
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { NAV_ITEMS } from '@/components/layout/sidebarNav';
import { ROUTE_META } from '../usePageMeta';

/**
 * **Validates: Requirements 4.6**
 *
 * Property 5: Header title matches navigation label
 *
 * For any route that appears in both the sidebar navigation config (NAV_ITEMS)
 * and the route metadata (ROUTE_META), the sidebar item's `name` and the
 * ROUTE_META entry's `title` must be identical strings. This ensures no
 * mismatches between the sidebar label and the header title for that route.
 */

// Build the intersection: NAV_ITEMS whose href exists in ROUTE_META
const intersectionItems = NAV_ITEMS.filter((item) => item.href in ROUTE_META);

describe('Property 5: Header title matches navigation label', () => {
  it('NAV_ITEMS and ROUTE_META have a non-empty intersection to test', () => {
    expect(intersectionItems.length).toBeGreaterThan(0);
  });

  it('for every nav item whose href is in ROUTE_META, item.name === ROUTE_META[item.href].title', () => {
    fc.assert(
      fc.property(fc.constantFrom(...intersectionItems), (navItem) => {
        const routeTitle = ROUTE_META[navItem.href].title;
        expect(navItem.name).toBe(routeTitle);
      }),
      { numRuns: 100 },
    );
  });
});
