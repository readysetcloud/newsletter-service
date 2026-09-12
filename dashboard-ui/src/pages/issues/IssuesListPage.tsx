import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Eye, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { Card } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/Loading';
import { SectionError } from '@/components/ui/SectionError';
import {
  IssueCard,
  IssueStatusBadge,
  DeleteIssueDialog,
  IssuesEmptyState
} from '@/components/issues';
import { issuesService } from '@/services/issuesService';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { IssueListItem, IssueStatus, Issue } from '@/types/issues';
import { useTenantDateFormat } from '@/contexts/SettingsContext';

type SortField = 'subject' | 'status' | 'issueNumber' | 'date';

const STATUS_FILTERS: { value: IssueStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in progress', label: 'In Progress' },
  { value: 'sending', label: 'Sending' },
  { value: 'published', label: 'Published' },
  { value: 'failed', label: 'Failed' }
];

/** The indicator on a sortable column header: direction when active, a hint on hover. */
const SortIcon: React.FC<{ active: boolean; direction: 'asc' | 'desc' }> = ({ active, direction }) => {
  if (!active) {
    return <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />;
  }
  return direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
};

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
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Rendered one way or the other, never both — the table's five columns do not
  // fit a phone, and two copies of the list would be two copies to a reader.
  const isNarrow = useMediaQuery('(max-width: 767px)');

  const nextTokenRef = React.useRef<string | null>(null);
  nextTokenRef.current = nextToken;

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
        ...(reset ? {} : { nextToken: nextTokenRef.current || undefined })
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
  }, [statusFilter, addToast]);

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

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }, [sortField]);

  const sortedIssues = useMemo(() => {
    const sorted = [...issues];

    sorted.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'subject': {
          comparison = a.subject.localeCompare(b.subject);
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

    return sorted;
  }, [issues, sortField, sortDirection]);

  // Dates read in the newsletter's timezone (see SettingsPage), so the list
  // agrees with the schedule that produced it.
  const { formatDate } = useTenantDateFormat();

  /** A sortable column heading. */
  const sortableHeader = (field: SortField, label: string, className: string) => (
    <th scope="col" className={className}>
      <button
        onClick={() => handleSort(field)}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors group"
        aria-label={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <SortIcon active={sortField === field} direction={sortDirection} />
      </button>
    </th>
  );

  const loadMore = hasMore ? (
    <div className="mt-4 flex justify-center">
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
  ) : null;

  const renderList = () => {
    if (loading) {
      return (
        <div role="status" aria-live="polite" aria-label="Loading issues">
          <span className="sr-only">Loading issues...</span>
          <LoadingSkeleton lines={5} />
        </div>
      );
    }

    if (error && issues.length === 0) {
      return <SectionError message={error} onRetry={handleRetry} retryLabel="Retry loading issues" />;
    }

    if (sortedIssues.length === 0) {
      return (
        <div role="status" aria-live="polite">
          <IssuesEmptyState
            hasFilters={statusFilter !== 'all'}
            onClearFilters={handleClearFilters}
          />
        </div>
      );
    }

    if (isNarrow) {
      return (
        <>
          <div className="grid gap-4" role="list" aria-label="Issues list">
            {sortedIssues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} />
            ))}
          </div>
          {loadMore}
        </>
      );
    }

    return (
      <>
        <div className="overflow-x-auto">
          <table className="w-full" aria-label="Issues list">
            <thead>
              <tr className="bg-muted">
                {sortableHeader('subject', 'Subject', 'w-[45%] px-4 py-3 text-left')}
                {sortableHeader('status', 'Status', 'w-[15%] px-4 py-3 text-left')}
                {sortableHeader('issueNumber', 'Issue #', 'w-[10%] px-4 py-3 text-left')}
                {sortableHeader('date', 'Date', 'w-[20%] px-4 py-3 text-left')}
                <th scope="col" className="w-[10%] px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedIssues.map((issue) => {
                const displayDate = issue.publishedAt || issue.scheduledAt || issue.createdAt;
                const dateLabel = issue.publishedAt
                  ? 'Published'
                  : issue.scheduledAt ? 'Scheduled' : 'Created';

                return (
                  <tr
                    key={issue.id}
                    className="border-t border-border hover:bg-muted/50 transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/issues/${issue.id}`)}
                        className="text-left hover:text-primary-600 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring rounded w-full"
                        aria-label={`View issue: ${issue.subject}`}
                      >
                        <div className="text-sm font-medium text-foreground group-hover:text-primary-600 transition-colors">
                          {issue.subject}
                        </div>
                      </button>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <IssueStatusBadge status={issue.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground font-mono">
                      #{issue.issueNumber}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground">
                      <div className="font-medium">{dateLabel}</div>
                      <div className="text-xs">{formatDate(displayDate)}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/issues/${issue.id}`)}
                          aria-label={`View issue: ${issue.subject}`}
                          className="hover:bg-primary-50 dark:hover:bg-primary-900/20"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {issue.status === 'draft' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteClick(issue)}
                            aria-label={`Delete issue: ${issue.subject}`}
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
        {loadMore}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <Card padding="md">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-semibold text-foreground">Issues</h3>
          <Button onClick={() => navigate('/issues/new')} aria-label="Create new issue">
            <Plus className="w-4 h-4 mr-2" />
            Create Issue
          </Button>
        </div>

        {/* Status as chips rather than a menu: with seven of them, which one is
            active and what else is on offer are both worth showing at once. */}
        <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Filter issues by status">
          {STATUS_FILTERS.map(option => {
            const active = statusFilter === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setStatusFilter(option.value);
                  setNextToken(null);
                }}
                aria-pressed={active}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                  active
                    ? 'bg-primary-100 text-primary-800 border-primary-300 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-800'
                    : 'bg-transparent text-muted-foreground border-border hover:bg-muted'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {renderList()}
      </Card>

      <DeleteIssueDialog
        isOpen={!!issueToDelete}
        onClose={() => setIssueToDelete(null)}
        onConfirm={handleDeleteConfirm}
        issue={issueToDelete}
      />
    </div>
  );
};
