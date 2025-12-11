import { useMemo, useCallback, useRef, useEffect } from 'react';
import { variableCacheManager } from '@/utils/variableCacheManager';
import { useCustomVariables } from './useCustomVariables';
import type {
  VariableDefinitions,
  Variable,
  ControlFlowHelper,
  ComponentType
} from '@/types/variable';
import { VariableCategory } from '@/types/variable';

interface UseMemoizedVariableDefinitionsOptions {
  includeCustomVariables?: boolean;
  contextType?: ComponentType;
  enableCaching?: boolean;
  refreshInterval?: number; // in milliseconds
  onDefinitionsUpdate?: (definitions: VariableDefinitions) => void;
}

interface UseMemoizedVariableDefinitionsResult {
  // Core definitions
  definitions: VariableDefinitions;

  // Computed data
  allVariables: Variable[];
  variablesByCategory: Record<VariableCategory, Variable[]>;
  controlFlowHelpers: ControlFlowHelper[];

  // Contextual data
  contextualVariables: Variable[];
  priorityVariables: Variable[];
  excludedVariablePaths: string[];

  // Statistics
  stats: {
    totalVariables: number;
    customVariables: number;
    categoryCounts: Record<VariableCategory, number>;
    lastUpdated: Date;
    cacheHitRate: number;
  };

  // Actions
  refreshDefinitions: () => void;
  invalidateCache: () => void;

  // Utilities
  getVariableByPath: (path: string) => Variable | undefined;
  getVariableById: (id: string) => Variable | undefined;
  getControlFlowHelperById: (id: string) => ControlFlowHelper | undefined;
  isVariableExcluded: (variablePath: string) => boolean;
  getVariablesByType: (type: string) => Variable[];
}

const DEFAULT_OPTIONS: Required<UseMemoizedVariableDefinitionsOptions> = {
  includeCustomVariables: true,
  contextType: undefined as any,
  enableCaching: true,
  refreshInterval: 0, // No auto-refresh by default
  onDefinitionsUpdate: () => {}
};

