import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  AppNav,
  type AppNavItem,
  type AppNavLinkProps,
} from '@readysetcloud/ui';
import { useTheme } from '@/hooks/useTheme';
import { BRAND } from '@/constants/brand';
import { NAV_ITEMS, isNavItemActive } from './sidebarNav';
import { AvatarMenu } from './AvatarMenu';

/**
 * Renders `AppNav`'s in-app links with React Router's `Link` so navigation
 * stays client-side (no full-page reload). Defined at module scope for a
 * stable component identity. External links bypass this (handled by `AppNav`).
 */
function RouterNavLink({ href, children, ...rest }: AppNavLinkProps) {
  return (
    <Link to={href} {...rest}>
      {children}
    </Link>
  );
}

/**
 * Primary navigation, built on the shared `AppNav` from `@readysetcloud/ui`.
 *
 * Uses `AppNav`'s `side` layout — a vertical rail with grouped sections and
 * per-item icons — which mirrors this app's original side nav. Below the mobile
 * breakpoint the rail collapses to `AppNav`'s built-in top-bar drawer.
 *
 * The app's richer account menu (Profile, Sender Emails, API Keys, Billing,
 * Sign out) has no equivalent in `AppNav`'s built-in profile popover, so we keep
 * {@link AvatarMenu} and inject it through the `actions` slot — with its own
 * theme toggle suppressed, since `AppNav` already renders one. `authState="none"`
 * keeps `AppNav` from also drawing its native avatar/auth controls.
 *
 * Theme stays owned by the app's {@link useTheme} hook (persist + colorScheme),
 * so `AppNav` is a controlled consumer: it reads `theme` and reports changes via
 * `onThemeChange`, and `applyThemeToDocument` is off to avoid double-writes.
 */
export function AppNavBar() {
  const location = useLocation();
  const { theme, setTheme } = useTheme();

  const navItems = useMemo<AppNavItem[]>(
    () =>
      NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return {
          id: item.href,
          label: item.name,
          href: item.href,
          active: isNavItemActive(item, location.pathname),
          icon: <Icon className="h-5 w-5" />,
          section: item.group,
        };
      }),
    [location.pathname],
  );

  return (
    <AppNav
      appName={BRAND.appName}
      homeHref="/"
      layout="side"
      linkComponent={RouterNavLink}
      navItems={navItems}
      authState="none"
      theme={theme}
      applyThemeToDocument={false}
      onThemeChange={(next) => setTheme(next === 'dark' ? 'dark' : 'light')}
      actions={<AvatarMenu showThemeToggle={false} />}
      className="sm:sticky sm:top-0 sm:h-screen sm:self-start"
    />
  );
}
