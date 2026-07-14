import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { EmptyState, SkeletonLoader } from '@/components/ui/LoadingStates';
import { templateService } from '@/services/templateService';
import { getUserFriendlyErrorMessage } from '@/utils/errorHandling';
import type { TemplateSummary } from '@/types/api';
import {
  DocumentDuplicateIcon,
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

export function TemplatesListPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { showConfirmation, ConfirmationDialog } = useConfirmationDialog();

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const response = await templateService.listTemplates();
    if (response.success && response.data) {
      setTemplates(response.data.templates);
    } else {
      setError(getUserFriendlyErrorMessage(response, 'template'));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleDelete = async (template: TemplateSummary) => {
    try {
      await showConfirmation({
        title: 'Delete Template',
        description: `Are you sure you want to delete "${template.name}"? This action cannot be undone.`,
        confirmText: 'Delete Template',
        type: 'danger',
        isDestructive: true,
        onConfirm: async () => {
          setDeletingId(template.templateId);
          const response = await templateService.deleteTemplate(template.templateId);
          if (response.success) {
            addToast({ type: 'success', title: 'Template deleted', message: `${template.name} was removed` });
            setTemplates((prev) => prev.filter((t) => t.templateId !== template.templateId));
          } else {
            throw new Error(getUserFriendlyErrorMessage(response, 'template'));
          }
        },
      });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to delete template', message: getUserFriendlyErrorMessage(err, 'template') });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-6 sm:mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Templates</h1>
              <p className="text-muted-foreground mt-2 text-sm sm:text-base">
                Create and manage reusable Handlebars templates for your emails.
              </p>
            </div>
            <Button onClick={() => navigate('/templates/new')}>
              <PlusIcon className="w-4 h-4 mr-2" />
              New template
            </Button>
          </div>

          {isLoading ? (
            <SkeletonLoader count={3} />
          ) : error ? (
            <ErrorDisplay
              title="Error loading templates"
              message={error}
              severity="error"
              retryable
              onRetry={loadTemplates}
            />
          ) : templates.length === 0 ? (
            <EmptyState
              title="No templates yet"
              description="Create your first template to start building reusable emails."
              icon={<DocumentDuplicateIcon className="w-12 h-12 text-muted-foreground" />}
              action={<Button onClick={() => navigate('/templates/new')}>New template</Button>}
            />
          ) : (
            <div className="space-y-3">
              {templates.map((template) => (
                <div
                  key={template.templateId}
                  className="bg-surface border border-border rounded-lg p-4 sm:p-6 flex items-center justify-between gap-4 hover:border-primary-200 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/templates/${template.templateId}/edit`)}
                    className="flex items-center gap-4 flex-1 min-w-0 text-left"
                  >
                    <div className="flex-shrink-0 w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                      <DocumentDuplicateIcon className="w-5 h-5 text-primary-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-medium text-foreground truncate">{template.name}</h3>
                        {template.category && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                            {template.category}
                          </span>
                        )}
                      </div>
                      {template.description && (
                        <p className="text-sm text-muted-foreground truncate mt-0.5">{template.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        Updated {new Date(template.updatedAt).toLocaleDateString()} · v{template.version}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/templates/${template.templateId}/edit`)}
                      title="Edit template"
                    >
                      <PencilSquareIcon className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(template)}
                      disabled={deletingId === template.templateId}
                      isLoading={deletingId === template.templateId}
                      className="text-error-600 hover:text-error-700 hover:bg-error-50"
                      title="Delete template"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <ConfirmationDialog />
    </div>
  );
}
