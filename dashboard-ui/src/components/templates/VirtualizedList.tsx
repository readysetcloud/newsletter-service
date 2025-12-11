import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useThrottle } from '@/utils/performanceOptimizations';

interface VirtualizedListProps<T> {
  items: T[];
  itemHeight: number | ((index: number) => number);
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loading?: boolean;
  loadingComponent?: React.ReactNode;
  className?: string;
  overscan?: number;
  getItemKey?: (item: T, index: number) => string | number;
  estimatedItemHeight?: number;
  scrollThrottleMs?: number;
  enableSmoothScrolling?: boolean;
}

interface ItemPosition {
  index: number;
  top: number;
  height: number;
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
  overscan = 5,
  getItemKey,
  estimatedItemHeight = 100,
  scrollThrottleMs = 16,
  enableSmoothScrolling = true
}: VirtualizedListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();
  const itemPositionsRef = useRef<ItemPosition[]>([]);
  const measuredHeightsRef = useRef<Map<number, number>>(new Map());

  // Calculate item positions with dynamic heights
  const itemPositions = useMemo(() => {
    const positions: ItemPosition[] = [];
    let currentTop = 0;

    for (let i = 0; i < items.length; i++) {
      const height = typeof itemHeight === 'function'
        ? itemHeight(i)
        : measuredHeightsRef.current.get(i) || itemHeight || estimatedItemHeight;

      positions.push({
        index: i,
        top: currentTop,
        height
      });

      currentTop += height;
    }

    itemPositionsRef.current = positions;
    return positions;
  }, [items.length, itemHeight, estimatedItemHeight]);

  const totalHeight = itemPositions.length > 0
    ? itemPositions[itemPositions.length - 1].top + itemPositions[itemPositions.length - 1].height
    : 0;

  // Binary search to find start index
  const findStartIndex = useCallback((scrollTop: number): number => {
    let low = 0;
    let high = itemPositions.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const position = itemPositions[mid];

      if (position.top <= scrollTop && position.top + position.height > scrollTop) {
        return Math.max(0, mid - overscan);
      } else if (position.top < scrollTop) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return Math.max(0, low - overscan);
  }, [itemPositions, overscan]);

  // Find visible items
  const { startIndex, endIndex, visibleItems } = useMemo(() => {
    if (itemPositions.length === 0) {
      return { startIndex: 0, endIndex: 0, visibleItems: [] };
    }

    const start = findStartIndex(scrollTop);
    let end = start;

    // Find end index
    const viewportBottom = scrollTop + containerHeight;
    for (let i = start; i < itemPositions.length; i++) {
      const position = itemPositions[i];
      if (position.top >= viewportBottom) {
        break;
      }
      end = i;
    }

    end = Math.min(itemPositions.length - 1, end + overscan);

    const visible = items.slice(start, end + 1).map((item, index) => ({
      item,
      index: start + index,
      position: itemPositions[start + index]
    }));

    return { startIndex: start, endIndex: end, visibleItems: visible };
  }, [items, itemPositions, scrollTop, containerHeight, findStartIndex, overscan]);

  // Throttled scroll handler for better performance
  const throttledScrollHandler = useThrottle((scrollTop: number) => {
    setScrollTop(scrollTop);
  }, scrollThrottleMs);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const newScrollTop = e.currentTarget.scrollTop;

    // Set scrolling state
    setIsScrolling(true);
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 150);

    throttledScrollHandler(newScrollTop);

    // Load more when near bottom
    if (onLoadMore && hasMore && !loading) {
      const scrollHeight = e.currentTarget.scrollHeight;
      const clientHeight = e.currentTarget.clientHeight;
      const scrollPosition = newScrollTop + clientHeight;

      // Trigger load more when 80% scrolled
      if (scrollPosition >= scrollHeight * 0.8) {
        onLoadMore();
      }
    }
  }, [throttledScrollHandler, onLoadMore, hasMore, loading]);

  // Measure item heights for dynamic sizing
  const measureItemHeight = useCallback((index: number, height: number) => {
    if (typeof itemHeight === 'function') return; // Skip if using function-based heights

    const currentHeight = measuredHeightsRef.current.get(index);
    if (currentHeight !== height) {
      measuredHeightsRef.current.set(index, height);
      // Force recalculation on next render
      setScrollTop(prev => prev);
    }
  }, [itemHeight]);

  // Item renderer with measurement
  const renderItemWithMeasurement = useCallback((
    item: T,
    index: number,
    position: ItemPosition
  ) => {
    const itemRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (itemRef.current && typeof itemHeight !== 'function') {
        const height = itemRef.current.offsetHeight;
        measureItemHeight(index, height);
      }
    });

    const key = getItemKey ? getItemKey(item, index) : index;

    return (
      <div
        key={key}
        ref={itemRef}
        style={{
          position: 'absolute',
          top: position.top,
          left: 0,
          right: 0,
          height: typeof itemHeight === 'function' ? position.height : undefined,
          minHeight: typeof itemHeight !== 'function' ? position.height : undefined
        }}
        className="flex-shrink-0"
      >
        {renderItem(item, index)}
      </div>
    );
  }, [renderItem, getItemKey, itemHeight, measureItemHeight]);

  // Auto-scroll to load more content when needed
  useEffect(() => {
    if (items.length === 0 && onLoadMore && hasMore && !loading) {
      onLoadMore();
    }
  }, [items.length, onLoadMore, hasMore, loading]);

  // Scroll to specific index
  const scrollToIndex = useCallback((index: number, align: 'start' | 'center' | 'end' = 'start') => {
    if (!scrollElementRef.current || index < 0 || index >= itemPositions.length) return;

    const position = itemPositions[index];
    let scrollTop = position.top;

    if (align === 'center') {
      scrollTop = position.top - (containerHeight - position.height) / 2;
    } else if (align === 'end') {
      scrollTop = position.top - containerHeight + position.height;
    }

    scrollTop = Math.max(0, Math.min(scrollTop, totalHeight - containerHeight));

    if (enableSmoothScrolling) {
      scrollElementRef.current.scrollTo({
        top: scrollTop,
        behavior: 'smooth'
      });
    } else {
      scrollElementRef.current.scrollTop = scrollTop;
    }
  }, [itemPositions, containerHeight, totalHeight, enableSmoothScrolling]);

  // Expose scroll methods
  // Expose scroll methods via ref (commented out for now to fix TypeScript error)
  // React.useImperativeHandle(ref => ({
  //   scrollToIndex,
  //   scrollToTop: () => scrollToIndex(0),
  //   scrollToBottom: () => scrollToIndex(items.length - 1, 'end'),
  //   getScrollTop: () => scrollTop,
  //   isScrolling
  // }), [scrollToIndex, items.length, scrollTop, isScrolling]);

  return (
    <div
      ref={scrollElementRef}
      className={`overflow-auto ${className} ${isScrolling ? 'pointer-events-none' : ''}`}
      style={{
        height: containerHeight,
        scrollBehavior: enableSmoothScrolling ? 'smooth' : 'auto'
      }}
      onScroll={handleScroll}
      role="listbox"
      aria-label={`Virtual list with ${items.length} items`}
    >
      <div
        style={{
          height: totalHeight,
          position: 'relative',
          // Improve rendering performance
          willChange: isScrolling ? 'transform' : 'auto'
        }}
      >
        {visibleItems.map(({ item, index, position }) =>
          renderItemWithMeasurement(item, index, position)
        )}

        {loading && loadingComponent && (
          <div
            style={{
              position: 'absolute',
              top: totalHeight,
              left: 0,
              right: 0,
              height: estimatedItemHeight
            }}
            className="flex-shrink-0"
          >
            {loadingComponent}
          </div>
        )}
      </div>

      {/* Scroll indicators */}
      {isScrolling && (
        <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
          {Math.round((scrollTop / (totalHeight - containerHeight)) * 100)}%
        </div>
      )}
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
