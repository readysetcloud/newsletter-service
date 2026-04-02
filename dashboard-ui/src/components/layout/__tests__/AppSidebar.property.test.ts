// Feature: dashboard-ux-overhaul, Property 1: Active indicator matches current route
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { NAV_ITEMS, isNavItemActive } from '../sidebarNav';

/**
 * **Validates: Requirements 2.4, 2.5, 2.6**
 *
 * Property 1: Active indicator matches current route
 *
 * For any route path, exactly one (or zero) sidebar nav items has the active
 * indicator, and it matches the expected matchPaths logic:
 * - Dashboard (/): exact match only
 * - Issues (/issues): startsWith
 * - Subscribers (/subscribers, /segments): startsWith
 * - Brand (/brand): exact match
 * - Pricing (/pricing): exact match
 */
describe('AppSidebar - Property-Based Tests', () => {
  // Generator: known routes that should activate specific nav items
  const knownRouteGen = fc.oneof(
    fc.constant('/'),
    fc.constant('/issues'),
    fc.constant('/issues/42'),
    fc.constant('/subscribers'),
    fc.constant('/segments/abc'),
    fc.constant('/brand'),
    fc.constant('/pricing'),
    fc.constant('/profile'),
    fc.constant('/unknown'),
  );

  // Generator: random paths built from a small alphabet
  const randomPathGen = fc
    .array(fc.constantFrom('/', 'a', 'b', 'c', '1', '2', '3'), { minLength: 0, maxLength: 15 })
    .map((chars) => {
      const s = chars.join('');
      return s.startsWith('/') ? s : '/' + s;
    });

  const routePathGen = fc.oneof(knownRouteGen, randomPathGen);

  describe('Property 1: Active indicator matches current route', () => {
    it('at most one nav item is active for any route path', () => {
      fc.assert(
        fc.property(routePathGen, (pathname) => {
          const activeItems = NAV_ITEMS.filter((item) =>
            isNavItemActive(item, pathname),
          );
          expect(activeItems.length).toBeLessThanOrEqual(1);
        }),
        { numRuns: 200 },
      );
    });

    it('active item matches the expected matchPaths logic', () => {
      fc.assert(
        fc.property(routePathGen, (pathname) => {
          for (const item of NAV_ITEMS) {
            const active = isNavItemActive(item, pathname);

            // Compute expected activation based on the design spec rules
            const expectedActive = item.matchPaths.some((matchPath) => {
              if (matchPath === '/') {
                return pathname === '/';
              }
              return pathname.startsWith(matchPath);
            });

            expect(active).toBe(expectedActive);
          }
        }),
        { numRuns: 200 },
      );
    });

    it('Dashboard is active only on exact "/" path', () => {
      fc.assert(
        fc.property(routePathGen, (pathname) => {
          const dashboard = NAV_ITEMS.find((item) => item.name === 'Dashboard')!;
          const active = isNavItemActive(dashboard, pathname);
          expect(active).toBe(pathname === '/');
        }),
        { numRuns: 200 },
      );
    });

    it('Issues is active for any path starting with "/issues"', () => {
      fc.assert(
        fc.property(routePathGen, (pathname) => {
          const issues = NAV_ITEMS.find((item) => item.name === 'Issues')!;
          const active = isNavItemActive(issues, pathname);
          expect(active).toBe(pathname.startsWith('/issues'));
        }),
        { numRuns: 200 },
      );
    });

    it('Subscribers is active for paths starting with "/subscribers" or "/segments"', () => {
      fc.assert(
        fc.property(routePathGen, (pathname) => {
          const subscribers = NAV_ITEMS.find((item) => item.name === 'Subscribers')!;
          const active = isNavItemActive(subscribers, pathname);
          const expected =
            pathname.startsWith('/subscribers') || pathname.startsWith('/segments');
          expect(active).toBe(expected);
        }),
        { numRuns: 200 },
      );
    });
  });
});
