import React, { memo, useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { Search, X, ChevronDown, ChevronRight, Zap, Hash } from 'lucide-react';
import { useOptimizedVariableSearch } from '@/hooks/useOptimizedVariableSearch';
import { useOptimizedVariableFilter } from '@/hooks/useOptimizedVariableFilter';
import { useMemoizedVariableDefinitions } from '@/hooks/useMemoizedVariableDefinitions';
import { useVirtualScrolling } from '@/utils/performanceOptimizations';
import { cn } from '@/utils/cn';
import type { Variable, ControlFlowHelper, ComponentType } from '@/types/variable';
import { VariableCategory } from '@/types/variable';

interface OptimizedVariablePickerProps {
  onVariableSelect: (variable: Variable) => void;
  onControlFlowSelect?: (helper: ControlFlowHelper) => void;
  contextType?: ComponentType;
  currentValue?: string;
  position?: 'inline' | 'modal';
  maxHeight?: number;
  showControlFlow?: boolean;
  showSearch?: boolean;
  showCategories?: boolean;
  placeholder?: string;
  className?: string;
  onClose?: () => void;
}

interface VariableItemProps {
  variable: Variable;
  isHighlighted: boolean;
  onClick: (variable: Variable) => void;
  style?: React.CSSProperties;
}

interface CategoryHeaderProps {
  category: VariableCategory;
  label: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
}

// Memoized variable item component for performance
const VariableItem = memo<VariableItemProps>(({
  variable,
  isHighlighted,
  onClick,
  style
}) => {
  const handleClick = useCallback(() => {
    onClick(variable);
  }, [variable, onClick]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(variable);
    }
  }, [variable, onClick]);

  return (
    <div
      style={style}
      className={cn(
        'flex items-center justify-between p-3 cursor-pointer transition-colors',
        'hover:bg-gray-50 focus:bg-gray-50 focus:outline-none',
        isHighlighted && 'bg-blue-50 border-l-2 border-l-blue-500'
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="option"
      aria-selected={isHighlighted}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 truncate">
            {variable.name}
          </span>
          {variable.isCustom && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
              Custom
            </span>
          )}
        </div>
        <div className="text-sm text-gray-500 truncate">
          {variable.path}
        </div>
        {variable.description && (
          <div className="text-xs text-gray-400 truncate mt-1">
            {variable.description}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 ml-3">
        <span className={cn(
          'px-2 py-1 rounded text-xs font-medium',
          getTypeColor(variable.type)
        )}>
          {variable.type}
        </span>
        {variable.sampleValue && (
          <div className="text-xs text-gray-400 max-w-20 truncate">
            {formatSampleValue(variable.sampleValue)}
          </div>
        )}
      </div>
    </div>
  );
});

VariableItem.displayName = 'VariableItem';

// Memoized category header component
const CategoryHeader = memo<CategoryHeaderProps>(({
  category,
  label,
  count,
  isExpanded,
  onToggle
}) => {
  const handleClick = useCallback(() => {
    onToggle();
  }, [onToggle]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  }, [onToggle]);

  return (
    <div
      className="flex items-center justify-between p-2 bg-gray-100 cursor-pointer hover:bg-gray-200 transition-colors"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-expanded={isExpanded}
    >
      <div className="flex items-center gap-2">
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-gray-600" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-600" />
        )}
        <span className="font-medium text-gray-900">{label}</span>
        <span className="text-sm text-gray-500">({count})</span>
      </div>
      {category === VariableCategory.CONTROL_FLOW && (
        <Hash className="w-4 h-4 text-gray-600" />
      )}
    </div>
  );
});

CategoryHeader.displayName = 'CategoryHeader';

