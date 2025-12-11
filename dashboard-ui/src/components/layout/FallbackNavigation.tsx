import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { cn } from '@/utils/cn';
import type { ScreenSize } from '@/types/sidebar';
import {
  Bars3Icon,
  XMarkIcon,
  HomeIcon,
  DocumentIcon,
  BuildingOfficeIcon,
  EnvelopeIcon,
  KeyIcon,
  UserIcon,
  CreditCardIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';

/**
 * Fallback navigation item interface
 */
interface FallbackNavigationItem {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  tenantAdminOnly?: boolean;
}

/**
 * Fallback navigation props
 */
interface FallbackNavigationProps {
  errorType: 'navigation' | 'responsive' | 'icon' | 'unknown';
  fallbackScreenSize: ScreenSize;
  onRetry: () => void;
  className?: string;
}

/**
 * Simple fallback navigation when main sidebar fails
 * Provides basic navigation functionality with minimal dependencies
 */
export const FallbackNavigation: React.FC<FallbackNavigationProps> = ({
  errorType,
  fallbackScreenSize,
  onRetry,
  className
}) => {
  const { user } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Simplified navigation configuration with fallback icons
  const fallbackNavigation: FallbackNavigationItem[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      href: '/dashboard',
      icon: HomeIcon
    },
    {
      id: 'templates',
      label: 'Templates',
      href: '/templates',
      icon: DocumentIcon
    },
    {
      id: 'brand',
      label: 'Brand',
      href: '/brand',
      icon: BuildingOfficeIcon
    },
    {
      id: 'senders',
      label: 'Sender Emails',
      href: '/senders',
      icon: EnvelopeIcon
    },
    {
      id: 'api-keys',
      label: 'API Keys',
      href: '/api-keys',
      icon: KeyIcon
    },
    {
      id: 'profile',
      label: 'Profile',
      href: '/profile',
      icon: UserIcon
    },
    {
      id: 'billing',
      label: 'Billing',
      href: '/billing',
      icon: CreditCardIcon,
      adminOnly: true,
      tenantAdminOnly: true
    }
  ];

  // Filter navigation based on user permissions
  const filteredNavigation = fallbackNavigation.filter(item => {
    if (item.adminOnly && !user?.isAdmin) return false;
    if (item.tenantAdminOnly && !user?.isTenantAdmin && !user?.isAdmin) return false;
    return true;
  });

  const isActive = (href: string) => location.pathname === href;

  const handleMobileToggle = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const handleMobileClose = () => {
    setMobileMenuOpen(false);
  };

  const getErrorMessage = () => {
    switch (errorType) {
      case 'responsive':
        return 'Responsive detection failed. Using mobile-friendly fallback navigation.';
      case 'icon':
        return 'Icon loading failed. Using simplified navigation with basic icons.';
      case 'navigation':
        return 'Navigation configuration failed. Using basic navigation structure.';
      default:
        return 'Navigation system encountered an error. Using simplified fallback navigation.';
    }
  };

  // Mobile navigation (for all screen sizes when in fallback mode)
  if (fallbackScreenSize === 'mobile' || mobileMenuOpen) {
    return (
      <>
        {/* Mobile menu button */}
        {!mobileMenuOpen && (
          <div className="fixed top-4 left-4 z-40">
            <button
              onClick={handleMobileToggle}
              className="bg-white shadow-md rounded-md p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Open navigation menu"
            >
              <Bars3Icon className="h-6 w-6" />
            </button>
          </div>
        )}

        {/* Mobile overlay */}
        {mobileMenuOpen && (
          <>
            <div
              className="fixed inset-0 bg-black bg-opacity-50 z-40"
              onClick={handleMobileClose}
              aria-hidden="true"
            />
            <div className="fixed inset-y-0 left-0 w-80 bg-white shadow-xl z-50 flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <div className="flex items-center space-x-2">
                  <ExclamationTriangleIcon className="h-5 w-5 text-amber-500" />
                  <h2 className="text-lg font-semibold text-gray-900">Fallback Navigation</h2>
                </div>
                <button
                  onClick={handleMobileClose}
                  className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md p-1"
                  aria-label="Close navigation menu"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>

              {/* Error message */}
              <div className="p-4 bg-amber-50 border-b border-amber-200">
                <p className="text-sm text-amber-800">{getErrorMessage()}</p>
                <button
                  onClick={onRetry}
                  className="mt-2 text-sm text-amber-900 underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-amber-500 rounded"
                >
                  Try to restore normal navigation
                </button>
              </div>

              {/* Navigation */}
              <nav className="flex-1 p-4 overflow-y-auto">
                <ul className="space-y-2">
                  {filteredNavigation.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.id}>
                        <Link
                          to={item.href}
                          onClick={handleMobileClose}
                          className={cn(
                            'flex items-center space-x-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                            isActive(item.href)
                              ? 'bg-blue-100 text-blue-900 border-r-2 border-blue-600'
                              : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                          )}
                          aria-current={isActive(item.href) ? 'page' : undefined}
                        >
                          <Icon className="h-5 w-5 flex-shrink-0" />
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              {/* Footer */}
              <div className="p-4 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">
                    {user?.firstName ?? user?.email}
                  </span>
                  <LogoutButton />
                </div>
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  // Desktop fallback navigation
  return (
    <div className={cn('fallback-navigation bg-white border-r border-gray-200 w-64 flex flex-col', className)}>
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center space-x-2">
          <ExclamationTriangleIcon className="h-5 w-5 text-amber-500 flex-shrink-0" />
          <h2 className="text-lg font-semibold text-gray-900">Fallback Navigation</h2>
        </div>
      </div>

      {/* Error message */}
      <div className="p-4 bg-amber-50 border-b border-amber-200">
        <p className="text-sm text-amber-800 mb-2">{getErrorMessage()}</p>
        <button
          onClick={onRetry}
          className="text-sm text-amber-900 underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-amber-500 rounded px-1"
        >
          Try to restore normal navigation
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <ul className="space-y-1">
          {filteredNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <Link
                  to={item.href}
                  className={cn(
                    'flex items-center space-x-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                    isActive(item.href)
                      ? 'bg-blue-100 text-blue-900 border-r-2 border-blue-600'
                      : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                  )}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200">
        <div className="space-y-3">
          <div className="text-sm text-gray-500">
            {user?.firstName ?? user?.email}
          </div>
          <div className="flex justify-end">
            <LogoutButton />
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Minimal navigation item component for fallback scenarios
 */
interface FallbackNavigationItemProps {
  item: FallbackNavigationItem;
  isActive: boolean;
  onClick?: () => void;
  className?: string;
}

export const FallbackNavigationItem: React.FC<FallbackNavigationItemProps> = ({
  item,
  isActive,
  onClick,
  className
}) => {
  const Icon = item.icon;

  return (
    <Link
      to={item.href}
      onClick={onClick}
      className={cn(
        'flex items-center space-x-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
        isActive
          ? 'bg-blue-100 text-blue-900 border-r-2 border-blue-600'
          : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900',
        className
      )}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      <span>{item.label}</span>
    </Link>
  );
};
