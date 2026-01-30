
import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { dashboardService } from '@/services/dashboardService';
import { profileService } from '@/services/profileService';
import { Loading } from '@/components/ui/Loading';
import { DashboardSkeleton } from '@/components/ui/SkeletonLoader';
import MetricsCard from '@/components/MetricsCard';
import { MaxMindAttribution } from '@/components/analytics';
import type { TrendsData, UserProfile, TrendComparison, BestWorstIssues } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { calculatePercentageDifference, calculateHealthStatus, calculateCompositeScore } from '@/utils/analyticsCalculations';
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
const SenderStatusWidget = lazy(() => import('@/components/senders/SenderStatusWidget').then(m => ({ default: m.SenderStatusWidget })));
const BestWorstIssueCard = lazy(() => import('@/components/BestWorstIssueCard'));
const DeliverabilityHealthWidget = lazy(() => import('@/components/DeliverabilityHealthWidget'));

export function DashboardPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [trendsData, setTrendsData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issueCount, setIssueCount] = useState(10);

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
      bounceRate: calculateHealthStatus(current.avgBounceRate, previous.avgBounceRate, { good: 5, warning: 10 })
    };
  }, [trendsData]);

  const bestWorstIssues = useMemo((): BestWorstIssues | null => {
    if (!trendsData?.issues || trendsData.issues.length === 0) {
      return null;
    }

    const issuesWithScores = trendsData.issues.map(issue => ({
      id: issue.id,
      issueNumber: parseInt(issue.id, 10),
      score: calculateCompositeScore(issue.metrics)
    }));

    issuesWithScores.sort((a, b) => b.score - a.score);

    return {
      best: issuesWithScores.length > 0 ? issuesWithScores[0] : null,
      worst: issuesWithScores.length > 0 ? issuesWithScores[issuesWithScores.length - 1] : null
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

  const handleRefresh = () => {
    dashboardService.invalidateTrendsCache();
    loadTrendsData(true);
  };

  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);

  useEffect(() => {
    loadTrendsData();
  }, [loadTrendsData]);

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
        <AppHeader />
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
      <AppHeader />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-2 sm:px-6 lg:px-8">
        <div className="px-4 py-4 sm:px-0">
          {/* Dashboard Controls */}
          <div className="mb-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold text-foreground">
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
                  </div>
                </div>
              </div>
            </div>
          ) : trendsData ? (
            <div className="space-y-4">
              {/* Key Metrics Grid - Primary metrics visible without scrolling */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                <MetricsCard
                  title="Average Open Rate"
                  value={trendsData.aggregates.avgOpenRate}
                  format="percentage"
                  icon={TrendingUp}
                  trendComparison={trendComparisons?.openRate}
                  healthStatus={healthStatuses?.openRate}
                />
                <MetricsCard
                  title="Average Click Rate"
                  value={trendsData.aggregates.avgClickRate}
                  format="percentage"
                  icon={MousePointer}
                  trendComparison={trendComparisons?.clickRate}
                  healthStatus={healthStatuses?.clickRate}
                />
                <MetricsCard
                  title="Total Delivered"
                  value={trendsData.aggregates.totalDelivered}
                  format="number"
                  icon={Mail}
                  trendComparison={trendComparisons?.delivered}
                />
              </div>

              {/* Secondary Metrics Row - Compact layout */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {/* Sender Status Widget */}
                <Suspense fallback={<div className="bg-surface rounded-lg shadow p-4 animate-pulse h-32" />}>
                  <SenderStatusWidget />
                </Suspense>

                {/* Deliverability Health Widget */}
                {deliverabilityMetrics && (
                  <Suspense fallback={<div className="bg-surface rounded-lg shadow p-4 animate-pulse h-32" />}>
                    <DeliverabilityHealthWidget
                      totalComplaints={deliverabilityMetrics.totalComplaints}
                      complaintRate={deliverabilityMetrics.complaintRate}
                      bounceRate={deliverabilityMetrics.bounceRate}
                      senderStatus={deliverabilityMetrics.senderStatus}
                    />
                  </Suspense>
                )}

                {/* Best/Worst Issue Card */}
                {bestWorstIssues && (
                  <Suspense fallback={<div className="bg-surface rounded-lg shadow p-4 animate-pulse h-32" />}>
                    <BestWorstIssueCard
                      bestIssue={bestWorstIssues.best}
                      worstIssue={bestWorstIssues.worst}
                    />
                  </Suspense>
                )}
              </div>

              {/* Performance Overview - Below the fold */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
                <div className="lg:col-span-2 space-y-3 sm:space-y-4">
                  {trendsData.issues.length > 0 ? (
                    <Suspense fallback={<div className="bg-surface rounded-lg shadow p-6 animate-pulse h-64" />}>
                      <IssuePerformanceChart trendsData={trendsData} />
                    </Suspense>
                  ) : (
                    <div className="bg-surface rounded-lg shadow p-6">
                      <h3 className="text-lg font-medium text-foreground mb-4">Newsletter Issue Performance</h3>
                      <div className="text-center py-12">
                        <BarChart3 className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-2 text-sm font-medium text-foreground">No issues found</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          No newsletter issues have been published yet.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Most Recent Issue Stats */}
                  {trendsData.issues.length > 0 && (
                    <div className="bg-surface rounded-lg shadow p-3 sm:p-4">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-3 gap-1">
                        <h3 className="text-sm sm:text-base font-medium text-foreground">Latest Issue Performance</h3>
                        <span className="text-xs sm:text-sm text-muted-foreground">Issue #{trendsData.issues[0].id}</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Opens</div>
                          <div className="text-lg sm:text-xl font-semibold text-foreground">{formatNumber(trendsData.issues[0].metrics.opens)}</div>
                          <div className="text-xs text-muted-foreground">{formatPercentage(trendsData.issues[0].metrics.openRate)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Clicks</div>
                          <div className="text-lg sm:text-xl font-semibold text-foreground">{formatNumber(trendsData.issues[0].metrics.clicks)}</div>
                          <div className="text-xs text-muted-foreground">{formatPercentage(trendsData.issues[0].metrics.clickRate)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Bounces</div>
                          <div className="text-lg sm:text-xl font-semibold text-foreground">{formatNumber(trendsData.issues[0].metrics.bounces)}</div>
                          <div className="text-xs text-muted-foreground">{formatPercentage(trendsData.issues[0].metrics.bounceRate)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Delivered</div>
                          <div className="text-lg sm:text-xl font-semibold text-foreground">{formatNumber(trendsData.issues[0].metrics.delivered)}</div>
                          <div className="text-xs text-muted-foreground">Total sent</div>
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

                  {/* Recent Issues */}
                  {trendsData.issues.length > 0 && (
                    <div className="bg-surface rounded-lg shadow overflow-hidden">
                      <div className="px-3 sm:px-4 py-3 border-b border-border">
                        <h3 className="text-sm sm:text-base font-medium text-foreground">Recent Issues</h3>
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
                                Delivered
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-surface divide-y divide-border">
                            {trendsData.issues.slice(0, 10).map((issue) => (
                              <tr key={issue.id} className="hover:bg-background">
                                <td className="px-3 sm:px-6 py-3 sm:py-4">
                                  <div className="text-xs sm:text-sm font-medium text-foreground">Issue #{issue.id}</div>
                                </td>
                                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-foreground">
                                  {formatPercentage(issue.metrics.openRate)}
                                </td>
                                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-foreground hidden md:table-cell">
                                  {formatPercentage(issue.metrics.clickRate)}
                                </td>
                                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-foreground hidden lg:table-cell">
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
                  {/* Performance Summary */}
                  <div className="bg-surface rounded-lg shadow p-3 sm:p-4">
                    <h3 className="text-sm sm:text-base font-medium text-foreground mb-3">Performance Summary</h3>
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-xs sm:text-sm">
                        <span className="text-muted-foreground">Open Rate</span>
                        <span className="font-medium">{formatPercentage(trendsData.aggregates.avgOpenRate)}</span>
                      </div>
                      <div className="mt-1 w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-primary-600 h-2 rounded-full"
                          style={{ width: `${Math.min(trendsData.aggregates.avgOpenRate, 100)}%` }}
                        ></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs sm:text-sm">
                        <span className="text-muted-foreground">Click Rate</span>
                        <span className="font-medium">{formatPercentage(trendsData.aggregates.avgClickRate)}</span>
                      </div>
                      <div className="mt-1 w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-success-600 h-2 rounded-full"
                          style={{ width: `${Math.min(trendsData.aggregates.avgClickRate, 100)}%` }}
                        ></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs sm:text-sm">
                        <span className="text-muted-foreground">Bounce Rate</span>
                        <span className="font-medium">{formatPercentage(trendsData.aggregates.avgBounceRate)}</span>
                      </div>
                      <div className="mt-1 w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-error-600 h-2 rounded-full"
                          style={{ width: `${Math.min(trendsData.aggregates.avgBounceRate, 100)}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-border">
                      <div className="text-xs sm:text-sm text-muted-foreground">Total Emails Delivered</div>
                      <div className="text-lg sm:text-xl font-semibold text-foreground">
                        {formatNumber(trendsData.aggregates.totalDelivered)}
                      </div>
                    </div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          ) : (
            <div className="text-center py-12">
              <div className="text-muted-foreground">No dashboard data available</div>
            </div>
          )}

          {/* MaxMind Attribution */}
          {trendsData && <MaxMindAttribution />}
        </div>
      </main>
    </div>
  );
}
