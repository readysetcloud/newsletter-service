import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createElement } from 'react';
import { usePageMeta } from '../usePageMeta';

function renderUsePageMeta(path: string, dynamicTitle?: string) {
  // Build a route structure that matches the app's actual routes
  // so useParams extracts the correct values.
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

describe('usePageMeta', () => {
  describe('static routes', () => {
    const staticRoutes = [
      { path: '/', title: 'Dashboard' },
      { path: '/issues', title: 'Issues' },
      { path: '/subscribers', title: 'Subscribers' },
      { path: '/brand', title: 'Brand' },
      { path: '/pricing', title: 'Sponsors' },
      { path: '/profile', title: 'Profile' },
      { path: '/senders', title: 'Sender Emails' },
      { path: '/api-keys', title: 'API Keys' },
      { path: '/billing', title: 'Billing' },
    ];

    it.each(staticRoutes)('returns title "$title" for $path', ({ path, title }) => {
      const { result } = renderUsePageMeta(path);
      expect(result.current.title).toBe(title);
      expect(result.current.breadcrumb).toBeNull();
    });
  });

  describe('dynamic routes', () => {
    it('returns breadcrumb for /issues/:id', () => {
      const { result } = renderUsePageMeta('/issues/42');
      expect(result.current.title).toBe('Issue #42');
      expect(result.current.breadcrumb).toEqual([
        { label: 'Issues', href: '/issues' },
        { label: 'Issue #42' },
      ]);
    });

    it('returns breadcrumb for /issues/:id/edit', () => {
      const { result } = renderUsePageMeta('/issues/7/edit');
      expect(result.current.title).toBe('Edit Issue #7');
      expect(result.current.breadcrumb).toEqual([
        { label: 'Issues', href: '/issues' },
        { label: 'Edit Issue #7' },
      ]);
    });

    it('returns breadcrumb for /issues/new', () => {
      const { result } = renderUsePageMeta('/issues/new');
      expect(result.current.title).toBe('New Issue');
      expect(result.current.breadcrumb).toEqual([
        { label: 'Issues', href: '/issues' },
        { label: 'New Issue' },
      ]);
    });

    it('returns fallback breadcrumb for /segments/:segmentId without dynamicTitle', () => {
      const { result } = renderUsePageMeta('/segments/abc-123');
      expect(result.current.title).toBe('Segment');
      expect(result.current.breadcrumb).toEqual([
        { label: 'Subscribers', href: '/subscribers' },
        { label: 'Segment' },
      ]);
    });

    it('uses dynamicTitle for /segments/:segmentId when provided', () => {
      const { result } = renderUsePageMeta('/segments/abc-123', 'VIP Readers');
      expect(result.current.title).toBe('VIP Readers');
      expect(result.current.breadcrumb).toEqual([
        { label: 'Subscribers', href: '/subscribers' },
        { label: 'VIP Readers' },
      ]);
    });
  });

  describe('unknown routes', () => {
    it('returns Dashboard fallback for unknown paths', () => {
      const { result } = renderUsePageMeta('/unknown-route');
      expect(result.current.title).toBe('Dashboard');
      expect(result.current.breadcrumb).toBeNull();
    });
  });
});