export const OptimizedVariablePicker = memo<OptimizedVariablePickerProps>(({
  onVariableSelect,
  onControlFlowSelect,
  contextType,
  currentValue = '',
  position = 'inline',
  maxHeight = 400,
  showControlFlow = true,
  showSearch = true,
  showCategories = true,
  placeholder = 'Search variables...',
  className,
  onClose
}) => {
  // State
  const [expandedCategories, setExpandedCategories] = useState<Set<VariableCategory>>(
    new Set([VariableCategory.NEWSLETTER, VariableCategory.SUBSCRIBER])
  );
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Hooks
  const { definitions, controlFlowHelpers, stats } = useMemoizedVariableDefinitions({
    includeCustomVariables: true,
    contextType,
    enableCaching: true
  });

  const {
    query,
    results: searchResults,
    isSearching,
    error: searchError,
    searchStats,
    setQuery,
    clearQuery,
    getResultsByCategory
  } = useOptimizedVariableSearch({
    contextType,
    debounceDelay: 200,
    maxResults: 100,
    enableCaching: true,
    enablePreloading: true
  });

  const {
    selectedCategory,
    variables: filteredVariables,
    allCategories,
    filterStats,
    setSelectedCategory
  } = useOptimizedVariableFilter({
    contextType,
    enableCaching: true,
    enablePreloading: true,
    sortBy: 'priority'
  });

  // Determine which variables to display
  const displayVariables = useMemo(() => {
    if (query.trim()) {
      return searchResults;
    }
    return selectedCategory ? filteredVariables : [];
  }, [query, searchResults, selectedCategory, filteredVariables]);

  // Virtual scrolling for performance with large lists
  const {
    visibleItems,
    totalHeight,
    offsetY,
    scrollToIndex
  } = useVirtualScrolling(
    displayVariables,
    60, // Item height
    Math.min(maxHeight - 120, 300), // Container height (accounting for header/search)
    5 // Overscan
  );

  // Handle category toggle
  const toggleCategory = useCallback((category: VariableCategory) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
        if (selectedCategory === category) {
          setSelectedCategory(null);
        }
      } else {
        newSet.add(category);
        setSelectedCategory(category);
      }
      return newSet;
    });
  }, [selectedCategory, setSelectedCategory]);

  // Handle variable selection
  const handleVariableSelect = useCallback((variable: Variable) => {
    onVariableSelect(variable);
    onClose?.();
  }, [onVariableSelect, onClose]);

  // Handle control flow selection
  const handleControlFlowSelect = useCallback((helper: ControlFlowHelper) => {
    onControlFlowSelect?.(helper);
    onClose?.();
  }, [onControlFlowSelect, onClose]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const itemCount = displayVariables.length;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => Math.min(prev + 1, itemCount - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => Math.max(prev - 1, -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < itemCount) {
          handleVariableSelect(displayVariables[highlightedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose?.();
        break;
    }
  }, [displayVariables, highlightedIndex, handleVariableSelect, onClose]);

  // Focus search input on mount
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0) {
      scrollToIndex(highlightedIndex);
    }
  }, [highlightedIndex, scrollToIndex]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'bg-white border border-gray-200 rounded-lg shadow-lg',
        position === 'modal' && 'max-w-md w-full',
        className
      )}
      style={{ maxHeight }}
      onKeyDown={handleKeyDown}
      role="listbox"
      aria-label="Variable picker"
    >
      {/* Header with search */}
      {showSearch && (
        <div className="p-3 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full pl-10 pr-8 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {query && (
              <button
                onClick={clearQuery}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}
          </div>

          {/* Search stats */}
          {query && (
            <div className="mt-2 text-xs text-gray-500 flex items-center justify-between">
              <span>
                {isSearching ? 'Searching...' : `${searchResults.length} results`}
                {searchStats.cacheHit && (
                  <span className="ml-1 text-green-600">(cached)</span>
                )}
              </span>
              {searchStats.searchTime > 0 && (
                <span>{searchStats.searchTime.toFixed(1)}ms</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Categories */}
      {showCategories && !query && (
        <div className="border-b border-gray-200">
          {allCategories.map(({ category, label, count }) => (
            <CategoryHeader
              key={category}
              category={category}
              label={label}
              count={count}
              isExpanded={expandedCategories.has(category)}
              onToggle={() => toggleCategory(category)}
            />
          ))}
        </div>
      )}

      {/* Variables list */}
      <div className="relative overflow-auto" style={{ maxHeight: maxHeight - 120 }}>
        {displayVariables.length > 0 ? (
          <div style={{ height: totalHeight }}>
            <div style={{ transform: `translateY(${offsetY}px)` }}>
              {visibleItems.map(({ item: variable, index }) => (
                <VariableItem
                  key={variable.id}
                  variable={variable}
                  isHighlighted={index === highlightedIndex}
                  onClick={handleVariableSelect}
                />
              ))}
            </div>
          </div>
        ) : query ? (
          <div className="p-4 text-center text-gray-500">
            {isSearching ? (
              <div className="flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                Searching...
              </div>
            ) : (
              <div>
                <Search className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                No variables found for "{query}"
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 text-center text-gray-500">
            {showCategories ? (
              <div>
                <Zap className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                Select a category to view variables
              </div>
            ) : (
              <div>No variables available</div>
            )}
          </div>
        )}
      </div>

      {/* Control Flow Helpers */}
      {showControlFlow && onControlFlowSelect && (
        <div className="border-t border-gray-200">
          <div className="p-2 bg-gray-50">
            <div className="flex items-center gap-2">
              <Hash className="w-4 h-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">Control Flow</span>
            </div>
          </div>
          <div className="max-h-32 overflow-auto">
            {controlFlowHelpers.map(helper => (
              <div
                key={helper.id}
                className="p-2 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                onClick={() => handleControlFlowSelect(helper)}
              >
                <div className="font-medium text-sm text-gray-900">{helper.name}</div>
                <div className="text-xs text-gray-500 font-mono">{helper.syntax}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer with stats */}
      {process.env.NODE_ENV === 'development' && (
        <div className="p-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
          <div className="flex justify-between">
            <span>Total: {stats.totalVariables} variables</span>
            <span>Cache: {stats.cacheHitRate.toFixed(1)}% hit rate</span>
          </div>
        </div>
      )}

      {/* Error display */}
      {searchError && (
        <div className="p-3 bg-red-50 border-t border-red-200">
          <div className="text-sm text-red-600">{searchError}</div>
        </div>
      )}
    </div>
  );
});

OptimizedVariablePicker.displayName = 'OptimizedVariablePicker';

// Helper functions
function getTypeColor(type: string): string {
  const colors = {
    string: 'bg-blue-100 text-blue-800',
    number: 'bg-green-100 text-green-800',
    boolean: 'bg-purple-100 text-purple-800',
    date: 'bg-orange-100 text-orange-800',
    url: 'bg-indigo-100 text-indigo-800',
    array: 'bg-pink-100 text-pink-800',
    object: 'bg-gray-100 text-gray-800'
  };

  return colors[type as keyof typeof colors] || 'bg-gray-100 text-gray-800';
}

function formatSampleValue(value: any): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') {
    return value.length > 20 ? value.substring(0, 20) + '...' : value;
  }

  if (typeof value === 'object') {
    return Array.isArray(value) ? `[${value.length} items]` : '{object}';
  }

  return String(value);
}

export default OptimizedVariablePicker;
