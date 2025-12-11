import { useState, useEffect, useCallback } from 'react';
import { getResponsiveFallback } from '@/utils/navigationErrorRecovery';
import type { ScreenSize } from '@/types/sidebar';

interface SafeResponsiveState {
  windowSize: { width: number; height: number };
  screenSize: ScreenSize;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  hasError: boolean;
  errorCount: number;
}

interface BreakpointConfig {
  mobile: number;
  tablet: number;
  desktop: number;
}

const DEFAULT_BREAKPOINTS: BreakpointConfig = {
  mobile: 768,
  tablet: 1024,
  desktop: 1024
};

/**
 * Safe responsive hook that handles errors gracefully
 * Falls back to mobile-first approach when responsive detection fails
 */
export const useSafeResponsive = (breakpoints: BreakpointConfig = DEFAULT_BREAKPOINTS) => {
  const [state, setState] = useState<SafeResponsiveState>(() => {
    try {
      const width = typeof window !== 'undefined' ? window.innerWidth : 0;
      const height = typeof window !== 'undefined' ? window.innerHeight : 0;

      return {
        windowSize: { width, height },
        screenSize: width < breakpoints.mobile ? 'mobile' :
                   width < breakpoints.tablet ? 'tablet' : 'desktop',
        isMobile: width < breakpoints.mobile,
        isTablet: width >= breakpoints.mobile && width < breakpoints.tablet,
        isDesktop: width >= breakpoints.desktop,
        hasError: false,
        errorCount: 0
      };
    } catch (error) {
      console.warn('Initial responsive state setup failed:', error);
      const fallback = getResponsiveFallback(error as Error);
      return {
        windowSize: { width: 0, height: 0 },
        ...fallback,
        hasError: true,
        errorCount: 1
      };
    }
  });

  const updateResponsiveState = useCallback(() => {
    try {
      if (typeof window === 'undefined') {
        return;
      }

      const width = window.innerWidth;
      const height = window.innerHeight;

      const newState: SafeResponsiveState = {
        windowSize: { width, height },
        screenSize: width < breakpoints.mobile ? 'mobile' :
                   width < breakpoints.tablet ? 'tablet' : 'desktop',
        isMobile: width < breakpoints.mobile,
        isTablet: width >= breakpoints.mobile && width < breakpoints.tablet,
        isDesktop: width >= breakpoints.desktop,
        hasError: false,
        errorCount: state.errorCount
      };

      setState(newState);
    } catch (error) {
      console.warn('Responsive state update failed:', error);

      setState(prevState => {
        const fallback = getResponsiveFallback(error as Error);
        return {
          ...prevState,
          ...fallback,
          hasError: true,
          errorCount: prevState.errorCount + 1
        };
      });
    }
  }, [breakpoints.mobile, breakpoints.tablet, breakpoints.desktop, state.errorCount]);

  useEffect(() => {
    let mounted = true;
    let timeoutId: number | null = null;

    // Debounced resize handler to prevent excessive updates
    const debouncedUpdate = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = window.setTimeout(() => {
        if (mounted) {
          updateResponsiveState();
        }
      }, 100);
    };

    const handleResize = () => {
      try {
        debouncedUpdate();
      } catch (error) {
        console.warn('Resize handler failed:', error);

        if (mounted) {
          setState(prevState => {
            const fallback = getResponsiveFallback(error as Error);
            return {
              ...prevState,
              ...fallback,
              hasError: true,
              errorCount: prevState.errorCount + 1
            };
          });
        }
      }
    };

    // Set initial state
    updateResponsiveState();

    // Add resize listener with error handling
    try {
      window.addEventListener('resize', handleResize, { passive: true });
    } catch (error) {
      console.warn('Failed to add resize listener:', error);
      setState(prevState => ({
        ...prevState,
        hasError: true,
        errorCount: prevState.errorCount + 1
      }));
    }

    return () => {
      mounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      try {
        window.removeEventListener('resize', handleResize);
      } catch (error) {
        console.warn('Failed to remove resize listener:', error);
      }
    };
  }, [updateResponsiveState]);

  // Provide utility functions with error handling
  const isAbove = useCallback((breakpoint: keyof BreakpointConfig): boolean => {
    try {
      return state.windowSize.width >= breakpoints[breakpoint];
    } catch (error) {
      console.warn(`isAbove(${breakpoint}) failed:`, error);
      return false;
    }
  }, [state.windowSize.width, breakpoints]);

  const isBelow = useCallback((breakpoint: keyof BreakpointConfig): boolean => {
    try {
      return state.windowSize.width < breakpoints[breakpoint];
    } catch (error) {
      console.warn(`isBelow(${breakpoint}) failed:`, error);
      return true; // Default to mobile-first
    }
  }, [state.windowSize.width, breakpoints]);

  const isBetween = useCallback((min: keyof BreakpointConfig, max: keyof BreakpointConfig): boolean => {
    try {
      return state.windowSize.width >= breakpoints[min] && state.windowSize.width < breakpoints[max];
    } catch (error) {
      console.warn(`isBetween(${min}, ${max}) failed:`, error);
      return false;
    }
  }, [state.windowSize.width, breakpoints]);

  // Reset error state (useful for error recovery)
  const resetError = useCallback(() => {
    setState(prevState => ({
      ...prevState,
      hasError: false,
      errorCount: 0
    }));
    updateResponsiveState();
  }, [updateResponsiveState]);

  return {
    windowSize: state.windowSize,
    screenSize: state.screenSize,
    isMobile: state.isMobile,
    isTablet: state.isTablet,
    isDesktop: state.isDesktop,
    hasError: state.hasError,
    errorCount: state.errorCount,
    isAbove,
    isBelow,
    isBetween,
    resetError
  };
};

/**
 * Hook for responsive behavior with mobile-first fallback
 * Automatically falls back to mobile behavior when responsive detection fails
 */
export const useMobileFallbackResponsive = () => {
  const responsive = useSafeResponsive();

  // If there are errors, default to mobile behavior for safety
  if (responsive.hasError || responsive.errorCount > 3) {
    return {
      ...responsive,
      screenSize: 'mobile' as ScreenSize,
      isMobile: true,
      isTablet: false,
      isDesktop: false
    };
  }

  return responsive;
};

export default useSafeResponsive;
