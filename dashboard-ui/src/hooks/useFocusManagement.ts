import { useCallback, useEffect, useRef } from 'react';

interface FocusableElement extends HTMLElement {
  focus(): void;
}

interface UseFocusManagementOptions {
  trapFocus?: boolean;
  restoreFocus?: boolean;
  autoFocus?: boolean;
  focusableSelector?: string;
}

const DEFAULT_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]'
].join(', ');

export const useFocusManagement = ({
  trapFocus = false,
  restoreFocus = false,
  autoFocus = false,
  focusableSelector = DEFAULT_FOCUSABLE_SELECTOR
}: UseFocusManagementOptions = {}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<Element | null>(null);

  // Store the previously focused element when component mounts
  useEffect(() => {
    if (restoreFocus) {
      previousActiveElementRef.current = document.activeElement;
    }
  }, [restoreFocus]);

  // Auto focus first focusable element
  useEffect(() => {
    if (autoFocus && containerRef.current) {
      const firstFocusable = getFocusableElements(containerRef.current, focusableSelector)[0];
      if (firstFocusable) {
        firstFocusable.focus();
      }
    }
  }, [autoFocus, focusableSelector]);

  // Focus trap implementation
  useEffect(() => {
    if (!trapFocus || !containerRef.current) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const container = containerRef.current;
      if (!container) return;

      const focusableElements = getFocusableElements(container, focusableSelector);
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        // Shift + Tab: moving backwards
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: moving forwards
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [trapFocus, focusableSelector]);

  // Restore focus when component unmounts
  useEffect(() => {
    return () => {
      if (restoreFocus && previousActiveElementRef.current) {
        const elementToFocus = previousActiveElementRef.current as FocusableElement;
        if (elementToFocus && typeof elementToFocus.focus === 'function') {
          // Use setTimeout to ensure the element is still in the DOM
          setTimeout(() => {
            try {
              elementToFocus.focus();
            } catch (error) {
              // Element might have been removed from DOM
              console.warn('Could not restore focus:', error);
            }
          }, 0);
        }
      }
    };
  }, [restoreFocus]);

  const getFocusableElements = useCallback((container: HTMLElement, selector: string): FocusableElement[] => {
    const elements = Array.from(container.querySelectorAll(selector)) as FocusableElement[];
    return elements.filter(element => {
      // Additional checks for truly focusable elements
      const style = window.getComputedStyle(element);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        !element.hasAttribute('disabled') &&
        element.tabIndex !== -1
      );
    });
  }, []);

  const focusFirst = useCallback(() => {
    if (!containerRef.current) return false;

    const focusableElements = getFocusableElements(containerRef.current, focusableSelector);
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
      return true;
    }
    return false;
  }, [focusableSelector, getFocusableElements]);

  const focusLast = useCallback(() => {
    if (!containerRef.current) return false;

    const focusableElements = getFocusableElements(containerRef.current, focusableSelector);
    if (focusableElements.length > 0) {
      focusableElements[focusableElements.length - 1].focus();
      return true;
    }
    return false;
  }, [focusableSelector, getFocusableElements]);

  const focusNext = useCallback(() => {
    if (!containerRef.current) return false;

    const focusableElements = getFocusableElements(containerRef.current, focusableSelector);
    const currentIndex = focusableElements.findIndex(el => el === document.activeElement);

    if (currentIndex !== -1 && currentIndex < focusableElements.length - 1) {
      focusableElements[currentIndex + 1].focus();
      return true;
    }
    return false;
  }, [focusableSelector, getFocusableElements]);

  const focusPrevious = useCallback(() => {
    if (!containerRef.current) return false;

    const focusableElements = getFocusableElements(containerRef.current, focusableSelector);
    const currentIndex = focusableElements.findIndex(el => el === document.activeElement);

    if (currentIndex > 0) {
      focusableElements[currentIndex - 1].focus();
      return true;
    }
    return false;
  }, [focusableSelector, getFocusableElements]);

  const containsFocus = useCallback(() => {
    return containerRef.current?.contains(document.activeElement) || false;
  }, []);

  return {
    containerRef,
    focusFirst,
    focusLast,
    focusNext,
    focusPrevious,
    containsFocus,
    getFocusableElements: useCallback(() => {
      return containerRef.current ? getFocusableElements(containerRef.current, focusableSelector) : [];
    }, [getFocusableElements, focusableSelector])
  };
};

export default useFocusManagement;
