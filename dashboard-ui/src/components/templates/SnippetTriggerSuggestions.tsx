import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CodeBracketIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import SnippetTriggerUtils from '@/utils/snippetTriggerUtils';
import { cn } from '@/utils/cn';
import type { Snippet } from '@/types/template';

interface SnippetTriggerSuggestionsProps {
  isVisible: boolean;
  query: string;
  snippets: Snippet[];
  position: { x: number; y: number };
  onSelect: (snippet: Snippet) => void;
  onClose: () => void;
  className?: string;
}

interface SuggestionItem {
  id: string;
  snippet: Snippet;
  trigger: string;
  relevanceScore: number;
}

export const SnippetTriggerSuggestions: React.FC<SnippetTriggerSuggestionsProps> = ({
  isVisible,
  query,
  snippets,
  position,
  onSelect,
  onClose,
  className
}) => {
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Generate suggestions based on query
  useEffect(() => {
    if (!query || !isVisible) {
      setSuggestions([]);
      return;
    }

    const matches = SnippetTriggerUtils.findMatchingSnippets(query, snippets, 8);
    const suggestionItems: SuggestionItem[] = matches.map((match, index) => ({
      id: match.snippet.id,
      snippet: match.snippet,
      trigger: match.trigger,
      relevanceScore: matches.length - index // Higher score for earlier matches
    }));

    setSuggestions(suggestionItems);
  }, [query, snippets, isVisible]);

  // Keyboard navigation
  const navigationItems = suggestions.map(suggestion => ({
    id: suggestion.id,
    focusable: true
  }));

  const {
    containerRef: navigationContainerRef,
    selectedIndex,
    selectedId,
    setSelectedByIndex,
    clearSelection
  } = useKeyboardNavigation({
    items: navigationItems,
    orientation: 'vertical',
    loop: true,
    autoFocus: true,
    onActivate: (snippetId) => {
      const suggestion = suggestions.find(s => s.id === snippetId);
      if (suggestion) {
        onSelect(suggestion.snippet);
      }
    }
  });

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      shortcut: { key: 'Escape' },
      handler: () => onClose(),
      description: 'Close suggestions'
    },
    {
      shortcut: { key: 'Enter' },
      handler: () => {
        if (selectedId) {
          const suggestion = suggestions.find(s => s.id === selectedId);
          if (suggestion) {
            onSelect(suggestion.snippet);
          }
        }
      },
      description: 'Select highlighted suggestion'
    },
    {
      shortcut: { key: 'Tab' },
      handler: (e) => {
        e.preventDefault();
        if (suggestions.length > 0) {
          const nextIndex = selectedIndex >= 0 ? (selectedIndex + 1) % suggestions.length : 0;
          setSelectedByIndex(nextIndex);
        }
      },
      description: 'Navigate to next suggestion'
    }
  ], { enabled: isVisible });

  // Auto-select first suggestion
  useEffect(() => {
    if (suggestions.length > 0 && selectedIndex === -1) {
      setSelectedByIndex(0);
    } else if (suggestions.length === 0) {
      clearSelection();
    }
  }, [suggestions, selectedIndex, setSelectedByIndex, clearSelection]);

  const handleSuggestionClick = useCallback((suggestion: SuggestionItem) => {
    onSelect(suggestion.snippet);
  }, [onSelect]);

  const renderSuggestion = useCallback((suggestion: SuggestionItem, index: number) => {
    const isSelected = selectedIndex === index;
    const parameterCount = suggestion.snippet.parameters?.length || 0;

    return (
      <button
        key={suggestion.id}
        className={cn(
          'w-full text-left px-3 py-2 rounded-md transition-colors',
          'hover:bg-blue-50 focus:bg-blue-50 focus:outline-none',
          isSelected && 'bg-blue-100 ring-2 ring-blue-500 ring-inset'
        )}
        onClick={() => handleSuggestionClick(suggestion)}
        onMouseEnter={() => setSelectedByIndex(index)}
        role="option"
        aria-selected={isSelected}
        tabIndex={-1}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center">
              <CodeBracketIcon className="w-4 h-4 text-blue-600 mr-2 flex-shrink-0" />
              <span className="font-medium text-slate-900 truncate">
                {suggestion.snippet.name}
              </span>
              {parameterCount > 0 && (
                <span className="ml-2 px-1.5 py-0.5 text-xs bg-slate-100 text-slate-600 rounded">
                  {parameterCount} param{parameterCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {suggestion.snippet.description && (
              <p className="text-sm text-slate-600 mt-1 line-clamp-2">
                {suggestion.snippet.description}
              </p>
            )}
            <div className="flex items-center mt-1">
              <SparklesIcon className="w-3 h-3 text-slate-400 mr-1" />
              <code className="text-xs text-slate-500 font-mono">
                {suggestion.trigger}
              </code>
            </div>
          </div>
        </div>
      </button>
    );
  }, [selectedIndex, handleSuggestionClick, setSelectedByIndex]);

  if (!isVisible || suggestions.length === 0) {
    return null;
  }

  const suggestionElement = (
    <div
      ref={containerRef}
      className={cn(
        'fixed z-50 bg-white border border-slate-200 rounded-lg shadow-lg',
        'max-w-sm w-80 max-h-64 overflow-y-auto',
        'animate-in fade-in-0 zoom-in-95 duration-200',
        className
      )}
      style={{
        left: position.x,
        top: position.y
      }}
      role="listbox"
      aria-label="Snippet suggestions"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 rounded-t-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-900">
            Snippet Suggestions
          </h3>
          <span className="text-xs text-slate-500">
            {suggestions.length} match{suggestions.length !== 1 ? 'es' : ''}
          </span>
        </div>
        <p className="text-xs text-slate-600 mt-1">
          Use ↑↓ to navigate, Enter to select, Esc to close
        </p>
      </div>

      {/* Suggestions List */}
      <div
        ref={navigationContainerRef}
        className="p-1"
        tabIndex={0}
      >
        {suggestions.map((suggestion, index) => renderSuggestion(suggestion, index))}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-slate-100 bg-slate-50 rounded-b-lg">
        <p className="text-xs text-slate-500">
          Type <code className="font-mono">/snippet-name</code> for quick access
        </p>
      </div>
    </div>
  );

  // Render as portal to ensure proper z-index
  return createPortal(suggestionElement, document.body);
};

export default SnippetTriggerSuggestions;
