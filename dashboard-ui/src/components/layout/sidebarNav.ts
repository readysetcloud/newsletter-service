import {
  HomeIcon,
  BuildingOfficeIcon,
  CurrencyDollarIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { FileText, Building2, LayoutTemplate, Puzzle, BarChart3 } from 'lucide-react';

export interface SidebarNavItem {
  name: string;
  href: string;
  icon: React.FC<{ className?: string }>;
  preloadKey: string;
  matchPaths: string[];
  /**
   * Optional section label. Consecutive items that share a `group` are rendered
   * together under a single heading (see {@link getNavSections}).
   */
  group?: string;
}

/**
 * Left-nav items in priority order (most-used at top). Consecutive items that
 * share a `group` render together under one heading (see {@link getNavSections}):
 * - "Publish" — Issues + Subscribers (what you send and who receives it)
 * - "Content" — Templates + Snippets (reusable building blocks)
 * - "Monetization" — Sponsors + Pricing (how the newsletter earns)
 *
 * Dashboard and Brand stay ungrouped as standalone entries.
 */
export const NAV_ITEMS: SidebarNavItem[] = [
  { name: 'Dashboard', href: '/', icon: HomeIcon, preloadKey: 'dashboard', matchPaths: ['/'] },
  { name: 'Issues', href: '/issues', icon: FileText, preloadKey: 'issues', matchPaths: ['/issues'], group: 'Publish' },
  { name: 'Reports', href: '/reports', icon: BarChart3, preloadKey: 'reports', matchPaths: ['/reports'], group: 'Publish' },
  { name: 'Subscribers', href: '/subscribers', icon: UserGroupIcon, preloadKey: 'subscribers', matchPaths: ['/subscribers', '/segments'], group: 'Publish' },
  { name: 'Templates', href: '/templates', icon: LayoutTemplate, preloadKey: 'templates', matchPaths: ['/templates'], group: 'Content' },
  { name: 'Snippets', href: '/snippets', icon: Puzzle, preloadKey: 'snippets', matchPaths: ['/snippets'], group: 'Content' },
  { name: 'Sponsors', href: '/sponsors', icon: Building2, preloadKey: 'sponsors', matchPaths: ['/sponsors'], group: 'Monetization' },
  { name: 'Pricing', href: '/pricing', icon: CurrencyDollarIcon, preloadKey: 'pricing', matchPaths: ['/pricing'], group: 'Monetization' },
  { name: 'Brand', href: '/brand', icon: BuildingOfficeIcon, preloadKey: 'brand', matchPaths: ['/brand'] },
];

export interface SidebarNavSection {
  /** Section heading, or `null` for standalone (ungrouped) items. */
  label: string | null;
  items: SidebarNavItem[];
}

/**
 * Folds the flat, ordered {@link NAV_ITEMS} into render-ready sections.
 * Consecutive items sharing a `group` collapse into one labeled section;
 * ungrouped items each become their own label-less section. Order is preserved,
 * so this is purely a presentational grouping over the canonical item list.
 */
export function getNavSections(items: SidebarNavItem[] = NAV_ITEMS): SidebarNavSection[] {
  const sections: SidebarNavSection[] = [];
  for (const item of items) {
    const label = item.group ?? null;
    const last = sections[sections.length - 1];
    if (label !== null && last && last.label === label) {
      last.items.push(item);
    } else {
      sections.push({ label, items: [item] });
    }
  }
  return sections;
}

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
