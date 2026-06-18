import {
  HomeIcon,
  BuildingOfficeIcon,
  CurrencyDollarIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { FileText, Building2, LayoutTemplate } from 'lucide-react';

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
  { name: 'Templates', href: '/templates', icon: LayoutTemplate, preloadKey: 'templates', matchPaths: ['/templates'] },
  { name: 'Subscribers', href: '/subscribers', icon: UserGroupIcon, preloadKey: 'subscribers', matchPaths: ['/subscribers', '/segments'] },
  { name: 'Sponsors', href: '/sponsors', icon: Building2, preloadKey: 'sponsors', matchPaths: ['/sponsors'] },
  { name: 'Brand', href: '/brand', icon: BuildingOfficeIcon, preloadKey: 'brand', matchPaths: ['/brand'] },
  { name: 'Pricing', href: '/pricing', icon: CurrencyDollarIcon, preloadKey: 'pricing', matchPaths: ['/pricing'] },
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
