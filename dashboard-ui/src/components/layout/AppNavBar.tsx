import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { AppNav, type AppNavItem } from '@readysetcloud/ui';
import { useTheme } from '@/hooks/useTheme';
import { BRAND } from '@/constants/brand';
import { NAV_ITEMS, isNavItemActive } from './sidebarNav';
import { AvatarMenu } from './AvatarMenu';

/**
 * Primary navigation, built on the shared `AppNav` from `@readysetcloud/ui`.
 *
 * `AppNav` is a horizontal top bar, so it owns the brand, the primary nav
 * links, and the theme toggle. The app's richer account menu (Profile, Sender
 * Emails, API Keys, Billing, Sign out) has no equivalent in `AppNav`'s built-in
 * profile popover, so we keep {@link AvatarMenu} and inject it through the
 * `actions` slot — with its own theme toggle suppressed, since `AppNav`
 * already renders one. `authState="none"` keeps `AppNav` from also drawing its
 * native avatar/auth controls.
 *
 * Theme stays owned by the app's {@link useTheme} hook (persist + colorScheme),
 * so `AppNav` is a controlled consumer: it reads `theme` and reports changes
 * via `onThemeChange`, and `applyThemeToDocument` is off to avoid double-writes.
 *
 * NOTE: this app was designed around a vertical side nav; adopting the shared
 * top bar is an interim step until `AppNav` gains a side-nav layout
 * (tracked upstream in readysetcloud/rsc-core).
 */
export function AppNavBar() {
  const location = useLocation();
  const { theme, setTheme } = useTheme();

  const navItems = useMemo<AppNavItem[]>(
    () =>
      NAV_ITEMS.map((item) => ({
        id: item.href,
        label: item.name,
        href: item.href,
        active: isNavItemActive(item, location.pathname),
      })),
    [location.pathname],
  );

  return (
    <AppNav
      appName={BRAND.appName}
      homeHref="/"
      navItems={navItems}
      authState="none"
      theme={theme}
      applyThemeToDocument={false}
      onThemeChange={(next) => setTheme(next === 'dark' ? 'dark' : 'light')}
      actions={<AvatarMenu showThemeToggle={false} />}
    />
  );
}
