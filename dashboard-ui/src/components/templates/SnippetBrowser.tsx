import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  MagnifyingGlassIcon,
  XMarkIcon,
  FunnelIcon,
  ViewColumnsIcon,
  Squares2X2Icon,
  StarIcon,
  ClockIcon,
  CodeBracketIcon
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loading } from '@/components/ui/Loading';
import { Modal } from '@/components/ui/Modal';
import { LazySnippetCard } from './LazySnippetCard';
import { SnippetFilters } from './SnippetFilters';
import { VirtualizedList } from './VirtualizedList';
import { ParameterConfigDialog } from './ParameterConfigDialog';
import { useSnippets } from '@/hooks/useSnippets';
import { useDebounce } from '@/hooks/useDebounce';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useFocusManagement } from '@/hooks/useFocusManagement';
import { cn } from '@/utils/cn';
import type { Snippet } from '@/types/template';

interface SnippetBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (snippet: Snippet, parameters: Record<string, any>) => void;
  searchQuery?: string;
  selectedCategory?: string;
  className?: string;
}

type ViewMode = 'grid' | 'list';
type TabType = 'all' | 'favorites' | 'recent';

interface SnippetBrowserState {
  searchQuery: string;
  selectedCategory: string;
  viewMode: ViewMode;
  activeTab: TabType;
  showFilters: boolean;
  selectedSnippet: Snippet | null;
  showParameterDialog: boolean;
}

