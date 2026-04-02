import {
  HomeIcon,
  BuildingOfficeIcon,
  CurrencyDollarIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { FileText } from 'lucide-react';

export interface SidebarNavItem {
  name: string;
  href: string;
  icon: React.FC<{ className?: string }>;
  preloadKey: string;
  matchPaths: string[];
}

export const NAV_ITEMS: SidebarNavItem[] = [
  { name: 'Dashboard', href: '/', icon: HomeIcon, preloadKey: 'dashboard', matchPaths: ['/'] },
  { name: 'Issues', href: '/issues', icon: FileText, preloadKey: 'issues', matchPaths: ['/issues'] },
  { name: 'Subscribers', href: '/subscribers', icon: UserGroupIcon, preloadKey: 'subscribers', matchPaths: ['/subscribers', '/segments'] },
  { name: 'Brand', href: '/brand', icon: BuildingOfficeIcon, preloadKey: 'brand', matchPaths: ['/brand'] },
  { name: 'Sponsorship Pricing', href: '/pricing', icon: CurrencyDollarIcon, preloadKey: 'pricing', matchPaths: ['/pricing'] },
];

/**
 * Determines if a nav item is active based on the current pathname.
 * - Dashboard (/): exact match only
 * - Others: startsWith
 */
export function isNavItemActive(item: SidebarNavItem, pathname: string): boolean {
  return item.matchPaths.some((matchPath) => {
    if (matchPath === '/') {
      return pathname === '/';
    }
    return pathname.startsWith(matchPath);
  });
}
