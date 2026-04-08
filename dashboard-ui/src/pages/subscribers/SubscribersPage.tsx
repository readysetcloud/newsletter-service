import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, FolderOpen, AlertCircle, RefreshCw, X, ArrowUp, ArrowDown, Bot } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { DataList } from '@/components/ui/DataList';
import { VirtualTable } from '@/components/ui/VirtualTable';
import type { VirtualTableColumn } from '@/components/ui/VirtualTable';
import { LoadingSkeleton } from '@/components/ui/Loading';
import { EmptyState } from '@/components/ui/EmptyState';
import type { DataListColumn } from '@/components/ui/DataList';
import { SubscriberGrowthChart } from '@/components/SubscriberGrowthChart';
import { AudienceHealthWidget } from '@/components/AudienceHealthWidget';
import { subscriberService } from '@/services/subscriberService';
import { segmentService } from '@/services/segmentService';
import type { Segment } from '@/services/segmentService';
import type { SubscriberTrendsResponse, SubscriberListItem } from '@/types';

const formatDate = (dateString: string) =>
  new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

/** Skeleton for the subscriber count metric card (Row 1) */
const MetricSkeleton: React.FC = () => (
  <Card padding="sm">
    <div className="flex items-center gap-3">
      <div className="p-2 rounded-full bg-muted h-9 w-9 animate-pulse" />
      <div className="space-y-2">
        <div className="h-4 w-28 bg-muted rounded animate-pulse" />
        <div className="h-7 w-20 bg-muted rounded animate-pulse" />
      </div>
    </div>
  </Card>
);

/** Skeleton for the SubscriberGrowthChart (matches h-36 sm:h-44 chart area) */
const ChartSkeleton: React.FC = () => (
  <Card padding="md">
    <div className="h-4 w-36 bg-muted rounded animate-pulse mb-3" />
    <div className="h-36 sm:h-44 bg-muted rounded animate-pulse" />
  </Card>
);

/** Skeleton for the AudienceHealthWidget (matches widget dimensions) */
const HealthSkeleton: React.FC = () => (
  <div className="bg-surface rounded-lg shadow p-4 sm:p-6">
    <div className="h-5 w-32 bg-muted rounded animate-pulse mb-3" />
    <div className="h-48 bg-muted rounded animate-pulse mb-3" />
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex justify-between">
          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
          <div className="h-4 w-16 bg-muted rounded animate-pulse" />
        </div>
      ))}
    </div>
  </div>
);

/** Skeleton for the segment list table (Row 3) */
const SegmentListSkeleton: React.FC = () => (
  <Card padding="md">
    <div className="flex items-center justify-between mb-4">
      <div className="h-6 w-24 bg-muted rounded animate-pulse" />
      <div className="h-10 w-32 bg-muted rounded animate-pulse" />
    </div>
    <LoadingSkeleton lines={5} className="mt-2" />
  </Card>
);

/** Inline error with Retry button for a failed section */
const SectionError: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="flex items-center gap-3 p-4 rounded-lg bg-error-50 border border-error-200 text-error-700" role="alert">
    <AlertCircle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
    <p className="text-sm flex-1">{message}</p>
    <Button variant="outline" size="sm" onClick={onRetry}>
      <RefreshCw className="w-4 h-4 mr-1" aria-hidden="true" />
      Retry
    </Button>
  </div>
);

