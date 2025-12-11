import React, { useState, useCallback, useMemo } from 'react';
import {
  MagnifyingGlassIcon,
  CodeBracketSquareIcon,
  StarIcon,
  ClockIcon,
  FunnelIcon,
  ChevronDownIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loading } from '@/components/ui/Loading';
import { DragDropSnippet } from './DragDropSnippet';
import { useSnippets } from '@/hooks/useSnippets';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/utils/cn';
import type { Snippet } from '@/types/template';

interface SnippetPaletteProps {
  snippets: Snippet[];
  onDragStart: (snippet: Snippet) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  className?: string;
}

type TabType = 'all' | 'favorites' | 'recent';

interface SnippetPaletteState {
  activeTab: TabType;
  showFilters: boolean;
  expandedCategories: Set<string>;
  localSearchQuery: string;
}

export const SnippetPalette: React.FC<SnippetPaletteProps> = ({
  snippets,
  onDragStart,
  searchQuery,
  onSearchChange,
  className
}) => {
  const [state, setState] = useState<SnippetPaletteState>({
    activeTab: 'all',
    showFilters: false,
    expandedCategories: new Set(['General']),
    localSearchQuery: searchQuery
  });

  const {
    favorites,
    recentlyUsed,
    toggleFavorite
  } = useSnippets();

  const debouncedSearchQuery = useDebounce(state.localSearchQuery, 300);

  // Update parent search query when debounced value changes
  React.useEffect(() => {
    onSearchChange(debouncedSearchQuery);
  }, [debouncedSearchQuery, onSearchChange]);

  // Group snippets by category
  const categorizedSnippets = useMemo(() => {
    const categories = new Map<string, Snippet[]>();

    snippets.forEach(snippet => {
      // For now, we'll use a simple categorization
      // In a real implementation, this could be based on snippet metadata
      const category = snippet.description?.includes('email') ? 'Email' :
                      snippet.description?.includes('social') ? 'Social' :
                      snippet.description?.includes('header') ? 'Headers' :
                      snippet.description?.includes('footer') ? 'Footers' :
                      'General';

      if (!categories.has(category)) {
        categories.set(category, []);
      }
      categories.get(category)!.push(snippet);
    });

    // Sort categories and snippets within each category
    const sortedCategories = new Map();
    Array.from(categories.keys()).sort().forEach(category => {
      const categorySnippets = categories.get(category)!;
      categorySnippets.sort((a, b) => a.name.localeCompare(b.name));
      sortedCategories.set(category, categorySnippets);
    });

    return sortedCategories;
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

    // Apply search filter
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

    return filtered;
  }, [snippets, state.activeTab, favorites, recentlyUsed, debouncedSearchQuery]);

  const handleSearchChange = useCallback((value: string) => {
    setState(prev => ({ ...prev, localSearchQuery: value }));
  }, []);

  const handleTabChange = useCallback((tab: TabType) => {
    setState(prev => ({ ...prev, activeTab: tab }));
  }, []);

  const handleToggleFilters = useCallback(() => {
    setState(prev => ({ ...prev, showFilters: !prev.showFilters }));
  }, []);

  const handleToggleCategory = useCallback((category: string) => {
    setState(prev => {
      const newExpanded = new Set(prev.expandedCategories);
      if (newExpanded.has(category)) {
        newExpanded.delete(category);
      } else {
        newExpanded.add(category);
      }
      return { ...prev, expandedCategories: newExpanded };
    });
  }, []);

  const handleToggleFavorite = useCallback((snippetId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    toggleFavorite(snippetId);
  }, [toggleFavorite]);

  const renderSnippetsByCategory = () => {
    if (state.activeTab !== 'all' || debouncedSearchQuery) {
      // For non-category views, show flat list
      return (
        <div className="space-y-2">
          {filteredSnippets.map(snippet => (
            <DragDropSnippet
              key={snippet.id}
              snippet={snippet}
              onDragStart={onDragStart}
              isFavorite={favorites.includes(snippet.id)}
              onToggleFavorite={(event) => handleToggleFavorite(snippet.id, event)}
            />
          ))}
        </div>
      );
    }

    // Category view for 'all' tab
    const filteredCategories = new Map<string, Snippet[]>();
    categorizedSnippets.forEach((categorySnippets, category) => {
      const filtered = categorySnippets.filter((snippet: Snippet) =>
        filteredSnippets.includes(snippet)
      );
      if (filtered.length > 0) {
        filteredCategories.set(category, filtered);
      }
    });

    return (
      <div className="space-y-3">
        {Array.from(filteredCategories.entries()).map(([category, categorySnippets]) => (
          <div key={category} className="border border-slate-200 rounded-lg">
            <button
              onClick={() => handleToggleCategory(category)}
              className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center">
                {state.expandedCategories.has(category) ? (
                  <ChevronDownIcon className="w-4 h-4 text-slate-500 mr-2" />
                ) : (
                  <ChevronRightIcon className="w-4 h-4 text-slate-500 mr-2" />
                )}
                <span className="text-sm font-medium text-slate-700">{category}</span>
                <span className="ml-2 text-xs text-slate-500">({categorySnippets.length})</span>
              </div>
            </button>

            {state.expandedCategories.has(category) && (
              <div className="px-3 pb-3 space-y-2">
                {categorySnippets.map(snippet => (
                  <DragDropSnippet
                    key={snippet.id}
                    snippet={snippet}
                    onDragStart={onDragStart}
                    isFavorite={favorites.includes(snippet.id)}
                    onToggleFavorite={(event) => handleToggleFavorite(snippet.id, event)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-slate-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-900">Snippets</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleFilters}
            className="p-1"
          >
            <FunnelIcon className="w-4 h-4" />
          </Button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search snippets..."
            value={state.localSearchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10 text-sm"
          />
        </div>

        {/* Tabs */}
        {state.showFilters && (
          <div className="flex items-center gap-1">
            <Button
              variant={state.activeTab === 'all' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => handleTabChange('all')}
              className="flex items-center text-xs px-2 py-1"
            >
              <CodeBracketSquareIcon className="w-3 h-3 mr-1" />
              All
            </Button>
            <Button
              variant={state.activeTab === 'favorites' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => handleTabChange('favorites')}
              className="flex items-center text-xs px-2 py-1"
            >
              <StarIcon className="w-3 h-3 mr-1" />
              Favorites
            </Button>
            <Button
              variant={state.activeTab === 'recent' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => handleTabChange('recent')}
              className="flex items-center text-xs px-2 py-1"
            >
              <ClockIcon className="w-3 h-3 mr-1" />
              Recent
            </Button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {filteredSnippets.length === 0 ? (
          <div className="text-center py-8">
            <CodeBracketSquareIcon className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-600 mb-1">
              {state.activeTab === 'favorites' ? 'No favorite snippets' :
               state.activeTab === 'recent' ? 'No recent snippets' :
               debouncedSearchQuery ? 'No snippets found' : 'No snippets available'}
            </p>
            <p className="text-xs text-slate-500">
              {state.activeTab === 'favorites' ? 'Star snippets to add them here' :
               state.activeTab === 'recent' ? 'Used snippets will appear here' :
               debouncedSearchQuery ? 'Try different search terms' : 'Create snippets to get started'}
            </p>
          </div>
        ) : (
          renderSnippetsByCategory()
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 p-3 border-t border-slate-200 bg-slate-50">
        <div className="text-xs text-slate-600 text-center">
          {filteredSnippets.length} snippet{filteredSnippets.length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  );
};
