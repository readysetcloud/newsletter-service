import { useCallback, useEffect, useRef, useState } from 'react';

export interface AccessibilityOptions {
  /**
   * Announce changes to screen readers
   */
  announceChanges?: boolean;

  /**
   * Auto-focus management
   */
  manageFocus?: boolean;

  /**
   * Keyboard trap for modals/dialogs
 */
  trapFocus?: boolean;

  /**
   * High contrast mode detection
   */
  detectHighContrast?: boolean;

  /**
   * Reduced motion preference detection
   */
  respectReducedMotion?: boolean;
}

export interface FocusableElement {
  element: HTMLElement;
  tabIndex: number;
  originalTabIndex?: number;
}

/**
 * Hook for managing accessibility features in components
 */
export const useAccessibility = (options: AccessibilityOptions = {}) => {
  const {
    announceChanges = true,
    manageFocus = true,
    trapFocus = false,
    detectHighContrast = true,
    respectReducedMotion = true
  } = options;

  const [isHighContrast, setIsHighContrast] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const announcementRef = useRef<HTMLDivElement>(null);
  const focusableElementsRef = useRef<FocusableElement[]>([]);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

  // Detect high contrast mode
  useEffect(() => {
    if (!detectHighContrast) return;

    const checkHighContrast = () => {
      // Create a test element to detect high contrast mode
      const testElement = document.createElement('div');
      testElement.style.border = '1px solid';
      testElement.style.borderColor = 'rgb(31, 41, 55)'; // gray-800
      testElement.style.position = 'absolute';
      testElement.style.height = '5px';
      testElement.style.top = '-999px';
      testElement.style.backgroundColor = 'rgb(31, 41, 55)';

      document.body.appendChild(testElement);

      const computedStyle = window.getComputedStyle(testElement);
      const backgroundColor = computedStyle.backgroundColor;
      const borderColor = computedStyle.borderColor;

      // In high contrast mode, colors are often forced to specific values
      const isHighContrastDetected = backgroundColor === 'rgb(0, 0, 0)' ||
                                   backgroundColor === 'rgb(255, 255, 255)' ||
                                   borderColor !== 'rgb(31, 41, 55)';

      document.body.removeChild(testElement);
      setIsHighContrast(isHighContrastDetected);
    };

    checkHighContrast();

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-contrast: high)');
    const handleChange = () => checkHighContrast();

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [detectHighContrast]);

  // Detect reduced motion preference
  useEffect(() => {
    if (!respectReducedMotion) return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [respectReducedMotion]);

  // Create live region for announcements
  useEffect(() => {
    if (!announceChanges) return;

    const liveRegion = document.createElement('div');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.setAttribute('class', 'sr-only');
    liveRegion.id = 'accessibility-announcements';

    document.body.appendChild(liveRegion);
    (announcementRef as React.MutableRefObject<HTMLElement | null>).current = liveRegion;

    return () => {
      if (liveRegion.parentNode) {
        liveRegion.parentNode.removeChild(liveRegion);
      }
    };
  }, [announceChanges]);

  /**
   * Announce a message to screen readers
   */
  const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    if (!announceChanges || !announcementRef.current) return;

    announcementRef.current.setAttribute('aria-live', priority);
    announcementRef.current.textContent = message;

    // Clear the message after a short delay to allow for re-announcements
    setTimeout(() => {
      if (announcementRef.current) {
        announcementRef.current.textContent = '';
      }
    }, 1000);
  }, [announceChanges]);

  /**
   * Get all focusable elements within a container
   */
  const getFocusableElements = useCallback((container: HTMLElement): HTMLElement[] => {
    const focusableSelectors = [
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]'
    ].join(', ');

    return Array.from(container.querySelectorAll(focusableSelectors)) as HTMLElement[];
  }, []);

  /**
   * Trap focus within a container (useful for modals)
   */
  const trapFocusInContainer = useCallback((container: HTMLElement) => {
    if (!trapFocus) return () => {};

    const focusableElements = getFocusableElements(container);
    if (focusableElements.length === 0) return () => {};

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // Store the currently focused element
    lastFocusedElementRef.current = document.activeElement as HTMLElement;

    // Focus the first element
    firstElement.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      // Restore focus to the previously focused element
      if (lastFocusedElementRef.current) {
        lastFocusedElementRef.current.focus();
      }
    };
  }, [trapFocus, getFocusableElements]);

  /**
   * Manage focus for dynamic content changes
   */
  const manageFocusForUpdate = useCallback((
    container: HTMLElement,
    announcement?: string
  ) => {
    if (!manageFocus) return;

    // Announce the change if provided
    if (announcement) {
      announce(announcement);
    }

    // Find the first focusable element in the updated content
    const focusableElements = getFocusableElements(container);
    if (focusableElements.length > 0) {
      // Small delay to ensure DOM updates are complete
      setTimeout(() => {
        focusableElements[0].focus();
      }, 100);
    }
  }, [manageFocus, announce, getFocusableElements]);

  /**
   * Generate unique IDs for ARIA relationships
   */
  const generateId = useCallback((prefix: string = 'accessibility') => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  /**
   * Create ARIA attributes for form field relationships
   */
  const getFieldAriaAttributes = useCallback((
    fieldId: string,
    options: {
      labelId?: string;
      descriptionId?: string;
      errorId?: string;
      required?: boolean;
      invalid?: boolean;
    } = {}
  ) => {
    const { labelId, descriptionId, errorId, required = false, invalid = false } = options;

    const describedBy = [descriptionId, errorId].filter(Boolean).join(' ');

    return {
      id: fieldId,
      'aria-labelledby': labelId,
      'aria-describedby': describedBy || undefined,
      'aria-required': required,
      'aria-invalid': invalid
    };
  }, []);

  return {
    // State
    isHighContrast,
    prefersReducedMotion,

    // Functions
    announce,
    getFocusableElements,
    trapFocusInContainer,
    manageFocusForUpdate,
    generateId,
    getFieldAriaAttributes,

    // Refs
    announcementRef
  };
};

export default useAccessibility;
