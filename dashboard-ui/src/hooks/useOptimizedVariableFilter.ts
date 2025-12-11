import { useState, useCallback, useMemo, useEffect } from 'react';
import { variableCacheManager } from '@/utils/variableCacheManager';
import { measureSync } from '@/utils/performance';
import type { Variable, ComponentType } from '@/types/variable';
import { VariableCategory } from '@/types/variable';

interface UseOptimizedVariableFilterOptions {
  contextType?: ComponentType;
  enableCaching?: boolean;
  enablePreloading?: boolean;
  sortBy?: 'name' | 'category' | 'priority' | 'type';
  sortOrder?: 'asc' | 'desc';
  onFilterChange?: (category: VariableCategory | null, variables: Variable[]) => void;
  onError?: (error: Error) => void;
}

interface UseOptimizedVariableFilterResult {
  // State
  selectedCategory: VariableCategory | null;
  variables: Variable[];
  allCategories: Array<{
    category: VariableCategory;
    label: string;
    count: number;
    variables: Variable[];
  }>;
  isLoading: boolean;
  error: string | null;
  filterStats: {
    totalVariables: number;
    filteredCount: number;
    cacheHit: boolean;
    filterTime: number;
  };

  // Actions
  setSelectedCategory: (category: VariableCategory | null) => void;
  refreshCategories: () => void;
  clearFilter: () => void;

  // Utilities
  getVariablesByType: (type: string) => Variable[];
  getVariablesByPattern: (pattern: RegExp) => Variable[];
  getCategoryStats: () => Record<VariableCategory, number>;
}

const DEFAULT_OPTIONS: Required<UseOptimizedVariableFilterOptions> = {
  contextType: undefined as any,
  enableCaching: true,
  enablePreloading: true,
  sortBy: 'name',
  sortOrder: 'asc',
  onFilterChange: () => {},
  onError: () => {}
};

