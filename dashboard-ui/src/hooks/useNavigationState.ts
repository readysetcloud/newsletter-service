import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import type { LayoutState, SidebarPreferences, ScreenSize } from '@/types/sidebar';
import {
  getScreenSize,
  loadSidebarPreferences,
  saveSidebarPreferences,
  getCollapsedStateForScreen,
  updateCollapsedStateForScreen,
  debounce
} from '@/utils/navigationUtils';

/**
 * Hook for managing navigation sidebar state with responsive behavior
 * and persistent preferences
 */
export const useNavigationState = () => {
  const location = useLocation();

  // Initialize state
  const [layoutState, setLayoutState] = useState<LayoutState>(() => {
    const screenSize = getScreenSize();
    const preferences = loadSidebarPreferences();
    const collapsed = getCollapsedStateForScreen(preferences, screenSize);

    return {
      sidebarCollapsed: collapsed,
      sidebarVisible: screenSize !== 'mobile', // Mobile starts hidden
      screenSize
    };
  });

  const [preferences, setPreferences] = useState<SidebarPreferences>(loadSidebarPreferences);

  // Handle window resize with debouncing
  const handleResize = useCallback(
    debounce(() => {
      const newScreenSize = getScreenSize();
      const newCollapsed = getCollapsedStateForScreen(preferences, newScreenSize);

      setLayoutState(prev => ({
        ...prev,
        screenSize: newScreenSize,
        sidebarCollapsed: newCollapsed,
        sidebarVisible: newScreenSize !== 'mobile' || prev.sidebarVisible
      }));
    }, 150),
    [preferences]
  );

  // Set up resize listener
  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [handleResize]);

  // Auto-close mobile sidebar on route change
  useEffect(() => {
    if (layoutState.screenSize === 'mobile' && layoutState.sidebarVisible) {
      setLayoutState(prev => ({
        ...prev,
        sidebarVisible: false
      }));
    }
  }, [location.pathname, layoutState.screenSize]);

  /**
   * Toggle sidebar collapsed state
   */
  const toggleSidebar = useCallback(() => {
    const newCollapsed = !layoutState.sidebarCollapsed;
    const updatedPreferences = updateCollapsedStateForScreen(
      preferences,
      layoutState.screenSize,
      newCollapsed
    );

    setPreferences(updatedPreferences);
    saveSidebarPreferences(updatedPreferences);

    setLayoutState(prev => ({
      ...prev,
      sidebarCollapsed: newCollapsed
    }));
  }, [layoutState.sidebarCollapsed, layoutState.screenSize, preferences]);

  /**
   * Show sidebar (primarily for mobile)
   */
  const showSidebar = useCallback(() => {
    setLayoutState(prev => ({
      ...prev,
      sidebarVisible: true
    }));
  }, []);

  /**
   * Hide sidebar (primarily for mobile)
   */
  const hideSidebar = useCallback(() => {
    setLayoutState(prev => ({
      ...prev,
      sidebarVisible: false
    }));
  }, []);

  /**
   * Set sidebar visibility
   */
  const setSidebarVisible = useCallback((visible: boolean) => {
    setLayoutState(prev => ({
      ...prev,
      sidebarVisible: visible
    }));
  }, []);

  /**
   * Get current active navigation item based on location
   */
  const getActiveItemId = useCallback((): string | null => {
    const pathname = location.pathname;

    // Map common routes to navigation item IDs
    if (pathname === '/dashboard' || pathname === '/') {
      return 'dashboard';
    }
    if (pathname.startsWith('/templates')) {
      return 'templates';
    }
    if (pathname.startsWith('/brand')) {
      return 'brand';
    }
    if (pathname.startsWith('/senders')) {
      return 'senders';
    }
    if (pathname.startsWith('/api-keys')) {
      return 'api-keys';
    }
    if (pathname.startsWith('/profile')) {
      return 'profile';
    }
    if (pathname.startsWith('/billing')) {
      return 'billing';
    }

    return null;
  }, [location.pathname]);

  return {
    // State
    layoutState,
    preferences,
    activeItemId: getActiveItemId(),

    // Actions
    toggleSidebar,
    showSidebar,
    hideSidebar,
    setSidebarVisible,

    // Computed properties
    isMobile: layoutState.screenSize === 'mobile',
    isTablet: layoutState.screenSize === 'tablet',
    isDesktop: layoutState.screenSize === 'desktop',
    shouldShowOverlay: layoutState.screenSize !== 'desktop' && layoutState.sidebarVisible,
  };
};
