import React, { useRef, useState, useCallback, useEffect } from 'react';
import { cn } from '../../utils/cn';

export interface VirtualTableColumn<T> {
  key: string;
  header: React.ReactNode;
  render: (item: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  /** CSS width value, e.g. '40%' or '200px'. Columns without width share remaining space equally. */
  width?: string;
}

export interface VirtualTableProps<T> {
  items: T[];
  columns: VirtualTableColumn<T>[];
  getKey: (item: T) => string;
  rowHeight?: number;
  maxHeight?: number;
  ariaLabel: string;
}

const ROW_HEIGHT_DEFAULT = 44;
const MAX_HEIGHT_DEFAULT = 400;
const OVERSCAN = 5;

export function VirtualTable<T>({
  items,
  columns,
  getKey,
  rowHeight = ROW_HEIGHT_DEFAULT,
  maxHeight = MAX_HEIGHT_DEFAULT,
  ariaLabel,
}: VirtualTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = items.length * rowHeight;
  const visibleCount = Math.ceil(maxHeight / rowHeight);
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const endIndex = Math.min(items.length, startIndex + visibleCount + OVERSCAN * 2);
  const visibleItems = items.slice(startIndex, endIndex);
  const offsetY = startIndex * rowHeight;

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      setScrollTop(scrollRef.current.scrollTop);
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return (
    <div role="table" aria-label={ariaLabel} aria-rowcount={items.length}>
      {/* Header */}
      <div role="row" className="flex bg-muted">
        {columns.map((col) => (
          <div
            key={col.key}
            role="columnheader"
            style={col.width ? { width: col.width, flexShrink: 0 } : { flex: 1 }}
            className={cn(
              'px-3 sm:px-4 py-3 text-left text-sm font-medium text-muted-foreground',
              col.headerClassName
            )}
          >
            {col.header}
          </div>
        ))}
      </div>
      {/* Scrollable body */}
      <div
        ref={scrollRef}
        style={{ maxHeight, overflow: 'auto' }}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleItems.map((item, i) => (
            <div
              key={getKey(item)}
              role="row"
              className="flex hover:bg-muted/50 transition-colors"
              style={{
                position: 'absolute',
                top: offsetY + i * rowHeight,
                width: '100%',
                height: rowHeight,
              }}
            >
              {columns.map((col) => (
                <div
                  key={col.key}
                  role="cell"
                  style={col.width ? { width: col.width, flexShrink: 0 } : { flex: 1 }}
                  className={cn('px-3 sm:px-4 py-3 text-sm truncate', col.className)}
                >
                  {col.render(item)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
