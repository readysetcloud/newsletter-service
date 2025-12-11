import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Performance optimization utilities for snippet insertion UI
 */

// Debounced search hook with configurable delay
export function useOptimizedDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const timeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout
    timeoutRef.current = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Cleanup on unmount
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, delay]);

  return debouncedValue;
}

// Intersection Observer hook for lazy loading
export function useIntersectionObserver(
  options: IntersectionObserverInit = {}
): [React.RefCallback<Element>, boolean] {
  const [isIntersecting, setIsIntersecting] = useState(false);
  const [element, setElement] = useState<Element | null>(null);

  const ref = useCallback((node: Element | null) => {
    setElement(node);
  }, []);

  useEffect(() => {
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(entry.isIntersecting);
      },
      {
        threshold: 0.1,
        rootMargin: '50px',
        ...options
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [element, options]);

  return [ref, isIntersecting];
}

// Request idle callback hook for non-critical operations
export function useIdleCallback(
  callback: () => void,
  deps: React.DependencyList,
  options: { timeout?: number } = {}
): void {
  const { timeout = 5000 } = options;

  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(callback, { timeout });
      return () => window.cancelIdleCallback(handle);
    } else {
      // Fallback for browsers without requestIdleCallback
      const handle = setTimeout(callback, 0);
      return () => clearTimeout(handle);
    }
  }, deps);
}

// Memory-efficient cache with size limits and TTL
export class PerformanceCache<T> {
  private cache = new Map<string, { value: T; timestamp: number; accessCount: number }>();
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number = 100, ttl: number = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  set(key: string, value: T): void {
    // Remove expired entries before adding new ones
    this.cleanup();

    // If at capacity, remove least recently used item
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      accessCount: 0
    });
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Update access count for LRU
    entry.accessCount++;

    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }

  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruAccessCount = Infinity;
    let oldestTimestamp = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.accessCount < lruAccessCount ||
          (entry.accessCount === lruAccessCount && entry.timestamp < oldestTimestamp)) {
        lruKey = key;
        lruAccessCount = entry.accessCount;
        oldestTimestamp = entry.timestamp;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
    }
  }

  getStats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0 // Would need to track hits/misses for accurate calculation
    };
  }
}

// Batch processing utility for heavy operations
export class BatchProcessor<T, R> {
  private queue: Array<{ item: T; resolve: (result: R) => void; reject: (error: Error) => void }> = [];
  private processing = false;
  private batchSize: number;
  private delay: number;

  constructor(
    private processor: (items: T[]) => Promise<R[]>,
    batchSize: number = 10,
    delay: number = 100
  ) {
    this.batchSize = batchSize;
    this.delay = delay;
  }

  async process(item: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      this.queue.push({ item, resolve, reject });
      this.scheduleProcessing();
    });
  }

  private scheduleProcessing(): void {
    if (this.processing) return;

    this.processing = true;
    setTimeout(() => this.processBatch(), this.delay);
  }

  private async processBatch(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    const batch = this.queue.splice(0, this.batchSize);
    const items = batch.map(b => b.item);

    try {
      const results = await this.processor(items);

      batch.forEach((batchItem, index) => {
        if (results[index] !== undefined) {
          batchItem.resolve(results[index]);
        } else {
          batchItem.reject(new Error('No result for batch item'));
        }
      });
    } catch (error) {
      batch.forEach(batchItem => {
        batchItem.reject(error instanceof Error ? error : new Error('Batch processing failed'));
      });
    }

    this.processing = false;

    // Process next batch if queue is not empty
    if (this.queue.length > 0) {
      this.scheduleProcessing();
    }
  }
}

// Image lazy loading with progressive enhancement
export function useLazyImage(src: string, placeholder?: string): {
  imageSrc: string;
  isLoaded: boolean;
  error: boolean;
} {
  const [imageSrc, setImageSrc] = useState(placeholder || '');
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) return;

    const img = new Image();

    img.onload = () => {
      setImageSrc(src);
      setIsLoaded(true);
      setError(false);
    };

    img.onerror = () => {
      setError(true);
      setIsLoaded(false);
    };

    img.src = src;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);

  return { imageSrc, isLoaded, error };
}

// Virtual scrolling optimization hook
export function useVirtualScrolling<T>(
  items: T[],
  itemHeight: number,
  containerHeight: number,
  overscan: number = 5
): {
  visibleItems: Array<{ item: T; index: number }>;
  totalHeight: number;
  offsetY: number;
  scrollToIndex: (index: number) => void;
} {
  const [scrollTop, setScrollTop] = useState(0);
  const scrollElementRef = useRef<HTMLElement>();

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length - 1,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const visibleItems = items
    .slice(startIndex, endIndex + 1)
    .map((item, i) => ({ item, index: startIndex + i }));

  const totalHeight = items.length * itemHeight;
  const offsetY = startIndex * itemHeight;

  const scrollToIndex = useCallback((index: number) => {
    if (scrollElementRef.current) {
      const scrollTop = index * itemHeight;
      scrollElementRef.current.scrollTop = scrollTop;
      setScrollTop(scrollTop);
    }
  }, [itemHeight]);

  return {
    visibleItems,
    totalHeight,
    offsetY,
    scrollToIndex
  };
}

// Performance monitoring hook
export function usePerformanceMonitor(name: string): {
  startMeasure: () => void;
  endMeasure: () => number | null;
  getMetrics: () => { average: number; min: number; max: number; count: number };
} {
  const measurements = useRef<number[]>([]);
  const startTime = useRef<number | null>(null);

  const startMeasure = useCallback(() => {
    startTime.current = performance.now();
  }, []);

  const endMeasure = useCallback(() => {
    if (startTime.current === null) return null;

    const duration = performance.now() - startTime.current;
    measurements.current.push(duration);

    // Keep only last 100 measurements
    if (measurements.current.length > 100) {
      measurements.current = measurements.current.slice(-100);
    }

    startTime.current = null;
    return duration;
  }, []);

  const getMetrics = useCallback(() => {
    const values = measurements.current;
    if (values.length === 0) {
      return { average: 0, min: 0, max: 0, count: 0 };
    }

    const sum = values.reduce((a, b) => a + b, 0);
    return {
      average: sum / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length
    };
  }, []);

  return { startMeasure, endMeasure, getMetrics };
}

// Memory usage monitoring
export function useMemoryMonitor(): {
  memoryUsage: number | null;
  isHighMemory: boolean;
} {
  const [memoryUsage, setMemoryUsage] = useState<number | null>(null);

  useEffect(() => {
    const updateMemoryUsage = () => {
      if ('memory' in performance) {
        const memory = (performance as any).memory;
        setMemoryUsage(memory.usedJSHeapSize);
      }
    };

    updateMemoryUsage();
    const interval = setInterval(updateMemoryUsage, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, []);

  const isHighMemory = memoryUsage !== null && memoryUsage > 50 * 1024 * 1024; // 50MB threshold

  return { memoryUsage, isHighMemory };
}

// Throttled function execution
export function useThrottle<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): T {
  const lastRun = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout>();

  return useCallback((...args: Parameters<T>) => {
    const now = Date.now();

    if (now - lastRun.current >= delay) {
      func(...args);
      lastRun.current = now;
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        func(...args);
        lastRun.current = Date.now();
      }, delay - (now - lastRun.current));
    }
  }, [func, delay]) as T;
}
