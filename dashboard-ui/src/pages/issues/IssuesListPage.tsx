import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Eye, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, Filter } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { Card, CardContent } from '@/components/ui/Card';
import {
  IssueCard,
  IssueStatusBadge,
  DeleteIssueDialog,
  IssuesEmptyState
} from '@/components/issues';
import { issuesService } from '@/services/issuesService';
import type { IssueListItem, IssueStatus, Issue } from '@/types/issues';

export const IssuesListPage: React.FC = () => {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [issues, setIssues] = useState<IssueListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<IssueStatus | 'all'>('all');
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [issueToDelete, setIssueToDelete] = useState<Issue | null>(null);
  const [sortField, setSortField] = useState<'title' | 'status' | 'issueNumber' | 'date'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showStatusFilter, setShowStatusFilter] = useState(false);

  const loadIssues = useCallback(async (reset = false) => {
    try {
      if (reset) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      const params = {
        limit: 20,
        ...(statusFilter !== 'all' && { status: statusFilter }),
        ...(reset ? {} : { nextToken: nextToken || undefined })
      };

      const response = await issuesService.listIssues(params);

      if (response.success && response.data) {
        const { issues: newIssues, nextToken: newNextToken } = response.data;
        if (reset) {
          setIssues(newIssues);
        } else {
          setIssues(prev => [...prev, ...newIssues]);
        }
        setNextToken(newNextToken || null);
        setHasMore(!!newNextToken);
      } else {
        const errorMsg = response.error || 'Failed to load issues';
        setError(errorMsg);
        addToast({
          title: 'Failed to Load Issues',
          message: errorMsg,
          type: 'error',
          action: {
            label: 'Retry',
            onClick: () => loadIssues(true)
          }
        });
      }
    } catch (err) {
      console.error('Error loading issues:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to load issues';
      setError(errorMsg);
      addToast({
        title: 'Failed to Load Issues',
        message: errorMsg,
        type: 'error',
        action: {
          label: 'Retry',
          onClick: () => loadIssues(true)
        }
      });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [statusFilter, nextToken, addToast]);

  useEffect(() => {
    loadIssues(true);
  }, [statusFilter, loadIssues]);

  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      loadIssues(false);
    }
  }, [loadingMore, hasMore, loadIssues]);

  const handleDeleteClick = useCallback(async (issue: IssueListItem) => {
    try {
      const response = await issuesService.getIssue(issue.id);
      if (response.success && response.data) {
        setIssueToDelete(response.data);
      } else {
        addToast({
          title: 'Failed to Load Issue',
          message: response.error || 'Could not load issue details',
          type: 'error'
        });
      }
    } catch (err) {
      console.error('Error loading issue:', err);
      addToast({
        title: 'Failed to Load Issue',
        message: err instanceof Error ? err.message : 'Could not load issue details',
        type: 'error'
      });
    }
  }, [addToast]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!issueToDelete) return;

    // Optimistic update: remove issue immediately
    const previousIssues = [...issues];
    setIssues(prev => prev.filter(i => i.id !== issueToDelete.id));
    setIssueToDelete(null);

    try {
      const response = await issuesService.deleteIssue(issueToDelete.id);

      if (response.success) {
        addToast({
          title: 'Issue Deleted',
          message: 'The issue has been deleted successfully',
          type: 'success'
        });
      } else {
        // Revert optimistic update on error
        setIssues(previousIssues);

        const errorMsg = response.error || 'Failed to delete issue';
        if (errorMsg.includes('409') || errorMsg.includes('Conflict') || errorMsg.includes('cannot be modified')) {
          addToast({
            title: 'Cannot Delete Issue',
            message: 'This issue cannot be deleted because it has already been published or scheduled',
            type: 'error'
          });
        } else if (errorMsg.includes('404') || errorMsg.includes('not found')) {
          addToast({
            title: 'Issue Not Found',
            message: 'The issue may have already been deleted',
            type: 'error'
          });
        } else {
          addToast({
            title: 'Failed to Delete Issue',
            message: errorMsg,
            type: 'error'
          });
        }
      }
    } catch (err) {
      // Revert optimistic update on error
      setIssues(previousIssues);

      console.error('Error deleting issue:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete issue';
      addToast({
        title: 'Failed to Delete Issue',
        message: errorMsg,
        type: 'error'
      });
    }
  }, [issueToDelete, issues, addToast]);

  const handleRetry = useCallback(() => {
    setError(null);
    loadIssues(true);
  }, [loadIssues]);

  const handleClearFilters = useCallback(() => {
    setStatusFilter('all');
    setNextToken(null);
  }, []);

  const handleSort = useCallback((field: 'title' | 'status' | 'issueNumber' | 'date') => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }, [sortField]);

  const filteredIssues = useMemo(() => {
    const filtered = [...issues];

    // Sort
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'title': {
          comparison = a.title.localeCompare(b.title);
          break;
        }
        case 'status': {
          comparison = a.status.localeCompare(b.status);
          break;
        }
        case 'issueNumber': {
          comparison = a.issueNumber - b.issueNumber;
          break;
        }
        case 'date': {
          const dateA = new Date(a.publishedAt || a.scheduledAt || a.createdAt).getTime();
          const dateB = new Date(b.publishedAt || b.scheduledAt || b.createdAt).getTime();
          comparison = dateA - dateB;
          break;
        }
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [issues, sortField, sortDirection]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const statusOptions = useMemo(() => [
    { value: 'all', label: 'All Issues' },
    { value: 'draft', label: 'Draft' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'published', label: 'Published' },
    { value: 'failed', label: 'Failed' }
  ], []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div role="status" aria-live="polite" aria-label="Loading issues">
            <span className="sr-only">Loading issues...</span>
          {/* Header Skeleton */}
          <div className="mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="h-8 w-48 bg-muted rounded animate-pulse mb-2" />
                <div className="h-4 w-64 bg-muted rounded animate-pulse" />
              </div>
              <div className="h-10 w-32 bg-muted rounded animate-pulse" />
            </div>
          </div>

          {/* Filter Skeleton */}
          <div className="mb-6">
            <div className="h-10 w-64 bg-muted rounded animate-pulse" />
          </div>

          {/* Desktop Table Skeleton */}
          <div className="hidden md:block">
            <Card>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted">
                    <tr>
                      <th className="w-[40%] px-6 py-3 text-left">
                        <div className="h-4 w-16 bg-muted-foreground/20 rounded animate-pulse" />
                      </th>
                      <th className="w-[15%] px-6 py-3 text-left">
                        <div className="h-4 w-16 bg-muted-foreground/20 rounded animate-pulse" />
                      </th>
                      <th className="w-[10%] px-6 py-3 text-left">
                        <div className="h-4 w-16 bg-muted-foreground/20 rounded animate-pulse" />
                      </th>
                      <th className="w-[20%] px-6 py-3 text-left">
                        <div className="h-4 w-16 bg-muted-foreground/20 rounded animate-pulse" />
                      </th>
                      <th className="w-[15%] px-6 py-3 text-right">
                        <div className="h-4 w-16 bg-muted-foreground/20 rounded animate-pulse ml-auto" />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-surface divide-y divide-border">
                    {[1, 2, 3, 4, 5].map(i => (
                      <tr key={i}>
                        <td className="px-6 py-4">
                          <div className="space-y-2">
                            <div className="h-4 w-48 bg-muted rounded animate-pulse" />
                            <div className="h-3 w-32 bg-muted rounded animate-pulse" />
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="h-6 w-20 bg-muted rounded-full animate-pulse" />
                        </td>
                        <td className="px-6 py-4">
                          <div className="h-4 w-12 bg-muted rounded animate-pulse" />
                        </td>
                        <td className="px-6 py-4">
                          <div className="space-y-1">
                            <div className="h-3 w-20 bg-muted rounded animate-pulse" />
                            <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-8 w-8 bg-muted rounded animate-pulse" />
                            <div className="h-8 w-8 bg-muted rounded animate-pulse" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* Mobile Card Skeleton */}
          <div className="md:hidden space-y-4">
            {[1, 2, 3].map(i => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="h-5 w-48 bg-muted rounded animate-pulse" />
                      <div className="h-6 w-20 bg-muted rounded-full animate-pulse" />
                    </div>
                    <div className="h-3 w-32 bg-muted rounded animate-pulse" />
                    <div className="flex items-center justify-between">
                      <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                      <div className="flex gap-2">
                        <div className="h-8 w-8 bg-muted rounded animate-pulse" />
                        <div className="h-8 w-8 bg-muted rounded animate-pulse" />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          </div>
        </main>
      </div>
    );
  }

  if (error && issues.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div role="alert" aria-live="assertive" className="text-center py-12">
            <h3 className="text-lg font-medium text-foreground mb-2">Failed to load issues</h3>
            <p className="text-sm text-muted-foreground mb-6">{error}</p>
            <Button onClick={handleRetry} aria-label="Retry loading issues">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Issues</h1>
              <p className="text-sm sm:text-base text-muted-foreground mt-1">
                Manage your newsletter issues
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => navigate('/issues/new')}
                aria-label="Create new issue"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Issue
              </Button>
            </div>
          </div>
        </div>

        {filteredIssues.length === 0 ? (
          <div role="status" aria-live="polite">
            <IssuesEmptyState
              hasFilters={statusFilter !== 'all'}
              onClearFilters={handleClearFilters}
            />
          </div>
        ) : (
          <>
            <div className="hidden md:block" role="region" aria-label="Issues table">
              <Card className="overflow-visible relative">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border" role="table" aria-label="Issues list">
                    <thead className="bg-muted">
                      <tr>
                        <th scope="col" className="w-[40%] px-6 py-3 text-left">
                          <button
                            onClick={() => handleSort('title')}
                            className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors group"
                          >
                            Title
                            {sortField === 'title' ? (
                              sortDirection === 'asc' ? (
                                <ArrowUp className="w-3 h-3" />
                              ) : (
                                <ArrowDown className="w-3 h-3" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                            )}
                          </button>
                        </th>
                        <th scope="col" className="w-[15%] px-6 py-3 text-left">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleSort('status')}
                              className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors group"
                            >
                              Status
                              {sortField === 'status' ? (
                                sortDirection === 'asc' ? (
                                  <ArrowUp className="w-3 h-3" />
                                ) : (
                                  <ArrowDown className="w-3 h-3" />
                                )
                              ) : (
                                <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                              )}
                            </button>
                            <button
                              id="status-filter-button"
                              onClick={() => setShowStatusFilter(!showStatusFilter)}
                              className="p-1 hover:bg-muted-foreground/10 rounded transition-colors"
                              aria-label="Filter by status"
                            >
                              <Filter className={`w-3 h-3 ${statusFilter !== 'all' ? 'text-primary-600' : 'text-muted-foreground'}`} />
                            </button>
                          </div>
                        </th>
                        <th scope="col" className="w-[10%] px-6 py-3 text-left">
                          <button
                            onClick={() => handleSort('issueNumber')}
                            className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors group"
                          >
                            Issue #
                            {sortField === 'issueNumber' ? (
                              sortDirection === 'asc' ? (
                                <ArrowUp className="w-3 h-3" />
                              ) : (
                                <ArrowDown className="w-3 h-3" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                            )}
                          </button>
                        </th>
                        <th scope="col" className="w-[20%] px-6 py-3 text-left">
                          <button
                            onClick={() => handleSort('date')}
                            className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors group"
                          >
                            Date
                            {sortField === 'date' ? (
                              sortDirection === 'asc' ? (
                                <ArrowUp className="w-3 h-3" />
                              ) : (
                                <ArrowDown className="w-3 h-3" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                            )}
                          </button>
                        </th>
                        <th scope="col" className="w-[15%] px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-surface divide-y divide-border">
                      {filteredIssues.map((issue) => {
                        const displayDate = issue.publishedAt || issue.scheduledAt || issue.createdAt;
                        const dateLabel = issue.publishedAt ? 'Published' : issue.scheduledAt ? 'Scheduled' : 'Created';

                        return (
                          <tr key={issue.id} className="hover:bg-muted/50 transition-colors group">
                            <td className="px-6 py-4">
                              <button
                                onClick={() => navigate(`/issues/${issue.id}`)}
                                className="text-left hover:text-primary-600 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded w-full"
                                aria-label={`View issue: ${issue.title}`}
                              >
                                <div className="text-sm font-medium text-foreground group-hover:text-primary-600 transition-colors">
                                  {issue.title}
                                </div>
                                <div className="text-xs text-muted-foreground font-mono mt-1">
                                  {issue.slug}
                                </div>
                              </button>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <IssueStatusBadge status={issue.status} />
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                              #{issue.issueNumber}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-muted-foreground">
                                <div className="font-medium">{dateLabel}</div>
                                <div className="text-xs">{formatDate(displayDate)}</div>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => navigate(`/issues/${issue.id}`)}
                                  aria-label={`View issue: ${issue.title}`}
                                  className="hover:bg-primary-50 dark:hover:bg-primary-900/20"
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                                {issue.status === 'draft' && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteClick(issue)}
                                    aria-label={`Delete issue: ${issue.title}`}
                                    className="hover:bg-error-50 dark:hover:bg-error-900/20"
                                  >
                                    <Trash2 className="w-4 h-4 text-error-600 dark:text-error-400" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            <div className="md:hidden grid gap-4" role="list" aria-label="Issues list">
              {filteredIssues.map((issue) => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </div>

            {hasMore && (
              <div className="mt-6 flex justify-center">
                <Button
                  variant="outline"
                  onClick={handleLoadMore}
                  isLoading={loadingMore}
                  disabled={loadingMore}
                  aria-label="Load more issues"
                >
                  {loadingMore ? 'Loading...' : 'Load More'}
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Status Filter Dropdown - Rendered outside table to avoid overflow issues */}
      {showStatusFilter && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowStatusFilter(false)}
            onKeyDown={(e) => e.key === 'Escape' && setShowStatusFilter(false)}
            role="button"
            tabIndex={0}
            aria-label="Close filter menu"
          />
          <div
            className="fixed z-50 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-[140px]"
            style={{
              top: (() => {
                const button = document.getElementById('status-filter-button');
                if (button) {
                  const rect = button.getBoundingClientRect();
                  return `${rect.bottom + 4}px`;
                }
                return '0px';
              })(),
              left: (() => {
                const button = document.getElementById('status-filter-button');
                if (button) {
                  const rect = button.getBoundingClientRect();
                  return `${rect.left}px`;
                }
                return '0px';
              })()
            }}
          >
            {statusOptions.map(option => (
              <button
                key={option.value}
                onClick={() => {
                  setStatusFilter(option.value as IssueStatus | 'all');
                  setShowStatusFilter(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors ${
                  statusFilter === option.value ? 'bg-muted font-medium text-primary-600' : ''
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}

      <DeleteIssueDialog
        isOpen={!!issueToDelete}
        onClose={() => setIssueToDelete(null)}
        onConfirm={handleDeleteConfirm}
        issue={issueToDelete}
      />
    </div>
  );
};
