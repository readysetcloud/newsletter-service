import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogoutButton } from '../auth/LogoutButton';
import { MobileNavigation } from './MobileNavigation';
import { useAuth } from '../../contexts/AuthContext';
import { ariaPatterns, responsiveA11y } from '../../utils/accessibility';
import { preloadRoute } from '../../utils/lazyImports';
import {
  ChartBarIcon,
  BuildingOfficeIcon,
  UserIcon,
  KeyIcon,
  EnvelopeIcon,
  CreditCardIcon,
  MoonIcon,
  SunIcon
} from '@heroicons/react/24/outline';
import { FileText } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

export const AppHeader: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

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

  const handleLinkHover = (preloadKey: string) => {
    if (import.meta.env.VITE_PRELOAD_ROUTES === 'true') {
      preloadRoute(preloadKey);
    }
  };

  return (
    <header className="bg-surface shadow sticky top-0 z-30" role="banner">
      {/* Skip to main content link for keyboard navigation */}
      <a
        href="#main-content"
        className={responsiveA11y.skipLink.className}
      >
        Skip to main content
      </a>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-2 md:py-3">
          {/* Left side - Logo and desktop navigation */}
          <div className="flex items-center space-x-4 md:space-x-8">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <img
                  src="/logo.svg"
                  alt="Outboxed"
                  className="h-8 w-8 shrink-0"
                />
                <div className="min-w-0">
                  <h1 className="text-xl md:text-2xl font-bold text-foreground truncate">
                    Outboxed
                  </h1>
                </div>
              </div>
            </div>

            {/* Desktop Navigation */}
            <nav
              className="hidden md:flex space-x-6 lg:space-x-8"
              {...ariaPatterns.navigation('Main navigation')}
            >
              {navigation.map((item) => {
                const isActive = item.href === '/issues'
                  ? location.pathname.startsWith('/issues')
                  : location.pathname === item.href;
                const Icon = item.icon;

                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    onMouseEnter={() => handleLinkHover(item.preloadKey)}
                    onFocus={() => handleLinkHover(item.preloadKey)}
                    className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${responsiveA11y.focusRing.className} ${responsiveA11y.touchTarget.className} ${
                      isActive
                        ? 'bg-primary-100 text-primary-700'
                        : 'text-muted-foreground hover:text-muted-foreground hover:bg-background'
                    }`}
                    {...ariaPatterns.link(`Navigate to ${item.name}`, isActive)}
                  >
                    <Icon className="w-4 h-4 mr-2" aria-hidden="true" />
                    <span className="hidden lg:inline">{item.name}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right side - Desktop actions and mobile menu */}
          <div className="flex items-center space-x-2 md:space-x-4">
            {/* Desktop actions */}
            <div className="hidden md:flex items-center space-x-2">
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              >
                {theme === 'dark' ? (
                  <SunIcon className="h-5 w-5" />
                ) : (
                  <MoonIcon className="h-5 w-5" />
                )}
              </button>
              {user?.role && (
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800"
                  aria-label={`User role: ${user.role}`}
                >
                  {user.role}
                </span>
              )}
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
