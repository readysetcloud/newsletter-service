import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ChevronDown, TrendingUp, Users, Shield, FileText } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface NavigationSection {
  id: string;
  label: string;
  icon?: React.ReactNode;
  hasData: boolean;
}

export interface QuickNavigationProps {
  sections: NavigationSection[];
  activeSection: string | null;
  onSectionClick: (sectionId: string) => void;
  isSticky: boolean;
  className?: string;
}

/**
 * QuickNavigation component with sticky behavior and scroll tracking
 *
 * Features:
 * - Horizontal navigation bar with section links
 * - Icons for each section for better scannability
 * - Sticky positioning after scrolling past key metrics
 * - Highlights active section based on scroll position
 * - Converts to dropdown on mobile
 * - Smooth scrolling when clicking section links
 * - Only shows sections that have data
 */
export const QuickNavigation: React.FC<QuickNavigationProps> = React.memo(({
  sections,
  activeSection,
  onSectionClick,
  isSticky,
  className,
}) => {
  const [isMobileDropdownOpen, setIsMobileDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Filter out sections without data - memoize to avoid recalculation
  const availableSections = useMemo(() =>
    sections.filter(section => section.hasData),
    [sections]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsMobileDropdownOpen(false);
      }
    };

    if (isMobileDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isMobileDropdownOpen]);

  // Close dropdown on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isMobileDropdownOpen) {
        setIsMobileDropdownOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isMobileDropdownOpen]);

  const handleSectionClick = useCallback((sectionId: string) => {
    onSectionClick(sectionId);
    setIsMobileDropdownOpen(false);
  }, [onSectionClick]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent, sectionId: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSectionClick(sectionId);
    }
  }, [handleSectionClick]);

  const activeLabel = useMemo(() =>
    availableSections.find(s => s.id === activeSection)?.label || 'Navigate',
    [availableSections, activeSection]
  );

  if (availableSections.length === 0) {
    return null;
  }

  return (
    <nav
      className={cn(
        'bg-surface border-b border-border transition-all duration-300 z-40',
        isSticky && 'sticky top-0 shadow-md',
        className
      )}
      aria-label="Quick navigation to page sections"
      role="navigation"
    >
      <div className="max-w-7xl 2xl:max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-10">
        {/* Mobile Dropdown */}
        <div className="sm:hidden py-2" ref={dropdownRef}>
          <button
            onClick={() => setIsMobileDropdownOpen(!isMobileDropdownOpen)}
            className={cn(
              'w-full flex items-center justify-between px-4 py-3',
              'bg-muted hover:bg-muted/80 transition-colors rounded-lg',
              'text-sm font-medium text-foreground',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              'min-h-[44px]' // Ensure minimum touch target
            )}
            aria-expanded={isMobileDropdownOpen}
            aria-haspopup="true"
            aria-label={`Navigation menu. Current section: ${activeLabel}`}
          >
            <span className="flex items-center gap-2">
              {availableSections.find(s => s.id === activeSection)?.icon}
              {activeLabel}
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform duration-200',
                isMobileDropdownOpen && 'rotate-180'
              )}
              aria-hidden="true"
            />
          </button>

          {isMobileDropdownOpen && (
            <div
              className="mt-2 bg-surface border border-border rounded-lg shadow-lg overflow-hidden"
              role="menu"
              aria-orientation="vertical"
              aria-label="Section navigation menu"
            >
              {availableSections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => handleSectionClick(section.id)}
                  onKeyDown={(e) => handleKeyDown(e, section.id)}
                  role="menuitem"
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors',
                    'hover:bg-muted focus:bg-muted focus:outline-none',
                    'min-h-[44px]', // Ensure minimum touch target
                    activeSection === section.id
                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                      : 'text-foreground'
                  )}
                  aria-current={activeSection === section.id ? 'location' : undefined}
                >
                  <span className="flex-shrink-0" aria-hidden="true">
                    {section.icon}
                  </span>
                  <span>{section.label}</span>
                  {activeSection === section.id && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-600" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Desktop Horizontal Navigation */}
        <div className="hidden sm:flex items-center gap-1 py-2 overflow-x-auto" role="menubar">
          {availableSections.map((section) => (
            <button
              key={section.id}
              onClick={() => handleSectionClick(section.id)}
              onKeyDown={(e) => handleKeyDown(e, section.id)}
              role="menuitem"
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
                'hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                'whitespace-nowrap',
                'min-h-[44px]', // Ensure minimum touch target
                activeSection === section.id
                  ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              aria-current={activeSection === section.id ? 'location' : undefined}
              aria-label={`Navigate to ${section.label} section${activeSection === section.id ? ' (current)' : ''}`}
            >
              <span className="flex-shrink-0" aria-hidden="true">
                {section.icon}
              </span>
              <span>{section.label}</span>
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
});

QuickNavigation.displayName = 'QuickNavigation';

// Default section icons
// eslint-disable-next-line react-refresh/only-export-components
export const defaultSectionIcons = {
  engagement: <TrendingUp className="w-4 h-4" />,
  audience: <Users className="w-4 h-4" />,
  deliverability: <Shield className="w-4 h-4" />,
  content: <FileText className="w-4 h-4" />,
};

export default QuickNavigation;
