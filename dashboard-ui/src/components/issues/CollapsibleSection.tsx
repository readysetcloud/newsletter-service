import React, { useEffect, useRef, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface CollapsibleSectionProps {
  id: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  defaultExpanded?: boolean;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
  badge?: string | number;
  isEmpty?: boolean;
  emptyMessage?: string;
}

const SESSION_STORAGE_KEY = 'issue-detail-expanded-sections';

/**
 * CollapsibleSection component with expand/collapse functionality and session state persistence
 *
 * Features:
 * - Smooth expand/collapse animation with max-height transition
 * - Rotating chevron icon to indicate state
 * - Badge display when collapsed
 * - Empty state handling with placeholder message
 * - Session storage persistence for expanded/collapsed state
 * - Accessible with ARIA attributes
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = React.memo(({
  id,
  title,
  description,
  icon,
  defaultExpanded = false,
  isExpanded,
  onToggle,
  children,
  badge,
  isEmpty = false,
  emptyMessage = 'No data available for this section',
}) => {
  const contentRef = useRef<HTMLDivElement>(null);

  // Load expanded state from sessionStorage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        const expandedSections = JSON.parse(stored) as string[];
        const shouldBeExpanded = expandedSections.includes(id);

        // Only trigger toggle if the stored state differs from current state
        if (shouldBeExpanded !== isExpanded) {
          onToggle(id);
        }
      } else if (defaultExpanded && !isExpanded) {
        // If no stored state and defaultExpanded is true, expand the section
        onToggle(id);
      }
    } catch (error) {
      console.warn('Failed to load section state from sessionStorage:', error);
      // If there's an error, use defaultExpanded
      if (defaultExpanded && !isExpanded) {
        onToggle(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]); // Only run on mount

  // Save expanded state to sessionStorage when it changes
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      let expandedSections: string[] = stored ? JSON.parse(stored) : [];

      if (isExpanded) {
        // Add to expanded sections if not already there
        if (!expandedSections.includes(id)) {
          expandedSections.push(id);
        }
      } else {
        // Remove from expanded sections
        expandedSections = expandedSections.filter(sectionId => sectionId !== id);
      }

      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(expandedSections));
    } catch (error) {
      console.warn('Failed to save section state to sessionStorage:', error);
    }
  }, [id, isExpanded]);

  const handleToggle = useCallback(() => {
    onToggle(id);
  }, [onToggle, id]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    // Support Enter and Space keys for accessibility
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleToggle();
    }
    // Support Escape key to collapse
    if (event.key === 'Escape' && isExpanded) {
      event.preventDefault();
      handleToggle();
    }
  }, [handleToggle, isExpanded]);

  // If section is empty, show placeholder
  if (isEmpty) {
    return (
      <section
        id={id}
        className="bg-surface rounded-lg border border-border shadow-sm mb-4 sm:mb-6"
        aria-labelledby={`${id}-title`}
      >
        <div className="p-4 sm:p-6">
          <header className="flex items-center gap-2 sm:gap-3 mb-2">
            {icon && (
              <div className="flex-shrink-0 text-muted-foreground" aria-hidden="true">
                {icon}
              </div>
            )}
            <h2
              id={`${id}-title`}
              className="text-base sm:text-lg font-semibold text-foreground"
            >
              {title}
            </h2>
          </header>
          {description && (
            <p className="text-xs sm:text-sm text-muted-foreground mb-4">{description}</p>
          )}
          <div className="text-center py-6 sm:py-8 text-sm sm:text-base text-muted-foreground" role="status">
            <p>{emptyMessage}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      id={id}
      className="bg-surface rounded-lg border border-border shadow-sm mb-4 sm:mb-6 transition-shadow hover:shadow-md"
      aria-labelledby={`${id}-title`}
    >
      {/* Header with toggle button */}
      <header
        className={cn(
          'flex items-center justify-between p-4 sm:p-6 cursor-pointer select-none',
          'hover:bg-muted/50 transition-colors',
          'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 rounded-t-lg',
          'min-h-[60px]' // Ensure minimum touch target height
        )}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={`${id}-content`}
        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${title} section`}
      >
        <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
          {icon && (
            <div className="flex-shrink-0 text-muted-foreground" aria-hidden="true">
              {icon}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2
              id={`${id}-title`}
              className="text-base sm:text-lg font-semibold text-foreground"
            >
              {title}
            </h2>
            {description && (
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">{description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0 ml-2 sm:ml-4">
          {/* Badge - only show when collapsed */}
          {!isExpanded && badge !== undefined && (
            <span
              className="px-2 sm:px-2.5 py-1 text-xs font-medium bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 rounded-full"
              aria-label={`${badge} items in this section`}
            >
              {badge}
            </span>
          )}

          {/* Chevron icon - ensure minimum touch target */}
          <div className="min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2 sm:-mr-3">
            <ChevronDown
              className={cn(
                'h-5 w-5 text-muted-foreground transition-transform duration-300',
                isExpanded && 'rotate-180'
              )}
              aria-hidden="true"
            />
          </div>
        </div>
      </header>

      {/* Collapsible content */}
      <div
        id={`${id}-content`}
        ref={contentRef}
        className={cn(
          'overflow-hidden transition-all duration-300 ease-in-out',
          isExpanded ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'
        )}
        aria-hidden={!isExpanded}
        role="region"
        aria-labelledby={`${id}-title`}
      >
        <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-0">
          {children}
        </div>
      </div>
    </section>
  );
});

CollapsibleSection.displayName = 'CollapsibleSection';

export default CollapsibleSection;
