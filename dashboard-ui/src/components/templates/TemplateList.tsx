import React, { useState, useEffect, useCallback } from 'react';
import {
  MagnifyingGlassIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  FunnelIcon,
  CalendarIcon,
  DocumentTextIcon,
  ClockIcon
} from '@heroicons/react/24/outline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Loading } from '@/components/ui/Loading';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { ConfirmationDialog, useConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { templateService } from '@/services/templateService';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/utils/cn';
import type {
  Template,
  TemplateFilters,
  TemplateListState
} from '@/types/template';

interface TemplateListProps {
  onEditTemplate?: (template: Template) => void;
  onPreviewTemplate?: (template: Template) => void;
  onViewVersionHistory?: (template: Template) => void;
  className?: string;
}

export const TemplateList: React.FC<TemplateListProps> = ({
  onEditTemplate,
  onPreviewTemplate,
  onViewVersionHistory,
  className
}) => {
  const [state, setState] = useState<TemplateListState>({
    templates: [],
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

  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const { showConfirmation, ConfirmationDialog } = useConfirmationDialog();

  // Load templates
  const loadTemplates = useCallback(async (filters?: TemplateFilters) => {
    setState(prev => ({ ...prev, loading: true, error: undefined }));

    try {
      const response = await templateService.getTemplates(filters);

      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          templates: response.data!.templates,
          loading: false,
          pagination: {
            ...prev.pagination,
            total: response.data!.total
          }
        }));
      } else {
        setState(prev => ({
          ...prev,
          loading: false,
          error: response.error || 'Failed to load templates'
        }));
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load templates'
      }));
    }
  }, []);



  // Apply filters
  const applyFilters = useCallback(() => {
    const filters: TemplateFilters = {};

    if (debouncedSearchTerm) {
      filters.search = debouncedSearchTerm;
    }



    setState(prev => ({ ...prev, filters }));
    loadTemplates(filters);
  }, [debouncedSearchTerm, loadTemplates]);

  // Clear filters
  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setShowFilters(false);

    setState(prev => ({ ...prev, filters: {} }));
    loadTemplates();
  }, [loadTemplates]);

  // Delete template
  const handleDeleteTemplate = useCallback(async (template: Template) => {
    try {
      await showConfirmation({
        title: 'Delete Template',
        description: `Are you sure you want to delete "${template.name}"? This action cannot be undone.`,
        confirmText: 'Delete Template',
        type: 'danger',
        isDestructive: true,
        requireTextConfirmation: true,
        confirmationText: 'DELETE',
        consequences: [
          'The template will be permanently deleted',
          'All versions will be removed from storage',
          'This action cannot be undone'
        ],
        details: [
          { label: 'Template Name', value: template.name },
          { label: 'Created', value: new Date(template.createdAt).toLocaleDateString() },
          { label: 'Last Modified', value: new Date(template.updatedAt).toLocaleDateString() }
        ],
        onConfirm: async () => {
          const response = await templateService.deleteTemplateWithRetry(template.id);
          if (response.success) {
            // Reload templates after successful deletion
            loadTemplates(state.filters);
          } else {
            throw new Error(response.error || 'Failed to delete template');
          }
        }
      });
    } catch (error) {
      console.error('Error deleting template:', error);
    }
  }, [showConfirmation, loadTemplates, state.filters]);



  // Format date
  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }, []);

  // Initial load
  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // Apply filters when they change
  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  if (state.loading && state.templates.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loading size="lg" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>

      {/* Search and Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search templates..."
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
            </Button>
          </div>

          {/* Clear Filters */}
          {showFilters && searchTerm && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear Search
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error Display */}
      {state.error && (
        <ErrorDisplay
          title="Error Loading Templates"
          message={state.error}
          severity="error"
          retryable={true}
          onRetry={() => loadTemplates(state.filters)}
        />
      )}

      {/* Templates Grid */}
      {state.templates.length === 0 && !state.loading ? (
        <Card>
          <CardContent className="text-center py-12">
            <DocumentTextIcon className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-900 mb-2">
              No templates found
            </h3>
            <p className="text-slate-600">
              {Object.keys(state.filters).length > 0
                ? 'No templates match your current filters. Try adjusting your search criteria.'
                : 'Get started by creating your first newsletter template using the Create Template button above.'
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {state.templates.map((template) => (
            <Card key={template.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg truncate">
                      {template.name}
                    </CardTitle>
                    {template.description && (
                      <p className="text-sm text-slate-600 mt-1 line-clamp-2">
                        {template.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Template Metadata */}
                <div className="flex items-center gap-4 text-xs text-slate-500 mt-3">
                  <div className="flex items-center">
                    <CalendarIcon className="w-3 h-3 mr-1" />
                    {formatDate(template.updatedAt)}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {onPreviewTemplate && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onPreviewTemplate(template)}
                        className="flex items-center"
                      >
                        <EyeIcon className="w-4 h-4 mr-1" />
                        Preview
                      </Button>
                    )}

                    {onEditTemplate && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onEditTemplate(template)}
                        className="flex items-center"
                      >
                        <PencilIcon className="w-4 h-4 mr-1" />
                        Edit
                      </Button>
                    )}

                    {onViewVersionHistory && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onViewVersionHistory(template)}
                        className="flex items-center"
                      >
                        <ClockIcon className="w-4 h-4 mr-1" />
                        History
                      </Button>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteTemplate(template)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Loading overlay for refresh */}
      {state.loading && state.templates.length > 0 && (
        <div className="fixed inset-0 bg-black bg-opacity-10 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 shadow-lg">
            <Loading size="sm" />
            <p className="text-sm text-slate-600 mt-2">Updating templates...</p>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmationDialog />
    </div>
  );
};