export const useOptimizedVariableFilter = (
  options: UseOptimizedVariableFilterOptions = {}
): UseOptimizedVariableFilterResult => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // State
  const [selectedCategory, setSelectedCategoryState] = useState<VariableCategory | null>(null);
  const [allVariables, setAllVariables] = useState<Variable[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStats, setFilterStats] = useState({
    totalVariables: 0,
    filteredCount: 0,
    cacheHit: false,
    filterTime: 0
  });

  // Load all variables from all categories
  const loadAllVariables = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const startTime = performance.now();
      const definitions = variableCacheManager.getVariableDefinitions();

      const allVars: Variable[] = [];
      Object.values(definitions.categories).forEach(categoryData => {
        allVars.push(...categoryData.variables);
      });

      // Apply contextual filtering if specified
      let filteredVars = allVars;
      if (opts.contextType && definitions.contextualMappings[opts.contextType]) {
        const mapping = definitions.contextualMappings[opts.contextType];
        const excludedPaths = new Set(mapping.excluded);

        filteredVars = allVars.filter(variable => !excludedPaths.has(variable.path));
      }

      // Apply sorting
      filteredVars = measureSync('variable-filter-sort', () => {
        return sortVariables(filteredVars, opts.sortBy, opts.sortOrder);
      });

      const filterTime = performance.now() - startTime;
      const cacheStats = variableCacheManager.getStats();

      setAllVariables(filteredVars);
      setFilterStats({
        totalVariables: allVars.length,
        filteredCount: filteredVars.length,
        cacheHit: cacheStats.filter.hitRate > 0,
        filterTime
      });

    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load variables');
      setError(error.message);
      opts.onError(error);
    } finally {
      setIsLoading(false);
    }
  }, [opts.contextType, opts.sortBy, opts.sortOrder, opts.onError]);

  // Get variables for a specific category
  const getVariablesForCategory = useCallback((category: VariableCategory | null): Variable[] => {
    if (!category) {
      return allVariables;
    }

    const startTime = performance.now();

    let categoryVariables: Variable[];

    if (opts.enableCaching) {
      categoryVariables = variableCacheManager.getVariablesByCategory(
        category,
        opts.contextType
      );
    } else {
      // Direct filtering without caching
      categoryVariables = allVariables.filter(variable => variable.category === category);
    }

    // Apply sorting
    categoryVariables = sortVariables(categoryVariables, opts.sortBy, opts.sortOrder);

    const filterTime = performance.now() - startTime;

    setFilterStats(prev => ({
      ...prev,
      filteredCount: categoryVariables.length,
      filterTime
    }));

    return categoryVariables;
  }, [allVariables, opts.enableCaching, opts.contextType, opts.sortBy, opts.sortOrder]);

  // Memoized filtered variables based on selected category
  const variables = useMemo(() => {
    return getVariablesForCategory(selectedCategory);
  }, [selectedCategory, getVariablesForCategory]);

  // Memoized category information
  const allCategories = useMemo(() => {
    const categoryMap = new Map<VariableCategory, Variable[]>();

    allVariables.forEach(variable => {
      const category = variable.category as VariableCategory;
      if (!categoryMap.has(category)) {
        categoryMap.set(category, []);
      }
      categoryMap.get(category)!.push(variable);
    });

    const definitions = variableCacheManager.getVariableDefinitions();

    return Array.from(categoryMap.entries()).map(([category, vars]) => ({
      category,
      label: definitions.categories[category]?.label || category,
      count: vars.length,
      variables: sortVariables(vars, opts.sortBy, opts.sortOrder)
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [allVariables, opts.sortBy, opts.sortOrder]);

  // Load variables on mount and when dependencies change
  useEffect(() => {
    loadAllVariables();
  }, [loadAllVariables]);

  // Preload category data
  useEffect(() => {
    if (opts.enablePreloading && opts.enableCaching) {
      const preloadCategories = async () => {
        const categories = Object.keys(VariableCategory) as VariableCategory[];
        const contextTypes = opts.contextType ? [opts.contextType] : [];

        try {
          await variableCacheManager.preloadVariableData(categories, contextTypes);
        } catch (error) {
          console.warn('Failed to preload category data:', error);
        }
      };

      // Use requestIdleCallback for non-blocking preloading
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(preloadCategories);
      } else {
        setTimeout(preloadCategories, 100);
      }
    }
  }, [opts.enablePreloading, opts.enableCaching, opts.contextType]);

  // Notify when filter changes
  useEffect(() => {
    opts.onFilterChange(selectedCategory, variables);
  }, [selectedCategory, variables, opts.onFilterChange]);

  // Actions
  const setSelectedCategory = useCallback((category: VariableCategory | null) => {
    setSelectedCategoryState(category);
    setError(null);
  }, []);

  const refreshCategories = useCallback(() => {
    // Invalidate cache and reload
    if (opts.enableCaching) {
      variableCacheManager.invalidateFilterCache();
      variableCacheManager.invalidateDefinitionsCache();
    }
    loadAllVariables();
  }, [opts.enableCaching, loadAllVariables]);

  const clearFilter = useCallback(() => {
    setSelectedCategory(null);
    setError(null);
  }, [setSelectedCategory]);

  // Utility functions
  const getVariablesByType = useCallback((type: string): Variable[] => {
    return variables.filter(variable => variable.type === type);
  }, [variables]);

  const getVariablesByPattern = useCallback((pattern: RegExp): Variable[] => {
    return variables.filter(variable =>
      pattern.test(variable.name) ||
      pattern.test(variable.path) ||
      (variable.description && pattern.test(variable.description))
    );
  }, [variables]);

  const getCategoryStats = useCallback((): Record<VariableCategory, number> => {
    const stats: Record<VariableCategory, number> = {} as any;

    allCategories.forEach(({ category, count }) => {
      stats[category] = count;
    });

    return stats;
  }, [allCategories]);

  return {
    // State
    selectedCategory,
    variables,
    allCategories,
    isLoading,
    error,
    filterStats,

    // Actions
    setSelectedCategory,
    refreshCategories,
    clearFilter,

    // Utilities
    getVariablesByType,
    getVariablesByPattern,
    getCategoryStats
  };
};

// Helper function to sort variables
function sortVariables(
  variables: Variable[],
  sortBy: 'name' | 'category' | 'priority' | 'type',
  sortOrder: 'asc' | 'desc'
): Variable[] {
  const sorted = [...variables].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'category':
        comparison = a.category.localeCompare(b.category);
        break;
      case 'type':
        comparison = a.type.localeCompare(b.type);
        break;
      case 'priority':
        // Custom variables have lower priority
        if (a.isCustom !== b.isCustom) {
          comparison = a.isCustom ? 1 : -1;
        } else {
          comparison = a.name.localeCompare(b.name);
        }
        break;
      default:
        comparison = 0;
    }

    return sortOrder === 'desc' ? -comparison : comparison;
  });

  return sorted;
}
