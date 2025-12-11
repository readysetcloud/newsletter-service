import React from 'react';
import {
  HomeIcon,
  DocumentIcon,
  BuildingOfficeIcon,
  EnvelopeIcon,
  KeyIcon,
  UserIcon,
  CreditCardIcon,
  QuestionMarkCircleIcon
} from '@heroicons/react/24/outline';
import type { NavigationItem, NavigationGroup, ScreenSize } from '@/types/sidebar';

/**
 * Error recovery utilities for navigation system
 */

/**
 * Fallback icon mapping for when icons fail to load
 */
const FALLBACK_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: HomeIcon,
  templates: DocumentIcon,
  brand: BuildingOfficeIcon,
  senders: EnvelopeIcon,
  'sender-emails': EnvelopeIcon,
  'api-keys': KeyIcon,
  profile: UserIcon,
  billing: CreditCardIcon,
  settings: KeyIcon,
  account: UserIcon,
  default: QuestionMarkCircleIcon
};

/**
 * Get fallback icon for navigation item
 */
export const getFallbackIcon = (itemId: string): React.ComponentType<{ className?: string }> => {
  const normalizedId = itemId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return FALLBACK_ICON_MAP[normalizedId] || FALLBACK_ICON_MAP.default;
};

/**
 * Validate and sanitize navigation configuration
 */
export const sanitizeNavigationConfig = (
  config: NavigationGroup[]
): NavigationGroup[] => {
  try {
    return config.map(group => ({
      ...group,
      items: group.items
        .filter(item => {
          // Validate required fields
          if (!item.id || !item.label || !item.href) {
            console.warn('Invalid navigation item missing required fields:', item);
            return false;
          }
          return true;
        })
        .map(item => ({
          ...item,
          // Ensure icon is available or provide fallback
          icon: item.icon || getFallbackIcon(item.id)
        }))
    })).filter(group => group.items.length > 0);
  } catch (error) {
    console.error('Navigation configuration sanitization failed:', error);
    return getMinimalNavigationConfig();
  }
};

/**
 * Get minimal navigation configuration as last resort
 */
export const getMinimalNavigationConfig = (): NavigationGroup[] => {
  return [
    {
      id: 'main',
      label: '',
      items: [
        {
          id: 'dashboard',
          label: 'Dashboard',
          href: '/dashboard',
          icon: HomeIcon
        },
        {
          id: 'profile',
          label: 'Profile',
          href: '/profile',
          icon: UserIcon
        }
      ]
    }
  ];
};

/**
 * Responsive detection error recovery
 */
export const getResponsiveFallback = (error?: Error): {
  screenSize: ScreenSize;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
} => {
  console.warn('Responsive detection failed, using fallback:', error);

  // Try to detect screen size using basic window properties
  let screenSize: ScreenSize = 'desktop';
  let isMobile = false;
  let isTablet = false;
  let isDesktop = true;

  try {
    if (typeof window !== 'undefined' && window.innerWidth) {
      const width = window.innerWidth;
      if (width < 768) {
        screenSize = 'mobile';
        isMobile = true;
        isTablet = false;
        isDesktop = false;
      } else if (width < 1024) {
        screenSize = 'tablet';
        isMobile = false;
        isTablet = true;
        isDesktop = false;
      }
    }
  } catch (fallbackError) {
    console.warn('Fallback responsive detection also failed:', fallbackError);
    // Default to mobile as safest option
    screenSize = 'mobile';
    isMobile = true;
    isTablet = false;
    isDesktop = false;
  }

  return { screenSize, isMobile, isTablet, isDesktop };
};

/**
 * Navigation configuration error recovery
 */
export const recoverNavigationConfig = (
  originalConfig: NavigationGroup[],
  error: Error
): NavigationGroup[] => {
  console.warn('Navigation configuration error, attempting recovery:', error);

  try {
    // Try to sanitize the original configuration
    const sanitized = sanitizeNavigationConfig(originalConfig);
    if (sanitized.length > 0) {
      return sanitized;
    }
  } catch (sanitizeError) {
    console.warn('Configuration sanitization failed:', sanitizeError);
  }

  // Fall back to minimal configuration
  return getMinimalNavigationConfig();
};

/**
 * Local storage error recovery for sidebar preferences
 */
export const getSafeStorageValue = <T>(
  key: string,
  defaultValue: T,
  validator?: (value: any) => value is T
): T => {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return defaultValue;

    const parsed = JSON.parse(stored);

    // Validate the parsed value if validator is provided
    if (validator && !validator(parsed)) {
      console.warn(`Invalid stored value for ${key}, using default:`, parsed);
      return defaultValue;
    }

    return parsed;
  } catch (error) {
    console.warn(`Failed to read from localStorage for key ${key}:`, error);
    return defaultValue;
  }
};

/**
 * Safe local storage setter
 */
export const setSafeStorageValue = <T>(key: string, value: T): boolean => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Failed to write to localStorage for key ${key}:`, error);
    return false;
  }
};

/**
 * Error recovery for navigation state management
 */
export const recoverNavigationState = (error: Error) => {
  console.warn('Navigation state error, recovering:', error);

  return {
    sidebarCollapsed: false,
    sidebarVisible: true,
    screenSize: 'desktop' as ScreenSize,
    preferences: {
      collapsed: false,
      deviceSpecific: {
        desktop: false,
        tablet: false
      }
    }
  };
};
