import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { EmptyState, SkeletonLoader } from '@/components/ui/LoadingStates';
import { snippetService } from '@/services/snippetService';
import { getUserFriendlyErrorMessage } from '@/utils/errorHandling';
import type { SnippetSummary } from '@/types/api';
import {
  PuzzlePieceIcon,
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

export function SnippetsListPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { showConfirmation, ConfirmationDialog } = useConfirmationDialog();

  const [snippets, setSnippets] = useState<SnippetSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadSnippets = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const response = await snippetService.listSnippets();
    if (response.success && response.data) {
      setSnippets(response.data.snippets);
    } else {
      setError(getUserFriendlyErrorMessage(response, 'snippet'));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadSnippets();
  }, [loadSnippets]);

  const handleDelete = async (snippet: SnippetSummary) => {
    try {
      await showConfirmation({
        title: 'Delete Snippet',
        description: `Are you sure you want to delete "${snippet.name}"? This action cannot be undone.`,
        confirmText: 'Delete Snippet',
        type: 'danger',
        isDestructive: true,
        onConfirm: async () => {
          setDeletingId(snippet.snippetId);
          const response = await snippetService.deleteSnippet(snippet.snippetId);
          if (response.success) {
            addToast({ type: 'success', title: 'Snippet deleted', message: `${snippet.name} was removed` });
            setSnippets((prev) => prev.filter((s) => s.snippetId !== snippet.snippetId));
          } else {
            throw new Error(getUserFriendlyErrorMessage(response, 'snippet'));
          }
        },
      });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to delete snippet', message: getUserFriendlyErrorMessage(err, 'snippet') });
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
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Snippets</h1>
              <p className="text-muted-foreground mt-2 text-sm sm:text-base">
                Create and manage reusable Handlebars partials referenced in templates as {'{{> name }}'}.
              </p>
            </div>
            <Button onClick={() => navigate('/snippets/new')}>
              <PlusIcon className="w-4 h-4 mr-2" />
              New snippet
            </Button>
          </div>

          {isLoading ? (
            <SkeletonLoader count={3} />
          ) : error ? (
            <ErrorDisplay
              title="Error loading snippets"
              message={error}
              severity="error"
              retryable
              onRetry={loadSnippets}
            />
          ) : snippets.length === 0 ? (
            <EmptyState
              title="No snippets yet"
              description="Create your first snippet to start building reusable partials."
              icon={<PuzzlePieceIcon className="w-12 h-12 text-muted-foreground" />}
              action={{ label: 'New snippet', onClick: () => navigate('/snippets/new') }}
            />
          ) : (
            <div className="space-y-3">
              {snippets.map((snippet) => (
                <div
                  key={snippet.snippetId}
                  className="bg-surface border border-border rounded-lg p-4 sm:p-6 flex items-center justify-between gap-4 hover:border-primary-200 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/snippets/${snippet.snippetId}/edit`)}
                    className="flex items-center gap-4 flex-1 min-w-0 text-left"
                  >
                    <div className="flex-shrink-0 w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                      <PuzzlePieceIcon className="w-5 h-5 text-primary-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-medium text-foreground truncate">{snippet.name}</h3>
                      </div>
                      {snippet.description && (
                        <p className="text-sm text-muted-foreground truncate mt-0.5">{snippet.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        Updated {new Date(snippet.updatedAt).toLocaleDateString()} · v{snippet.version}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/snippets/${snippet.snippetId}/edit`)}
                      title="Edit snippet"
                    >
                      <PencilSquareIcon className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(snippet)}
                      disabled={deletingId === snippet.snippetId}
                      isLoading={deletingId === snippet.snippetId}
                      className="text-error-600 hover:text-error-700 hover:bg-error-50"
                      title="Delete snippet"
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
