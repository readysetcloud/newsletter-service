import React, { useEffect, useCallback, useRef } from 'react';
import { detectBrowserSupport, detectDeviceCapabilities, determinePerformanceMode } from '../../utils/crossBrowserCompatibility';

interface PerformanceOptimizations {
  enableVirtualization: boolean;
  enableLazyLoading: boolean;
  enableDebouncing: boolean;
  enableMemoization: boolean;
  enableAnimations: boolean;
  batchUpdates: boolean;
  useWebWorkers: boolean;
}

interface VisualBuilderPerformanceOptimizerProps {
  onOptimizationsReady: (optimizations: PerformanceOptimizations) => void;
  children: React.ReactNode;
}

/**
 * Performance optimizer for the Visual Builder
 *
 * This component analyzes the user's device and browser capabilities
 * to determine optimal performance settings for the visual builder.
 */
export const VisualBuilderPerformanceOptimizer: React.FC<VisualBuilderPerformanceOptimizerProps> = ({
  onOptimizationsReady,
  children
}) => {
  const performanceObserverRef = useRef<PerformanceObserver | null>(null);
  const metricsRef = useRef({
    renderTime: 0,
    interactionTime: 0,
    memoryUsage: 0,
    frameRate: 60
  });

  // Initialize performance monitoring
  useEffect(() => {
    const initializePerformanceMonitoring = () => {
      // Detect browser and device capabilities
      const browserSupport = detectBrowserSupport();
      const deviceCapabilities = detectDeviceCapabilities();
      const performanceMode = determinePerformanceMode(browserSupport, deviceCapabilities);

      // Determine optimizations based on capabilities
      const optimizations: PerformanceOptimizations = {
        enableVirtualization: deviceCapabilities.isMobile || performanceMode === 'optimized',
        enableLazyLoading: true,
        enableDebouncing: true,
        enableMemoization: true,
        enableAnimations: browserSupport.animations && performanceMode !== 'optimized',
        batchUpdates: true,
        useWebWorkers: browserSupport.webWorkers && performanceMode === 'high'
      };

      // Start performance monitoring if available
      if ('PerformanceObserver' in window) {
        startPerformanceMonitoring();
      }

      // Monitor memory usage if available
      if ('memory' in performance) {
        monitorMemoryUsage();
      }

      // Monitor frame rate
      monitorFrameRate();

      onOptimizationsReady(optimizations);
    };

    initializePerformanceMonitoring();

    return () => {
      if (performanceObserverRef.current) {
        performanceObserverRef.current.disconnect();
      }
    };
  }, [onOptimizationsReady]);

  // Start performance monitoring
  const startPerformanceMonitoring = useCallback(() => {
    try {
      performanceObserverRef.current = new PerformanceObserver((list) => {
        const entries = list.getEntries();

        entries.forEach((entry) => {
          switch (entry.entryType) {
            case 'measure':
              if (entry.name.includes('visual-builder')) {
                metricsRef.current.renderTime = entry.duration;
              }
              break;
            case 'navigation':
              // Track page load performance
              break;
            case 'paint':
              // Track paint performance
              break;
            case 'largest-contentful-paint':
              // Track LCP for visual builder content
              break;
          }
        });
      });

      performanceObserverRef.current.observe({
        entryTypes: ['measure', 'navigation', 'paint', 'largest-contentful-paint']
      });
    } catch (error) {
      console.warn('Performance monitoring not available:', error);
    }
  }, []);

  // Monitor memory usage
  const monitorMemoryUsage = useCallback(() => {
    const checkMemory = () => {
      if ('memory' in performance) {
        const memory = (performance as any).memory;
        metricsRef.current.memoryUsage = memory.usedJSHeapSize / memory.jsHeapSizeLimit;

        // Warn if memory usage is high
        if (metricsRef.current.memoryUsage > 0.8) {
          console.warn('High memory usage detected in Visual Builder');
          // Could trigger garbage collection or optimization mode
        }
      }
    };

    // Check memory every 5 seconds
    const interval = setInterval(checkMemory, 5000);
    return () => clearInterval(interval);
  }, []);

  // Monitor frame rate
  const monitorFrameRate = useCallback(() => {
    let lastTime = performance.now();
    let frameCount = 0;

    const measureFrameRate = (currentTime: number) => {
      frameCount++;

      if (currentTime - lastTime >= 1000) {
        metricsRef.current.frameRate = frameCount;
        frameCount = 0;
        lastTime = currentTime;

        // Warn if frame rate is low
        if (metricsRef.current.frameRate < 30) {
          console.warn('Low frame rate detected in Visual Builder');
          // Could trigger performance optimizations
        }
      }

      requestAnimationFrame(measureFrameRate);
    };

    requestAnimationFrame(measureFrameRate);
  }, []);

  // Performance measurement utilities
  const measurePerformance = useCallback((name: string, fn: () => void) => {
    performance.mark(`${name}-start`);
    fn();
    performance.mark(`${name}-end`);
    performance.measure(name, `${name}-start`, `${name}-end`);
  }, []);

  // Batch DOM updates for better performance
  const batchDOMUpdates = useCallback((updates: (() => void)[]) => {
    requestAnimationFrame(() => {
      updates.forEach(update => update());
    });
  }, []);

  // Debounce function for performance-critical operations
  const debounce = useCallback(<T extends (...args: any[]) => any>(
    func: T,
    wait: number
  ): ((...args: Parameters<T>) => void) => {
    let timeout: NodeJS.Timeout;

    return (...args: Parameters<T>) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }, []);

  // Throttle function for scroll/resize events
  const throttle = useCallback(<T extends (...args: any[]) => any>(
    func: T,
    limit: number
  ): ((...args: Parameters<T>) => void) => {
    let inThrottle: boolean;

    return (...args: Parameters<T>) => {
      if (!inThrottle) {
        func(...args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }, []);

  // Provide performance utilities to children
  const performanceUtils = {
    measurePerformance,
    batchDOMUpdates,
    debounce,
    throttle,
    metrics: metricsRef.current
  };

  return (
    <div data-performance-optimizer="true">
      {React.Children.map(children, child => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child, { performanceUtils } as any);
        }
        return child;
      })}
    </div>
  );
};

export default VisualBuilderPerformanceOptimizer;
