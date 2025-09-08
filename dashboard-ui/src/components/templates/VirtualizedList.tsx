import React, { useState, useEffect, useRef, useCallback } from 'react';

interface VirtualizedListProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loading?: boolean;
  loadingComponent?: React.ReactNode;
  className?: string;
  overscan?: number;
}

export function VirtualizedList<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  onLoadMore,
  hasMore = false,
  loading = false,
  loadingComponent,
  className = '',
  overscan = 5
}: VirtualizedListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const scrollElementRef = useRef<HTMLDivElement>(null);

  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length - 1,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const visibleItems = items.slice(startIndex, endIndex + 1);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    setScrollTop(scrollTop);

    // Load more when near bottom
    if (onLoadMore && hasMore && !loading) {
      const scrollHeight = e.currentTarget.scrollHeight;
      const clientHeight = e.currentTarget.clientHeight;
      const scrollPosition = scrollTop + clientHeight;

      // Trigger load more when 80% scrolled
      if (scrollPosition >= scrollHeight * 0.8) {
        onLoadMore();
      }
    }
  }, [onLoadMore, hasMore, loading]);

  // Auto-scroll to load more content when needed
  useEffect(() => {
    if (items.length === 0 && onLoadMore && hasMore && !loading) {
      onLoadMore();
    }
  }, [items.length, onLoadMore, hasMore, loading]);

  return (
    <div
      ref={scrollElementRef}
      className={`overflow-auto ${className}`}
      style={{ height: containerHeight }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div
          style={{
            transform: `translateY(${startIndex * itemHeight}px)`,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0
          }}
        >
          {visibleItems.map((item, index) => (
            <div
              key={startIndex + index}
              style={{ height: itemHeight }}
              className="flex-shrink-0"
            >
              {renderItem(item, startIndex + index)}
            </div>
          ))}

          {loading && loadingComponent && (
            <div style={{ height: itemHeight }} className="flex-shrink-0">
              {loadingComponent}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Loading skeleton component for templates
export const TemplateListSkeleton: React.FC = () => (
  <div className="p-4 border border-gray-200 rounded-lg animate-pulse">
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <div className="h-5 bg-gray-200 rounded w-3/4 mb-2"></div>
        <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
        <div className="flex space-x-2">
          <div className="h-3 bg-gray-200 rounded w-16"></div>
          <div className="h-3 bg-gray-200 rounded w-20"></div>
        </div>
      </div>
      <div className="ml-4">
        <div className="h-8 w-8 bg-gray-200 rounded"></div>
      </div>
    </div>
  </div>
);

// Loading skeleton component for snippets
export const SnippetListSkeleton: React.FC = () => (
  <div className="p-4 border border-gray-200 rounded-lg animate-pulse">
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <div className="h-5 bg-gray-200 rounded w-2/3 mb-2"></div>
        <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
        <div className="flex space-x-2">
          <div className="h-3 bg-gray-200 rounded w-12"></div>
          <div className="h-3 bg-gray-200 rounded w-16"></div>
          <div className="h-3 bg-gray-200 rounded w-14"></div>
        </div>
      </div>
      <div className="ml-4">
        <div className="h-8 w-8 bg-gray-200 rounded"></div>
      </div>
    </div>
  </div>
);
