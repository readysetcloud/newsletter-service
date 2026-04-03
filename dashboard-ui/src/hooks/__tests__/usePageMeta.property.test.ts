// Feature: dashboard-ux-overhaul, Property 4: Breadcrumb presence based on route depth
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { renderHook } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createElement } from 'react';
import { usePageMeta, ROUTE_META } from '../usePageMeta';

/**
 * **Validates: Requirements 4.1, 4.2**
 *
 * Property 4: Breadcrumb presence based on route depth
 *
 * For any route in the application, the header displays a breadcrumb
 * (parent link + current title) if and only if the route is a nested route.
 * Top-level routes display only a plain text title with no breadcrumb links.
 */

function renderUsePageMeta(path: string, dynamicTitle?: string) {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [path] },
      createElement(Routes, null,
        createElement(Route, { path: '/', element: children }),
        createElement(Route, { path: '/issues', element: children }),
        createElement(Route, { path: '/issues/new', element: children }),
        createElement(Route, { path: '/issues/:id', element: children }),
        createElement(Route, { path: '/issues/:id/edit', element: children }),
        createElement(Route, { path: '/subscribers', element: children }),
        createElement(Route, { path: '/segments/:segmentId', element: children }),
        createElement(Route, { path: '/brand', element: children }),
        createElement(Route, { path: '/pricing', element: children }),
        createElement(Route, { path: '/profile', element: children }),
        createElement(Route, { path: '/senders', element: children }),
        createElement(Route, { path: '/api-keys', element: children }),
        createElement(Route, { path: '/billing', element: children }),
        createElement(Route, { path: '*', element: children }),
      )
    );

  return renderHook(() => usePageMeta(dynamicTitle), { wrapper });
}

// All static (top-level) routes from ROUTE_META
const staticRouteKeys = Object.keys(ROUTE_META);

// Nested routes that should produce breadcrumbs
const nestedRouteGen = fc.oneof(
  // /issues/:id — generate numeric IDs
  fc.nat({ max: 9999 }).map((id) => `/issues/${id}`),
  // /issues/:id/edit
  fc.nat({ max: 9999 }).map((id) => `/issues/${id}/edit`),
  // /issues/new is a fixed nested route
  fc.constant('/issues/new'),
  // /segments/:segmentId — generate UUID-like segment IDs
  fc.uuid().map((uuid) => `/segments/${uuid}`),
);

describe('usePageMeta - Property-Based Tests', () => {
  describe('Property 4: Breadcrumb presence based on route depth', () => {
    it('static routes in ROUTE_META always have null breadcrumb', () => {
      const staticRouteGen = fc.constantFrom(...staticRouteKeys);

      fc.assert(
        fc.property(staticRouteGen, (path) => {
          const { result } = renderUsePageMeta(path);
          expect(result.current.breadcrumb).toBeNull();
          expect(result.current.title).toBeTruthy();
        }),
        { numRuns: 100 },
      );
    });

    it('nested routes always produce a non-null breadcrumb with at least 2 items', () => {
      fc.assert(
        fc.property(nestedRouteGen, (path) => {
          const { result } = renderUsePageMeta(path);
          expect(result.current.breadcrumb).not.toBeNull();
          expect(result.current.breadcrumb!.length).toBeGreaterThanOrEqual(2);
        }),
        { numRuns: 100 },
      );
    });

    it('first breadcrumb item always has an href (parent link)', () => {
      fc.assert(
        fc.property(nestedRouteGen, (path) => {
          const { result } = renderUsePageMeta(path);
          const breadcrumb = result.current.breadcrumb!;
          expect(breadcrumb[0].href).toBeDefined();
          expect(breadcrumb[0].href).toBeTruthy();
        }),
        { numRuns: 100 },
      );
    });

    it('last breadcrumb item never has an href (current page)', () => {
      fc.assert(
        fc.property(nestedRouteGen, (path) => {
          const { result } = renderUsePageMeta(path);
          const breadcrumb = result.current.breadcrumb!;
          const lastItem = breadcrumb[breadcrumb.length - 1];
          expect(lastItem.href).toBeUndefined();
        }),
        { numRuns: 100 },
      );
    });
  });
});
