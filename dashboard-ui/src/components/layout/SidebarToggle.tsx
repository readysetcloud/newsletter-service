import React from 'react';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { responsiveA11y } from '@/utils/accessibility';

interface SidebarToggleProps {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  variant?: 'desktop' | 'mobile';
}

export const SidebarToggle: React.FC<SidebarToggleProps> = ({
  collapsed,
  onToggle,
  className,
  variant = 'desktop'
}) => {
  const isMobile = variant === 'mobile';
  const Icon = isMobile && !collapsed ? XMarkIcon : Bars3Icon;

  const baseClasses = cn(
    'sidebar-toggle',
    isMobile ? 'sidebar-toggle-mobile' : 'sidebar-toggle-desktop'
  );
  const iconClasses = isMobile ? 'h-6 w-6' : 'h-5 w-5';

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Handle Enter and Space keys
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle();
    }
  };

  const getAriaLabel = () => {
    if (isMobile) {
      return collapsed ? 'Open navigation menu' : 'Close navigation menu';
    }
    return collapsed ? 'Expand sidebar navigation' : 'Collapse sidebar navigation';
  };

  const getAriaDescription = () => {
    if (isMobile) {
      return collapsed
        ? 'Opens the navigation menu overlay'
        : 'Closes the navigation menu overlay';
    }
    return collapsed
      ? 'Expands the sidebar to show navigation labels'
      : 'Collapses the sidebar to show only icons';
  };

  return (
    <button
      type="button"
      className={cn(baseClasses, className)}
      onClick={onToggle}
      onKeyDown={handleKeyDown}
      aria-label={getAriaLabel()}
      aria-expanded={!collapsed}
      aria-describedby="sidebar-toggle-desc"
      role="button"
      tabIndex={0}
    >
      <Icon className={iconClasses} aria-hidden="true" />
      <span id="sidebar-toggle-desc" className="sr-only">
        {getAriaDescription()}
      </span>
    </button>
  );
};