export const SubscribersPage: React.FC = () => {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [trendsData, setTrendsData] = useState<SubscriberTrendsResponse | null>(null);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [subscriberList, setSubscriberList] = useState<SubscriberListItem[]>([]);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const [segmentsLoading, setSegmentsLoading] = useState(true);
  const [subscriberListLoading, setSubscriberListLoading] = useState(true);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const [segmentsError, setSegmentsError] = useState<string | null>(null);
  const [subscriberListError, setSubscriberListError] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Create segment modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleUnsubscribe = useCallback(async (email: string) => {
    if (!confirm(`Remove ${email} from your subscriber list?`)) return;
    const result = await subscriberService.unsubscribe(email);
    if (result.success) {
      setSubscriberList((prev) => prev.filter((s) => s.email !== email));
      setSubscriberCount((prev) => Math.max(0, prev - 1));
      addToast({ type: 'success', title: 'Subscriber removed', message: `${email} has been unsubscribed.` });
    } else {
      addToast({ type: 'error', title: 'Failed to remove subscriber', message: result.error || 'Something went wrong.' });
    }
  }, [addToast]);

  const loadTrends = useCallback(async () => {
    try {
      setTrendsLoading(true);
      setTrendsError(null);
      const [countResponse, trendsResponse] = await Promise.all([
        subscriberService.getCount(),
        subscriberService.getTrends(),
      ]);
      if (countResponse.success && countResponse.data && trendsResponse.success && trendsResponse.data) {
        setSubscriberCount(countResponse.data.totalSubscribers);
        setTrendsData(trendsResponse.data);
      } else {
        setTrendsError(
          countResponse.error ||
          trendsResponse.error ||
          'Failed to load subscriber data'
        );
      }
    } catch {
      setTrendsError('Failed to load subscriber data');
    } finally {
      setTrendsLoading(false);
    }
  }, []);

  const loadSegments = useCallback(async () => {
    try {
      setSegmentsLoading(true);
      setSegmentsError(null);
      const response = await segmentService.listSegments();
      if (response.success && response.data) {
        setSegments(response.data.segments);
      } else {
        setSegmentsError(response.error || 'Failed to load segments');
      }
    } catch {
      setSegmentsError('Failed to load segments');
    } finally {
      setSegmentsLoading(false);
    }
  }, []);

  const loadSubscriberList = useCallback(async () => {
    try {
      setSubscriberListLoading(true);
      setSubscriberListError(null);
      const response = await subscriberService.getList();
      if (response.success && response.data) {
        setSubscriberList(response.data.subscribers);
      } else {
        setSubscriberListError(response.error || 'Failed to load subscriber list');
      }
    } catch {
      setSubscriberListError('Failed to load subscriber list');
    } finally {
      setSubscriberListLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrends();
    loadSegments();
    loadSubscriberList();
  }, [loadTrends, loadSegments, loadSubscriberList]);

  const latestIssueNumber = trendsData?.points?.[0]?.issueNumber
    ? Number(trendsData.points[0].issueNumber)
    : 0;

  const sortedSubscribers = useMemo(() => {
    return [...subscriberList].sort((a, b) => {
      const aTime = a.addedAt ? new Date(a.addedAt).getTime() : 0;
      const bTime = b.addedAt ? new Date(b.addedAt).getTime() : 0;
      return sortDirection === 'asc' ? aTime - bTime : bTime - aTime;
    });
  }, [subscriberList, sortDirection]);

  const toggleSortDirection = useCallback(() => {
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  }, []);

  const SortIcon = sortDirection === 'asc' ? ArrowUp : ArrowDown;

  const getEngagementLabel = useCallback(
    (lastEngagedIssue: number | null): { text: string; className: string } => {
      if (!latestIssueNumber || latestIssueNumber === 0) {
        return { text: '—', className: 'text-muted-foreground' };
      }
      if (lastEngagedIssue === null) {
        return {
          text: 'Dormant',
          className: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400',
        };
      }
      if (lastEngagedIssue >= latestIssueNumber - 1) {
        return {
          text: 'Highly Engaged',
          className: 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400',
        };
      }
      if (lastEngagedIssue >= latestIssueNumber - 9) {
        return {
          text: 'Occasional',
          className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400',
        };
      }
      return {
        text: 'Dormant',
        className: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400',
      };
    },
    [latestIssueNumber]
  );

  const subscriberColumns: VirtualTableColumn<SubscriberListItem>[] = useMemo(
    () => [
      {
        key: 'email',
        header: 'Email',
        render: (sub) => <span className="text-foreground">{sub.email}</span>,
      },
      {
        key: 'bot',
        header: 'Bot',
        render: (sub) => {
          if (!sub.suspectedBot) return null;
          const reasons: string[] = [];
          if (sub.botFlags?.honeypotTriggered) reasons.push('Honeypot triggered');
          if (sub.botFlags?.disposableDomain) reasons.push('Disposable email domain');
          if (sub.botFlags?.suspiciousUserAgent) reasons.push('Suspicious user agent');
          if (sub.botFlags?.fastSubmission) reasons.push('Fast form submission');
          if (sub.botFlags?.suspiciousEmailPattern) reasons.push('Suspicious email pattern (dot-trick)');
          const tooltip = reasons.length > 0
            ? `Flagged for: ${reasons.join(', ')}`
            : 'One or more bot detection flags were triggered';
          return (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400 cursor-help"
              role="status"
              title={tooltip}
            >
              <Bot className="w-3 h-3" aria-hidden="true" />
              Suspected
            </span>
          );
        },
      },
      {
        key: 'name',
        header: 'Name',
        className: 'hidden md:table-cell',
        headerClassName: 'hidden md:table-cell',
        render: (sub) => (
          <span className="text-muted-foreground">
            {[sub.firstName, sub.lastName].filter(Boolean).join(' ') || '—'}
          </span>
        ),
      },
      {
        key: 'engagement',
        header: 'Engagement',
        className: 'hidden sm:block',
        headerClassName: 'hidden sm:block',
        render: (sub) => {
          const label = getEngagementLabel(sub.lastEngagedIssue);
          return (
            <span
              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${label.className}`}
              role="status"
            >
              {label.text}
            </span>
          );
        },
      },
      {
        key: 'subscribed',
        header: (
          <button
            type="button"
            onClick={toggleSortDirection}
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            aria-label={`Sort by subscription date, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
          >
            Subscribed
            <SortIcon className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        ),
        render: (sub) => (
          <span className="text-muted-foreground">
            {sub.addedAt ? formatDate(sub.addedAt) : '—'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        render: (sub) => (
          <button
            type="button"
            onClick={() => handleUnsubscribe(sub.email)}
            className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 transition-colors"
            aria-label={`Unsubscribe ${sub.email}`}
          >
            Remove
          </button>
        ),
      },
    ],
    [sortDirection, toggleSortDirection, SortIcon, getEngagementLabel, handleUnsubscribe]
  );

  const segmentColumns: DataListColumn<Segment>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        render: (segment) => (
          <span className="font-medium text-foreground">{segment.name}</span>
        ),
      },
      {
        key: 'description',
        header: 'Description',
        className: 'hidden md:table-cell',
        headerClassName: 'hidden md:table-cell',
        render: (segment) => (
          <span className="text-muted-foreground truncate max-w-xs block">
            {segment.description || '—'}
          </span>
        ),
      },
      {
        key: 'members',
        header: 'Members',
        render: (segment) => (
          <span className="text-muted-foreground">{segment.memberCount}</span>
        ),
      },
      {
        key: 'created',
        header: 'Created',
        className: 'hidden md:table-cell',
        headerClassName: 'hidden md:table-cell',
        render: (segment) => (
          <span className="text-muted-foreground">
            {formatDate(segment.createdAt)}
          </span>
        ),
      },
    ],
    []
  );

  const handleSegmentClick = useCallback(
    (segment: Segment) => {
      navigate(`/segments/${segment.segmentId}`);
    },
    [navigate]
  );

  // --- Create segment validation ---
  const nameError = (() => {
    const trimmed = createName.trim();
    if (trimmed.length === 0 && createName.length > 0) return 'Name cannot be only whitespace';
    if (trimmed.length > 100) return 'Name must not exceed 100 characters';
    return null;
  })();

  const descriptionError = createDescription.length > 500
    ? 'Description must not exceed 500 characters'
    : null;

  const canSubmit = createName.trim().length >= 1 && !nameError && !descriptionError && !creating;

  const handleOpenCreateModal = useCallback(() => {
    setCreateName('');
    setCreateDescription('');
    setCreateError(null);
    setIsCreateModalOpen(true);
  }, []);

  const handleCloseCreateModal = useCallback(() => {
    setIsCreateModalOpen(false);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!canSubmit) return;
    setCreating(true);
    setCreateError(null);

    const response = await segmentService.createSegment({
      name: createName.trim(),
      description: createDescription.trim() || undefined,
    });

    if (response.success && response.data) {
      setSegments(prev => [response.data!, ...prev]);
      setIsCreateModalOpen(false);
      setCreateName('');
      setCreateDescription('');
      addToast({ title: 'Segment Created', message: `"${response.data.name}" created successfully`, type: 'success' });
    } else {
      const errMsg = response.error || 'Failed to create segment';
      if (errMsg.includes('409') || errMsg.includes('Conflict') || errMsg.toLowerCase().includes('already exists')) {
        setCreateError('A segment with this name already exists');
      } else {
        setCreateError(errMsg);
      }
      addToast({ title: 'Create Failed', message: errMsg, type: 'error' });
    }
    setCreating(false);
  }, [canSubmit, createName, createDescription, addToast]);

  return (
    <div className="flex flex-col gap-6">
      {/* Row 1: Key Metrics */}
      {trendsLoading ? (
        <MetricSkeleton />
      ) : trendsError ? (
        <SectionError message={trendsError} onRetry={loadTrends} />
      ) : (
        <Card padding="sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary-50">
              <Users className="w-5 h-5 text-primary-600" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Subscribers</p>
              <p className="text-2xl font-bold text-foreground">
                {subscriberCount.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Row 2: Trends & Health */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {trendsLoading ? (
          <>
            <ChartSkeleton />
            <HealthSkeleton />
          </>
        ) : trendsError ? (
          <div className="md:col-span-2">
            <SectionError message={trendsError} onRetry={loadTrends} />
          </div>
        ) : (
          <>
            <Card padding="md">
              <h3 className="text-base font-medium text-foreground mb-3">
                Subscriber Growth
              </h3>
              {trendsData && <SubscriberGrowthChart trendsData={trendsData} />}
            </Card>
            <div>
              {latestIssueNumber > 0 && (
                <AudienceHealthWidget latestIssueNumber={latestIssueNumber} />
              )}
            </div>
          </>
        )}
      </div>

      {/* Row 3: Subscriber List */}
      {subscriberListLoading ? (
        <Card padding="md">
          <div className="h-6 w-32 bg-muted rounded animate-pulse mb-4" />
          <LoadingSkeleton lines={5} className="mt-2" />
        </Card>
      ) : subscriberListError ? (
        <Card padding="md">
          <h3 className="text-lg font-semibold text-foreground mb-4">Subscribers</h3>
          <SectionError message={subscriberListError} onRetry={loadSubscriberList} />
        </Card>
      ) : sortedSubscribers.length === 0 ? (
        <Card padding="md">
          <h3 className="text-lg font-semibold text-foreground mb-4">Subscribers</h3>
          <p className="text-sm text-muted-foreground">No subscribers yet.</p>
        </Card>
      ) : (
        <Card padding="md">
          <h3 className="text-lg font-semibold text-foreground mb-4">Subscribers</h3>
          <VirtualTable<SubscriberListItem>
            items={sortedSubscribers}
            getKey={(sub) => sub.email}
            ariaLabel="Subscribers list"
            rowHeight={44}
            maxHeight={440}
            columns={subscriberColumns}
          />
        </Card>
      )}

      {/* Row 4: Segment Management */}
      {segmentsLoading ? (
        <SegmentListSkeleton />
      ) : segmentsError ? (
        <Card padding="md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Segments</h3>
            <Button variant="primary" onClick={handleOpenCreateModal}>
              Create Segment
            </Button>
          </div>
          <SectionError message={segmentsError} onRetry={loadSegments} />
        </Card>
      ) : segments.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          heading="Get started with segments"
          description="Create your first segment to start organizing your audience"
          action={{ label: 'Create Segment', onClick: handleOpenCreateModal }}
        />
      ) : (
        <Card padding="md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Segments</h3>
            <Button variant="primary" onClick={handleOpenCreateModal}>
              Create Segment
            </Button>
          </div>
          <DataList
            items={segments}
            columns={segmentColumns}
            getKey={(segment) => segment.segmentId}
            onRowClick={handleSegmentClick}
            ariaLabel="Segments list"
          />
        </Card>
      )}

      {/* Create Segment Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            role="presentation"
            onClick={handleCloseCreateModal}
            onKeyDown={e => { if (e.key === 'Escape') handleCloseCreateModal(); }}
          />
          <div className="relative bg-surface rounded-lg shadow-xl w-full max-w-md mx-4 p-6 z-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">Create Segment</h2>
              <button onClick={handleCloseCreateModal} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="segment-name" className="block text-sm font-medium text-foreground mb-1">Name</label>
                <input
                  id="segment-name"
                  type="text"
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  placeholder="e.g. VIP Subscribers"
                  maxLength={100}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <div className="flex justify-between mt-1">
                  {nameError && <p className="text-xs text-error-600">{nameError}</p>}
                  <p className="text-xs text-muted-foreground ml-auto">{createName.trim().length}/100</p>
                </div>
              </div>

              <div>
                <label htmlFor="segment-description" className="block text-sm font-medium text-foreground mb-1">
                  Description <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <textarea
                  id="segment-description"
                  value={createDescription}
                  onChange={e => setCreateDescription(e.target.value)}
                  placeholder="Describe this segment..."
                  rows={3}
                  maxLength={500}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
                <div className="flex justify-between mt-1">
                  {descriptionError && <p className="text-xs text-error-600">{descriptionError}</p>}
                  <p className="text-xs text-muted-foreground ml-auto">{createDescription.length}/500</p>
                </div>
              </div>

              {createError && (
                <p className="text-sm text-error-600 bg-error-50 dark:bg-error-900/20 rounded-md px-3 py-2">{createError}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={handleCloseCreateModal}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!canSubmit} isLoading={creating}>Create</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubscribersPage;
