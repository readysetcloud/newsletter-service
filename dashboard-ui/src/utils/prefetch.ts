/**
 * Prefetch utility for optimizing navigation performance
 *
 * This module provides utilities to prefetch components and data
 * that are likely to be needed based on user behavior.
 */

/**
 * Prefetch a lazy-loaded component by triggering its import
 * This loads the component in the background without rendering it
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prefetchComponent(importFn: () => Promise<any>): void {
  // Check if we're in a browser environment
  if (typeof window === 'undefined') return;

  // Use requestIdleCallback if available, otherwise use setTimeout
  const scheduleTask = (window.requestIdleCallback ||
    ((cb: IdleRequestCallback) => setTimeout(cb, 1))) as typeof requestIdleCallback;

  scheduleTask(() => {
    importFn().catch((error) => {
      console.warn('Failed to prefetch component:', error);
    });
  });
}

/**
 * Prefetch data by making an API request in the background
 * The result will be cached by the browser
 */
export function prefetchData(url: string): void {
  // Check if we're in a browser environment
  if (typeof window === 'undefined') return;

  // Use requestIdleCallback if available
  const scheduleTask = (window.requestIdleCallback ||
    ((cb: IdleRequestCallback) => setTimeout(cb, 1))) as typeof requestIdleCallback;

  scheduleTask(() => {
    fetch(url, {
      method: 'GET',
      credentials: 'include',
      priority: 'low',
    }).catch((error) => {
      console.warn('Failed to prefetch data:', error);
    });
  });
}

/**
 * Prefetch multiple components in sequence
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prefetchComponents(importFns: Array<() => Promise<any>>): void {
  importFns.forEach((importFn, index) => {
    // Stagger the prefetch requests to avoid overwhelming the network
    setTimeout(() => {
      prefetchComponent(importFn);
    }, index * 100);
  });
}

/**
 * Hook to prefetch issue detail page components when hovering over an issue card
 */
export function usePrefetchIssueDetail() {
  const prefetchIssueComponents = () => {
    prefetchComponents([
      () => import('../components/issues/LinkPerformanceTable'),
      () => import('../components/issues/ClickDecayChart'),
      () => import('../components/issues/OpenDecayChart'),
      () => import('../components/analytics/GeoMap'),
      () => import('../components/issues/AudienceInsightsPanel'),
      () => import('../components/issues/DeliverabilityHealthCard'),
    ]);
  };

  return { prefetchIssueComponents };
}

/**
 * Prefetch resources based on connection quality
 * Only prefetch on fast connections to avoid wasting bandwidth
 */
export function shouldPrefetch(): boolean {
  // Check if we're in a browser environment
  if (typeof window === 'undefined') return false;

  // Check if the user has data saver mode enabled
  if ('connection' in navigator) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connection = (navigator as any).connection;
    if (connection?.saveData) {
      return false;
    }

    // Only prefetch on fast connections (4g or better)
    const effectiveType = connection?.effectiveType;
    if (effectiveType && !['4g', 'wifi'].includes(effectiveType)) {
      return false;
    }
  }

  return true;
}
