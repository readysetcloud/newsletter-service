import React, { memo, useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOptimizedVariableSearch } from '@/hooks/useOptimizedVariableSearch';
import { useMemoizedVariableDefinitions } from '@/hooks/useMemoizedVariableDefinitions';
import { useOptimizedDebounce } from '@/utils/performanceOptimizations';
import { cn } from '@/utils/cn';
import type { Variable, ControlFlowHelper, ComponentType } from '@/types/variable';

interface OptimizedVariableAutocompleteProps {
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement>;
  onVariableInsert: (variable: Variable, insertPosition: number) => void;
  onControlFlowInsert?: (helper: ControlFlowHelper, insertPosition: number) => void;
  contextType?: ComponentType;
  disabled?: boolean;
  maxSuggestions?: number;
  debounceDelay?: number;
  className?: string;
}

interface AutocompletePosition {
  top: number;
  left: number;
  maxWidth: number;
}

interface SuggestionItemProps {
  variable: Variable;
  isHighlighted: boolean;
  query: string;
  onClick: (variable: Variable) => void;
}

interface ControlFlowItemProps {
  helper: ControlFlowHelper;
  isHighlighted: boolean;
  query: string;
  onClick: (helper: ControlFlowHelper) => void;
}

// Memoized suggestion item component
const SuggestionItem = memo<SuggestionItemProps>(({
  variable,
  isHighlighted,
  query,
  onClick
}) => {
  const handleClick = useCallback(() => {
    onClick(variable);
  }, [variable, onClick]);

  // Highlight matching text
  const highlightedName = useMemo(() => {
    if (!query) return variable.name;

    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return variable.name.replace(regex, '<mark>$1</mark>');
  }, [variable.name, query]);

  const highlightedPath = useMemo(() => {
    if (!query) return variable.path;

    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return variable.path.replace(regex, '<mark>$1</mark>');
  }, [variable.path, query]);

  return (
    <div
      className={cn(
        'px-3 py-2 cursor-pointer transition-colors border-l-2',
        isHighlighted
          ? 'bg-blue-50 border-l-blue-500'
          : 'bg-white border-l-transparent hover:bg-gray-50'
      )}
      onClick={handleClick}
      role="option"
      aria-selected={isHighlighted}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div
            className="font-medium text-sm text-gray-900 truncate"
            dangerouslySetInnerHTML={{ __html: highlightedName }}
          />
          <div
            className="text-xs text-gray-500 font-mono truncate"
            dangerouslySetInnerHTML={{ __html: highlightedPath }}
          />
        </div>
        <div className="flex items-center gap-2 ml-2">
          {variable.isCustom && (
            <span className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
              Custom
            </span>
          )}
          <span className={cn(
            'px-1.5 py-0.5 text-xs rounded font-medium',
            getTypeColor(variable.type)
          )}>
            {variable.type}
          </span>
        </div>
      </div>
      {variable.description && (
        <div className="text-xs text-gray-400 mt-1 truncate">
          {variable.description}
        </div>
      )}
    </div>
  );
});

SuggestionItem.displayName = 'SuggestionItem';

// Memoized control flow item component
const ControlFlowItem = memo<ControlFlowItemProps>(({
  helper,
  isHighlighted,
  query,
  onClick
}) => {
  const handleClick = useCallback(() => {
    onClick(helper);
  }, [helper, onClick]);

  const highlightedName = useMemo(() => {
    if (!query) return helper.name;

    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return helper.name.replace(regex, '<mark>$1</mark>');
  }, [helper.name, query]);

  return (
    <div
      className={cn(
        'px-3 py-2 cursor-pointer transition-colors border-l-2',
        isHighlighted
          ? 'bg-purple-50 border-l-purple-500'
          : 'bg-white border-l-transparent hover:bg-gray-50'
      )}
      onClick={handleClick}
      role="option"
      aria-selected={isHighlighted}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div
            className="font-medium text-sm text-gray-900 truncate"
            dangerouslySetInnerHTML={{ __html: highlightedName }}
          />
          <div className="text-xs text-purple-600 font-mono truncate">
            {helper.syntax}
          </div>
        </div>
        <span className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded font-medium">
          {helper.category}
        </span>
      </div>
      <div className="text-xs text-gray-400 mt-1 truncate">
        {helper.description}
      </div>
    </div>
  );
});