export const SnippetBrowser: React.FC<SnippetBrowserProps> = ({
  isOpen,
  onClose,
  onInsert,
  searchQuery: initialSearchQuery = '',
  selectedCategory: initialSelectedCategory = '',
  className
}) => {
  const [state, setState] = useState<SnippetBrowserState>({
    searchQuery: initialSearchQuery,
    selectedCategory: initialSelectedCategory,
    viewMode: 'grid',
    activeTab: 'all',
    showFilters: false,
    selectedSnippet: null,
    showParameterDialog: false
  });

  // Refs for keyboard navigation and focus management
  const searchInputRef = useRef<HTMLInputElement>(null);
  const snippetGridRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const {
    snippets,
    loading,
    error,
    favorites,
    recentlyUsed,
    toggleFavorite,
    addToHistory,
    setSearchQuery
  } = useSnippets();

  const debouncedSearchQuery = useDebounce(state.searchQuery, 300);

  // Update search query in hook when debounced value changes
  React.useEffect(() => {
    setSearchQuery(debouncedSearchQuery);
  }, [debouncedSearchQuery, setSearchQuery]);

  // Focus management
  const { containerRef: focusContainerRef, focusFirst, focusLast } = useFocusManagement({
    trapFocus: isOpen,
    restoreFocus: true,
    autoFocus: isOpen
  });

  // Get categories from snippets
  const categories = useMemo(() => {
    const categorySet = new Set<string>();
    snippets.forEach(snippet => {
      if (snippet.description) {
        // Extract categories from description or use a category field if available
        // For now, we'll use a simple approach
        categorySet.add('General');
      }
    });
    return Array.from(categorySet);
  }, [snippets]);

  // Filter snippets based on current state
  const filteredSnippets = useMemo(() => {
    let filtered = snippets;

    // Apply tab filter
    switch (state.activeTab) {
      case 'favorites':
        filtered = filtered.filter(snippet => favorites.includes(snippet.id));
        break;
      case 'recent':
        const recentIds = recentlyUsed.map(usage => usage.snippetId);
        filtered = filtered.filter(snippet => recentIds.includes(snippet.id));
        // Sort by most recent usage
        filtered.sort((a, b) => {
          const aUsage = recentlyUsed.find(usage => usage.snippetId === a.id);
          const bUsage = recentlyUsed.find(usage => usage.snippetId === b.id);
          if (!aUsage || !bUsage) return 0;
          return new Date(bUsage.timestamp).getTime() - new Date(aUsage.timestamp).getTime();
        });
        break;
      default:
        // 'all' - no additional filtering
        break;
    }

    // Apply search filter (already handled by useSnippets hook)
    if (debouncedSearchQuery) {
      const query = debouncedSearchQuery.toLowerCase();
      filtered = filtered.filter(snippet =>
        snippet.name.toLowerCase().includes(query) ||
        (snippet.description && snippet.description.toLowerCase().includes(query)) ||
        (snippet.parameters && snippet.parameters.some(param =>
          param.name.toLowerCase().includes(query) ||
          (param.description && param.description.toLowerCase().includes(query))
        ))
      );
    }

    // Apply category filter
    if (state.selectedCategory && state.selectedCategory !== 'all') {
      // For now, we'll implement a simple category filter
      // In a real implementation, this would be based on actual category data
      filtered = filtered.filter(snippet => {
        // Placeholder category logic
        return true;
      });
    }

    return filtered;
  }, [snippets, state.activeTab, state.selectedCategory, favorites, recentlyUsed, debouncedSearchQuery]);

  // Keyboard navigation for snippet grid
  const navigationItems = useMemo(() => {
    return filteredSnippets.map((snippet, index) => ({
      id: snippet.id,
      focusable: true
    }));
  }, [filteredSnippets]);

  const {
    containerRef: navigationContainerRef,
    selectedIndex,
    selectedId,
    setSelectedByIndex,
    clearSelection
  } = useKeyboardNavigation({
    items: navigationItems,
    orientation: state.viewMode === 'grid' ? 'both' : 'vertical',
    loop: true,
    onActivate: (snippetId) => {
      const snippet = filteredSnippets.find(s => s.id === snippetId);
      if (snippet) {
        handleSnippetSelect(snippet, {});
      }
    }
  });

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      shortcut: { key: 'Escape' },
      handler: () => {
        if (state.showParameterDialog) {
          handleParameterDialogCancel();
        } else {
          onClose();
        }
      },
      description: 'Close dialog'
    },
    {
      shortcut: { key: 'f', ctrlKey: true },
      handler: (e) => {
        e.preventDefault();
        searchInputRef.current?.focus();
      },
      description: 'Focus search'
    },
    {
      shortcut: { key: '/', ctrlKey: false },
      handler: (e) => {
        // Only trigger if not already in an input
        if (document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
      },
      description: 'Quick search'
    },
    {
      shortcut: { key: 'Enter' },
      handler: (e) => {
        if (selectedId && !state.showParameterDialog) {
          e.preventDefault();
          const snippet = filteredSnippets.find(s => s.id === selectedId);
          if (snippet) {
            handleSnippetSelect(snippet, {});
          }
        }
      },
      description: 'Insert selected snippet'
    },
    {
      shortcut: { key: 'Tab' },
      handler: (e) => {
        // Handle tab navigation between sections
        const activeElement = document.activeElement;
        if (activeElement === searchInputRef.current && !e.shiftKey) {
          e.preventDefault();
          // Focus first tab button
          const firstTab = tabsRef.current?.querySelector('button');
          firstTab?.focus();
        }
      },
      description: 'Navigate between sections'
    }
  ], { enabled: isOpen });

  // Auto-focus search input when dialog opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      // Small delay to ensure modal is fully rendered
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Clear selection when filtered snippets change
  useEffect(() => {
    clearSelection();
  }, [filteredSnippets, clearSelection]);

  const handleSearchChange = useCallback((value: string) => {
    setState(prev => ({ ...prev, searchQuery: value }));
  }, []);

  const handleCategoryChange = useCallback((category: string) => {
    setState(prev => ({ ...prev, selectedCategory: category }));
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setState(prev => ({ ...prev, viewMode: mode }));
  }, []);

  const handleTabChange = useCallback((tab: TabType) => {
    setState(prev => ({ ...prev, activeTab: tab }));
  }, []);

  const handleToggleFilters = useCallback(() => {
    setState(prev => ({ ...prev, showFilters: !prev.showFilters }));
  }, []);

  const handleSnippetSelect = useCallback((snippet: Snippet, parameters: Record<string, any>) => {
    // If snippet has parameters and no parameters provided, show parameter dialog
    if (snippet.parameters && snippet.parameters.length > 0 && Object.keys(parameters).length === 0) {
      setState(prev => ({
        ...prev,
        selectedSnippet: snippet,
        showParameterDialog: true
      }));
    } else {
      // Insert directly with provided parameters or no parameters
      handleSnippetInsert(snippet, parameters);
    }
  }, []);

  const handleSnippetInsert = useCallback((snippet: Snippet, parameters: Record<string, any>) => {
    // Add to history
    addToHistory({
      snippetId: snippet.id,
      parameters,
      timestamp: new Date()
    });

    // Call the parent insert handler
    onInsert(snippet, parameters);
  }, [addToHistory, onInsert]);

  const handleParameterDialogConfirm = useCallback((parameters: Record<string, any>) => {
    if (state.selectedSnippet) {
      handleSnippetInsert(state.selectedSnippet, parameters);
      setState(prev => ({
        ...prev,
        selectedSnippet: null,
        showParameterDialog: false
      }));
    }
  }, [state.selectedSnippet, handleSnippetInsert]);

  const handleParameterDialogCancel = useCallback(() => {
    setState(prev => ({
      ...prev,
      selectedSnippet: null,
      showParameterDialog: false
    }));
  }, []);

  const handleToggleFavorite = useCallback((snippetId: string) => {
    toggleFavorite(snippetId);
  }, [toggleFavorite]);

  const clearFilters = useCallback(() => {
    setState(prev => ({
      ...prev,
      searchQuery: '',
      selectedCategory: '',
      activeTab: 'all'
    }));
  }, []);

  // Calculate item height based on view mode
  const itemHeight = state.viewMode === 'grid' ? 200 : 120;
  const containerHeight = 600; // Fixed height for virtualization

  const renderSnippetItem = useCallback((snippet: Snippet, index: number) => {
    return (
      <div className={cn(
        'p-2',
        state.viewMode === 'grid' ? 'w-full' : 'w-full'
      )}>
        <LazySnippetCard
          snippet={snippet}
          viewMode={state.viewMode}
          isFavorite={favorites.includes(snippet.id)}
          onInsert={handleSnippetSelect}
          onToggleFavorite={handleToggleFavorite}
          showPreview={true}
        />
      </div>
    );
  }, [state.viewMode, favorites, handleSnippetSelect, handleToggleFavorite]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
    >
      <div
        ref={focusContainerRef as React.RefObject<HTMLDivElement>}
        className="flex flex-col h-full max-h-[80vh]"
        role="dialog"
        aria-labelledby="snippet-browser-title"
        aria-describedby="snippet-browser-description"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div>
            <h2 id="snippet-browser-title" className="text-xl font-semibold text-slate-900">
              Snippet Browser
            </h2>
            <p id="snippet-browser-description" className="text-sm text-slate-600 mt-1">
              Browse and insert reusable snippets into your template. Use arrow keys to navigate, Enter to select.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded"
            aria-label="Close snippet browser"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>
        {/* Header */}
        <div className="flex-shrink-0 p-6 border-b border-slate-200">
          {/* Search Bar */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex-1 relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                ref={searchInputRef}
                placeholder="Search snippets... (Press / for quick search)"
                value={state.searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10"
                aria-label="Search snippets"
                aria-describedby="search-help"
              />
              <div id="search-help" className="sr-only">
                Type to search snippets by name, description, or parameters. Press / to focus this field.
              </div>
            </div>

            <Button
              variant="outline"
              onClick={handleToggleFilters}
              className="flex items-center"
              aria-expanded={state.showFilters}
              aria-controls="snippet-filters"
            >
              <FunnelIcon className="w-4 h-4 mr-2" />
              Filters
            </Button>

            <div
              className="flex items-center border border-slate-200 rounded-lg"
              role="group"
              aria-label="View mode selection"
            >
              <Button
                variant={state.viewMode === 'grid' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => handleViewModeChange('grid')}
                className="rounded-r-none border-r"
                aria-label="Grid view"
                aria-pressed={state.viewMode === 'grid'}
              >
                <Squares2X2Icon className="w-4 h-4" />
              </Button>
              <Button
                variant={state.viewMode === 'list' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => handleViewModeChange('list')}
                className="rounded-l-none"
                aria-label="List view"
                aria-pressed={state.viewMode === 'list'}
              >
                <ViewColumnsIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div
            ref={tabsRef}
            className="flex items-center gap-1"
            role="tablist"
            aria-label="Snippet categories"
          >
            <Button
              variant={state.activeTab === 'all' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => handleTabChange('all')}
              className="flex items-center"
              role="tab"
              aria-selected={state.activeTab === 'all'}
              aria-controls="snippet-content"
              id="tab-all"
            >
              <CodeBracketIcon className="w-4 h-4 mr-2" />
              All ({snippets.length})
            </Button>
            <Button
              variant={state.activeTab === 'favorites' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => handleTabChange('favorites')}
              className="flex items-center"
              role="tab"
              aria-selected={state.activeTab === 'favorites'}
              aria-controls="snippet-content"
              id="tab-favorites"
            >
              <StarIcon className="w-4 h-4 mr-2" />
              Favorites ({favorites.length})
            </Button>
            <Button
              variant={state.activeTab === 'recent' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => handleTabChange('recent')}
              className="flex items-center"
              role="tab"
              aria-selected={state.activeTab === 'recent'}
              aria-controls="snippet-content"
              id="tab-recent"
            >
              <ClockIcon className="w-4 h-4 mr-2" />
              Recent ({recentlyUsed.length})
            </Button>
          </div>

          {/* Filters Panel */}
          {state.showFilters && (
            <div
              id="snippet-filters"
              className="mt-4 pt-4 border-t border-slate-200"
              role="region"
              aria-label="Snippet filters"
            >
              <SnippetFilters
                categories={categories}
                selectedCategory={state.selectedCategory}
                onCategoryChange={handleCategoryChange}
                onClearFilters={clearFilters}
              />
            </div>
          )}
        </div>

        {/* Content */}
        <div
          className="flex-1 overflow-hidden"
          role="tabpanel"
          aria-labelledby={`tab-${state.activeTab}`}
          id="snippet-content"
        >
          {loading ? (
            <div className="flex items-center justify-center h-64" role="status" aria-label="Loading snippets">
              <Loading size="lg" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-64" role="alert">
              <div className="text-center">
                <p className="text-red-600 mb-2">Error loading snippets</p>
                <p className="text-slate-600 text-sm">{error}</p>
              </div>
            </div>
          ) : filteredSnippets.length === 0 ? (
            <div className="flex items-center justify-center h-64" role="status">
              <div className="text-center">
                <CodeBracketIcon className="w-12 h-12 text-slate-400 mx-auto mb-4" aria-hidden="true" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">
                  {state.activeTab === 'favorites' ? 'No favorite snippets' :
                   state.activeTab === 'recent' ? 'No recent snippets' :
                   state.searchQuery ? 'No snippets found' : 'No snippets available'}
                </h3>
                <p className="text-slate-600">
                  {state.activeTab === 'favorites' ? 'Star snippets to add them to your favorites' :
                   state.activeTab === 'recent' ? 'Recently used snippets will appear here' :
                   state.searchQuery ? 'Try adjusting your search terms' : 'Create your first snippet to get started'}
                </p>
              </div>
            </div>
          ) : (
            <div className="p-6">
              {state.viewMode === 'grid' ? (
                <div
                  ref={navigationContainerRef as React.RefObject<HTMLDivElement>}
                  className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                  role="grid"
                  aria-label={`${filteredSnippets.length} snippets in ${state.viewMode} view`}
                  tabIndex={0}
                >
                  {filteredSnippets.map((snippet, index) => (
                    <div
                      key={snippet.id}
                      role="gridcell"
                      className={cn(
                        'focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 rounded-lg',
                        selectedIndex === index && 'ring-2 ring-blue-500 ring-offset-2'
                      )}
                    >
                      {renderSnippetItem(snippet, index)}
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  ref={navigationContainerRef as React.RefObject<HTMLDivElement>}
                  role="listbox"
                  aria-label={`${filteredSnippets.length} snippets in list view`}
                  tabIndex={0}
                >
                  <VirtualizedList
                    items={filteredSnippets}
                    itemHeight={itemHeight}
                    containerHeight={containerHeight}
                    renderItem={(snippet, index) => (
                      <div
                        role="option"
                        aria-selected={selectedIndex === index}
                        className={cn(
                          'focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 rounded-lg',
                          selectedIndex === index && 'ring-2 ring-blue-500 ring-offset-2'
                        )}
                      >
                        {renderSnippetItem(snippet, index)}
                      </div>
                    )}
                    className="w-full"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 p-6 border-t border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-600" role="status" aria-live="polite">
              {filteredSnippets.length} snippet{filteredSnippets.length !== 1 ? 's' : ''} found
              {selectedId && (
                <span className="ml-2">
                  • Use arrow keys to navigate, Enter to select, Escape to close
                </span>
              )}
            </div>
            <Button
              variant="outline"
              onClick={onClose}
              aria-label="Close snippet browser (Escape)"
            >
              Close
            </Button>
          </div>
        </div>
      </div>

      {/* Parameter Configuration Dialog */}
      <ParameterConfigDialog
        snippet={state.selectedSnippet}
        isOpen={state.showParameterDialog}
        onConfirm={handleParameterDialogConfirm}
        onCancel={handleParameterDialogCancel}
      />
    </Modal>
  );
};
