/**
 * Cross-browser compatibility utilities for the visual builder
 */

export interface BrowserSupport {
  dragAndDrop: boolean;
  animations: boolean;
  flexbox: boolean;
  grid: boolean;
  touchEvents: boolean;
  webGL: boolean;
  localStorage: boolean;
  sessionStorage: boolean;
  indexedDB: boolean;
  webWorkers: boolean;
  intersectionObserver: boolean;
  resizeObserver: boolean;
}

export interface DeviceCapabilities {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  hasTouch: boolean;
  deviceMemory?: number;
  hardwareConcurrency: number;
  connectionType?: string;
  effectiveType?: string;
  downlink?: number;
}

/**
 * Comprehensive browser feature detection
 */
export const detectBrowserSupport = (): BrowserSupport => {
  const support: BrowserSupport = {
    dragAndDrop: false,
    animations: false,
    flexbox: false,
    grid: false,
    touchEvents: false,
    webGL: false,
    localStorage: false,
    sessionStorage: false,
    indexedDB: false,
    webWorkers: false,
    intersectionObserver: false,
    resizeObserver: false
  };

  // Drag and Drop API
  try {
    const testDiv = document.createElement('div');
    support.dragAndDrop = 'draggable' in testDiv &&
                         'ondragstart' in testDiv &&
                         'ondrop' in testDiv;
  } catch {
    support.dragAndDrop = false;
  }

  // CSS Animations
  support.animations = CSS.supports('animation', 'none') ||
                      CSS.supports('-webkit-animation', 'none');

  // Flexbox
  support.flexbox = CSS.supports('display', 'flex') ||
                   CSS.supports('display', '-webkit-flex');

  // CSS Grid
  support.grid = CSS.supports('display', 'grid') ||
                CSS.supports('display', '-ms-grid');

  // Touch Events
  support.touchEvents = 'ontouchstart' in window ||
                       navigator.maxTouchPoints > 0 ||
                       (navigator as any).msMaxTouchPoints > 0;

  // WebGL
  try {
    const canvas = document.createElement('canvas');
    support.webGL = !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    support.webGL = false;
  }

  // Local Storage
  try {
    localStorage.setItem('test', 'test');
    localStorage.removeItem('test');
    support.localStorage = true;
  } catch {
    support.localStorage = false;
  }

  // Session Storage
  try {
    sessionStorage.setItem('test', 'test');
    sessionStorage.removeItem('test');
    support.sessionStorage = true;
  } catch {
    support.sessionStorage = false;
  }

  // IndexedDB
  support.indexedDB = 'indexedDB' in window;

  // Web Workers
  support.webWorkers = 'Worker' in window;

  // Intersection Observer
  support.intersectionObserver = 'IntersectionObserver' in window;

  // Resize Observer
  support.resizeObserver = 'ResizeObserver' in window;

  return support;
};

/**
 * Detect device capabilities and performance characteristics
 */
export const detectDeviceCapabilities = (): DeviceCapabilities => {
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
  const isTablet = /ipad|android(?!.*mobile)/i.test(userAgent);
  const isDesktop = !isMobile && !isTablet;

  const capabilities: DeviceCapabilities = {
    isMobile,
    isTablet,
    isDesktop,
    hasTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    hardwareConcurrency: navigator.hardwareConcurrency || 1
  };

  // Device Memory API (experimental)
  if ('deviceMemory' in navigator) {
    capabilities.deviceMemory = (navigator as any).deviceMemory;
  }

  // Network Information API (experimental)
  const connection = (navigator as any).connection ||
                    (navigator as any).mozConnection ||
                    (navigator as any).webkitConnection;

  if (connection) {
    capabilities.connectionType = connection.type;
    capabilities.effectiveType = connection.effectiveType;
    capabilities.downlink = connection.downlink;
  }

  return capabilities;
};

/**
 * Determine optimal performance mode based on device capabilities
 */
export const determinePerformanceMode = (
  browserSupport: BrowserSupport,
  deviceCapabilities: DeviceCapabilities
): 'high' | 'standard' | 'optimized' => {
  // High performance mode for powerful devices
  if (
    deviceCapabilities.isDesktop &&
    deviceCapabilities.hardwareConcurrency >= 8 &&
    (!deviceCapabilities.deviceMemory || deviceCapabilities.deviceMemory >= 8) &&
    browserSupport.webGL &&
    browserSupport.intersectionObserver &&
    browserSupport.resizeObserver
  ) {
    return 'high';
  }

  // Optimized mode for lower-end devices
  if (
    deviceCapabilities.isMobile ||
    deviceCapabilities.hardwareConcurrency < 4 ||
    (deviceCapabilities.deviceMemory && deviceCapabilities.deviceMemory < 4) ||
    (deviceCapabilities.effectiveType && ['slow-2g', '2g', '3g'].includes(deviceCapabilities.effectiveType)) ||
    !browserSupport.animations ||
    !browserSupport.flexbox
  ) {
    return 'optimized';
  }

  return 'standard';
};