ControlFlowItem.displayName = 'ControlFlowItem';

export const OptimizedVariableAutocomplete = memo<OptimizedVariableAutocompleteProps>(({
  inputRef,
  onVariableInsert,
  onControlFlowInsert,
  contextType,
  disabled = false,
  maxSuggestions = 10,
  debounceDelay = 150,
  className
}) => {
  // State
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<AutocompletePosition | null>(null);
  const [currentQuery, setCurrentQuery] = useState('');
  const [triggerType, setTriggerType] = useState<'variable' | 'control_flow' | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(0);

  // Refs
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);

  // Debounced query for search
  const debouncedQuery = useOptimizedDebounce(currentQuery, debounceDelay);

  // Hooks
  const { controlFlowHelpers } = useMemoizedVariableDefinitions({
    contextType,
    enableCaching: true
  });

  const {
    results: variableResults,
    isSearching
  } = useOptimizedVariableSearch({
    contextType,
    debounceDelay: 0, // We handle debouncing ourselves
    maxResults: maxSuggestions,
    enableCaching: true
  });

  // Filter results based on current query
  const filteredVariables = useMemo(() => {
    if (!debouncedQuery || triggerType !== 'variable') return [];

    return variableResults
      .filter(variable =>
        variable.name.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
        variable.path.toLowerCase().includes(debouncedQuery.toLowerCase())
      )
      .slice(0, maxSuggestions);
  }, [variableResults, debouncedQuery, triggerType, maxSuggestions]);

  // Filter control flow helpers
  const filteredControlFlow = useMemo(() => {
    if (!debouncedQuery || triggerType !== 'control_flow') return [];

    return controlFlowHelpers
      .filter(helper =>
        helper.name.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
        helper.id.toLowerCase().includes(debouncedQuery.toLowerCase())
      )
      .slice(0, maxSuggestions);
  }, [controlFlowHelpers, debouncedQuery, triggerType, maxSuggestions]);

  // Combined suggestions
  const allSuggestions = useMemo(() => {
    const suggestions: Array<{ type: 'variable' | 'control_flow'; item: Variable | ControlFlowHelper }> = [];

    filteredVariables.forEach(variable => {
      suggestions.push({ type: 'variable', item: variable });
    });

    filteredControlFlow.forEach(helper => {
      suggestions.push({ type: 'control_flow', item: helper });
    });

    return suggestions;
  }, [filteredVariables, filteredControlFlow]);

  // Calculate autocomplete position
  const calculatePosition = useCallback((): AutocompletePosition | null => {
    if (!inputRef.current) return null;

    const input = inputRef.current;
    const rect = input.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    // Create temporary element to measure text width up to cursor
    const temp = document.createElement('div');
    temp.style.position = 'absolute';
    temp.style.visibility = 'hidden';
    temp.style.whiteSpace = 'pre';
    temp.style.font = window.getComputedStyle(input).font;
    temp.style.padding = window.getComputedStyle(input).padding;
    temp.style.border = window.getComputedStyle(input).border;
    temp.textContent = input.value.substring(0, cursorPosition);
    document.body.appendChild(temp);

    const textWidth = temp.offsetWidth;
    document.body.removeChild(temp);

    // Calculate position
    const lineHeight = parseInt(window.getComputedStyle(input).lineHeight) || 20;
    const paddingLeft = parseInt(window.getComputedStyle(input).paddingLeft) || 0;

    const top = rect.bottom + scrollTop + 4;
    const left = rect.left + scrollLeft + paddingLeft + Math.min(textWidth, rect.width - paddingLeft - 20);
    const maxWidth = Math.min(400, window.innerWidth - left - 20);

    return { top, left, maxWidth };
  }, [cursorPosition]);

  // Handle input changes
  const handleInputChange = useCallback(() => {
    if (!inputRef.current || disabled) return;

    const input = inputRef.current;
    const value = input.value;
    const cursor = input.selectionStart || 0;

    setCursorPosition(cursor);

    // Check for trigger patterns
    const beforeCursor = value.substring(0, cursor);

    // Variable pattern: {{word
    const variableMatch = beforeCursor.match(/\{\{([^}]*)$/);
    // Control flow pattern: {{#word
    const controlFlowMatch = beforeCursor.match(/\{\{#([^}]*)$/);

    if (controlFlowMatch && onControlFlowInsert) {
      const query = controlFlowMatch[1];
      setCurrentQuery(query);
      setTriggerType('control_flow');
      setHighlightedIndex(0);

      const pos = calculatePosition();
      if (pos) {
        setPosition(pos);
        setIsVisible(true);
      }
    } else if (variableMatch) {
      const query = variableMatch[1];
      setCurrentQuery(query);
      setTriggerType('variable');
      setHighlightedIndex(0);

      const pos = calculatePosition();
      if (pos) {
        setPosition(pos);
        setIsVisible(true);
      }
    } else {
      setIsVisible(false);
      setPosition(null);
      setCurrentQuery('');
      setTriggerType(null);
    }
  }, [disabled, calculatePosition, onControlFlowInsert]);

  // Handle variable selection
  const handleVariableSelect = useCallback((variable: Variable) => {
    if (!inputRef.current) return;

    const input = inputRef.current;
    const value = input.value;

    // Find the trigger pattern position
    const beforeCursor = value.substring(0, cursorPosition);
    const triggerMatch = beforeCursor.match(/\{\{[^}]*$/);

    if (triggerMatch) {
      const triggerStart = beforeCursor.length - triggerMatch[0].length;
      const variableSyntax = `{{${variable.path}}}`;

      // Replace the trigger pattern with the variable syntax
      const newValue =
        value.substring(0, triggerStart) +
        variableSyntax +
        value.substring(cursorPosition);

      const newCursorPosition = triggerStart + variableSyntax.length;

      // Update input
      input.value = newValue;
      input.setSelectionRange(newCursorPosition, newCursorPosition);
      input.focus();

      // Trigger change event
      const event = new Event('input', { bubbles: true });
      input.dispatchEvent(event);

      // Call callback
      onVariableInsert(variable, newCursorPosition);
    }

    setIsVisible(false);
  }, [cursorPosition, onVariableInsert]);

  // Handle control flow selection
  const handleControlFlowSelect = useCallback((helper: ControlFlowHelper) => {
    if (!inputRef.current || !onControlFlowInsert) return;

    const input = inputRef.current;
    const value = input.value;

    // Find the trigger pattern position
    const beforeCursor = value.substring(0, cursorPosition);
    const triggerMatch = beforeCursor.match(/\{\{#[^}]*$/);

    if (triggerMatch) {
      const triggerStart = beforeCursor.length - triggerMatch[0].length;

      // Create the control flow insertion
      let insertion: string;
      let newCursorPosition: number;

      if (helper.closingSyntax) {
        // Block helper with closing tag
        insertion = `${helper.syntax}\n  \n${helper.closingSyntax}`;
        newCursorPosition = triggerStart + helper.syntax.length + 3; // Position inside the block
      } else {
        // Simple helper
        insertion = helper.syntax;
        newCursorPosition = triggerStart + insertion.length;
      }

      // Replace the trigger pattern
      const newValue =
        value.substring(0, triggerStart) +
        insertion +
        value.substring(cursorPosition);

      // Update input
      input.value = newValue;
      input.setSelectionRange(newCursorPosition, newCursorPosition);
      input.focus();

      // Trigger change event
      const event = new Event('input', { bubbles: true });
      input.dispatchEvent(event);

      // Call callback
      onControlFlowInsert(helper, newCursorPosition);
    }

    setIsVisible(false);
  }, [cursorPosition, onControlFlowInsert]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isVisible || allSuggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => Math.min(prev + 1, allSuggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        const suggestion = allSuggestions[highlightedIndex];
        if (suggestion) {
          if (suggestion.type === 'variable') {
            handleVariableSelect(suggestion.item as Variable);
          } else {
            handleControlFlowSelect(suggestion.item as ControlFlowHelper);
          }
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsVisible(false);
        break;
    }
  }, [isVisible, allSuggestions, highlightedIndex, handleVariableSelect, handleControlFlowSelect]);

  // Set up event listeners
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    input.addEventListener('input', handleInputChange);
    input.addEventListener('keydown', handleKeyDown as EventListener);
    input.addEventListener('click', handleInputChange);
    input.addEventListener('keyup', handleInputChange);

    return () => {
      input.removeEventListener('input', handleInputChange);
      input.removeEventListener('keydown', handleKeyDown as EventListener);
      input.removeEventListener('click', handleInputChange);
      input.removeEventListener('keyup', handleInputChange);
    };
  }, [handleInputChange, handleKeyDown]);

  // Create portal container
  useEffect(() => {
    if (!portalRef.current) {
      portalRef.current = document.createElement('div');
      portalRef.current.className = 'variable-autocomplete-portal';
      document.body.appendChild(portalRef.current);
    }

    return () => {
      if (portalRef.current && document.body.contains(portalRef.current)) {
        document.body.removeChild(portalRef.current);
        portalRef.current = null;
      }
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isVisible &&
        autocompleteRef.current &&
        !autocompleteRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsVisible(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isVisible]);

  // Reset highlighted index when suggestions change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [allSuggestions.length]);

  if (!isVisible || !position || allSuggestions.length === 0 || !portalRef.current) {
    return null;
  }

  return createPortal(
    <div
      ref={autocompleteRef}
      className={cn(
        'fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden',
        className
      )}
      style={{
        top: position.top,
        left: position.left,
        maxWidth: position.maxWidth,
        minWidth: 200
      }}
      role="listbox"
      aria-label="Variable suggestions"
    >
      {/* Loading indicator */}
      {isSearching && (
        <div className="px-3 py-2 text-xs text-gray-500 bg-gray-50 border-b">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-3 w-3 border-b border-blue-600"></div>
            Searching...
          </div>
        </div>
      )}

      {/* Suggestions */}
      <div className="max-h-64 overflow-auto">
        {allSuggestions.map((suggestion, index) => (
          suggestion.type === 'variable' ? (
            <SuggestionItem
              key={`var-${(suggestion.item as Variable).id}`}
              variable={suggestion.item as Variable}
              isHighlighted={index === highlightedIndex}
              query={currentQuery}
              onClick={handleVariableSelect}
            />
          ) : (
            <ControlFlowItem
              key={`cf-${(suggestion.item as ControlFlowHelper).id}`}
              helper={suggestion.item as ControlFlowHelper}
              isHighlighted={index === highlightedIndex}
              query={currentQuery}
              onClick={handleControlFlowSelect}
            />
          )
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-1 bg-gray-50 border-t text-xs text-gray-500">
        <div className="flex justify-between items-center">
          <span>
            {triggerType === 'variable' ? 'Variables' : 'Control Flow'}
            ({allSuggestions.length})
          </span>
          <span>↑↓ navigate • ↵ select • esc close</span>
        </div>
      </div>
    </div>,
    portalRef.current
  );
});

OptimizedVariableAutocomplete.displayName = 'OptimizedVariableAutocomplete';

// Helper function for type colors
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

export default OptimizedVariableAutocomplete;
