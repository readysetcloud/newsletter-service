import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface TablePagerProps {
  /** Zero-based index of the current page */
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  /** Plural noun for the summary line, e.g. "links" */
  itemLabel?: string;
  className?: string;
}

/**
 * Pager for long analytics tables.
 *
 * Long lists are the worst offender on a phone — a hundred rows means a hundred
 * screens of scrolling to get past them — so the tables page instead, with
 * touch-sized controls and a plain "showing x-y of z" summary.
 */
export const TablePager: React.FC<TablePagerProps> = ({
  page,
  pageSize,
  totalItems,
  onPageChange,
  itemLabel = 'items',
  className,
}) => {
  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));

  if (totalItems <= pageSize) {
    return null;
  }

  const first = page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, totalItems);
  const canGoBack = page > 0;
  const canGoForward = page < pageCount - 1;

  const buttonClasses = cn(
    'inline-flex items-center gap-1 rounded-lg border border-border px-3 min-h-[44px]',
    'text-sm font-medium text-foreground bg-surface touch-manipulation',
    'hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
    'disabled:opacity-40 disabled:pointer-events-none'
  );

  return (
    <nav
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 pt-3 mt-3 border-t border-border',
        className
      )}
      aria-label={`${itemLabel} pagination`}
    >
      <p className="text-xs sm:text-sm text-muted-foreground" aria-live="polite">
        Showing <span className="font-medium text-foreground">{first}–{last}</span> of{' '}
        <span className="font-medium text-foreground">{totalItems.toLocaleString()}</span> {itemLabel}
      </p>

      <div className="flex items-center gap-2 ml-auto">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={!canGoBack}
          className={buttonClasses}
          aria-label={`Previous page of ${itemLabel}`}
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          <span>Prev</span>
        </button>

        <span className="text-xs sm:text-sm text-muted-foreground whitespace-nowrap px-1">
          {page + 1} / {pageCount}
        </span>

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={!canGoForward}
          className={buttonClasses}
          aria-label={`Next page of ${itemLabel}`}
        >
          <span>Next</span>
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
};

export default TablePager;
