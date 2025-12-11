import {
  ChartBarIcon,
  DocumentTextIcon,
  CodeBracketIcon,
  BuildingOfficeIcon,
  EnvelopeIcon,
  KeyIcon,
  UserIcon,
  CreditCardIcon,
} from '@heroicons/react/24/outline';

import type { NavigationGroup, NavigationItem } from '@/types/sidebar';
import type { User } from '@/contexts/AuthContext';

/**
 * Main navigation configuration for the dashboard sidebar
 * Organized into logical groups with role-based access control
 */
export const navigationConfig: NavigationGroup[] = [
  {
    id: 'main',
    label: '', // No label for top-level items
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        href: '/dashboard',
        icon: ChartBarIcon,
        preloadKey: 'dashboard'
      },
      {
        id: 'brand',
        label: 'Brand',
        href: '/brand',
        icon: BuildingOfficeIcon,
        preloadKey: 'brand'
      },
      {
        id: 'senders',
        label: 'Sender Emails',
        href: '/senders',
        icon: EnvelopeIcon,
        preloadKey: 'senders'
        // Badge will be dynamically added based on sender status
      }
    ]
  },
  {
    id: 'configuration',
    label: 'Configuration',
    items: [
      {
        id: 'templates',
        label: 'Templates',
        href: '/templates',
        icon: DocumentTextIcon,
        preloadKey: 'templates'
      },
      {
        id: 'snippets',
        label: 'Snippets',
        href: '/snippets',
        icon: CodeBracketIcon,
        preloadKey: 'snippets'
      }
    ]
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      {
        id: 'api-keys',
        label: 'API Keys',
        href: '/api-keys',
        icon: KeyIcon,
        preloadKey: 'api-keys'
      }
    ]
  },
  {
    id: 'account',
    label: 'Account',
    items: [
      {
        id: 'profile',
        label: 'Profile',
        href: '/profile',
        icon: UserIcon,
        preloadKey: 'profile'
      },
      {
        id: 'billing',
        label: 'Billing',
        href: '/billing',
        icon: CreditCardIcon,
        tenantAdminOnly: true,
        preloadKey: 'billing'
      }
    ]
  }
];

/**
 * Get navigation items filtered by user role and permissions
 */
export const getFilteredNavigation = (
  user: User | null
): NavigationGroup[] => {
  const isAdmin = user?.isAdmin ?? false;
  const isTenantAdmin = user?.isTenantAdmin ?? false;
  return navigationConfig
    .map(group => ({
      ...group,
      items: group.items.filter(item => {
        // If item requires admin access
        if (item.adminOnly && !isAdmin) {
          return false;
        }

        // If item requires tenant admin access
        if (item.tenantAdminOnly && !isTenantAdmin && !isAdmin) {
          return false;
        }

        return true;
      })
    }))
    .filter(group => group.items.length > 0); // Remove empty groups
};

/**
 * Find navigation item by href
 */
export const findNavigationItem = (href: string): NavigationItem | null => {
  for (const group of navigationConfig) {
    const item = group.items.find(item => item.href === href);
    if (item) {
      return item;
    }
  }
  return null;
};

/**
 * Get the active navigation item based on current pathname
 */
export const getActiveNavigationItem = (pathname: string): NavigationItem | null => {
  // Handle root path
  if (pathname === '/') {
    return findNavigationItem('/dashboard');
  }

  // Try exact match first
  let activeItem = findNavigationItem(pathname);

  if (!activeItem) {
    // Try to find the best match for nested routes
    // e.g., /templates/123 should match /templates
    const segments = pathname.split('/').filter(Boolean);

    for (let i = segments.length; i > 0; i--) {
      const testPath = '/' + segments.slice(0, i).join('/');
      activeItem = findNavigationItem(testPath);
      if (activeItem) {
        break;
      }
    }
  }

  return activeItem;
};
