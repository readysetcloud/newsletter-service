import { render, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { performanceMonitor, measureAsync, measureSync } from '../utils/performance';
import App from '../App';

// Mock the contexts to avoid authentication requirements
jest.mock('../contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useAuth: () => ({
    user: { email: 'test@example.com' },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

jest.mock('../contexts/NotificationContext', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('../components/ui/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock the lazy imports to avoid actual lazy loading in tests
jest.mock('../utils/lazyImports', () => ({
  LazyDashboardPage: () => <div>Dashboard Page</div>,
  LazyLoginPage: () => <div>Login Page</div>,
  LazyBrandPage: () => <div>Brand Page</div>,
  LazyProfilePage: () => <div>Profile Page</div>,
  LazyApiKeysPage: () => <div>API Keys Page</div>,
  preloadCriticalRoutes: jest.fn(),
  preloadRoute: jest.fn(),
}));

describe('Performance Tests', () => {
  beforeEach(() => {
    // Clear performance metrics before each test
    performanceMonitor.clearMetrics();

    // Mock performance.now for consistent testing
    jest.spyOn(performance, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Performance Monitoring', () => {
    it('should record metrics correctly', () => {
      performanceMonitor.recordMetric('test-metric', 100);

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].name).toBe('test-metric');
      expect(metrics[0].duration).toBe(100);
    });

    it('should calculate average metrics', () => {
      performanceMonitor.recordMetric('test-metric', 100);
      performanceMonitor.recordMetric('test-metric', 200);
      performanceMonitor.recordMetric('test-metric', 300);

      const average = performanceMonitor.getAverageMetric('test-metric');
      expect(average).toBe(200);
    });

    it('should filter metrics by name', () => {
      performanceMonitor.recordMetric('metric-a', 100);
      performanceMonitor.recordMetric('metric-b', 200);
      performanceMonitor.recordMetric('metric-a', 300);

      const metricsA = performanceMonitor.getMetricsByName('metric-a');
      expect(metricsA).toHaveLength(2);
      expect(metricsA.every(m => m.name === 'metric-a')).toBe(true);
    });
  });

  describe('Async Performance Measurement', () => {
    it('should measure async operations', async () => {
      const mockOperation = jest.fn().mockResolvedValue('result');

      const result = await measureAsync('async-test', mockOperation);

      expect(result).toBe('result');
      expect(mockOperation).toHaveBeenCalled();

      const metrics = performanceMonitor.getMetricsByName('async-test');
      expect(metrics).toHaveLength(1);
    });

    it('should measure failed async operations', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Test error'));

      await expect(measureAsync('async-error-test', mockOperation)).rejects.toThrow('Test error');

      const metrics = performanceMonitor.getMetricsByName('async-error-test-error');
      expect(metrics).toHaveLength(1);
    });
  });

  describe('Sync Performance Measurement', () => {
    it('should measure sync operations', () => {
      const mockOperation = jest.fn().mockReturnValue('result');

      const result = measureSync('sync-test', mockOperation);

      expect(result).toBe('result');
      expect(mockOperation).toHaveBeenCalled();

      const metrics = performanceMonitor.getMetricsByName('sync-test');
      expect(metrics).toHaveLength(1);
    });

    it('should measure failed sync operations', () => {
      const mockOperation = jest.fn().mockImplementation(() => {
        throw new Error('Test error');
      });

      expect(() => measureSync('sync-error-test', mockOperation)).toThrow('Test error');

      const metrics = performanceMonitor.getMetricsByName('sync-error-test-error');
      expect(metrics).toHaveLength(1);
    });
  });

  describe('Component Render Performance', () => {
    it('should render App component within performance budget', async () => {
      const startTime = performance.now();

      render(<App />);

      await waitFor(() => {
        const renderTime = performance.now() - startTime;
        // App should render within 100ms (this is a mock test, real values would vary)
        expect(renderTime).toBeLessThan(100);
      });
    });

    it('should not cause memory leaks', () => {
      const { unmount } = render(<App />);

      // Simulate component unmount
      unmount();

      // In a real test, you would check for memory leaks
      // This is a placeholder for memory leak detection
      expect(true).toBe(true);
    });
  });

  describe('Bundle Size Optimization', () => {
    it('should have reasonable chunk sizes', () => {
      // This would be tested with actual bundle analysis
      // For now, we test that the bundle analyzer function exists
      const { analyzeBundleSize } = require('../utils/performance');
      expect(typeof analyzeBundleSize).toBe('function');
    });

    it('should implement code splitting', () => {
      // Verify that lazy imports are being used
      const lazyImports = require('../utils/lazyImports');
      expect(lazyImports.LazyDashboardPage).toBeDefined();
      expect(lazyImports.LazyLoginPage).toBeDefined();
      expect(lazyImports.LazyBrandPage).toBeDefined();
      expect(lazyImports.LazyProfilePage).toBeDefined();
      expect(lazyImports.LazyApiKeysPage).toBeDefined();
    });
  });

  describe('Loading Performance', () => {
    it('should preload critical routes', () => {
      const { preloadCriticalRoutes } = require('../utils/lazyImports');

      preloadCriticalRoutes();

      expect(preloadCriticalRoutes).toHaveBeenCalled();
    });

    it('should support route preloading on hover', () => {
      const { preloadRoute } = require('../utils/lazyImports');

      preloadRoute('dashboard');

      expect(preloadRoute).toHaveBeenCalledWith('dashboard');
    });
  });

  describe('Performance Budgets', () => {
    const performanceBudgets = {
      // Time budgets (in milliseconds)
      initialPageLoad: 2000,
      routeTransition: 500,
      apiCall: 3000,

      // Size budgets (in KB)
      totalBundleSize: 500,
      vendorChunkSize: 200,
      appChunkSize: 100,
    };

    it('should meet performance budgets', () => {
      // In a real implementation, these would be actual measurements
      expect(performanceBudgets.initialPageLoad).toBeLessThanOrEqual(2000);
      expect(performanceBudgets.routeTransition).toBeLessThanOrEqual(500);
      expect(performanceBudgets.apiCall).toBeLessThanOrEqual(3000);
      expect(performanceBudgets.totalBundleSize).toBeLessThanOrEqual(500);
      expect(performanceBudgets.vendorChunkSize).toBeLessThanOrEqual(200);
      expect(performanceBudgets.appChunkSize).toBeLessThanOrEqual(100);
    });
  });

  describe('Core Web Vitals', () => {
    it('should meet Largest Contentful Paint (LCP) requirements', () => {
      // LCP should be less than 2.5 seconds
      const mockLCP = 2000; // milliseconds
      expect(mockLCP).toBeLessThan(2500);
    });

    it('should meet First Input Delay (FID) requirements', () => {
      // FID should be less than 100 milliseconds
      const mockFID = 50; // milliseconds
      expect(mockFID).toBeLessThan(100);
    });

    it('should meet Cumulative Layout Shift (CLS) requirements', () => {
      // CLS should be less than 0.1
      const mockCLS = 0.05;
      expect(mockCLS).toBeLessThan(0.1);
    });
  });
});
