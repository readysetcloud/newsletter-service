import { useEffect, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { keyboardUtils, responsiveA11y } from '@/utils/accessibility';
import { NAV_ITEMS } from './sidebarNav';
import { ACCOUNT_ITEMS } from './accountNav';
import { cn } from '@/utils/cn';
import {
  MoonIcon,
  SunIcon,
  ArrowRightOnRectangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileDrawer({ isOpen, onClose }: MobileDrawerProps) {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  const showBilling = user?.isAdmin === true || user?.isTenantAdmin === true;

  const visibleAccountItems = ACCOUNT_ITEMS.filter(
    (item) => !item.adminOnly || showBilling
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Focus trap and escape key handling
  useEffect(() => {
    if (!isOpen) return;

    // Store the element that had focus before opening
    previousActiveElement.current = document.activeElement as HTMLElement;

    let cleanupTrapFocus: (() => void) | undefined;

    // Small delay to ensure the drawer is rendered before trapping focus
    const rafId = requestAnimationFrame(() => {
      if (drawerRef.current) {
        cleanupTrapFocus = keyboardUtils.trapFocus(drawerRef.current);
      }
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('keydown', handleKeyDown);
      cleanupTrapFocus?.();
      // Return focus to the hamburger button (previous active element)
      previousActiveElement.current?.focus();
    };
  }, [isOpen, handleClose]);

  // Close drawer on route change
  useEffect(() => {
    if (isOpen) {
      handleClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const handleLinkClick = () => {
    handleClose();
  };

  const handleLogout = async () => {
    handleClose();
    try {
      await signOut();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleBackdropClick = () => {
    handleClose();
  };

  if (!user) return null;

  return (
    <>
      {/* Backdrop overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={handleBackdropClick}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal={isOpen}
        aria-label="Mobile navigation"
        aria-hidden={!isOpen}
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-80 max-w-[85vw] bg-surface shadow-xl md:hidden',
          'transform transition-transform duration-200 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Header with logo and close button */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="Outboxed" className="h-8 w-8 shrink-0" />
              <span className="text-xl font-bold text-foreground">Outboxed</span>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close navigation"
              className={cn(
                'p-2 rounded-md text-muted-foreground hover:bg-muted transition-colors',
                responsiveA11y.focusRing.className
              )}
            >
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {/* Navigation group */}
            <div className="px-3 py-4">
              <h3 className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Navigation
              </h3>
              <ul className="space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = item.matchPaths.some((matchPath) => {
                    if (matchPath === '/') return location.pathname === '/';
                    return location.pathname.startsWith(matchPath);
                  });

                  return (
                    <li key={item.href}>
                      <Link
                        to={item.href}
                        onClick={handleLinkClick}
                        className={cn(
                          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                          responsiveA11y.focusRing.className,
                          active
                            ? 'bg-primary-100 text-primary-700 border-l-4 border-primary-700'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                        aria-current={active ? 'page' : undefined}
                      >
                        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                        {item.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Account group */}
            <div className="px-3 py-4 border-t border-border">
              <h3 className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Account
              </h3>
              <ul className="space-y-1">
                {visibleAccountItems.map((item) => {
                  const Icon = item.icon;
                  const active = location.pathname === item.href;

                  return (
                    <li key={item.href}>
                      <Link
                        to={item.href}
                        onClick={handleLinkClick}
                        className={cn(
                          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                          responsiveA11y.focusRing.className,
                          active
                            ? 'bg-primary-100 text-primary-700'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                        aria-current={active ? 'page' : undefined}
                      >
                        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                        {item.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* Footer: email, role badge, theme toggle, logout */}
          <div className="border-t border-border px-4 py-4 space-y-3">
            {/* User info */}
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground truncate flex-1">{user.email}</p>
              {user.role && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800 shrink-0">
                  {user.role}
                </span>
              )}
            </div>

            {/* Theme toggle and logout */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className={cn(
                  'flex items-center gap-2 flex-1 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
                  responsiveA11y.focusRing.className
                )}
              >
                {theme === 'dark' ? (
                  <SunIcon className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <MoonIcon className="h-5 w-5" aria-hidden="true" />
                )}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>

              <button
                type="button"
                onClick={handleLogout}
                aria-label="Sign out"
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
                  responsiveA11y.focusRing.className
                )}
              >
                <ArrowRightOnRectangleIcon className="h-5 w-5" aria-hidden="true" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
