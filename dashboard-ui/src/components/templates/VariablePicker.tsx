import React, { useState, useMemo, useCallback } from 'react';
import { Search, X, Hash, Type, Calendar, Link, ToggleLeft, List, Braces } from 'lucide-react';
import { Variable, VariableCategory, ComponentType, ControlFlowHelper } from '../../types/variable';
import { VARIABLE_DEFINITIONS, searchVariables, getContextualVariables } from '../../data/variableDefinitions';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Card } from '../ui/Card';

interface VariablePickerProps {
  onVariableSelect: (variable: Variable) => void;
  onControlFlowSelect?: (helper: ControlFlowHelper) => void;
  contextType?: ComponentType;
  currentValue?: string;
  position?: 'inline' | 'modal';
  showControlFlow?: boolean;
  maxHeight?: string;
  className?: string;
  availableVariables?: Variable[];
}

interface CategorySectionProps {
  category: VariableCategory;
  variables: Variable[];
  onVariableSelect: (variable: Variable) => void;
  searchQuery: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

interface ControlFlowSectionProps {
  helpers: ControlFlowHelper[];
  onHelperSelect: (helper: ControlFlowHelper) => void;
  searchQuery: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

const getVariableTypeIcon = (type: string) => {
  switch (type) {
    case 'string':
      return <Type className="w-3 h-3" />;
    case 'number':
      return <Hash className="w-3 h-3" />;
    case 'boolean':
      return <ToggleLeft className="w-3 h-3" />;
    case 'url':
      return <Link className="w-3 h-3" />;
    case 'date':
      return <Calendar className="w-3 h-3" />;
    case 'array':
    case 'object':
      return <List className="w-3 h-3" />;
    default:
      return <Braces className="w-3 h-3" />;
  }
};

const getCategoryColor = (category: VariableCategory): string => {
  switch (category) {
    case VariableCategory.NEWSLETTER:
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case VariableCategory.SUBSCRIBER:
      return 'bg-green-100 text-green-800 border-green-200';
    case VariableCategory.BRAND:
      return 'bg-purple-100 text-purple-800 border-purple-200';
    case VariableCategory.SYSTEM:
      return 'bg-gray-100 text-gray-800 border-gray-200';
    case VariableCategory.CUSTOM:
      return 'bg-orange-100 text-orange-800 border-orange-200';
    case VariableCategory.CONTROL_FLOW:
      return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

const VariableItem: React.FC<{
  variable: Variable;
  onSelect: (variable: Variable) => void;
  searchQuery: string;
}> = ({ variable, onSelect, searchQuery }) => {
  const handleClick = useCallback(() => {
    onSelect(variable);
  }, [variable, onSelect]);

  const highlightText = (text: string, query: string) => {
    if (!query) return text;

    const regex = new RegExp(`(${query})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, index) =>
      regex.test(part) ? (
        <span key={index} className="bg-yellow-200 font-medium">
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  return (
    <div
      className="flex items-center justify-between p-2 hover:bg-gray-50 cursor-pointer rounded-md group transition-colors"
      onClick={handleClick}
    >
      <div className="flex items-center space-x-3 flex-1 min-w-0">
        <div className="flex-shrink-0 text-gray-400">
          {getVariableTypeIcon(variable.type)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-900 truncate">
              {highlightText(variable.name, searchQuery)}
            </span>
            {variable.isCustom && (
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800 border border-orange-200">
                Custom
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 truncate">
            {highlightText(variable.path, searchQuery)}
          </div>
          {variable.description && (
            <div className="text-xs text-gray-400 truncate mt-1">
              {highlightText(variable.description, searchQuery)}
            </div>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
        Click to insert
      </div>
    </div>
  );
};

const ControlFlowItem: React.FC<{
  helper: ControlFlowHelper;
  onSelect: (helper: ControlFlowHelper) => void;
  searchQuery: string;
}> = ({ helper, onSelect, searchQuery }) => {
  const handleClick = useCallback(() => {
    onSelect(helper);
  }, [helper, onSelect]);

  const highlightText = (text: string, query: string) => {
    if (!query) return text;

    const regex = new RegExp(`(${query})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, index) =>
      regex.test(part) ? (
        <span key={index} className="bg-yellow-200 font-medium">
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  return (
    <div
      className="flex items-center justify-between p-2 hover:bg-gray-50 cursor-pointer rounded-md group transition-colors"
      onClick={handleClick}
    >
      <div className="flex items-center space-x-3 flex-1 min-w-0">
        <div className="flex-shrink-0 text-indigo-500">
          <Braces className="w-3 h-3" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-900 truncate">
              {highlightText(helper.name, searchQuery)}
            </span>
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200 capitalize">
              {helper.category}
            </span>
          </div>
          <div className="text-xs text-gray-500 font-mono truncate">
            {highlightText(helper.syntax, searchQuery)}
          </div>
          <div className="text-xs text-gray-400 truncate mt-1">
            {highlightText(helper.description, searchQuery)}
          </div>
        </div>
      </div>
      <div className="flex-shrink-0 text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
        Click to insert
      </div>
    </div>
  );
};

const CategorySection: React.FC<CategorySectionProps> = ({
  category,
  variables,
  onVariableSelect,
  searchQuery,
  isExpanded,
  onToggleExpanded
}) => {
  const categoryData = VARIABLE_DEFINITIONS.categories[category];

  if (!categoryData || variables.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 transition-colors"
        onClick={onToggleExpanded}
      >
        <div className="flex items-center space-x-3">
          <span className="text-sm font-medium text-gray-900">
            {categoryData.label}
          </span>
          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getCategoryColor(category)}`}>
            {variables.length}
          </span>
        </div>
        <div className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>

      {isExpanded && (
        <div className="pb-2">
          <div className="px-3 pb-2">
            <p className="text-xs text-gray-500">{categoryData.description}</p>
          </div>
          <div className="space-y-1 px-1">
            {variables.map((variable) => (
              <VariableItem
                key={variable.id}
                variable={variable}
                onSelect={onVariableSelect}
                searchQuery={searchQuery}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const ControlFlowSection: React.FC<ControlFlowSectionProps> = ({
  helpers,
  onHelperSelect,
  searchQuery,
  isExpanded,
  onToggleExpanded
}) => {
  if (helpers.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 transition-colors"
        onClick={onToggleExpanded}
      >
        <div className="flex items-center space-x-3">
          <span className="text-sm font-medium text-gray-900">
            Control Flow
          </span>
          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getCategoryColor(VariableCategory.CONTROL_FLOW)}`}>
            {helpers.length}
          </span>
        </div>
        <div className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>

      {isExpanded && (
        <div className="pb-2">
          <div className="px-3 pb-2">
            <p className="text-xs text-gray-500">
              Conditional logic and loops for dynamic content
            </p>
          </div>
          <div className="space-y-1 px-1">
            {helpers.map((helper) => (
              <ControlFlowItem
                key={helper.id}
                helper={helper}
                onSelect={onHelperSelect}
                searchQuery={searchQuery}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const VariablePicker: React.FC<VariablePickerProps> = ({
  onVariableSelect,
  onControlFlowSelect,
  contextType,
  currentValue = '',
  position = 'inline',
  showControlFlow = true,
  maxHeight = '400px',
  className = '',
  availableVariables
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set([VariableCategory.NEWSLETTER, VariableCategory.SUBSCRIBER])
  );
  const [announcement, setAnnouncement] = useState<string>('');

  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Get contextual variables if component type is provided
  const contextualData = useMemo(() => {
    if (contextType) {
      return getContextualVariables(contextType);
    }
    return { priority: [], excluded: [] };
  }, [contextType]);

  // Filter and organize variables
  const organizedVariables = useMemo(() => {
    const excludedPaths = new Set(contextualData.excluded);
    const result: Record<VariableCategory, Variable[]> = {
      [VariableCategory.NEWSLETTER]: [],
      [VariableCategory.SUBSCRIBER]: [],
      [VariableCategory.BRAND]: [],
      [VariableCategory.SYSTEM]: [],
      [VariableCategory.CUSTOM]: [],
      [VariableCategory.CONTROL_FLOW]: []
    };

    // Use availableVariables if provided, otherwise use all variables
    const sourceVariables = availableVariables || (() => {
      const allVars: Variable[] = [];
      Object.values(VARIABLE_DEFINITIONS.categories).forEach(categoryData => {
        if (categoryData.variables) {
          allVars.push(...categoryData.variables);
        }
      });
      return allVars;
    })();

    if (debouncedSearchQuery) {
      // Filter source variables by search query
      const searchResults = sourceVariables.filter(variable =>
        variable.name.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
        variable.path.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
        variable.description?.toLowerCase().includes(debouncedSearchQuery.toLowerCase())
      );

      searchResults.forEach(variable => {
        if (!excludedPaths.has(variable.path)) {
          result[variable.category].push(variable);
        }
      });
    } else {
      // Organize source variables by category
      sourceVariables.forEach(variable => {
        if (!excludedPaths.has(variable.path) && variable.category !== VariableCategory.CONTROL_FLOW) {
          result[variable.category].push(variable);
        }
      });

      // Sort each category by contextual priority if available
      if (contextType && contextualData.priority.length > 0) {
        const priorityIds = new Set(contextualData.priority.map(v => v.id));

        Object.keys(result).forEach(category => {
          result[category as VariableCategory].sort((a, b) => {
            const aPriority = priorityIds.has(a.id);
            const bPriority = priorityIds.has(b.id);

            if (aPriority && !bPriority) return -1;
            if (!aPriority && bPriority) return 1;
            return a.name.localeCompare(b.name);
          });
        });
      }
    }

    return result;
  }, [debouncedSearchQuery, contextType, contextualData]);

  // Filter control flow helpers
  const filteredControlFlowHelpers = useMemo(() => {
    if (!showControlFlow) return [];

    if (debouncedSearchQuery) {
      return VARIABLE_DEFINITIONS.controlFlowHelpers.filter(helper =>
        helper.name.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
        helper.syntax.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
        helper.description.toLowerCase().includes(debouncedSearchQuery.toLowerCase())
      );
    }

    return VARIABLE_DEFINITIONS.controlFlowHelpers;
  }, [debouncedSearchQuery, showControlFlow]);

  const toggleCategory = useCallback((category: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  const handleVariableSelect = useCallback((variable: Variable) => {
    onVariableSelect(variable);
    setAnnouncement(`Variable ${variable.name} selected`);
  }, [onVariableSelect]);

  const handleControlFlowSelect = useCallback((helper: ControlFlowHelper) => {
    if (onControlFlowSelect) {
      onControlFlowSelect(helper);
      setAnnouncement(`Control flow helper ${helper.name} selected`);
    }
  }, [onControlFlowSelect]);

  const totalVariables = Object.values(organizedVariables).reduce(
    (sum, variables) => sum + variables.length,
    0
  ) + filteredControlFlowHelpers.length;

  return (
    <Card
      className={`${className} ${position === 'modal' ? 'w-full max-w-md' : 'w-80'}`}
      role="dialog"
      aria-labelledby="variable-picker-title"
      aria-describedby="variable-picker-description"
    >
      {/* Screen Reader Announcements */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>

      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h3
            id="variable-picker-title"
            className="text-sm font-medium text-gray-900"
          >
            Insert Variable
          </h3>
          {contextType && (
            <span
              className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200 capitalize"
              role="status"
              aria-label={`Filtered for ${contextType} component`}
            >
              {contextType}
            </span>
          )}
        </div>

        <div className="relative">
          <label htmlFor="variable-search" className="sr-only">
            Search variables
          </label>
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4"
            aria-hidden="true"
          />
          <Input
            id="variable-search"
            type="text"
            placeholder="Search variables..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value) {
                setAnnouncement(`Searching for ${e.target.value}`);
              }
            }}
            className="pl-10 pr-10 text-sm"
            aria-describedby="search-help"
          />
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Clear search"
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <div id="search-help" className="sr-only">
            Type to search for variables by name, path, or description
          </div>
        </div>

        {totalVariables > 0 && (
          <div
            className="mt-2 text-xs text-gray-500"
            role="status"
            aria-live="polite"
            id="variable-picker-description"
          >
            {totalVariables} variable{totalVariables !== 1 ? 's' : ''} available
            {contextType && (
              <span className="ml-1">
                (filtered for {contextType} component)
              </span>
            )}
          </div>
        )}
      </div>

      <div
        className="overflow-y-auto"
        style={{ maxHeight }}
        role="region"
        aria-label="Variable list"
        tabIndex={0}
      >
        {totalVariables === 0 ? (
          <div
            className="p-6 text-center text-gray-500"
            role="status"
          >
            <Search
              className="w-8 h-8 mx-auto mb-2 text-gray-300"
              aria-hidden="true"
            />
            <p className="text-sm">
              {debouncedSearchQuery ? 'No variables found' : 'No variables available'}
            </p>
            {debouncedSearchQuery && (
              <p className="text-xs mt-1">
                Try adjusting your search terms
              </p>
            )}
          </div>
        ) : (
          <div>
            {/* Variable Categories */}
            {Object.entries(organizedVariables).map(([category, variables]) => (
              <CategorySection
                key={category}
                category={category as VariableCategory}
                variables={variables}
                onVariableSelect={handleVariableSelect}
                searchQuery={debouncedSearchQuery}
                isExpanded={expandedCategories.has(category)}
                onToggleExpanded={() => toggleCategory(category)}
              />
            ))}

            {/* Control Flow Helpers */}
            {showControlFlow && (
              <ControlFlowSection
                helpers={filteredControlFlowHelpers}
                onHelperSelect={handleControlFlowSelect}
                searchQuery={debouncedSearchQuery}
                isExpanded={expandedCategories.has('control_flow')}
                onToggleExpanded={() => toggleCategory('control_flow')}
              />
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

export default VariablePicker;
