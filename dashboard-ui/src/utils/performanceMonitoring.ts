/**
 * Performance monitoring utilities
 *
 * This module provides utilities to monitor and report performance metrics
 * for the application, helping identify bottlenecks and optimization opportunities.
 */

interface PerformanceMetrics {
  fcp?: number; // First Contentful Paint
  lcp?: number; // Largest Contentful Paint
  fid?: number; // First Input Delay
  cls?: number; // Cumulative Layout Shift
  ttfb?: number; // Time to First Byte
  tti?: number; // Time to Interactive
}

/**
 * Measure and log Core Web Vitals
 */
export function measureWebVitals(): void {
  // Check if we're in a browser environment
  if (typeof window === 'undefined' || !('performance' in window)) {
    return;
  }

  // Measure First Contentful Paint (FCP)
  const paintEntries = performance.getEntriesByType('paint');
  const fcpEntry = paintEntries.find(entry => entry.name === 'first-contentful-paint');

  if (fcpEntry) {
    console.log(`[Performance] First Contentful Paint: ${fcpEntry.startTime.toFixed(2)}ms`);
  }

  // Measure Largest Contentful Paint (LCP)
  if ('PerformanceObserver' in window) {
    try {
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lastEntry = entries[entries.length - 1] as any;

        if (lastEntry) {
          console.log(`[Performance] Largest Contentful Paint: ${lastEntry.renderTime || lastEntry.loadTime}ms`);
        }
      });

      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      // LCP not supported
    }

    // Measure First Input Delay (FID)
    try {
      const fidObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entries.forEach((entry: any) => {
          console.log(`[Performance] First Input Delay: ${entry.processingStart - entry.startTime}ms`);
        });
      });

      fidObserver.observe({ type: 'first-input', buffered: true });
    } catch {
      // FID not supported
    }

    // Measure Cumulative Layout Shift (CLS)
    try {
      let clsScore = 0;
      const clsObserver = new PerformanceObserver((list) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const entry of list.getEntries() as any[]) {
          if (!entry.hadRecentInput) {
            clsScore += entry.value;
          }
        }
        console.log(`[Performance] Cumulative Layout Shift: ${clsScore.toFixed(4)}`);
      });

      clsObserver.observe({ type: 'layout-shift', buffered: true });
    } catch {
      // CLS not supported
    }
  }

  // Measure Time to First Byte (TTFB)
  const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
  if (navigationEntry) {
    const ttfb = navigationEntry.responseStart - navigationEntry.requestStart;
    console.log(`[Performance] Time to First Byte: ${ttfb.toFixed(2)}ms`);
  }
}

/**
 * Measure component render time
 */
export function measureComponentRender(componentName: string, startTime: number): void {
  const endTime = performance.now();
  const renderTime = endTime - startTime;

  if (renderTime > 16) { // Log if render takes more than one frame (16ms)
    console.warn(`[Performance] ${componentName} render took ${renderTime.toFixed(2)}ms`);
  }
}

/**
 * Measure data loading time
 */
export function measureDataLoad(operationName: string, startTime: number): void {
  const endTime = performance.now();
  const loadTime = endTime - startTime;

  console.log(`[Performance] ${operationName} took ${loadTime.toFixed(2)}ms`);

  if (loadTime > 1000) {
    console.warn(`[Performance] ${operationName} is slow (>${loadTime.toFixed(2)}ms)`);
  }
}

/**
 * Create a performance mark
 */
export function mark(name: string): void {
  if (typeof window !== 'undefined' && 'performance' in window) {
    performance.mark(name);
  }
}

/**
 * Measure time between two marks
 */
export function measure(name: string, startMark: string, endMark: string): void {
  if (typeof window !== 'undefined' && 'performance' in window) {
    try {
      performance.measure(name, startMark, endMark);
      const measure = performance.getEntriesByName(name)[0];
      console.log(`[Performance] ${name}: ${measure.duration.toFixed(2)}ms`);
    } catch (e) {
      console.warn(`Failed to measure ${name}:`, e);
    }
  }
}

/**
 * Get current memory usage (Chrome only)
 */
export function getMemoryUsage(): { used: number; total: number; limit: number } | null {
  if (typeof window !== 'undefined' && 'performance' in window) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memory = (performance as any).memory;
    if (memory) {
      return {
        used: Math.round(memory.usedJSHeapSize / 1048576), // Convert to MB
        total: Math.round(memory.totalJSHeapSize / 1048576),
        limit: Math.round(memory.jsHeapSizeLimit / 1048576),
      };
    }
  }
  return null;
}

/**
 * Log memory usage
 */
export function logMemoryUsage(): void {
  const memory = getMemoryUsage();
  if (memory) {
    console.log(`[Performance] Memory: ${memory.used}MB / ${memory.total}MB (limit: ${memory.limit}MB)`);

    if (memory.used / memory.limit > 0.9) {
      console.warn('[Performance] Memory usage is high (>90% of limit)');
    }
  }
}

/**
 * Monitor long tasks (tasks that block the main thread for >50ms)
 */
export function monitorLongTasks(): void {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) {
    return;
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        console.warn(`[Performance] Long task detected: ${entry.duration.toFixed(2)}ms`);
      }
    });

    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    // Long task monitoring not supported
  }
}

/**
 * Initialize performance monitoring
 * Call this once when the app starts
 */
export function initPerformanceMonitoring(): void {
  if (process.env.NODE_ENV === 'development') {
    // Only monitor in development to avoid overhead in production
    measureWebVitals();
    monitorLongTasks();

    // Log memory usage every 30 seconds
    setInterval(() => {
      logMemoryUsage();
    }, 30000);
  }
}

/**
 * Report performance metrics to analytics service
 * This would typically send data to a service like Google Analytics or custom backend
 */
export function reportPerformanceMetrics(metrics: PerformanceMetrics): void {
  // In a real application, you would send these metrics to your analytics service
  if (process.env.NODE_ENV === 'production') {
    // Example: Send to analytics
    // analytics.track('performance_metrics', metrics);
    console.log('[Performance] Metrics:', metrics);
  }
}