/**
 * Apply polyfills and fallbacks for unsupported features
 */
export const applyCompatibilityFixes = (browserSupport: BrowserSupport): void => {
  // Drag and Drop polyfill for touch devices
  if (!browserSupport.dragAndDrop && browserSupport.touchEvents) {
    loadDragDropPolyfill();
  }

  // Intersection Observer polyfill
  if (!browserSupport.intersectionObserver) {
    loadIntersectionObserverPolyfill();
  }

  // Resize Observer polyfill
  if (!browserSupport.resizeObserver) {
    loadResizeObserverPolyfill();
  }

  // CSS Grid fallback
  if (!browserSupport.grid && browserSupport.flexbox) {
    applyCSSGridFallback();
  }

  // Animation fallbacks
  if (!browserSupport.animations) {
    applyAnimationFallbacks();
  }
};

/**
 * Load drag and drop polyfill for touch devices
 */
const loadDragDropPolyfill = (): void => {
  // Simple touch-to-drag polyfill
  let draggedElement: HTMLElement | null = null;
  let touchOffset = { x: 0, y: 0 };

  document.addEventListener('touchstart', (e) => {
    const target = e.target as HTMLElement;
    if (target.draggable) {
      draggedElement = target;
      const touch = e.touches[0];
      const rect = target.getBoundingClientRect();
      touchOffset.x = touch.clientX - rect.left;
      touchOffset.y = touch.clientY - rect.top;

      target.style.opacity = '0.5';
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (draggedElement) {
      const touch = e.touches[0];
      draggedElement.style.position = 'fixed';
      draggedElement.style.left = `${touch.clientX - touchOffset.x}px`;
      draggedElement.style.top = `${touch.clientY - touchOffset.y}px`;
      draggedElement.style.zIndex = '9999';
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (draggedElement) {
      const touch = e.changedTouches[0];
      const dropTarget = document.elementFromPoint(touch.clientX, touch.clientY);

      // Simulate drop event
      if (dropTarget) {
        const dropEvent = new CustomEvent('drop', {
          bubbles: true,
          detail: { draggedElement, touch }
        });
        dropTarget.dispatchEvent(dropEvent);
      }

      // Reset dragged element
      draggedElement.style.position = '';
      draggedElement.style.left = '';
      draggedElement.style.top = '';
      draggedElement.style.zIndex = '';
      draggedElement.style.opacity = '';
      draggedElement = null;
    }
  });
};

/**
 * Load Intersection Observer polyfill
 */
const loadIntersectionObserverPolyfill = (): void => {
  // Simple polyfill using scroll events
  if (!window.IntersectionObserver) {
    (window as any).IntersectionObserver = class {
      private callback: IntersectionObserverCallback;
      private elements: Set<Element> = new Set();

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        this.setupScrollListener();
      }

      observe(element: Element) {
        this.elements.add(element);
        this.checkIntersection(element);
      }

      unobserve(element: Element) {
        this.elements.delete(element);
      }

      disconnect() {
        this.elements.clear();
      }

      private setupScrollListener() {
        const checkAll = () => {
          this.elements.forEach(element => this.checkIntersection(element));
        };

        window.addEventListener('scroll', checkAll, { passive: true });
        window.addEventListener('resize', checkAll, { passive: true });
      }

      private checkIntersection(element: Element) {
        const rect = element.getBoundingClientRect();
        const isIntersecting = rect.top < window.innerHeight && rect.bottom > 0;

        this.callback([{
          target: element,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
          boundingClientRect: rect,
          intersectionRect: rect,
          rootBounds: { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth, width: window.innerWidth, height: window.innerHeight },
          time: Date.now()
        } as IntersectionObserverEntry], this as any);
      }
    };
  }
};

/**
 * Load Resize Observer polyfill
 */
const loadResizeObserverPolyfill = (): void => {
  if (!window.ResizeObserver) {
    (window as any).ResizeObserver = class {
      private callback: ResizeObserverCallback;
      private elements: Map<Element, { width: number; height: number }> = new Map();

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        this.setupResizeListener();
      }

      observe(element: Element) {
        const rect = element.getBoundingClientRect();
        this.elements.set(element, { width: rect.width, height: rect.height });
      }

      unobserve(element: Element) {
        this.elements.delete(element);
      }

      disconnect() {
        this.elements.clear();
      }

      private setupResizeListener() {
        const checkResize = () => {
          const entries: ResizeObserverEntry[] = [];

          this.elements.forEach((lastSize, element) => {
            const rect = element.getBoundingClientRect();
            if (rect.width !== lastSize.width || rect.height !== lastSize.height) {
              this.elements.set(element, { width: rect.width, height: rect.height });
              entries.push({
                target: element,
                contentRect: rect,
                borderBoxSize: [{ blockSize: rect.height, inlineSize: rect.width }],
                contentBoxSize: [{ blockSize: rect.height, inlineSize: rect.width }],
                devicePixelContentBoxSize: [{ blockSize: rect.height, inlineSize: rect.width }]
              } as ResizeObserverEntry);
            }
          });

          if (entries.length > 0) {
            this.callback(entries, this as any);
          }
        };

        window.addEventListener('resize', checkResize, { passive: true });
        setInterval(checkResize, 100); // Fallback polling
      }
    };
  }
};