export const useMemoizedVariableDefinitions = (
  options: UseMemoizedVariableDefinitionsOptions = {}
): UseMemoizedVariableDefinitionsResult => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Get custom variables if needed
  const {
    variables: customVariables,
    loading: customVariablesLoading
  } = useCustomVariables({
    autoLoad: opts.includeCustomVariables
  });

  // Track last update time
  const lastUpdateRef = useRef<Date>(new Date());
  const refreshTimeoutRef = useRef<NodeJS.Timeout>();

  // Core definitions with caching
  const baseDefinitions = useMemo(() => {
    if (opts.enableCaching) {
      return variableCacheManager.getVariableDefinitions();
    } else {
      // Direct import without caching
      const { VARIABLE_DEFINITIONS } = require('@/data/variableDefinitions');
      return VARIABLE_DEFINITIONS;
    }
  }, [opts.enableCaching]);

  // Merge custom variables into definitions
  const definitions = useMemo((): VariableDefinitions => {
    if (!opts.includeCustomVariables || customVariablesLoading) {
      return baseDefinitions;
    }

    // Create a deep copy to avoid mutating the original
    const mergedDefinitions: VariableDefinitions = {
      ...baseDefinitions,
      categories: {
        ...baseDefinitions.categories,
        [VariableCategory.CUSTOM]: {
          ...baseDefinitions.categories[VariableCategory.CUSTOM],
          variables: [
            ...baseDefinitions.categories[VariableCategory.CUSTOM].variables,
            ...customVariables.map(cv => ({
              id: cv.id,
              name: cv.name,
              path: cv.path,
              category: VariableCategory.CUSTOM,
              type: cv.type,
              sampleValue: cv.defaultValue,
              description: cv.description,
              isCustom: true
            } as Variable))
          ]
        }
      }
    };

    lastUpdateRef.current = new Date();
    opts.onDefinitionsUpdate(mergedDefinitions);

    return mergedDefinitions;
  }, [baseDefinitions, customVariables, customVariablesLoading, opts.includeCustomVariables, opts.onDefinitionsUpdate]);

  // All variables flattened
  const allVariables = useMemo((): Variable[] => {
    const variables: Variable[] = [];

    Object.values(definitions.categories).forEach(category => {
      variables.push(...category.variables);
    });

    return variables;
  }, [definitions]);

  // Variables organized by category
  const variablesByCategory = useMemo((): Record<VariableCategory, Variable[]> => {
    const categorized: Record<VariableCategory, Variable[]> = {} as any;

    Object.entries(definitions.categories).forEach(([category, categoryData]) => {
      categorized[category as VariableCategory] = [...categoryData.variables];
    });

    return categorized;
  }, [definitions]);

  // Control flow helpers
  const controlFlowHelpers = useMemo((): ControlFlowHelper[] => {
    return [...definitions.controlFlowHelpers];
  }, [definitions]);

  // Contextual variables based on component type
  const contextualData = useMemo(() => {
    if (!opts.contextType || !definitions.contextualMappings[opts.contextType]) {
      return {
        contextualVariables: allVariables,
        priorityVariables: [],
        excludedVariablePaths: []
      };
    }

    const mapping = definitions.contextualMappings[opts.contextType];
    const excludedPaths = new Set(mapping.excluded);

    // Filter out excluded variables
    const contextualVariables = allVariables.filter(
      variable => !excludedPaths.has(variable.path)
    );

    // Get priority variables
    const priorityVariables = mapping.priority
      .map(path => allVariables.find(v => v.path === path))
      .filter((v): v is Variable => v !== undefined);

    return {
      contextualVariables,
      priorityVariables,
      excludedVariablePaths: mapping.excluded
    };
  }, [allVariables, opts.contextType, definitions]);

  // Statistics
  const stats = useMemo(() => {
    const categoryCounts: Record<VariableCategory, number> = {} as any;

    Object.entries(variablesByCategory).forEach(([category, variables]) => {
      categoryCounts[category as VariableCategory] = variables.length;
    });

    const customVariableCount = variablesByCategory[VariableCategory.CUSTOM]?.length || 0;
    const cacheStats = opts.enableCaching ? variableCacheManager.getStats() : { definitions: { hitRate: 0 } };

    return {
      totalVariables: allVariables.length,
      customVariables: customVariableCount,
      categoryCounts,
      lastUpdated: lastUpdateRef.current,
      cacheHitRate: cacheStats.definitions.hitRate
    };
  }, [allVariables.length, variablesByCategory, opts.enableCaching]);

  // Auto-refresh setup
  useEffect(() => {
    if (opts.refreshInterval > 0) {
      refreshTimeoutRef.current = setInterval(() => {
        refreshDefinitions();
      }, opts.refreshInterval);

      return () => {
        if (refreshTimeoutRef.current) {
          clearInterval(refreshTimeoutRef.current);
        }
      };
    }
  }, [opts.refreshInterval]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearInterval(refreshTimeoutRef.current);
      }
    };
  }, []);

  // Actions
  const refreshDefinitions = useCallback(() => {
    if (opts.enableCaching) {
      variableCacheManager.invalidateDefinitionsCache();
    }
    lastUpdateRef.current = new Date();
  }, [opts.enableCaching]);

  const invalidateCache = useCallback(() => {
    if (opts.enableCaching) {
      variableCacheManager.invalidateAllCaches();
    }
  }, [opts.enableCaching]);

  // Utility functions
  const getVariableByPath = useCallback((path: string): Variable | undefined => {
    return allVariables.find(variable => variable.path === path);
  }, [allVariables]);

  const getVariableById = useCallback((id: string): Variable | undefined => {
    return allVariables.find(variable => variable.id === id);
  }, [allVariables]);

  const getControlFlowHelperById = useCallback((id: string): ControlFlowHelper | undefined => {
    return controlFlowHelpers.find(helper => helper.id === id);
  }, [controlFlowHelpers]);

  const isVariableExcluded = useCallback((variablePath: string): boolean => {
    return contextualData.excludedVariablePaths.includes(variablePath);
  }, [contextualData.excludedVariablePaths]);

  const getVariablesByType = useCallback((type: string): Variable[] => {
    return allVariables.filter(variable => variable.type === type);
  }, [allVariables]);

  return {
    // Core definitions
    definitions,

    // Computed data
    allVariables,
    variablesByCategory,
    controlFlowHelpers,

    // Contextual data
    contextualVariables: contextualData.contextualVariables,
    priorityVariables: contextualData.priorityVariables,
    excludedVariablePaths: contextualData.excludedVariablePaths,

    // Statistics
    stats,

    // Actions
    refreshDefinitions,
    invalidateCache,

    // Utilities
    getVariableByPath,
    getVariableById,
    getControlFlowHelperById,
    isVariableExcluded,
    getVariablesByType
  };
};
