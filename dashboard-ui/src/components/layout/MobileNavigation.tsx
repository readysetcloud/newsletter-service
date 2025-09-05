import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSenderStatus } from '../../hooks/useSenderStatus';
import { LogoutButton } from '../auth/LogoutButton';
import { NotificationDropdown } from '../notifications/NotificationDropdown';
import { SenderStatusIndicator } from '../senders/SenderStatusIndicator';
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
    closeMenu();
  }, [location.pathname]);

  return (
    <>
      {/* Mobile menu button */}
      <button
        ref={buttonRef}
        type="button"
        className={`md:hidden inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 ${responsiveA11y.focusRing.className} ${responsiveA11y.touchTarget.className}`}
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
          'fixed top-0 right-0 z-50 h-full w-80 max-w-sm bg-white shadow-xl transform transition-transform duration-300 ease-in-out md:hidden',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
        {...ariaPatterns.navigation('Mobile navigation menu')}
        aria-hidden={!isOpen}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Menu</h2>
              <p className="text-sm text-gray-500">{user?.email}</p>
            </div>
            <button
              type="button"
              className={`p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 ${responsiveA11y.focusRing.className} ${responsiveA11y.touchTarget.className}`}
              onClick={closeMenu}
              aria-label="Close menu"
            >
              <XMarkIcon className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-2" role="navigation" aria-label="Mobile navigation">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href;
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
                      ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  )}
                  {...ariaPatterns.link(`Navigate to ${item.name}`, isActive)}
                >
                  <Icon className="w-6 h-6 mr-3" aria-hidden="true" />
                  {item.name}
                  {item.name === 'Sender Emails' && !senderStatus.loading && (
                    <SenderStatusIndicator
                      verifiedCount={senderStatus.verifiedCount}
                      pendingCount={senderStatus.pendingCount}
                      failedCount={senderStatus.failedCount}
                      timedOutCount={senderStatus.timedOutCount}
                      totalCount={senderStatus.totalCount}
                      size="sm"
                      className="ml-auto"
                    />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="border-t border-gray-200 p-4 space-y-4">
            {/* User role badge */}
            {user?.role && (
              <div className="flex justify-center">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                  {user.role}
                </span>
              </div>
            )}

            {/* Notifications and logout */}
            <div className="flex items-center justify-between">
              <NotificationDropdown />
              <LogoutButton />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
