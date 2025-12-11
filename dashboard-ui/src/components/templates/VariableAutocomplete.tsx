import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Variable, ControlFlowHelper, ComponentType, AutocompleteTrigger } from '../../types/variable';
import { VARIABLE_DEFINITIONS, searchVariables } from '../../data/variableDefinitions';
import { useKeyboardNavigation } from '../../hooks/useKeyboardNavigation';
import { useDebounce } from '../../hooks/useDebounce';
import { Card } from '../ui/Card';
import { Type, Hash, Calendar, Link, ToggleLeft, List, Braces } from 'lucide-react';

interface VariableAutocompleteProps {
  inputValue: string;
  onSuggestionSelect: (variable: Variable) => void;
  onControlFlowInsert: (helper: ControlFlowHelper) => void;
  contextType?: ComponentType;
  maxSuggestions?: number;
  className?: string;
  position?: { top: number; left: number };
  onClose?: () => void;
}

interface AutocompleteSuggestion {
  id: string;
  type: 'variable' | 'control_flow';
  variable?: Variable;
  controlFlow?: ControlFlowHelper;
  displayText: string;
  insertText: string;
  description?: string;
}

// Trigger patterns for autocomplete
const AUTOCOMPLETE_TRIGGERS: AutocompleteTrigger = {
  pattern: /\{\{[\w.#]*$/,
  minLength: 2,
  controlFlowPattern: /\{\{#[\w]*$/
};

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

const SuggestionItem: React.FC<{
  suggestion: AutocompleteSuggestion;
  isSelected: boolean;
  onSelect: (suggestion: AutocompleteSuggestion) => void;
}> = ({ suggestion, isSelected, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(suggestion);
  }, [suggestion, onSelect]);

  return (
    <div
      className={`flex items-center space-x-3 p-2 cursor-pointer rounded-md transition-colors ${
        isSelected
          ? 'bg-blue-50 border-blue-200 text-blue-900'
          : 'hover:bg-gray-50 text-gray-900'
      }`}
      onClick={handleClick}
    >
      <div className={`flex-shrink-0 ${isSelected ? 'text-blue-500' : 'text-gray-400'}`}>
        {suggestion.type === 'control_flow' ? (
          <Braces className="w-3 h-3" />
        ) : (
          suggestion.variable && getVariableTypeIcon(suggestion.variable.type)
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium truncate">
            {suggestion.displayText}
          </span>
          {suggestion.type === 'control_flow' && (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 border border-indigo-200">
              Control Flow
            </span>
          )}
          {suggestion.variable?.isCustom && (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800 border border-orange-200">
              Custom
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 font-mono truncate">
          {suggestion.insertText}
        </div>
        {suggestion.description && (
          <div className="text-xs text-gray-400 truncate mt-1">
            {suggestion.description}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 text-xs text-gray-400">
        {isSelected && (
          <span className="text-blue-600">Enter</span>
        )}
      </div>
    </div>
  );
};

export const VariableAutocomplete: React.FC<VariableAutocompleteProps> = ({
  inputValue,
  onSuggestionSelect,
  onControlFlowInsert,
  contextType,
  maxSuggestions = 10,
  className = '',
  position,
  onClose
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [triggerMatch, setTriggerMatch] = useState<RegExpMatchArray | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const debouncedSearchQuery = useDebounce(searchQuery, 150);

  // Detect trigger patterns in input value
  useEffect(() => {
    const match = inputValue.match(AUTOCOMPLETE_TRIGGERS.pattern);

    if (match) {
      const matchedText = match[0];
      const query = matchedText.slice(2); // Remove {{ or {{#

      if (query.length >= AUTOCOMPLETE_TRIGGERS.minLength || matchedText.includes('#')) {
        setTriggerMatch(match);
        setSearchQuery(query);
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    } else {
      setIsVisible(false);
      setTriggerMatch(null);
      setSearchQuery('');
    }
  }, [inputValue]);

  // Generate suggestions based on search query and trigger type
  const suggestions = useMemo((): AutocompleteSuggestion[] => {
    if (!triggerMatch || !debouncedSearchQuery) return [];

    const isControlFlow = triggerMatch[0].includes('#');
    const results: AutocompleteSuggestion[] = [];

    if (isControlFlow) {
      // Filter control flow helpers
      const filteredHelpers = VARIABLE_DEFINITIONS.controlFlowHelpers.filter(helper =>
        helper.name.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
        helper.syntax.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
        helper.id.toLowerCase().includes(debouncedSearchQuery.toLowerCase())
      );

      filteredHelpers.forEach(helper => {
        results.push({
          id: `control_flow_${helper.id}`,
          type: 'control_flow',
          controlFlow: helper,
          displayText: helper.name,
          insertText: helper.syntax,
          description: helper.description
        });
      });
    } else {
      // Filter regular variables
      const filteredVariables = searchVariables(debouncedSearchQuery, contextType);

      filteredVariables.forEach(variable => {
        results.push({
          id: `variable_${variable.id}`,
          type: 'variable',
          variable,
          displayText: variable.name,
          insertText: `{{${variable.path}}}`,
          description: variable.description
        });
      });
    }

    return results.slice(0, maxSuggestions);
  }, [triggerMatch, debouncedSearchQuery, contextType, maxSuggestions]);

  // Set up keyboard navigation
  const navigationItems = useMemo(() => {
    return suggestions.map(suggestion => ({
      id: suggestion.id,
      focusable: true
    }));
  }, [suggestions]);

  const {
    selectedIndex,
    handleKeyDown,
    setSelectedByIndex,
    clearSelection
  } = useKeyboardNavigation({
    items: navigationItems,
    orientation: 'vertical',
    loop: true,
    autoFocus: true,
    onActivate: (selectedId) => {
      const suggestion = suggestions.find(s => s.id === selectedId);
      if (suggestion) {
        handleSuggestionSelect(suggestion);
      }
    }
  });

  const handleSuggestionSelect = useCallback((suggestion: AutocompleteSuggestion) => {
    if (suggestion.type === 'variable' && suggestion.variable) {
      onSuggestionSelect(suggestion.variable);
    } else if (suggestion.type === 'control_flow' && suggestion.controlFlow) {
      onControlFlowInsert(suggestion.controlFlow);
    }

    setIsVisible(false);
    clearSelection();
  }, [onSuggestionSelect, onControlFlowInsert, clearSelection]);

  // Handle escape key to close autocomplete
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isVisible) {
        event.preventDefault();
        event.stopPropagation();
        setIsVisible(false);
        clearSelection();
        onClose?.();
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleEscape, true);
      return () => {
        document.removeEventListener('keydown', handleEscape, true);
      };
    }
  }, [isVisible, clearSelection, onClose]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyboardNavigation = (event: KeyboardEvent) => {
      if (!isVisible || suggestions.length === 0) return;

      // Let the keyboard navigation hook handle the event
      handleKeyDown(event);
    };

    if (isVisible) {
      document.addEventListener('keydown', handleKeyboardNavigation, true);
      return () => {
        document.removeEventListener('keydown', handleKeyboardNavigation, true);
      };
    }
  }, [isVisible, suggestions.length, handleKeyDown]);

  // Close autocomplete when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsVisible(false);
        clearSelection();
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isVisible, clearSelection]);

  // Auto-select first suggestion when suggestions change
  useEffect(() => {
    if (suggestions.length > 0 && selectedIndex === -1) {
      setSelectedByIndex(0);
    }
  }, [suggestions.length, selectedIndex, setSelectedByIndex]);

  if (!isVisible || suggestions.length === 0) {
    return null;
  }

  const containerStyle = position ? {
    position: 'absolute' as const,
    top: position.top,
    left: position.left,
    zIndex: 1000
  } : {};

  return (
    <div
      ref={containerRef}
      className={`${className}`}
      style={containerStyle}
    >
      <Card className="w-80 max-h-64 overflow-hidden shadow-lg border border-gray-200">
        <div className="p-2 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600">
              {triggerMatch?.[0].includes('#') ? 'Control Flow Helpers' : 'Variables'}
            </span>
            <span className="text-xs text-gray-500">
              {suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''}
            </span>
          </div>
          {contextType && (
            <div className="mt-1">
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200 capitalize">
                {contextType} context
              </span>
            </div>
          )}
        </div>

        <div className="max-h-48 overflow-y-auto">
          <div className="p-1">
            {suggestions.map((suggestion, index) => (
              <SuggestionItem
                key={suggestion.id}
                suggestion={suggestion}
                isSelected={index === selectedIndex}
                onSelect={handleSuggestionSelect}
              />
            ))}
          </div>
        </div>

        <div className="p-2 border-t border-gray-100 bg-gray-50">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>↑↓ Navigate</span>
            <span>Enter Select</span>
            <span>Esc Close</span>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default VariableAutocomplete;
