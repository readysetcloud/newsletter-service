import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseScrollTrackingOptions {
  /**
   * Threshold for Intersection Observer (0-1)
   * @default 0.5
   */
  threshold?: number;
  /**
   * Root margin for Intersection Observer
   * @default '-100px 0px -50% 0px'
   */
  rootMargin?: string;
  /**
   * Whether smooth scrolling is enabled
   * @default true
   */
  smoothScroll?: boolean;
}

export interface UseScrollTrackingReturn {
  /**
   * Currently active section ID
   */
  activeSection: string | null;
  /**
   * Scroll to a specific section
   */
  scrollToSection: (sectionId: string) => void;
  /**
   * Register a section element for tracking
   */
  registerSection: (sectionId: string, element: HTMLElement | null) => void;
  /**
   * Unregister a section element
   */
  unregisterSection: (sectionId: string) => void;
}

/**
 * Custom hook for tracking scroll position and active sections using Intersection Observer
 *
 * Features:
 * - Tracks which section is currently in the viewport
 * - Provides smooth scrolling to sections
 * - Uses Intersection Observer for efficient scroll tracking
 * - Handles section registration and cleanup
 *
 * @param options - Configuration options for scroll tracking
 * @returns Object with activeSection, scrollToSection, and section registration functions
 *
 * @example
 * ```tsx
 * const { activeSection, scrollToSection, registerSection } = useScrollTracking({
 *   threshold: 0.5,
 *   rootMargin: '-100px 0px -50% 0px',
 * });
 *
 * // Register sections
 * <section ref={(el) => registerSection('engagement', el)}>
 *   Engagement content
 * </section>
 *
 * // Scroll to section
 * <button onClick={() => scrollToSection('engagement')}>
 *   Go to Engagement
 * </button>
 * ```
 */
export const useScrollTracking = (
  options: UseScrollTrackingOptions = {}
): UseScrollTrackingReturn => {
  const {
    threshold = 0.5,
    rootMargin = '-100px 0px -50% 0px',
    smoothScroll = true,
  } = options;

  const [activeSection, setActiveSection] = useState<string | null>(null);
  const sectionsRef = useRef<Map<string, HTMLElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const isScrollingRef = useRef(false);

  // Initialize Intersection Observer
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Don't update active section while programmatically scrolling
        if (isScrollingRef.current) {
          return;
        }

        // Find the most visible section
        let mostVisibleEntry: IntersectionObserverEntry | undefined;
        let maxIntersectionRatio = 0;

        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > maxIntersectionRatio) {
            mostVisibleEntry = entry;
            maxIntersectionRatio = entry.intersectionRatio;
          }
        });

        if (mostVisibleEntry && mostVisibleEntry.target instanceof HTMLElement) {
          const sectionId = mostVisibleEntry.target.id;
          setActiveSection(sectionId);
        }
      },
      {
        threshold,
        rootMargin,
      }
    );

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [threshold, rootMargin]);

  // Register a section for tracking
  const registerSection = useCallback((sectionId: string, element: HTMLElement | null) => {
    if (!element) {
      return;
    }

    // Store the element
    sectionsRef.current.set(sectionId, element);

    // Observe the element
    if (observerRef.current) {
      observerRef.current.observe(element);
    }
  }, []);

  // Unregister a section
  const unregisterSection = useCallback((sectionId: string) => {
    const element = sectionsRef.current.get(sectionId);
    if (element && observerRef.current) {
      observerRef.current.unobserve(element);
    }
    sectionsRef.current.delete(sectionId);
  }, []);

  // Scroll to a specific section
  const scrollToSection = useCallback((sectionId: string) => {
    const element = sectionsRef.current.get(sectionId);
    if (!element) {
      return;
    }

    // Set flag to prevent active section updates during scroll
    isScrollingRef.current = true;

    // Calculate scroll position (accounting for sticky nav)
    const navHeight = 80; // Approximate height of sticky navigation
    const elementTop = element.getBoundingClientRect().top + window.pageYOffset;
    const scrollToPosition = elementTop - navHeight;

    // Scroll to the section
    window.scrollTo({
      top: scrollToPosition,
      behavior: smoothScroll ? 'smooth' : 'auto',
    });

    // Update active section immediately
    setActiveSection(sectionId);

    // Reset scrolling flag after animation completes
    setTimeout(() => {
      isScrollingRef.current = false;
    }, smoothScroll ? 1000 : 0);
  }, [smoothScroll]);

  return {
    activeSection,
    scrollToSection,
    registerSection,
    unregisterSection,
  };
};

export default useScrollTracking;
