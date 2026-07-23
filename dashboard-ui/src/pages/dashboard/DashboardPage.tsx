
import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { dashboardService } from '@/services/dashboardService';
import { profileService } from '@/services/profileService';
import { issuesService } from '@/services/issuesService';
import { DashboardSkeleton } from '@/components/ui/SkeletonLoader';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import MetricsCard from '@/components/MetricsCard';
import { SubscriberGrowthChart } from '@/components/SubscriberGrowthChart';
import { MiniSparkline } from '@/components/MiniSparkline';
import type { TrendsData, UserProfile, TrendComparison } from '@/types';
import type { AbHistoryResponse, ActiveAbTest } from '@/types/issues';
import { useAuth } from '@/contexts/AuthContext';
import { calculatePercentageDifference, calculateHealthStatus } from '@/utils/analyticsCalculations';
import {
  Mail,
  TrendingUp,
  MousePointer,
  RefreshCw,
  AlertCircle,
  BarChart3
} from 'lucide-react';

// Lazy load non-critical components for better initial load performance
const IssuePerformanceChart = lazy(() => import('@/components/IssuePerformanceChart'));
const SendingHealthWidget = lazy(() => import('@/components/SendingHealthWidget'));
const ActionableInsights = lazy(() => import('@/components/ActionableInsights'));
const QualitySignalsChart = lazy(() => import('@/components/QualitySignalsChart'));
const EngagementTypeTrendChart = lazy(() => import('@/components/EngagementTypeTrendChart'));
const TrafficSourceTrendChart = lazy(() => import('@/components/TrafficSourceTrendChart'));
const TopRegionsWidget = lazy(() => import('@/components/TopRegionsWidget'));
const AbTestHistory = lazy(() =>
  import('@/components/issues/AbTestHistory').then((m) => ({ default: m.AbTestHistory }))
);
const AbTestInProgress = lazy(() =>
  import('@/components/issues/AbTestInProgress').then((m) => ({ default: m.AbTestInProgress }))
);

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [trendsData, setTrendsData] = useState<TrendsData | null>(null);
  const [abHistory, setAbHistory] = useState<AbHistoryResponse | null>(null);
  const [abHistoryLoading, setAbHistoryLoading] = useState(true);
  const [abHistoryError, setAbHistoryError] = useState<string | null>(null);
  const [activeAbTests, setActiveAbTests] = useState<ActiveAbTest[]>([]);
  const [activeAbLoading, setActiveAbLoading] = useState(true);
  const [activeAbError, setActiveAbError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issueCount, setIssueCount] = useState(5);
  const [showAllIssues, setShowAllIssues] = useState(() => searchParams.get('issues') === 'all');
  const [rightPanelTab, setRightPanelTab] = useState<'quality' | 'engagement' | 'traffic'>(() => {
    const tab = searchParams.get('insights');
    if (tab === 'quality' || tab === 'engagement' || tab === 'traffic') {
      return tab;
    }
    return 'quality';
  });

  const trendComparisons = useMemo(() => {
    if (!trendsData?.aggregates || !trendsData?.previousPeriodAggregates) {
      return null;
    }

    const current = trendsData.aggregates;
    const previous = trendsData.previousPeriodAggregates;

    const createComparison = (currentVal: number, previousVal: number): TrendComparison => {
      const percentChange = calculatePercentageDifference(currentVal, previousVal);
      let direction: 'up' | 'down' | 'stable' = 'stable';

      if (Math.abs(percentChange) >= 0.1) {
        direction = percentChange > 0 ? 'up' : 'down';
      }

      return {
        current: currentVal,
        previous: previousVal,
        percentChange,
        direction
      };
    };

    return {
      openRate: createComparison(current.avgOpenRate, previous.avgOpenRate),
      clickRate: createComparison(current.avgClickRate, previous.avgClickRate),
      clickToOpenRate: createComparison(current.avgClickToOpenRate, previous.avgClickToOpenRate),
      bounceRate: createComparison(current.avgBounceRate, previous.avgBounceRate),
      delivered: createComparison(current.totalDelivered, previous.totalDelivered)
    };
  }, [trendsData]);

  const healthStatuses = useMemo(() => {
    if (!trendsData?.aggregates || !trendsData?.previousPeriodAggregates) {
      return null;
    }

    const current = trendsData.aggregates;
    const previous = trendsData.previousPeriodAggregates;

    return {
      openRate: calculateHealthStatus(current.avgOpenRate, previous.avgOpenRate, { good: 5, warning: 10 }),
      clickRate: calculateHealthStatus(current.avgClickRate, previous.avgClickRate, { good: 5, warning: 10 }),
      clickToOpenRate: calculateHealthStatus(current.avgClickToOpenRate, previous.avgClickToOpenRate, { good: 5, warning: 10 }),
      bounceRate: calculateHealthStatus(current.avgBounceRate, previous.avgBounceRate, { good: 5, warning: 10 })
    };
  }, [trendsData]);

  // Per-metric history (oldest first) so the overview tiles can render trend
  // sparklines from the same window the aggregates cover.
  const metricSparklines = useMemo(() => {
    if (!trendsData?.issues || trendsData.issues.length < 2) {
      return null;
    }

    const chronological = [...trendsData.issues].sort((a, b) => parseInt(a.id) - parseInt(b.id));

    return {
      openRate: chronological.map(issue => issue.metrics.openRate),
      clickToOpenRate: chronological.map(issue => issue.metrics.clickToOpenRate),
      delivered: chronological.map(issue => issue.metrics.delivered),
    };
  }, [trendsData]);

  const deliverabilityMetrics = useMemo(() => {
    if (!trendsData?.aggregates) {
      return null;
    }

    const totalComplaints = trendsData.issues.reduce((sum, issue) => sum + (issue.metrics.complaints || 0), 0);
    const totalDelivered = trendsData.aggregates.totalDelivered;
    const complaintRate = totalDelivered > 0 ? (totalComplaints / totalDelivered) * 100 : 0;
    const bounceRate = trendsData.aggregates.avgBounceRate;

    let senderStatus: 'healthy' | 'warning' | 'critical' = 'healthy';

    if (complaintRate > 0.1 || bounceRate > 5) {
      senderStatus = 'critical';
    } else if (complaintRate > 0.05 || bounceRate > 2) {
      senderStatus = 'warning';
    }

    return {
      totalComplaints,
      complaintRate,
      bounceRate,
      senderStatus
    };
  }, [trendsData]);

  const loadProfileData = useCallback(async () => {
    try {
      const response = await profileService.getProfile();
      if (response.success && response.data) {
        setProfile(response.data);
      }
    } catch (err) {
      console.error('Profile data error:', err);
    }
  }, []);

  const loadTrendsData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const response = await dashboardService.getTrends(issueCount);

      if (response.success && response.data) {
        setTrendsData(response.data);
      } else {
        const errorMsg = response.error || 'Failed to load trends data';
        if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
          setError('Your session has expired. Please log in again.');
        } else if (errorMsg.includes('403') || errorMsg.includes('Forbidden')) {
          setError('You do not have permission to view this data.');
        } else if (errorMsg.includes('Network') || errorMsg.includes('network')) {
          setError('Unable to connect. Please check your internet connection.');
        } else if (errorMsg.includes('500') || errorMsg.includes('Server')) {
          setError('Something went wrong on our end. Please try again.');
        } else {
          setError(errorMsg);
        }
      }
    } catch (err) {
      console.error('Trends data error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to load trends data';
      if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
        setError('Your session has expired. Please log in again.');
      } else if (errorMsg.includes('403') || errorMsg.includes('Forbidden')) {
        setError('You do not have permission to view this data.');
      } else if (errorMsg.includes('Network') || errorMsg.includes('network') || errorMsg.includes('Failed to fetch')) {
        setError('Unable to connect. Please check your internet connection.');
      } else if (errorMsg.includes('500') || errorMsg.includes('Server')) {
        setError('Something went wrong on our end. Please try again.');
      } else if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
        setError('Request timed out. Please try again.');
      } else {
        setError('Failed to load trends data. Please try again.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [issueCount]);

  const loadAbHistory = useCallback(async () => {
    try {
      setAbHistoryLoading(true);
      setAbHistoryError(null);
      const response = await issuesService.getAbHistory();
      if (response.success && response.data) {
        setAbHistory(response.data);
      } else {
        setAbHistoryError(response.error || 'Failed to load A/B test history');
      }
    } catch (err) {
      console.error('A/B history error:', err);
      setAbHistoryError(err instanceof Error ? err.message : 'Failed to load A/B test history');
    } finally {
      setAbHistoryLoading(false);
    }
  }, []);

  const loadActiveAbTests = useCallback(async () => {
    try {
      setActiveAbLoading(true);
      setActiveAbError(null);
      const response = await issuesService.getActiveAbTests();
      if (response.success && response.data) {
        setActiveAbTests(response.data.tests);
      } else {
        setActiveAbError(response.error || 'Failed to load running A/B tests');
      }
    } catch (err) {
      console.error('Active A/B tests error:', err);
      setActiveAbError(err instanceof Error ? err.message : 'Failed to load running A/B tests');
    } finally {
      setActiveAbLoading(false);
    }
  }, []);

  const handleRefresh = () => {
    dashboardService.invalidateTrendsCache();
    loadTrendsData(true);
    loadAbHistory();
    loadActiveAbTests();
  };

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (showAllIssues) {
      params.set('issues', 'all');
    } else {
      params.delete('issues');
    }
    if (rightPanelTab !== 'quality') {
      params.set('insights', rightPanelTab);
    } else {
      params.delete('insights');
    }
    setSearchParams(params, { replace: true });
  }, [searchParams, showAllIssues, rightPanelTab, setSearchParams]);

  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);

  useEffect(() => {
    loadTrendsData();
  }, [loadTrendsData]);

  useEffect(() => {
    loadAbHistory();
  }, [loadAbHistory]);

  useEffect(() => {
    loadActiveAbTests();
  }, [loadActiveAbTests]);

  const formatPercentage = (value: number) => `${value.toFixed(1)}%`;
  const formatNumber = (value: number) => value.toLocaleString();
  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-7xl mx-auto py-2 sm:px-6 lg:px-8">
          <div className="px-4 py-4 sm:px-0">
            <div className="mb-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
              <div className="min-w-0">
                <h2 className="text-xl sm:text-2xl font-bold text-foreground">
                  {user?.firstName ? `${greeting}, ${user.firstName}` : greeting}!
                </h2>
                <p className="text-muted-foreground mt-1 text-sm sm:text-base truncate">
                  Loading analytics...
                </p>
              </div>
            </div>
            <DashboardSkeleton />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-2 sm:px-6 lg:px-8">
        <div className="px-4 py-4 sm:px-0">
          {/* Dashboard Controls */}
          <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-surface via-surface to-primary-50/70 shadow-soft mb-4">
            <div
              className="pointer-events-none absolute -top-24 -right-16 w-72 h-72 rounded-full bg-primary-500/10 blur-3xl"
              aria-hidden="true"
            />
            <div className="relative p-4 sm:p-6 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold font-display text-foreground">
                {user?.firstName ? `${greeting}, ${user.firstName}` : greeting}!
              </h2>
              <p className="text-muted-foreground mt-1 text-sm sm:text-base truncate">
                {profile?.brand?.brandName ? `${profile.brand.brandName} Analytics` : 'Newsletter Analytics'}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
              {/* Issue Count Selector */}
              <select
                value={issueCount}
                onChange={(e) => setIssueCount(Number(e.target.value))}
                className="text-sm border border-border rounded-md px-3 py-2.5 bg-surface focus:outline-none focus:ring-2 focus:ring-ring min-h-[44px] touch-manipulation"
              >
                <option value={5}>Last 5 issues</option>
                <option value={10}>Last 10 issues</option>
                <option value={20}>Last 20 issues</option>
                <option value={50}>Last 50 issues</option>
              </select>

              {/* Refresh Button */}
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="inline-flex items-center justify-center px-4 py-2.5 border border-border shadow-sm text-sm font-medium rounded-md text-muted-foreground bg-surface hover:bg-background focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring disabled:opacity-50 min-h-[44px] touch-manipulation"
                aria-label={refreshing ? 'Refreshing data' : 'Refresh data'}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{refreshing ? 'Refreshing...' : 'Refresh'}</span>
                <span className="sm:hidden">{refreshing ? '...' : 'Refresh'}</span>
              </button>
            </div>
            </div>
          </div>
          {error ? (
            <div className="bg-error-50 border border-error-200 rounded-md p-4 mb-6" role="alert" aria-live="assertive">
              <div className="flex">
                <AlertCircle className="h-5 w-5 text-error-400 flex-shrink-0" aria-hidden="true" />
                <div className="ml-3 flex-1">
                  <h3 className="text-sm font-medium text-error-800">
                    Error loading dashboard data
                  </h3>
                  <div className="mt-2 text-sm text-error-700">
                    <p>{error}</p>
                  </div>
                  <div className="mt-4">
                    <button
                      onClick={() => loadTrendsData()}
                      className="bg-error-100 px-3 py-2 rounded-md text-sm font-medium text-error-800 hover:bg-error-200 focus:outline-none focus:ring-2 focus:ring-error-500 focus:ring-offset-2"
                      aria-label="Retry loading dashboard data"
                    >
                      Try again
                    </button>
                    <button
                      onClick={() => navigate('/issues')}
                      className="ml-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      aria-label="View issues list"
                    >
                      View issues
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : trendsData ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm uppercase tracking-widest text-muted-foreground">Overview</h3>
              </div>
              {/* Key Metrics Grid - Primary metrics visible without scrolling */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                <MetricsCard
                  title="Average Open Rate"
                  value={trendsData.aggregates.avgOpenRate}
                  format="percentage"
                  icon={TrendingUp}
                  trendComparison={trendComparisons?.openRate}
                  healthStatus={healthStatuses?.openRate}
                  sparkline={metricSparklines?.openRate}
                />
                <MetricsCard
                  title="Avg Click-to-Open Rate"
                  value={trendsData.aggregates.avgClickToOpenRate}
                  format="percentage"
                  icon={MousePointer}
                  trendComparison={trendComparisons?.clickToOpenRate}
                  healthStatus={healthStatuses?.clickToOpenRate}
                  sparkline={metricSparklines?.clickToOpenRate}
                />
                <MetricsCard
                  title="Total Delivered"
                  value={trendsData.aggregates.totalDelivered}
                  format="number"
                  icon={Mail}
                  trendComparison={trendComparisons?.delivered}
                  sparkline={metricSparklines?.delivered}
                />
              </div>

              {/* Secondary Metrics Row - Compact layout */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                {/* Consolidated Sending Health Widget */}
                {deliverabilityMetrics && (
                  <Suspense fallback={<div className="bg-surface rounded-xl border border-border shadow-soft p-4 animate-pulse h-32" />}>
                    <SendingHealthWidget
                      totalComplaints={deliverabilityMetrics.totalComplaints}
                      complaintRate={deliverabilityMetrics.complaintRate}
                      bounceRate={deliverabilityMetrics.bounceRate}
                      senderStatus={deliverabilityMetrics.senderStatus}
                    />
                  </Suspense>
                )}

                {/* Actionable Insights */}
                <Suspense fallback={<div className="bg-surface rounded-xl border border-border shadow-soft p-4 animate-pulse h-32" />}>
                  <ActionableInsights trendsData={trendsData} />
                </Suspense>
              </div>

              {/* Performance Overview - Below the fold */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
                <div className="lg:col-span-2 space-y-3 sm:space-y-4">
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <h3 className="text-sm uppercase tracking-widest text-muted-foreground">Trends</h3>
                  </div>

                  {/* Latest Issue Performance (moved up) */}
                  {trendsData.issues.length > 0 && (
                    <div className="bg-surface rounded-xl border border-border shadow-soft p-3 sm:p-4">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-3 gap-1">
                        <h3 className="text-sm sm:text-base font-medium text-foreground flex items-center gap-2">
                          Latest Issue Performance
                          <InfoTooltip
                            label="Latest issue performance"
                            description="Snapshot of the most recent published issue so you can quickly spot outliers."
                          />
                        </h3>
                        <span className="text-xs sm:text-sm text-muted-foreground">Issue #{trendsData.issues[0].id}</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Opens</div>
                          <div className="text-lg sm:text-xl font-bold font-display text-foreground tabular-nums">{formatNumber(trendsData.issues[0].metrics.opens)}</div>
                          <div className="text-xs text-muted-foreground">{formatPercentage(trendsData.issues[0].metrics.openRate)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Clicks</div>
                          <div className="text-lg sm:text-xl font-bold font-display text-foreground tabular-nums">{formatNumber(trendsData.issues[0].metrics.clicks)}</div>
                          <div className="text-xs text-muted-foreground">
                            CTR {formatPercentage(trendsData.issues[0].metrics.clickRate)} · CTOR {formatPercentage(trendsData.issues[0].metrics.clickToOpenRate)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Bounces</div>
                          <div className="text-lg sm:text-xl font-bold font-display text-foreground tabular-nums">{formatNumber(trendsData.issues[0].metrics.bounces)}</div>
                          <div className="text-xs text-muted-foreground">{formatPercentage(trendsData.issues[0].metrics.bounceRate)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Delivered</div>
                          <div className="text-lg sm:text-xl font-bold font-display text-foreground tabular-nums">{formatNumber(trendsData.issues[0].metrics.delivered)}</div>
                          <div className="text-xs text-muted-foreground">Total sent</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Subscribers</div>
                          <div className="text-lg sm:text-xl font-bold font-display text-foreground tabular-nums">{formatNumber(trendsData.issues[0].metrics.subscribers)}</div>
                          <div className="text-xs text-muted-foreground">List size</div>
                        </div>
                      </div>
                      {trendsData.issues[0].metrics.complaints > 0 && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <div className="flex items-center text-xs sm:text-sm">
                            <AlertCircle className="w-4 h-4 mr-2 text-error-500 flex-shrink-0" />
                            <span className="text-muted-foreground">Complaints:</span>
                            <span className="ml-2 font-medium text-foreground">{formatNumber(trendsData.issues[0].metrics.complaints)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {trendsData.issues.length > 0 ? (
                    <Suspense fallback={<div className="bg-surface rounded-xl border border-border shadow-soft p-6 animate-pulse h-64" />}>
                      <IssuePerformanceChart trendsData={trendsData} />
                    </Suspense>
                  ) : (
                    <div className="bg-surface rounded-xl border border-border shadow-soft p-6">
                      <h3 className="text-lg font-medium text-foreground mb-4">Newsletter Issue Performance</h3>
                      <div className="text-center py-12">
                        <BarChart3 className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-2 text-sm font-medium text-foreground">No issues found</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          No newsletter issues have been published yet.
                        </p>
                        <div className="mt-4">
                          <button
                            onClick={() => navigate('/issues/new')}
                            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                            aria-label="Create a new issue"
                          >
                            Create your first issue
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Recent Issues */}
                  {trendsData.issues.length > 0 && (
                    <div className="bg-surface rounded-xl border border-border shadow-soft overflow-hidden">
                      <div className="px-3 sm:px-4 py-3 border-b border-border flex items-center justify-between">
                        <h3 className="text-sm sm:text-base font-medium text-foreground flex items-center gap-2">
                          Recent Issues
                          <InfoTooltip
                            label="Recent issues"
                            description="Quick access to the latest issues with key performance metrics."
                          />
                        </h3>
                        <button
                          onClick={() => setShowAllIssues(prev => !prev)}
                          className="text-xs sm:text-sm text-primary-600 hover:text-primary-700 font-medium"
                          aria-label={showAllIssues ? 'Show fewer issues' : 'Show all issues'}
                        >
                          {showAllIssues ? 'Show less' : 'Show all'}
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-border">
                          <thead className="bg-background">
                            <tr>
                              <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Issue
                              </th>
                              <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Open Rate
                              </th>
                              <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                                Click Rate
                              </th>
                              <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                                Trend
                              </th>
                              <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden xl:table-cell">
                                Delivered
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-surface divide-y divide-border">
                            {trendsData.issues.slice(0, showAllIssues ? 10 : 5).map((issue) => (
                              <tr
                                key={issue.id}
                                className="hover:bg-background cursor-pointer"
                                onClick={() => navigate(`/issues/${issue.id}`)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    navigate(`/issues/${issue.id}`);
                                  }
                                }}
                                tabIndex={0}
                                role="link"
                                aria-label={`View issue ${issue.id} details`}
                              >
                                <td className="px-3 sm:px-6 py-3 sm:py-4">
                                  <span className="text-xs sm:text-sm font-medium text-foreground">
                                    Issue #{issue.id}
                                  </span>
                                </td>
                                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-foreground">
                                  {formatPercentage(issue.metrics.openRate)}
                                </td>
                                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-foreground hidden md:table-cell">
                                  {formatPercentage(issue.metrics.clickRate)}
                                </td>
                                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap hidden lg:table-cell">
                                  <MiniSparkline
                                    value={issue.metrics.openRate}
                                    average={trendsData.aggregates.avgOpenRate}
                                  />
                                </td>
                                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-foreground hidden xl:table-cell">
                                  {formatNumber(issue.metrics.delivered)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-3 sm:space-y-4">
                  <div className="flex items-center justify-between pt-2 border-t border-border lg:border-t-0 lg:pt-0">
                    <h3 className="text-sm uppercase tracking-widest text-muted-foreground">Insights</h3>
                  </div>
                  {/* Subscriber Growth */}
                  {trendsData.issues.length > 0 && (
                    <div className="bg-surface rounded-xl border border-border shadow-soft p-3 sm:p-4">
                      <div className="mb-3">
                        <h3 className="text-sm sm:text-base font-medium text-foreground flex items-center gap-2">
                          Subscriber Growth
                          <InfoTooltip
                            label="Subscriber growth"
                            description="Tracks list size across issues to show growth or churn trends."
                          />
                        </h3>
                        <p className="text-xs sm:text-sm text-muted-foreground mt-1">Last {Math.min(issueCount, trendsData.issues.length)} issues</p>
                      </div>
                      <SubscriberGrowthChart trendsData={trendsData} />
                    </div>
                  )}

                  {/* Top Regions */}
                  {trendsData.issues.length > 0 && (
                    <Suspense fallback={<div className="bg-surface rounded-xl border border-border shadow-soft p-4 animate-pulse h-32" />}>
                      <TopRegionsWidget latestIssueId={trendsData.issues[0].id} />
                    </Suspense>
                  )}

                  <div className="bg-surface rounded-xl border border-border shadow-soft p-3 sm:p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm sm:text-base font-medium text-foreground flex items-center gap-2">
                        {rightPanelTab === 'quality'
                            ? 'Quality Signals'
                            : rightPanelTab === 'engagement'
                              ? 'Engagement Trends'
                              : 'Traffic Source Trends'}
                        <InfoTooltip
                          label="Insights panel"
                          description="Switch between quality, engagement, and traffic trends."
                        />
                      </h3>
                      <select
                        value={rightPanelTab}
                        onChange={(e) => setRightPanelTab(e.target.value as typeof rightPanelTab)}
                        className="sm:hidden w-full text-sm border border-border rounded-md px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-ring"
                        aria-label="Select insights tab"
                      >
                        <option value="quality">Quality</option>
                        <option value="engagement">Engagement</option>
                        <option value="traffic">Traffic</option>
                      </select>
                      <div
                        className="hidden sm:inline-flex rounded-lg border border-border bg-muted/30 p-0.5"
                        role="group"
                        aria-label="Insights panel view"
                      >
                        <button
                          onClick={() => setRightPanelTab('quality')}
                          aria-pressed={rightPanelTab === 'quality'}
                          className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors ${
                            rightPanelTab === 'quality'
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                          aria-label="Show quality signals"
                        >
                          Quality
                        </button>
                        <button
                          onClick={() => setRightPanelTab('engagement')}
                          aria-pressed={rightPanelTab === 'engagement'}
                          className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors ${
                            rightPanelTab === 'engagement'
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                          aria-label="Show engagement trends"
                        >
                          Engagement
                        </button>
                        <button
                          onClick={() => setRightPanelTab('traffic')}
                          aria-pressed={rightPanelTab === 'traffic'}
                          className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors ${
                            rightPanelTab === 'traffic'
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                          aria-label="Show traffic source trends"
                        >
                          Traffic
                        </button>
                      </div>
                    </div>

                    {rightPanelTab === 'quality' ? (
                      <Suspense fallback={<div className="bg-muted rounded-lg h-44 animate-pulse" />}>
                        <QualitySignalsChart trendsData={trendsData} />
                      </Suspense>
                    ) : rightPanelTab === 'engagement' ? (
                      <Suspense fallback={<div className="bg-muted rounded-lg h-40 animate-pulse" />}>
                        <EngagementTypeTrendChart trendsData={trendsData} />
                      </Suspense>
                    ) : (
                      <Suspense fallback={<div className="bg-muted rounded-lg h-40 animate-pulse" />}>
                        <TrafficSourceTrendChart trendsData={trendsData} />
                      </Suspense>
                    )}
                  </div>
                </div>
              </div>

              {/* A/B Test History */}
              <div className="space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <h3 className="text-sm uppercase tracking-widest text-muted-foreground">A/B Testing</h3>
                </div>
                {/* In-progress tests (running now) surface above the completed history. */}
                {(activeAbLoading || activeAbError || activeAbTests.length > 0) && (
                  <Suspense fallback={<div className="bg-surface rounded-xl border border-border shadow-soft p-6 animate-pulse h-32" />}>
                    <AbTestInProgress
                      tests={activeAbTests}
                      loading={activeAbLoading}
                      error={activeAbError}
                      onRetry={loadActiveAbTests}
                    />
                  </Suspense>
                )}
                <Suspense fallback={<div className="bg-surface rounded-xl border border-border shadow-soft p-6 animate-pulse h-48" />}>
                  <AbTestHistory
                    data={abHistory}
                    loading={abHistoryLoading}
                    error={abHistoryError}
                    onRetry={loadAbHistory}
                  />
                </Suspense>
              </div>

            </div>
          ) : (
            <div className="text-center py-12">
              <div className="text-muted-foreground">No dashboard data available</div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
