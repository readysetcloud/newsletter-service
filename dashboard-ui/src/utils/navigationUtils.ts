import type { SidebarPreferences, ScreenSize, BadgeConfig } from '@/types/sidebar';
import type { SenderStatus } from '@/hooks/useSenderStatus';

// Local storage key for sidebar preferences
export const SIDEBAR_PREFERENCES_KEY = 'newsletter-sidebar-preferences';

// Responsive breakpoints
export const breakpoints = {
  mobile: 768,
  tablet: 1024,
  desktop: 1024
} as const;

/**
 * Get current screen size based on window width
 */
export const getScreenSize = (): ScreenSize => {
  if (typeof window === 'undefined') {
    return 'desktop'; // Default for SSR
  }

  const width = window.innerWidth;

  if (width < breakpoints.mobile) {
    return 'mobile';
  } else if (width < breakpoints.desktop) {
    return 'tablet';
  } else {
    return 'desktop';
  }
};

/**
 * Get default sidebar preferences
 */
export const getDefaultSidebarPreferences = (): SidebarPreferences => ({
  collapsed: false,
  deviceSpecific: {
    desktop: false,
    tablet: false,
  }
});

/**
 * Load sidebar preferences from localStorage
 */
export const loadSidebarPreferences = (): SidebarPreferences => {
  try {
    const stored = localStorage.getItem(SIDEBAR_PREFERENCES_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle missing properties
      return {
        ...getDefaultSidebarPreferences(),
        ...parsed,
        deviceSpecific: {
          ...getDefaultSidebarPreferences().deviceSpecific,
          ...parsed.deviceSpecific
        }
      };
    }
  } catch (error) {
    console.warn('Failed to load sidebar preferences:', error);
  }

  return getDefaultSidebarPreferences();
};

/**
 * Save sidebar preferences to localStorage
 */
export const saveSidebarPreferences = (preferences: SidebarPreferences): void => {
  try {
    localStorage.setItem(SIDEBAR_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.warn('Failed to save sidebar preferences:', error);
  }
};

/**
 * Get the appropriate collapsed state for the current screen size
 */
export const getCollapsedStateForScreen = (
  preferences: SidebarPreferences,
  screenSize: ScreenSize
): boolean => {
  switch (screenSize) {
    case 'desktop':
      return preferences.deviceSpecific.desktop;
    case 'tablet':
      return preferences.deviceSpecific.tablet;
    case 'mobile':
      return true; // Mobile is always "collapsed" (hidden by default)
    default:
      return preferences.collapsed;
  }
};

/**
 * Update collapsed state for specific screen size
 */
export const updateCollapsedStateForScreen = (
  preferences: SidebarPreferences,
  screenSize: ScreenSize,
  collapsed: boolean
): SidebarPreferences => {
  const updated = { ...preferences };

  switch (screenSize) {
    case 'desktop':
      updated.deviceSpecific.desktop = collapsed;
      break;
    case 'tablet':
      updated.deviceSpecific.tablet = collapsed;
      break;
    // Mobile doesn't persist collapsed state
  }

  // Also update the general collapsed state
  updated.collapsed = collapsed;

  return updated;
};

/**
 * Generate badge configuration for sender emails based on status
 */
export const generateSenderBadge = (senderStatus: SenderStatus): BadgeConfig | undefined => {
  if (senderStatus.loading) {
    return undefined;
  }

  // Priority: Failed > Timed Out > Pending > Success
  if (senderStatus.hasFailed) {
    return {
      status: 'error',
      count: senderStatus.failedCount,
      text: `${senderStatus.failedCount} failed`
    };
  }

  if (senderStatus.hasTimedOut) {
    return {
      status: 'warning',
      count: senderStatus.timedOutCount,
      text: `${senderStatus.timedOutCount} timed out`
    };
  }

  if (senderStatus.hasUnverified) {
    return {
      status: 'info',
      count: senderStatus.pendingCount,
      text: `${senderStatus.pendingCount} pending`
    };
  }

  // Show success indicator if there are verified senders
  if (senderStatus.verifiedCount > 0) {
    return {
      status: 'success',
      count: senderStatus.verifiedCount,
      text: `${senderStatus.verifiedCount} verified`
    };
  }

  return undefined;
};

/**
 * Debounce function for window resize events
 */
export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout;

  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

/**
 * Check if a route should preload its component
 */
export const shouldPreloadRoute = (preloadKey: string): boolean => {
  // Add logic here to determine if a route should be preloaded
  // For now, we'll preload all routes on hover/focus
  return true;
};

/**
 * Get tooltip text for collapsed navigation items
 */
export const getTooltipText = (label: string, badge?: BadgeConfig): string => {
  if (badge && badge.text) {
    return `${label} - ${badge.text}`;
  }
  return label;
};
