import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSenderStatus } from '@/hooks/useSenderStatus';
import { NavigationItem } from './NavigationItem';
import { SidebarToggle } from './SidebarToggle';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { NotificationDropdown } from '@/components/notifications/NotificationDropdown';
import { NavigationErrorBoundary, useNavigationErrorHandler } from './NavigationErrorBoundary';
import { cn } from '@/utils/cn';
import { ariaPatterns, keyboardUtils, responsiveA11y, screenReaderUtils } from '@/utils/accessibility';
import {
  sanitizeNavigationConfig,
  getSafeStorageValue,
  setSafeStorageValue,
  recoverNavigationState
} from '@/utils/navigationErrorRecovery';
import { SafeIcon } from './SafeIcon';
import type { NavigationGroup, ScreenSize, BadgeConfig } from '@/types/sidebar';
import {
  ChartBarIcon,
  DocumentTextIcon,
  CodeBracketIcon,
  BuildingOfficeIcon,
  EnvelopeIcon,
  KeyIcon,
  UserIcon,
  CreditCardIcon
} from '@heroicons/react/24/outline';

interface SidebarProps {
  collapsed: boolean;
  visible: boolean;
  screenSize: ScreenSize;
  onToggle: () => void;
  onOpen: () => void;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  visible,
  screenSize,
  onToggle,
  onOpen,
  onClose
}) => {
  const { user } = useAuth();
  const senderStatus = useSenderStatus();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [previousCollapsed, setPreviousCollapsed] = useState(collapsed);
  const [previousVisible, setPreviousVisible] = useState(visible);
  const { captureNavigationError } = useNavigationErrorHandler();
  const isMobile = screenSize === 'mobile';
  const isTablet = screenSize === 'tablet';
  const isDesktop = screenSize === 'desktop';

  // Generate sender status badge with detailed information
  const generateSenderBadge = (): BadgeConfig | undefined => {
    if (senderStatus.loading) return undefined;

    const problemCount = senderStatus.pendingCount + senderStatus.failedCount + senderStatus.timedOutCount;

    if (problemCount === 0) return undefined;

    // Determine status priority: error > warning > info
    let status: BadgeConfig['status'] = 'info';
    let text = '';

    if (senderStatus.failedCount > 0 || senderStatus.timedOutCount > 0) {
      status = 'error';
      const failedText = senderStatus.failedCount > 0 ? `${senderStatus.failedCount} failed` : '';
      const timedOutText = senderStatus.timedOutCount > 0 ? `${senderStatus.timedOutCount} timed out` : '';
      text = [failedText, timedOutText].filter(Boolean).join(', ');
    } else if (senderStatus.pendingCount > 0) {
      status = 'warning';
      text = `${senderStatus.pendingCount} pending verification`;
    }

    return {
      count: problemCount,
      status,
      text
    };
  };

  // Create navigation configuration with error handling
  const navigationConfig: NavigationGroup[] = React.useMemo(() => {
    try {
      const config: NavigationGroup[] = [
        {
          id: 'main',
          label: '', // No label for top-level items
          items: [
            {
              id: 'dashboard',
              label: 'Dashboard',
              href: '/dashboard',
              icon: ChartBarIcon,
              preloadKey: 'dashboard'
            },
            {
              id: 'brand',
              label: 'Brand',
              href: '/brand',
              icon: BuildingOfficeIcon,
              preloadKey: 'brand'
            },
            {
              id: 'senders',
              label: 'Sender Emails',
              href: '/senders',
              icon: EnvelopeIcon,
              badge: generateSenderBadge(),
              preloadKey: 'senders'
            }
          ]
        },
        {
          id: 'configuration',
          label: 'Configuration',
          items: [
            {
              id: 'templates',
              label: 'Templates',
              href: '/templates',
              icon: DocumentTextIcon,
              preloadKey: 'templates'
            },
            {
              id: 'snippets',
              label: 'Snippets',
              href: '/snippets',
              icon: CodeBracketIcon,
              preloadKey: 'snippets'
            }
          ]
        },
        {
          id: 'settings',
          label: 'Settings',
          items: [
            {
              id: 'api-keys',
              label: 'API Keys',
              href: '/api-keys',
              icon: KeyIcon,
              preloadKey: 'api-keys'
            }
          ]
        },
        {
          id: 'account',
          label: 'Account',
          items: [
            {
              id: 'profile',
              label: 'Profile',
              href: '/profile',
              icon: UserIcon,
              preloadKey: 'profile'
            },
            {
              id: 'billing',
              label: 'Billing',
              href: '/billing',
              icon: CreditCardIcon,
              adminOnly: true,
              tenantAdminOnly: true,
              preloadKey: 'billing'
            }
          ]
        }
      ];

      return sanitizeNavigationConfig(config);
    } catch (error) {
      console.error('Navigation configuration error:', error);
      captureNavigationError(error as Error, 'navigation');
      return sanitizeNavigationConfig([]);
    }
  }, [generateSenderBadge, captureNavigationError]);

  // Filter navigation based on user permissions with error handling
  const filteredNavigation = React.useMemo(() => {
    try {
      return navigationConfig.map(group => ({
        ...group,
        items: group.items.filter(item => {
          try {
            if (item.adminOnly && !user?.isAdmin) return false;
            if (item.tenantAdminOnly && !user?.isTenantAdmin && !user?.isAdmin) return false;
            return true;
          } catch (error) {
            console.warn('Error filtering navigation item:', item.id, error);
            return true; // Include item if filtering fails
          }
        })
      })).filter(group => group.items.length > 0);
    } catch (error) {
      console.error('Navigation filtering error:', error);
      captureNavigationError(error as Error, 'navigation');
      return sanitizeNavigationConfig([]);
    }
  }, [navigationConfig, user?.isAdmin, user?.isTenantAdmin, captureNavigationError]);

  // Announce state changes to screen readers
  useEffect(() => {
    if (previousCollapsed !== collapsed && isDesktop) {
      const message = collapsed ? 'Sidebar collapsed' : 'Sidebar expanded';
      screenReaderUtils.announce(message, 'polite');
    }
    setPreviousCollapsed(collapsed);
  }, [collapsed, previousCollapsed, isDesktop]);

  useEffect(() => {
    if (previousVisible !== visible && (isMobile || isTablet)) {
      const message = visible ? 'Navigation menu opened' : 'Navigation menu closed';
      screenReaderUtils.announce(message, 'polite');
    }
    setPreviousVisible(visible);
  }, [visible, previousVisible, isMobile, isTablet]);

  // Handle keyboard navigation and focus management
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle escape key for mobile/tablet overlay
      if (event.key === keyboardUtils.keys.ESCAPE && visible && (isMobile || isTablet)) {
        event.preventDefault();
        onClose();
        return;
      }

      // Handle arrow key navigation within sidebar
      if (sidebarRef.current && visible) {
        const focusableElements = sidebarRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const currentIndex = Array.from(focusableElements).indexOf(document.activeElement as HTMLElement);

        if (event.key === keyboardUtils.keys.ARROW_DOWN && currentIndex < focusableElements.length - 1) {
          event.preventDefault();
          (focusableElements[currentIndex + 1] as HTMLElement).focus();
        } else if (event.key === keyboardUtils.keys.ARROW_UP && currentIndex > 0) {
          event.preventDefault();
          (focusableElements[currentIndex - 1] as HTMLElement).focus();
        }
      }
    };

    if (visible) {
      document.addEventListener('keydown', handleKeyDown);

      // Trap focus within the sidebar for mobile/tablet overlays
      let cleanup: (() => void) | undefined;
      if ((isMobile || isTablet) && sidebarRef.current) {
        cleanup = keyboardUtils.trapFocus(sidebarRef.current);
      }

      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        cleanup?.();
      };
    }
  }, [visible, isMobile, isTablet, onClose]);

  // Mobile/tablet toggle button (shown in header area)
  if ((isMobile || isTablet) && !visible) {
    return (
      <div className="fixed top-4 left-4 z-40">
        <SidebarToggle
          collapsed={true} // When sidebar is not visible, we want to show "Open" button
          onToggle={onOpen}
          variant="mobile"
          className="bg-white shadow-md"
        />
      </div>
    );
  }

  const sidebarClasses = cn(
    'sidebar sidebar-responsive-transition',
    // Desktop styles
    isDesktop && [
      'relative',
      collapsed ? 'sidebar-collapsed' : 'sidebar-expanded'
    ],
    // Mobile/tablet overlay styles
    (isMobile || isTablet) && [
      'sidebar-mobile',
      visible ? 'sidebar-mobile-visible' : 'sidebar-mobile-hidden'
    ]
  );

  return (
    <>
      {/* Backdrop for mobile/tablet */}
      {(isMobile || isTablet) && visible && (
        <div
          className="sidebar-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <div
        ref={sidebarRef}
        className={sidebarClasses}
        {...ariaPatterns.navigation('Main navigation')}
        aria-hidden={!visible}
        aria-expanded={visible}
        aria-label={`Main navigation ${collapsed ? 'collapsed' : 'expanded'}`}
      >
        {/* Header */}
        <div className={cn(
          'sidebar-header',
          collapsed && isDesktop && 'sidebar-header-collapsed'
        )}>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <h1 className="sidebar-title">
                Newsletter Admin
              </h1>
              <p className="sidebar-subtitle">
                {user?.firstName ?? user?.email}
              </p>
            </div>
          )}

          <div className="flex items-center space-x-2">
            {(isMobile || isTablet) && (
              <SidebarToggle
                collapsed={false}
                onToggle={onClose}
                variant="mobile"
              />
            )}
            {isDesktop && (
              <SidebarToggle
                collapsed={collapsed}
                onToggle={onToggle}
                variant="desktop"
              />
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav
          className="flex-1 px-3 py-4 overflow-y-auto scrollbar-hide"
          role="navigation"
          aria-label="Primary navigation"
        >
          <div className="nav-group">
            {filteredNavigation.map((group, groupIndex) => (
              <div
                key={group.id}
                className={cn(
                  groupIndex > 0 && 'nav-group-header-spacing'
                )}
                role="group"
                aria-labelledby={group.label ? `nav-group-${group.id}` : undefined}
              >
                {group.label && !collapsed && (
                  <h3
                    id={`nav-group-${group.id}`}
                    className="nav-group-header"
                    role="heading"
                    aria-level={3}
                  >
                    {group.label}
                  </h3>
                )}
                <ul className="nav-list" role="list">
                  {group.items.map((item, itemIndex) => (
                    <li key={item.id} role="listitem">
                      <NavigationItem
                        item={item}
                        collapsed={collapsed}
                        onClick={isMobile || isTablet ? onClose : undefined}
                        showTooltip={collapsed && isDesktop}
                        groupIndex={groupIndex}
                        itemIndex={itemIndex}
                        tooltipDetails={item.id === 'senders' && !senderStatus.loading ? {
                          total: senderStatus.totalCount,
                          verified: senderStatus.verifiedCount,
                          pending: senderStatus.pendingCount,
                          failed: senderStatus.failedCount,
                          timedOut: senderStatus.timedOutCount
                        } : undefined}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div className={cn(
          'sidebar-footer',
          collapsed && isDesktop && 'sidebar-footer-collapsed'
        )}>
          {!collapsed && (
            <div className="space-y-3">
              {/* User role badge */}
              {user?.role && (
                <div className="flex justify-center">
                  <span className="user-role-badge">
                    {user.role}
                  </span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between">
                <NotificationDropdown />
                <LogoutButton />
              </div>
            </div>
          )}

          {collapsed && isDesktop && (
            <div className="space-y-2 flex flex-col items-center">
              <NotificationDropdown />
              <LogoutButton />
            </div>
          )}
        </div>
      </div>
    </>
  );
};
