import React, { useState, useCallback, useMemo } from 'react';
import { ChevronRight, ChevronDown, Hash, Type, Calendar, Link, ToggleLeft, List, Braces } from 'lucide-react';
import { Variable, VariableCategory, ComponentType } from '../../types/variable';
import { VARIABLE_DEFINITIONS, getContextualVariables } from '../../data/variableDefinitions';
import { Card } from '../ui/Card';

interface VariableCategoriesProps {
  variables: Variable[];
  onVariableSelect: (variable: Variable) => void;
  contextType?: ComponentType;
  searchQuery?: string;
  expandedCategories?: Set<string>;
  onCategoryToggle?: (category: VariableCategory) => void;
  showEmptyCategories?: boolean;
  className?: string;
}

interface CategoryItemProps {
  variable: Variable;
  onSelect: (variable: Variable) => void;
  searchQuery?: string;
  isPriority?: boolean;
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

const getCategoryIcon = (category: VariableCategory) => {
  switch (category) {
    case VariableCategory.NEWSLETTER:
      return '📰';
    case VariableCategory.SUBSCRIBER:
      return '👤';
    case VariableCategory.BRAND:
      return '🏢';
    case VariableCategory.SYSTEM:
      return '⚙️';
    case VariableCategory.CUSTOM:
      return '🔧';
    case VariableCategory.CONTROL_FLOW:
      return '🔀';
    default:
      return '📁';
  }
};

const highlightText = (text: string, query?: string) => {
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

const CategoryItem: React.FC<CategoryItemProps> = ({
  variable,
  onSelect,
  searchQuery,
  isPriority = false
}) => {
  const handleClick = useCallback(() => {
    onSelect(variable);
  }, [variable, onSelect]);

  return (
    <div
      className={`flex items-center justify-between p-2 hover:bg-gray-50 cursor-pointer rounded-md group transition-colors ${
        isPriority ? 'bg-blue-50 border-l-2 border-blue-300' : ''
      }`}
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
            <div className="flex items-center space-x-1">
              {variable.isCustom && (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800 border border-orange-200">
                  Custom
                </span>
              )}
              {isPriority && (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-600 border border-blue-300">
                  Recommended
                </span>
              )}
            </div>
          </div>
          <div className="text-xs text-gray-500 font-mono truncate">
            {highlightText(variable.path, searchQuery)}
          </div>
          {variable.description && (
            <div className="text-xs text-gray-400 truncate mt-1">
              {highlightText(variable.description, searchQuery)}
            </div>
          )}
          {variable.sampleValue !== undefined && (
            <div className="text-xs text-green-600 truncate mt-1">
              Sample: {typeof variable.sampleValue === 'object'
                ? JSON.stringify(variable.sampleValue).substring(0, 50) + '...'
                : String(variable.sampleValue)
              }
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

export const VariableCategories: React.FC<VariableCategoriesProps> = ({
  variables,
  onVariableSelect,
  contextType,
  searchQuery = '',
  expandedCategories = new Set([VariableCategory.NEWSLETTER, VariableCategory.SUBSCRIBER]),
  onCategoryToggle,
  showEmptyCategories = false,
  className = ''
}) => {
  const [internalExpandedCategories, setInternalExpandedCategories] = useState(expandedCategories);

  // Use internal state if no external control is provided
  const currentExpandedCategories = onCategoryToggle ? expandedCategories : internalExpandedCategories;

  // Get contextual data for priority sorting
  const contextualData = useMemo(() => {
    if (contextType) {
      return getContextualVariables(contextType);
    }
    return { priority: [], excluded: [] };
  }, [contextType]);

  // Organize variables by category
  const organizedVariables = useMemo(() => {
    const result: Record<VariableCategory, Variable[]> = {
      [VariableCategory.NEWSLETTER]: [],
      [VariableCategory.SUBSCRIBER]: [],
      [VariableCategory.BRAND]: [],
      [VariableCategory.SYSTEM]: [],
      [VariableCategory.CUSTOM]: [],
      [VariableCategory.CONTROL_FLOW]: []
    };

    variables.forEach(variable => {
      if (result[variable.category]) {
        result[variable.category].push(variable);
      }
    });

    // Sort variables within each category
    Object.keys(result).forEach(category => {
      const categoryVariables = result[category as VariableCategory];

      if (contextType && contextualData.priority.length > 0) {
        // Sort by contextual priority
        const priorityIds = new Set(contextualData.priority.map(v => v.id));
        categoryVariables.sort((a, b) => {
          const aPriority = priorityIds.has(a.id);
          const bPriority = priorityIds.has(b.id);

          if (aPriority && !bPriority) return -1;
          if (!aPriority && bPriority) return 1;
          return a.name.localeCompare(b.name);
        });
      } else {
        // Default alphabetical sort
        categoryVariables.sort((a, b) => a.name.localeCompare(b.name));
      }
    });

    return result;
  }, [variables, contextType, contextualData]);

  const handleCategoryToggle = useCallback((category: VariableCategory) => {
    if (onCategoryToggle) {
      onCategoryToggle(category);
    } else {
      setInternalExpandedCategories(prev => {
        const newSet = new Set(prev);
        if (newSet.has(category)) {
          newSet.delete(category);
        } else {
          newSet.add(category);
        }
        return newSet;
      });
    }
  }, [onCategoryToggle]);

  const priorityVariableIds = useMemo(() => {
    return new Set(contextualData.priority.map(v => v.id));
  }, [contextualData.priority]);

  return (
    <div className={`space-y-1 ${className}`}>
      {Object.entries(organizedVariables).map(([category, categoryVariables]) => {
        const categoryData = VARIABLE_DEFINITIONS.categories[category as VariableCategory];
        const isExpanded = currentExpandedCategories.has(category);
        const hasVariables = categoryVariables.length > 0;

        // Skip empty categories if not showing them
        if (!hasVariables && !showEmptyCategories) {
          return null;
        }

        return (
          <Card key={category} className="overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 transition-colors"
              onClick={() => handleCategoryToggle(category as VariableCategory)}
            >
              <div className="flex items-center space-x-3">
                <span className="text-lg">
                  {getCategoryIcon(category as VariableCategory)}
                </span>
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    {categoryData?.label || category}
                  </span>
                  {categoryData?.description && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      {categoryData.description}
                    </div>
                  )}
                </div>
                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getCategoryColor(category as VariableCategory)}`}>
                  {categoryVariables.length}
                </span>
              </div>
              <div className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </div>
            </button>

            {isExpanded && hasVariables && (
              <div className="border-t border-gray-100">
                <div className="p-2 space-y-1">
                  {categoryVariables.map((variable) => (
                    <CategoryItem
                      key={variable.id}
                      variable={variable}
                      onSelect={onVariableSelect}
                      searchQuery={searchQuery}
                      isPriority={priorityVariableIds.has(variable.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {isExpanded && !hasVariables && showEmptyCategories && (
              <div className="border-t border-gray-100 p-4 text-center text-gray-500">
                <div className="text-sm">No variables in this category</div>
                {category === VariableCategory.CUSTOM && (
                  <div className="text-xs mt-1">
                    Create custom variables to see them here
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}

      {Object.values(organizedVariables).every(vars => vars.length === 0) && (
        <Card className="p-6 text-center text-gray-500">
          <div className="text-sm">No variables available</div>
          {searchQuery && (
            <div className="text-xs mt-1">
              Try adjusting your search terms
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default VariableCategories;
