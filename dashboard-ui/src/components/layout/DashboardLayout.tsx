import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './Sidebar';
import { MainContent } from './MainContent';
import { NavigationErrorBoundary, ResponsiveErrorBoundary } from './NavigationErrorBoundary';
import { useResponsive } from '@/hooks/useResponsive';
import { useSafeResponsive } from '@/hooks/useSafeResponsive';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { getSafeStorageValue, setSafeStorageValue, recoverNavigationState } from '@/utils/navigationErrorRecovery';
import type { LayoutState, SidebarPreferences, ScreenSize } from '@/types/sidebar';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

const SIDEBAR_PREFERENCES_KEY = 'newsletter-sidebar-preferences';

const defaultPreferences: SidebarPreferences = {
  collapsed: false,
  deviceSpecific: {
    desktop: false,
    tablet: false,
  },
};

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => {
  // Use safe responsive hook with error handling
  const responsiveState = useSafeResponsive();
  const { isMobile, isTablet, isDesktop, hasError: responsiveError } = responsiveState;

  // Use safe storage with error handling
  const [preferences, setPreferences] = React.useState<SidebarPreferences>(() =>
    getSafeStorageValue(SIDEBAR_PREFERENCES_KEY, defaultPreferences)
  );

  // Update preferences with error handling
  const updatePreferences = useCallback((newPreferences: SidebarPreferences) => {
    setPreferences(newPreferences);
    setSafeStorageValue(SIDEBAR_PREFERENCES_KEY, newPreferences);
  }, []);

  // Determine current screen size with error handling
  const getScreenSize = useCallback((): ScreenSize => {
    try {
      if (responsiveError) {
        // If responsive detection failed, default to mobile for safety
        return 'mobile';
      }
      if (isMobile) return 'mobile';
      if (isTablet) return 'tablet';
      return 'desktop';
    } catch (error) {
      console.warn('Screen size detection error:', error);
      return 'mobile'; // Safe fallback
    }
  }, [isMobile, isTablet, responsiveError]);

  const [layoutState, setLayoutState] = useState<LayoutState>(() => {
    try {
      const screenSize = getScreenSize();
      return {
        sidebarCollapsed: screenSize === 'desktop' ? preferences.deviceSpecific.desktop : false,
        sidebarVisible: screenSize === 'desktop',
        screenSize,
      };
    } catch (error) {
      console.error('Layout state initialization error:', error);
      return recoverNavigationState(error as Error);
    }
  });

  // Update screen size and sidebar state when responsive breakpoints change
  useEffect(() => {
    const newScreenSize = getScreenSize();

    setLayoutState(prev => {
      const newState: LayoutState = {
        ...prev,
        screenSize: newScreenSize,
      };

      // Handle responsive behavior
      switch (newScreenSize) {
        case 'mobile':
          newState.sidebarVisible = false;
          newState.sidebarCollapsed = false;
          break;
        case 'tablet':
          newState.sidebarVisible = false; // Hidden by default on tablet
          newState.sidebarCollapsed = false;
          break;
        case 'desktop':
          newState.sidebarVisible = true;
          newState.sidebarCollapsed = preferences.deviceSpecific.desktop;
          break;
      }

      return newState;
    });
  }, [isMobile, isTablet, isDesktop, preferences.deviceSpecific.desktop]);

  const handleSidebarToggle = useCallback(() => {
    try {
      setLayoutState(prev => {
        const newCollapsed = !prev.sidebarCollapsed;

        // Update preferences for current device type with error handling
        if (prev.screenSize === 'desktop') {
          const newPreferences = {
            ...preferences,
            collapsed: newCollapsed,
            deviceSpecific: {
              ...preferences.deviceSpecific,
              desktop: newCollapsed,
            },
          };
          updatePreferences(newPreferences);
        }

        return {
          ...prev,
          sidebarCollapsed: newCollapsed,
        };
      });
    } catch (error) {
      console.error('Sidebar toggle error:', error);
      // Continue with current state if toggle fails
    }
  }, [preferences, updatePreferences]);

  const handleSidebarOpen = useCallback(() => {
    setLayoutState(prev => ({
      ...prev,
      sidebarVisible: true,
    }));
  }, []);

  const handleSidebarClose = useCallback(() => {
    setLayoutState(prev => ({
      ...prev,
      sidebarVisible: false,
    }));
  }, []);

  return (
    <NavigationErrorBoundary
      onError={(error, errorInfo) => {
        console.error('Dashboard layout navigation error:', error, errorInfo);
      }}
    >
      <ResponsiveErrorBoundary
        fallbackScreenSize={layoutState.screenSize}
        onError={(error) => {
          console.error('Dashboard layout responsive error:', error);
        }}
      >
        <div className="min-h-screen bg-gray-50 flex">
          {/* Skip link for keyboard navigation */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 bg-blue-600 text-white px-4 py-2 rounded z-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Skip to main content
          </a>

          <Sidebar
            collapsed={layoutState.sidebarCollapsed}
            visible={layoutState.sidebarVisible}
            screenSize={layoutState.screenSize}
            onToggle={handleSidebarToggle}
            onOpen={handleSidebarOpen}
            onClose={handleSidebarClose}
          />

          <div className="flex-1 flex flex-col min-w-0">
            <MainContent
              id="main-content"
              className="flex-1 p-4 md:p-6 lg:p-8"
              role="main"
              aria-label="Main content area"
              tabIndex={-1}
            >
              {children}
            </MainContent>
          </div>
        </div>
      </ResponsiveErrorBoundary>
    </NavigationErrorBoundary>
  );
};
