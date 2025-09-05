import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogoutButton } from '../auth/LogoutButton';
import { NotificationDropdown } from '../notifications/NotificationDropdown';
import { MobileNavigation } from './MobileNavigation';
import { SenderStatusIndicator } from '../senders/SenderStatusIndicator';
import { useAuth } from '../../contexts/AuthContext';
import { useSenderStatus } from '../../hooks/useSenderStatus';
import { ariaPatterns, responsiveA11y } from '../../utils/accessibility';
import { preloadRoute } from '../../utils/lazyImports';
import {
  ChartBarIcon,
  BuildingOfficeIcon,
  UserIcon,
  KeyIcon,
  EnvelopeIcon,
  CreditCardIcon
} from '@heroicons/react/24/outline';

export const AppHeader: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const senderStatus = useSenderStatus();

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

  const handleLinkHover = (preloadKey: string) => {
    if (import.meta.env.VITE_PRELOAD_ROUTES === 'true') {
      preloadRoute(preloadKey);
    }
  };

  return (
    <header className="bg-white shadow sticky top-0 z-30" role="banner">
      {/* Skip to main content link for keyboard navigation */}
      <a
        href="#main-content"
        className={responsiveA11y.skipLink.className}
      >
        Skip to main content
      </a>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-4 md:py-6">
          {/* Left side - Logo and desktop navigation */}
          <div className="flex items-center space-x-4 md:space-x-8">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl md:text-2xl font-bold text-gray-900 truncate">
                Newsletter Admin
              </h1>
              <p className="text-gray-600 text-xs md:text-sm truncate" aria-label={`Welcome back, ${user?.firstName ?? user?.email}`}>
                Welcome back, {user?.firstName ?? user?.email}!
              </p>
            </div>

            {/* Desktop Navigation */}
            <nav
              className="hidden md:flex space-x-6 lg:space-x-8"
              {...ariaPatterns.navigation('Main navigation')}
            >
              {navigation.map((item) => {
                const isActive = location.pathname === item.href;
                const Icon = item.icon;

                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    onMouseEnter={() => handleLinkHover(item.preloadKey)}
                    onFocus={() => handleLinkHover(item.preloadKey)}
                    className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${responsiveA11y.focusRing.className} ${responsiveA11y.touchTarget.className} ${
                      isActive
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                    {...ariaPatterns.link(`Navigate to ${item.name}`, isActive)}
                  >
                    <Icon className="w-4 h-4 mr-2" aria-hidden="true" />
                    <span className="hidden lg:inline">{item.name}</span>
                    {item.name === 'Sender Emails' && !senderStatus.loading && (
                      <SenderStatusIndicator
                        verifiedCount={senderStatus.verifiedCount}
                        pendingCount={senderStatus.pendingCount}
                        failedCount={senderStatus.failedCount}
                        timedOutCount={senderStatus.timedOutCount}
                        totalCount={senderStatus.totalCount}
                        size="sm"
                        className="ml-1"
                      />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right side - Desktop actions and mobile menu */}
          <div className="flex items-center space-x-2 md:space-x-4">
            {/* Desktop actions */}
            <div className="hidden md:flex items-center space-x-4">
              {user?.role && (
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                  aria-label={`User role: ${user.role}`}
                >
                  {user.role}
                </span>
              )}
              <NotificationDropdown />
              <LogoutButton />
            </div>

            {/* Mobile navigation */}
            <MobileNavigation />
          </div>
        </div>
      </div>
    </header>
  );
};
