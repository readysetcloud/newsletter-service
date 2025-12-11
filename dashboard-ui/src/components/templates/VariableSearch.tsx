import React, { useState, useCallback, useMemo } from 'react';
import { Search, X, Filter, SortAsc, SortDesc } from 'lucide-react';
import { Variable, VariableCategory, ComponentType } from '../../types/variable';
import { searchVariables, getContextualVariables } from '../../data/variableDefinitions';
import { useDebounce } from '../../hooks/useDebounce';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';

interface VariableSearchProps {
  onResultsChange: (results: Variable[]) => void;
  contextType?: ComponentType;
  placeholder?: string;
  showFilters?: boolean;
  className?: string;
}

interface SearchFilters {
  category: VariableCategory | 'all';
  type: string;
  sortBy: 'name' | 'category' | 'type';
  sortOrder: 'asc' | 'desc';
  showCustomOnly: boolean;
}

const DEFAULT_FILTERS: SearchFilters = {
  category: 'all',
  type: 'all',
  sortBy: 'name',
  sortOrder: 'asc',
  showCustomOnly: false
};

export const VariableSearch: React.FC<VariableSearchProps> = ({
  onResultsChange,
  contextType,
  placeholder = 'Search variables...',
  showFilters = true,
  className = ''
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Get contextual data for filtering
  const contextualData = useMemo(() => {
    if (contextType) {
      return getContextualVariables(contextType);
    }
    return { priority: [], excluded: [] };
  }, [contextType]);

  // Perform search and filtering
  const searchResults = useMemo(() => {
    let results: Variable[] = [];

    if (debouncedSearchQuery) {
      results = searchVariables(debouncedSearchQuery, contextType);
    } else {
      // Get all variables when no search query
      const allVariables: Variable[] = [];
      Object.values(VariableCategory).forEach(category => {
        if (category !== VariableCategory.CONTROL_FLOW) {
          // This would need to be implemented in variableDefinitions.ts
          // For now, we'll use the search function with empty query
          const categoryVariables = searchVariables('', contextType);
          allVariables.push(...categoryVariables.filter(v => v.category === category));
        }
      });
      results = allVariables;
    }

    // Apply filters
    if (filters.category !== 'all') {
      results = results.filter(variable => variable.category === filters.category);
    }

    if (filters.type !== 'all') {
      results = results.filter(variable => variable.type === filters.type);
    }

    if (filters.showCustomOnly) {
      results = results.filter(variable => variable.isCustom);
    }

    // Apply sorting
    results.sort((a, b) => {
      let comparison = 0;

      switch (filters.sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'category':
          comparison = a.category.localeCompare(b.category);
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
      }

      return filters.sortOrder === 'desc' ? -comparison : comparison;
    });

    return results;
  }, [debouncedSearchQuery, contextType, filters]);

  // Notify parent of results changes
  React.useEffect(() => {
    onResultsChange(searchResults);
  }, [searchResults, onResultsChange]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  const handleFilterChange = useCallback((key: keyof SearchFilters, value: any) => {
    setFilters(prev => ({
      ...prev,
      [key]: value
    }));
  }, []);

  const handleResetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setSearchQuery('');
  }, []);

  const toggleSortOrder = useCallback(() => {
    setFilters(prev => ({
      ...prev,
      sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc'
    }));
  }, []);

  const hasActiveFilters = useMemo(() => {
    return (
      filters.category !== 'all' ||
      filters.type !== 'all' ||
      filters.showCustomOnly ||
      filters.sortBy !== 'name' ||
      filters.sortOrder !== 'asc'
    );
  }, [filters]);

  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    searchResults.forEach(variable => types.add(variable.type));
    return Array.from(types).sort();
  }, [searchResults]);

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
        <Input
          type="text"
          placeholder={placeholder}
          value={searchQuery}
          onChange={handleSearchChange}
          className="pl-10 pr-10"
        />
        {searchQuery && (
          <button
            onClick={handleClearSearch}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Results Summary */}
      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>
          {searchResults.length} variable{searchResults.length !== 1 ? 's' : ''} found
          {contextType && (
            <span className="ml-1">
              (filtered for {contextType})
            </span>
          )}
        </span>

        {showFilters && (
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="text-xs"
            >
              <Filter className="w-3 h-3 mr-1" />
              Filters
              {hasActiveFilters && (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800 border border-orange-200 ml-1">
                  {Object.values(filters).filter(v =>
                    v !== 'all' && v !== 'name' && v !== 'asc' && v !== false
                  ).length}
                </span>
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSortOrder}
              className="text-xs"
            >
              {filters.sortOrder === 'asc' ? (
                <SortAsc className="w-3 h-3" />
              ) : (
                <SortDesc className="w-3 h-3" />
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Advanced Filters */}
      {showFilters && showAdvancedFilters && (
        <div className="p-3 bg-gray-50 rounded-lg space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {/* Category Filter */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Category
              </label>
              <Select
                value={filters.category}
                onChange={(value) => handleFilterChange('category', value)}
                className="text-sm"
              >
                <option value="all">All Categories</option>
                <option value={VariableCategory.NEWSLETTER}>Newsletter</option>
                <option value={VariableCategory.SUBSCRIBER}>Subscriber</option>
                <option value={VariableCategory.BRAND}>Brand</option>
                <option value={VariableCategory.SYSTEM}>System</option>
                <option value={VariableCategory.CUSTOM}>Custom</option>
              </Select>
            </div>

            {/* Type Filter */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Type
              </label>
              <Select
                value={filters.type}
                onChange={(value) => handleFilterChange('type', value)}
                className="text-sm"
              >
                <option value="all">All Types</option>
                {availableTypes.map(type => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Sort By */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Sort By
              </label>
              <Select
                value={filters.sortBy}
                onChange={(value) => handleFilterChange('sortBy', value)}
                className="text-sm"
              >
                <option value="name">Name</option>
                <option value="category">Category</option>
                <option value="type">Type</option>
              </Select>
            </div>

            {/* Custom Only Toggle */}
            <div className="flex items-end">
              <label className="flex items-center space-x-2 text-sm">
                <input
                  type="checkbox"
                  checked={filters.showCustomOnly}
                  onChange={(e) => handleFilterChange('showCustomOnly', e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-gray-700">Custom only</span>
              </label>
            </div>
          </div>

          {/* Reset Filters */}
          {hasActiveFilters && (
            <div className="pt-2 border-t border-gray-200">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetFilters}
                className="text-xs text-gray-600"
              >
                Reset all filters
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VariableSearch;
