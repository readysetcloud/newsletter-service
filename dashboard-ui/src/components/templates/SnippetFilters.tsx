import React, { useState, useCallback } from 'react';
import {
  FunnelIcon,
  XMarkIcon,
  TagIcon,
  CalendarIcon,
  UserIcon,
  AdjustmentsHorizontalIcon
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';

import { cn } from '@/utils/cn';

interface SnippetFiltersProps {
  categories: string[];
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  onClearFilters: () => void;
  className?: string;
}

interface FilterState {
  category: string;
  dateRange: {
    start: string;
    end: string;
  };
  parameterCount: {
    min: number | null;
    max: number | null;
  };
  hasParameters: boolean | null;
  sortBy: 'name' | 'updated' | 'created' | 'usage';
  sortOrder: 'asc' | 'desc';
}

export const SnippetFilters: React.FC<SnippetFiltersProps> = ({
  categories,
  selectedCategory,
  onCategoryChange,
  onClearFilters,
  className
}) => {
  const [filterState, setFilterState] = useState<FilterState>({
    category: selectedCategory,
    dateRange: {
      start: '',
      end: ''
    },
    parameterCount: {
      min: null,
      max: null
    },
    hasParameters: null,
    sortBy: 'updated',
    sortOrder: 'desc'
  });

  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleCategoryChange = useCallback((category: string) => {
    setFilterState(prev => ({ ...prev, category }));
    onCategoryChange(category);
  }, [onCategoryChange]);

  const handleDateRangeChange = useCallback((field: 'start' | 'end', value: string) => {
    setFilterState(prev => ({
      ...prev,
      dateRange: {
        ...prev.dateRange,
        [field]: value
      }
    }));
  }, []);

  const handleParameterCountChange = useCallback((field: 'min' | 'max', value: string) => {
    const numValue = value === '' ? null : parseInt(value, 10);
    setFilterState(prev => ({
      ...prev,
      parameterCount: {
        ...prev.parameterCount,
        [field]: numValue
      }
    }));
  }, []);

  const handleHasParametersChange = useCallback((value: string) => {
    const boolValue = value === 'all' ? null : value === 'true';
    setFilterState(prev => ({ ...prev, hasParameters: boolValue }));
  }, []);

  const handleSortChange = useCallback((field: 'sortBy' | 'sortOrder', value: string) => {
    setFilterState(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleClearAll = useCallback(() => {
    setFilterState({
      category: '',
      dateRange: {
        start: '',
        end: ''
      },
      parameterCount: {
        min: null,
        max: null
      },
      hasParameters: null,
      sortBy: 'updated',
      sortOrder: 'desc'
    });
    onClearFilters();
  }, [onClearFilters]);

  const getActiveFilterCount = useCallback(() => {
    let count = 0;

    if (filterState.category && filterState.category !== 'all') count++;
    if (filterState.dateRange.start || filterState.dateRange.end) count++;
    if (filterState.parameterCount.min !== null || filterState.parameterCount.max !== null) count++;
    if (filterState.hasParameters !== null) count++;
    if (filterState.sortBy !== 'updated' || filterState.sortOrder !== 'desc') count++;

    return count;
  }, [filterState]);

  const activeFilterCount = getActiveFilterCount();

  return (
    <div className={cn('space-y-4', className)}>
      {/* Filter Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FunnelIcon className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-700">Filters</span>
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">
              {activeFilterCount} active
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs"
          >
            <AdjustmentsHorizontalIcon className="w-3 h-3 mr-1" />
            Advanced
          </Button>

          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              className="text-xs text-red-600 hover:text-red-700"
            >
              <XMarkIcon className="w-3 h-3 mr-1" />
              Clear All
            </Button>
          )}
        </div>
      </div>

      {/* Basic Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Category Filter */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            <TagIcon className="w-3 h-3 inline mr-1" />
            Category
          </label>
          <Select
            value={filterState.category}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="text-sm"
            options={[
              { value: '', label: 'All Categories' },
              ...categories.map(category => ({ value: category, label: category }))
            ]}
          />
        </div>

        {/* Sort By */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Sort By
          </label>
          <div className="flex gap-2">
            <Select
              value={filterState.sortBy}
              onChange={(e) => handleSortChange('sortBy', e.target.value)}
              className="text-sm flex-1"
              options={[
                { value: 'name', label: 'Name' },
                { value: 'updated', label: 'Last Updated' },
                { value: 'created', label: 'Created Date' },
                { value: 'usage', label: 'Usage Count' }
              ]}
            />
            <Select
              value={filterState.sortOrder}
              onChange={(e) => handleSortChange('sortOrder', e.target.value)}
              className="text-sm w-20"
              options={[
                { value: 'asc', label: '↑' },
                { value: 'desc', label: '↓' }
              ]}
            />
          </div>
        </div>

        {/* Has Parameters */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Parameters
          </label>
          <Select
            value={filterState.hasParameters === null ? 'all' : filterState.hasParameters.toString()}
            onChange={(e) => handleHasParametersChange(e.target.value)}
            className="text-sm"
            options={[
              { value: 'all', label: 'All Snippets' },
              { value: 'true', label: 'With Parameters' },
              { value: 'false', label: 'No Parameters' }
            ]}
          />
        </div>
      </div>

      {/* Advanced Filters */}
      {showAdvanced && (
        <div className="pt-4 border-t border-slate-200 space-y-4">
          <h4 className="text-sm font-medium text-slate-700">Advanced Filters</h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Date Range */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                <CalendarIcon className="w-3 h-3 inline mr-1" />
                Date Range
              </label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={filterState.dateRange.start}
                  onChange={(e) => handleDateRangeChange('start', e.target.value)}
                  className="text-sm"
                  placeholder="Start date"
                />
                <Input
                  type="date"
                  value={filterState.dateRange.end}
                  onChange={(e) => handleDateRangeChange('end', e.target.value)}
                  className="text-sm"
                  placeholder="End date"
                />
              </div>
            </div>

            {/* Parameter Count Range */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Parameter Count
              </label>
              <div className="flex gap-2 items-center">
                <Input
                  type="number"
                  min="0"
                  value={filterState.parameterCount.min?.toString() || ''}
                  onChange={(e) => handleParameterCountChange('min', e.target.value)}
                  className="text-sm"
                  placeholder="Min"
                />
                <span className="text-xs text-slate-500">to</span>
                <Input
                  type="number"
                  min="0"
                  value={filterState.parameterCount.max?.toString() || ''}
                  onChange={(e) => handleParameterCountChange('max', e.target.value)}
                  className="text-sm"
                  placeholder="Max"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active Filters Summary */}
      {activeFilterCount > 0 && (
        <div className="pt-4 border-t border-slate-200">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-600">Active filters:</span>

            {filterState.category && filterState.category !== 'all' && (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-slate-100 text-slate-700 rounded-full">
                Category: {filterState.category}
                <button
                  onClick={() => handleCategoryChange('')}
                  className="ml-1 hover:text-red-600"
                >
                  <XMarkIcon className="w-3 h-3" />
                </button>
              </span>
            )}

            {(filterState.dateRange.start || filterState.dateRange.end) && (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-slate-100 text-slate-700 rounded-full">
                Date: {filterState.dateRange.start || '...'} - {filterState.dateRange.end || '...'}
                <button
                  onClick={() => {
                    handleDateRangeChange('start', '');
                    handleDateRangeChange('end', '');
                  }}
                  className="ml-1 hover:text-red-600"
                >
                  <XMarkIcon className="w-3 h-3" />
                </button>
              </span>
            )}

            {filterState.hasParameters !== null && (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-slate-100 text-slate-700 rounded-full">
                {filterState.hasParameters ? 'With Parameters' : 'No Parameters'}
                <button
                  onClick={() => handleHasParametersChange('all')}
                  className="ml-1 hover:text-red-600"
                >
                  <XMarkIcon className="w-3 h-3" />
                </button>
              </span>
            )}

            {(filterState.parameterCount.min !== null || filterState.parameterCount.max !== null) && (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-slate-100 text-slate-700 rounded-full">
                Params: {filterState.parameterCount.min || 0}-{filterState.parameterCount.max || '∞'}
                <button
                  onClick={() => {
                    handleParameterCountChange('min', '');
                    handleParameterCountChange('max', '');
                  }}
                  className="ml-1 hover:text-red-600"
                >
                  <XMarkIcon className="w-3 h-3" />
                </button>
              </span>
            )}

            {(filterState.sortBy !== 'updated' || filterState.sortOrder !== 'desc') && (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-slate-100 text-slate-700 rounded-full">
                Sort: {filterState.sortBy} {filterState.sortOrder === 'asc' ? '↑' : '↓'}
                <button
                  onClick={() => {
                    handleSortChange('sortBy', 'updated');
                    handleSortChange('sortOrder', 'desc');
                  }}
                  className="ml-1 hover:text-red-600"
                >
                  <XMarkIcon className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