/**
 * Apply CSS Grid fallback using Flexbox
 */
const applyCSSGridFallback = (): void => {
  const style = document.createElement('style');
  style.textContent = `
    .grid-fallback {
      display: flex;
      flex-wrap: wrap;
    }

    .grid-fallback > * {
      flex: 1 1 auto;
      min-width: 0;
    }

    .grid-fallback.grid-cols-2 > * {
      flex-basis: 50%;
    }

    .grid-fallback.grid-cols-3 > * {
      flex-basis: 33.333%;
    }

    .grid-fallback.grid-cols-4 > * {
      flex-basis: 25%;
    }
  `;
  document.head.appendChild(style);
};

/**
 * Apply animation fallbacks for browsers without CSS animation support
 */
const applyAnimationFallbacks = (): void => {
  const style = document.createElement('style');
  style.textContent = `
    .animate-fallback {
      transition: opacity 0.2s ease-in-out;
    }

    .animate-fallback.fade-in {
      opacity: 1;
    }

    .animate-fallback.fade-out {
      opacity: 0;
    }

    .animate-fallback.slide-in {
      transform: translateX(0);
    }

    .animate-fallback.slide-out {
      transform: translateX(-100%);
    }
  `;
  document.head.appendChild(style);
};

/**
 * Get browser-specific CSS prefixes
 */
export const getBrowserPrefixes = (): string[] => {
  const prefixes: string[] = [];
  const testElement = document.createElement('div');
  const style = testElement.style;

  // Test for webkit prefix
  if ('webkitTransform' in style) {
    prefixes.push('-webkit-');
  }

  // Test for moz prefix
  if ('MozTransform' in style) {
    prefixes.push('-moz-');
  }

  // Test for ms prefix
  if ('msTransform' in style) {
    prefixes.push('-ms-');
  }

  // Test for o prefix
  if ('OTransform' in style) {
    prefixes.push('-o-');
  }

  return prefixes;
};

/**
 * Apply vendor prefixes to CSS properties
 */
export const addVendorPrefixes = (property: string, value: string): Record<string, string> => {
  const prefixes = getBrowserPrefixes();
  const result: Record<string, string> = {};

  // Add unprefixed version
  result[property] = value;

  // Add prefixed versions
  prefixes.forEach(prefix => {
    const prefixedProperty = prefix + property;
    result[prefixedProperty] = value;
  });

  return result;
};

/**
 * Check if the current browser is supported
 */
export const isBrowserSupported = (browserSupport: BrowserSupport): boolean => {
  // Minimum requirements for the visual builder
  return browserSupport.flexbox &&
         browserSupport.localStorage &&
         browserSupport.dragAndDrop;
};

/**
 * Get user-friendly browser compatibility message
 */
export const getBrowserCompatibilityMessage = (browserSupport: BrowserSupport): string | null => {
  if (!browserSupport.flexbox) {
    return 'Your browser does not support Flexbox layout. Please update to a modern browser for the best experience.';
  }

  if (!browserSupport.dragAndDrop) {
    return 'Drag and drop functionality is limited in your browser. You can still use the visual builder with click-to-add components.';
  }

  if (!browserSupport.localStorage) {
    return 'Local storage is not available. Your work may not be saved automatically.';
  }

  if (!browserSupport.animations) {
    return 'CSS animations are not supported. The interface will work but may appear less smooth.';
  }

  return null;
};

export default {
  detectBrowserSupport,
  detectDeviceCapabilities,
  determinePerformanceMode,
  applyCompatibilityFixes,
  getBrowserPrefixes,
  addVendorPrefixes,
  isBrowserSupported,
  getBrowserCompatibilityMessage
};
