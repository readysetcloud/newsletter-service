import React, { useState, useEffect, useCallback } from 'react';
import {
  MagnifyingGlassIcon,
  PlusIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  FunnelIcon,
  CalendarIcon,
  CodeBracketIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loading } from '@/components/ui/Loading';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { ConfirmationDialog, useConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { templateService } from '@/services/templateService';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/utils/cn';
import type {
  Snippet,
  SnippetFilters,
  SnippetListState,
  Template
} from '@/types/template';

interface SnippetListProps {
  onCreateSnippet?: () => void;
  onEditSnippet?: (snippet: Snippet) => void;
  onPreviewSnippet?: (snippet: Snippet) => void;
  className?: string;
}

export const SnippetList: React.FC<SnippetListProps> = ({
  onCreateSnippet,
  onEditSnippet,
  onPreviewSnippet,
  className
}) => {
  const [state, setState] = useState<SnippetListState>({
    snippets: [],
    loading: true,
    filters: {},
    pagination: {
      page: 1,
      limit: 20,
      total: 0
    }
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [snippetUsage, setSnippetUsage] = useState<Record<string, Template[]>>({});

  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const { showConfirmation, ConfirmationDialog } = useConfirmationDialog();

  // Load snippets
  const loadSnippets = useCallback(async (filters?: SnippetFilters) => {
    setState(prev => ({ ...prev, loading: true, error: undefined }));

    try {
      const response = await templateService.getSnippets(filters);

      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          snippets: response.data!.snippets,
          loading: false,
          pagination: {
            ...prev.pagination,
            total: response.data!.total
          }
        }));

        // Load usage information for each snippet
        loadSnippetUsage(response.data.snippets);
      } else {
        setState(prev => ({
          ...prev,
          loading: false,
          error: response.error || 'Failed to load snippets'
        }));
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load snippets'
      }));
    }
  }, []);

  // Load snippet usage information
  const loadSnippetUsage = useCallback(async (snippets: Snippet[]) => {
    try {
      const usagePromises = snippets.map(async (snippet) => {
        const usage = await templateService.getSnippetUsage(snippet.id);
        return { snippetId: snippet.id, usage };
      });

      const usageResults = await Promise.all(usagePromises);
      const usageMap: Record<string, Template[]> = {};

      usageResults.forEach(({ snippetId, usage }) => {
        usageMap[snippetId] = usage;
      });

      setSnippetUsage(usageMap);
    } catch (error) {
      console.error('Error loading snippet usage:', error);
    }
  }, []);

  // Apply filters
  const applyFilters = useCallback(() => {
    const filters: SnippetFilters = {};

    if (debouncedSearchTerm) {
      filters.search = debouncedSearchTerm;
    }

    setState(prev => ({ ...prev, filters }));
    loadSnippets(filters);
  }, [debouncedSearchTerm, loadSnippets]);

  // Clear filters
  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setShowFilters(false);

    setState(prev => ({ ...prev, filters: {} }));
    loadSnippets();
  }, [loadSnippets]);

  // Delete snippet
  const handleDeleteSnippet = useCallback(async (snippet: Snippet) => {
    const usage = snippetUsage[snippet.id] || [];
    const hasUsage = usage.length > 0;

    try {
      await showConfirmation({
        title: 'Delete Snippet',
        description: hasUsage
          ? `This snippet is used by ${usage.length} template(s). Deleting it may break those templates.`
          : `Are you sure you want to delete "${snippet.name}"? This action cannot be undone.`,
        confirmText: 'Delete Snippet',
        type: 'danger',
        isDestructive: true,
        requireTextConfirmation: hasUsage,
        confirmationText: 'DELETE',
        consequences: hasUsage ? [
          `This snippet is used by ${usage.length} template(s)`,
          'Deleting it may break those templates',
          'The snippet will be permanently deleted',
          'This action cannot be undone'
        ] : [
          'The snippet will be permanently deleted',
          'All versions will be removed from storage',
          'This action cannot be undone'
        ],
        details: [
          { label: 'Snippet Name', value: snippet.name },
          { label: 'Created', value: new Date(snippet.createdAt).toLocaleDateString() },
          { label: 'Last Modified', value: new Date(snippet.updatedAt).toLocaleDateString() },
          ...(hasUsage ? [{ label: 'Used by Templates', value: usage.map(t => t.name).join(', ') }] : [])
        ],
        onConfirm: async () => {
          const response = await templateService.deleteSnippetWithRetry(snippet.id);
          if (response.success) {
            // Reload snippets after successful deletion
            loadSnippets(state.filters);
          } else {
            throw new Error(response.error || 'Failed to delete snippet');
          }
        }
      });
    } catch (error) {
      console.error('Error deleting snippet:', error);
    }
  }, [showConfirmation, loadSnippets, state.filters, snippetUsage]);

  // Format date
  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }, []);

  // Get parameter type badge color
  const getParameterTypeBadgeColor = useCallback((type: string) => {
    switch (type) {
      case 'string':
        return 'bg-blue-100 text-blue-800';
      case 'number':
        return 'bg-green-100 text-green-800';
      case 'boolean':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-slate-100 text-slate-800';
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadSnippets();
  }, [loadSnippets]);

  // Apply filters when they change
  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  if (state.loading && state.snippets.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loading size="lg" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Snippets</h1>
          <p className="text-slate-600 mt-1">
            Manage reusable template components and shortcodes
          </p>
        </div>

        {onCreateSnippet && (
          <Button onClick={onCreateSnippet} className="flex items-center">
            <PlusIcon className="w-4 h-4 mr-2" />
            Create Snippet
          </Button>
        )}
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search snippets..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Filter Toggle */}
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center"
            >
              <FunnelIcon className="w-4 h-4 mr-2" />
              Filters
              {searchTerm && (
                <span className="ml-2 bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                  1
                </span>
              )}
            </Button>
          </div>

          {/* Expanded Filters */}
          {showFilters && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              {/* Clear Filters */}
              {searchTerm && (
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear All Filters
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error Display */}
      {state.error && (
        <ErrorDisplay
          title="Error Loading Snippets"
          message={state.error}
          severity="error"
          retryable={true}
          onRetry={() => loadSnippets(state.filters)}
        />
      )}

      {/* Snippets Grid */}
      {state.snippets.length === 0 && !state.loading ? (
        <Card>
          <CardContent className="text-center py-12">
            <CodeBracketIcon className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-900 mb-2">
              No snippets found
            </h3>
            <p className="text-slate-600 mb-6">
              {Object.keys(state.filters).length > 0
                ? 'No snippets match your current filters. Try adjusting your search criteria.'
                : 'Get started by creating your first reusable snippet.'
              }
            </p>
            {onCreateSnippet && Object.keys(state.filters).length === 0 && (
              <Button onClick={onCreateSnippet}>
                <PlusIcon className="w-4 h-4 mr-2" />
                Create Your First Snippet
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {state.snippets.map((snippet) => {
            const usage = snippetUsage[snippet.id] || [];
            const hasUsage = usage.length > 0;

            return (
              <Card key={snippet.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate flex items-center">
                        <CodeBracketIcon className="w-5 h-5 mr-2 text-slate-500" />
                        {snippet.name}
                      </CardTitle>
                      {snippet.description && (
                        <p className="text-sm text-slate-600 mt-1 line-clamp-2">
                          {snippet.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Snippet Metadata */}
                  <div className="flex items-center gap-4 text-xs text-slate-500 mt-3">
                    <div className="flex items-center">
                      <CalendarIcon className="w-3 h-3 mr-1" />
                      {formatDate(snippet.updatedAt)}
                    </div>
                    {snippet.parameters && snippet.parameters.length > 0 && (
                      <div className="flex items-center">
                        <span>{snippet.parameters.length} parameter{snippet.parameters.length !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                  </div>

                  {/* Parameters */}
                  {snippet.parameters && snippet.parameters.length > 0 && (
                    <div className="mt-3">
                      <div className="flex flex-wrap gap-1">
                        {snippet.parameters.slice(0, 3).map(param => (
                          <span
                            key={param.name}
                            className={cn(
                              'inline-flex items-center px-2 py-1 text-xs rounded-full',
                              getParameterTypeBadgeColor(param.type)
                            )}
                          >
                            {param.name}
                            {param.required && <span className="ml-1 text-red-500">*</span>}
                          </span>
                        ))}
                        {snippet.parameters.length > 3 && (
                          <span className="inline-block px-2 py-1 text-xs bg-slate-100 text-slate-700 rounded-full">
                            +{snippet.parameters.length - 3} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Usage Information */}
                  {hasUsage && (
                    <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded-md">
                      <div className="flex items-center text-xs text-blue-800">
                        <InformationCircleIcon className="w-3 h-3 mr-1" />
                        Used by {usage.length} template{usage.length !== 1 ? 's' : ''}
                      </div>
                      <div className="text-xs text-blue-700 mt-1 truncate">
                        {usage.slice(0, 2).map(t => t.name).join(', ')}
                        {usage.length > 2 && ` +${usage.length - 2} more`}
                      </div>
                    </div>
                  )}
                </CardHeader>

                <CardContent className="pt-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {onPreviewSnippet && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onPreviewSnippet(snippet)}
                          className="flex items-center"
                        >
                          <EyeIcon className="w-4 h-4 mr-1" />
                          Preview
                        </Button>
                      )}

                      {onEditSnippet && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onEditSnippet(snippet)}
                          className="flex items-center"
                        >
                          <PencilIcon className="w-4 h-4 mr-1" />
                          Edit
                        </Button>
                      )}
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteSnippet(snippet)}
                      className={cn(
                        'hover:bg-red-50',
                        hasUsage
                          ? 'text-amber-600 hover:text-amber-700'
                          : 'text-red-600 hover:text-red-700'
                      )}
                      title={hasUsage ? 'This snippet is used by templates' : 'Delete snippet'}
                    >
                      {hasUsage ? (
                        <ExclamationTriangleIcon className="w-4 h-4" />
                      ) : (
                        <TrashIcon className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Loading overlay for refresh */}
      {state.loading && state.snippets.length > 0 && (
        <div className="fixed inset-0 bg-black bg-opacity-10 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 shadow-lg">
            <Loading size="sm" />
            <p className="text-sm text-slate-600 mt-2">Updating snippets...</p>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmationDialog />
    </div>
  );
};
