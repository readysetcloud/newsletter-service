import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash, RefreshCw } from 'lucide-react';
import { AppHeader } from '../../components/layout/AppHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { IssueStatusBadge } from '../../components/issues/IssueStatusBadge';
import { MarkdownPreview } from '../../components/issues/MarkdownPreview';
import { DeleteIssueDialog } from '../../components/issues/DeleteIssueDialog';
import { issuesService } from '../../services/issuesService';
import type { Issue } from '../../types/issues';

export const IssueDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [issue, setIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const loadIssue = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);

      const response = await issuesService.getIssue(id);

      if (response.success && response.data) {
        setIssue(response.data);
      } else {
        const errorMsg = response.error || 'Failed to load issue';
        if (errorMsg.includes('404') || errorMsg.includes('not found')) {
          setError('Issue not found');
        } else if (errorMsg.includes('403') || errorMsg.includes('Access denied')) {
          setError('You do not have permission to view this issue');
        } else {
          setError(errorMsg);
        }
      }
    } catch (err) {
      console.error('Error loading issue:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to load issue';
      if (errorMsg.includes('404') || errorMsg.includes('not found')) {
        setError('Issue not found');
      } else if (errorMsg.includes('403') || errorMsg.includes('Access denied')) {
        setError('You do not have permission to view this issue');
      } else {
        setError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) {
      loadIssue();
    }
  }, [id, loadIssue]);

  const handleDelete = useCallback(async () => {
    if (!issue) return;

    try {
      const response = await issuesService.deleteIssue(issue.id);

      if (response.success) {
        navigate('/issues', { state: { message: 'Issue deleted successfully' } });
      } else {
        const errorMsg = response.error || 'Failed to delete issue';
        if (errorMsg.includes('409') || errorMsg.includes('Conflict') || errorMsg.includes('cannot be modified')) {
          setError('This issue cannot be deleted because it has already been published or scheduled');
        } else if (errorMsg.includes('404') || errorMsg.includes('not found')) {
          setError('Issue not found. It may have already been deleted');
        } else if (errorMsg.includes('403') || errorMsg.includes('Access denied')) {
          setError('You do not have permission to delete this issue');
        } else {
          setError(errorMsg);
        }
        setDeleteDialogOpen(false);
      }
    } catch (err) {
      console.error('Error deleting issue:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete issue';
      setError(errorMsg);
      setDeleteDialogOpen(false);
    }
  }, [issue, navigate]);

  const handleEdit = useCallback(() => {
    if (issue) {
      navigate(`/issues/${issue.id}/edit`);
    }
  }, [issue, navigate]);

  const handleBack = useCallback(() => {
    navigate('/issues');
  }, [navigate]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatPercentage = (value: number, total: number) => {
    if (total === 0) return '0%';
    return `${((value / total) * 100).toFixed(1)}%`;
  };

  const isDraft = useMemo(() => issue?.status === 'draft', [issue?.status]);
  const isPublished = useMemo(() => issue?.status === 'published', [issue?.status]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div role="status" aria-live="polite" aria-label="Loading issue details">
            <span className="sr-only">Loading issue details...</span>
          {/* Back Button Skeleton */}
          <div className="mb-6">
            <div className="h-9 w-32 bg-muted rounded animate-pulse" />
          </div>

          {/* Header Card Skeleton */}
          <Card className="mb-6">
            <CardContent className="py-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="h-9 w-96 bg-muted rounded animate-pulse" />
                    <div className="h-6 w-20 bg-muted rounded-full animate-pulse" />
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <div className="h-4 w-24 bg-muted rounded animate-pulse" />
                    <div className="h-4 w-4 bg-muted rounded-full animate-pulse" />
                    <div className="h-4 w-40 bg-muted rounded animate-pulse" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="h-9 w-20 bg-muted rounded animate-pulse" />
                  <div className="h-9 w-24 bg-muted rounded animate-pulse" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Content Card Skeleton */}
          <Card className="mb-6">
            <CardHeader>
              <div className="h-6 w-24 bg-muted rounded animate-pulse" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="h-4 w-full bg-muted rounded animate-pulse" />
                <div className="h-4 w-full bg-muted rounded animate-pulse" />
                <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
                <div className="h-4 w-full bg-muted rounded animate-pulse" />
                <div className="h-4 w-5/6 bg-muted rounded animate-pulse" />
                <div className="h-4 w-full bg-muted rounded animate-pulse" />
                <div className="h-4 w-2/3 bg-muted rounded animate-pulse" />
              </div>
            </CardContent>
          </Card>

          {/* Stats Card Skeleton */}
          <Card>
            <CardHeader>
              <div className="h-6 w-48 bg-muted rounded animate-pulse" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="bg-muted rounded-lg p-4 space-y-2">
                    <div className="h-8 w-16 bg-muted-foreground/20 rounded animate-pulse" />
                    <div className="h-4 w-20 bg-muted-foreground/20 rounded animate-pulse" />
                    <div className="h-3 w-12 bg-muted-foreground/20 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          </div>
        </main>
      </div>
    );
  }

  if (error || !issue) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="py-12">
              <div role="alert" aria-live="assertive" className="text-center">
                <h2 className="text-2xl font-semibold text-foreground mb-2">
                  {error === 'Issue not found' ? 'Issue Not Found' :
                   error === 'You do not have permission to view this issue' ? 'Access Denied' :
                   'Error Loading Issue'}
                </h2>
                <p className="text-muted-foreground mb-6">
                  {error || 'The issue you are looking for could not be found.'}
                </p>
                <div className="flex justify-center gap-3">
                  <Button onClick={handleBack} variant="outline" aria-label="Back to issues list">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Issues
                  </Button>
                  {error !== 'Issue not found' && error !== 'You do not have permission to view this issue' && (
                    <Button onClick={loadIssue} aria-label="Retry loading issue">
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Try Again
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main id="main-content" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back Button */}
        <div className="mb-6">
          <Button onClick={handleBack} variant="ghost" size="sm" aria-label="Back to issues list">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Issues
          </Button>
        </div>

        {/* Issue Header */}
        <Card className="mb-6 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="py-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h1 className="text-2xl sm:text-3xl font-bold text-foreground break-words">{issue.title}</h1>
                  <IssueStatusBadge status={issue.status} />
                </div>
                <div className="flex flex-wrap gap-2 sm:gap-4 text-sm text-muted-foreground">
                  <span className="font-medium">Issue #{issue.issueNumber}</span>
                  <span className="hidden sm:inline">•</span>
                  <span>Created {formatDate(issue.createdAt)}</span>
                  {issue.publishedAt && (
                    <>
                      <span className="hidden sm:inline">•</span>
                      <span className="text-success-600 dark:text-success-400 font-medium">Published {formatDate(issue.publishedAt)}</span>
                    </>
                  )}
                  {issue.scheduledAt && !issue.publishedAt && (
                    <>
                      <span className="hidden sm:inline">•</span>
                      <span className="text-blue-600 dark:text-blue-400 font-medium">Scheduled for {formatDate(issue.scheduledAt)}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              {isDraft && (
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    onClick={handleEdit}
                    variant="outline"
                    size="sm"
                    aria-label="Edit this issue"
                    className="hover:bg-primary-50 hover:border-primary-300 dark:hover:bg-primary-900/20 transition-colors"
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">Edit</span>
                  </Button>
                  <Button
                    onClick={() => setDeleteDialogOpen(true)}
                    variant="destructive"
                    size="sm"
                    aria-label="Delete this issue"
                    className="hover:bg-error-700 transition-colors"
                  >
                    <Trash className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">Delete</span>
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Issue Content */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Content</CardTitle>
          </CardHeader>
          <CardContent>
            <MarkdownPreview content={issue.content} />
          </CardContent>
        </Card>

        {/* Stats Section (for published issues) */}
        {isPublished && issue.stats && (
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Performance Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                <div className="bg-muted/50 hover:bg-muted transition-colors rounded-lg p-4 border border-border">
                  <div className="text-2xl font-bold text-foreground">
                    {issue.stats.deliveries.toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Deliveries</div>
                </div>

                <div className="bg-muted/50 hover:bg-muted transition-colors rounded-lg p-4 border border-border">
                  <div className="text-2xl font-bold text-foreground">
                    {issue.stats.opens.toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Opens</div>
                  <div className="text-xs text-success-600 dark:text-success-400 font-medium mt-1">
                    {formatPercentage(issue.stats.opens, issue.stats.deliveries)}
                  </div>
                </div>

                <div className="bg-muted/50 hover:bg-muted transition-colors rounded-lg p-4 border border-border">
                  <div className="text-2xl font-bold text-foreground">
                    {issue.stats.clicks.toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Clicks</div>
                  <div className="text-xs text-primary-600 dark:text-primary-400 font-medium mt-1">
                    {formatPercentage(issue.stats.clicks, issue.stats.deliveries)}
                  </div>
                </div>

                <div className="bg-muted/50 hover:bg-muted transition-colors rounded-lg p-4 border border-border">
                  <div className="text-2xl font-bold text-foreground">
                    {issue.stats.bounces.toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Bounces</div>
                  <div className="text-xs text-warning-600 dark:text-warning-400 font-medium mt-1">
                    {formatPercentage(issue.stats.bounces, issue.stats.deliveries)}
                  </div>
                </div>

                <div className="bg-muted/50 hover:bg-muted transition-colors rounded-lg p-4 border border-border">
                  <div className="text-2xl font-bold text-foreground">
                    {issue.stats.complaints.toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Complaints</div>
                  <div className="text-xs text-error-600 dark:text-error-400 font-medium mt-1">
                    {formatPercentage(issue.stats.complaints, issue.stats.deliveries)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Delete Confirmation Dialog */}
      <DeleteIssueDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        issue={issue}
      />
    </div>
  );
};
