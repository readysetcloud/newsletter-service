import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSenderStatus } from '../../hooks/useSenderStatus';
import { LogoutButton } from '../auth/LogoutButton';
import { ariaPatterns, keyboardUtils, responsiveA11y } from '../../utils/accessibility';
import { preloadRoute } from '../../utils/lazyImports';
import {
  ChartBarIcon,
  BuildingOfficeIcon,
  UserIcon,
  KeyIcon,
  EnvelopeIcon,
  CreditCardIcon,
  Bars3Icon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import { FileText } from 'lucide-react';
import { cn } from '../../utils/cn';

export const MobileNavigation: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useAuth();
  const location = useLocation();
  const senderStatus = useSenderStatus();
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const baseNavigation = [
    { name: 'Dashboard', href: '/dashboard', icon: ChartBarIcon, preloadKey: 'dashboard' },
    { name: 'Issues', href: '/issues', icon: FileText, preloadKey: 'issues' },
    { name: 'Brand', href: '/brand', icon: BuildingOfficeIcon, preloadKey: 'brand' },
    { name: 'Profile', href: '/profile', icon: UserIcon, preloadKey: 'profile' },
    { name: 'Sender Emails', href: '/senders', icon: EnvelopeIcon, preloadKey: 'senders' },
    { name: 'API Keys', href: '/api-keys', icon: KeyIcon, preloadKey: 'api-keys' },
  ];

  // Add billing navigation for admin users only
  const navigation = user?.isAdmin || user?.isTenantAdmin
    ? [
        ...baseNavigation,
        { name: 'Billing', href: '/billing', icon: CreditCardIcon, preloadKey: 'billing' },
      ]
    : baseNavigation;

  const toggleMenu = () => setIsOpen(!isOpen);
  const closeMenu = () => {
    setIsOpen(false);
    // Return focus to menu button when closing
    buttonRef.current?.focus();
  };

  const handleLinkHover = (preloadKey: string) => {
    if (import.meta.env.VITE_PRELOAD_ROUTES === 'true') {
      preloadRoute(preloadKey);
    }
  };

  // Handle escape key to close menu
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === keyboardUtils.keys.ESCAPE && isOpen) {
        closeMenu();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // Trap focus within the menu
      const cleanup = menuRef.current ? keyboardUtils.trapFocus(menuRef.current) : undefined;

      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        cleanup?.();
      };
    }
  }, [isOpen]);

  // Close menu when route changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    closeMenu();
  }, [location.pathname]);

  return (
    <>
      {/* Mobile menu button */}
      <button
        ref={buttonRef}
        type="button"
        className={`md:hidden inline-flex items-center justify-center p-2 rounded-md text-muted-foreground hover:text-muted-foreground hover:bg-muted ${responsiveA11y.focusRing.className} ${responsiveA11y.touchTarget.className}`}
        onClick={toggleMenu}
        aria-expanded={isOpen}
        aria-controls="mobile-menu"
        aria-label={isOpen ? 'Close main menu' : 'Open main menu'}
      >
        {isOpen ? (
          <XMarkIcon className="block h-6 w-6" aria-hidden="true" />
        ) : (
          <Bars3Icon className="block h-6 w-6" aria-hidden="true" />
        )}
      </button>

      {/* Mobile menu overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          onClick={closeMenu}
          aria-hidden="true"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </div>
      )}

      {/* Mobile menu panel */}
      <div
        ref={menuRef}
        id="mobile-menu"
        className={cn(
          'fixed top-0 right-0 z-50 h-full w-80 max-w-sm bg-surface shadow-xl transform transition-transform duration-300 ease-in-out md:hidden',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
        {...ariaPatterns.navigation('Mobile navigation menu')}
        aria-hidden={!isOpen}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Menu</h2>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
            <button
              type="button"
              className={`p-2 rounded-md text-muted-foreground hover:text-muted-foreground hover:bg-muted ${responsiveA11y.focusRing.className} ${responsiveA11y.touchTarget.className}`}
              onClick={closeMenu}
              aria-label="Close menu"
            >
              <XMarkIcon className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-2" role="navigation" aria-label="Mobile navigation">
            {navigation.map((item) => {
              const isActive = item.href === '/issues'
                ? location.pathname.startsWith('/issues')
                : location.pathname === item.href;
              const Icon = item.icon;

              return (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={closeMenu}
                  onMouseEnter={() => handleLinkHover(item.preloadKey)}
                  onFocus={() => handleLinkHover(item.preloadKey)}
                  className={cn(
                    'flex items-center px-4 py-3 text-base font-medium rounded-lg transition-colors',
                    responsiveA11y.focusRing.className,
                    responsiveA11y.touchTarget.className,
                    isActive
                      ? 'bg-primary-50 text-primary-700 border-l-4 border-primary-700'
                      : 'text-muted-foreground hover:text-foreground hover:bg-background'
                  )}
                  {...ariaPatterns.link(`Navigate to ${item.name}`, isActive)}
                >
                  <Icon className="w-6 h-6 mr-3" aria-hidden="true" />
                  {item.name}
                  {item.name === 'Sender Emails' && !senderStatus.loading && senderStatus.totalCount > 0 && (
                    <span
                      className="ml-auto inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      aria-label={`${senderStatus.verifiedCount} verified, ${senderStatus.pendingCount} pending, ${senderStatus.failedCount} failed, ${senderStatus.timedOutCount} expired`}
                    >
                      {senderStatus.verifiedCount}/{senderStatus.totalCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="border-t border-border p-4 space-y-4">
            {/* User role badge */}
            {user?.role && (
              <div className="flex justify-center">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary-100 text-primary-800">
                  {user.role}
                </span>
              </div>
            )}

            <div className="flex items-center justify-end">
              <LogoutButton />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
