
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { dashboardService } from '@/services/dashboardService';
import { Loading } from '@/components/ui/Loading';
import MetricsCard from '@/components/MetricsCard';
import IssuePerformanceChart from '@/components/IssuePerformanceChart';
import { EngagementMetrics } from '@/components/EngagementMetrics';
import { SenderStatusWidget } from '@/components/senders/SenderStatusWidget';
import { NotificationDebug } from '@/components/notifications/NotificationDebug';
import type { DashboardData } from '@/types/api';
import {
  Users,
  Mail,
  TrendingUp,
  MousePointer,
  RefreshCw,
  AlertCircle,
  Calendar,
  BarChart3
} from 'lucide-react';

export function DashboardPage() {
  const { } = useAuth();
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState('30d');

  const loadDashboardData = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const response = await dashboardService.getDashboardData(timeframe);

      if (response.success && response.data) {
        setDashboardData(response.data);
      } else {
        setError(response.error || 'Failed to load dashboard data');
      }
    } catch (err) {
      console.error('Dashboard data error:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    loadDashboardData(true);
  };

  useEffect(() => {
    loadDashboardData();
  }, [timeframe]);

  const formatPercentage = (value: number) => `${(value * 100).toFixed(1)}%`;
  const formatNumber = (value: number) => value.toLocaleString();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <Loading size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
        <div className="px-0">
          {/* Dashboard Controls */}
          <div className="mb-6 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                Dashboard
              </h2>
              <p className="text-gray-600 mt-1 text-sm sm:text-base truncate">
                {dashboardData?.tenant.name ? `${dashboardData.tenant.name} Analytics` : 'Newsletter Analytics'}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
              {/* Timeframe Selector */}
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="text-sm border border-gray-300 rounded-md px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] touch-manipulation"
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
              </select>

              {/* Refresh Button */}
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="inline-flex items-center justify-center px-4 py-2.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 min-h-[44px] touch-manipulation"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{refreshing ? 'Refreshing...' : 'Refresh'}</span>
                <span className="sm:hidden">{refreshing ? '...' : 'Refresh'}</span>
              </button>
            </div>
          </div>
          {error ? (
            <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
              <div className="flex">
                <AlertCircle className="h-5 w-5 text-red-400" />
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">
                    Error loading dashboard data
                  </h3>
                  <div className="mt-2 text-sm text-red-700">
                    <p>{error}</p>
                  </div>
                  <div className="mt-4">
                    <button
                      onClick={() => loadDashboardData()}
                      className="bg-red-100 px-3 py-2 rounded-md text-sm font-medium text-red-800 hover:bg-red-200"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : dashboardData ? (
            <div className="space-y-6">
              {/* Key Metrics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                <MetricsCard
                  title="Total Subscribers"
                  value={dashboardData.tenant.subscribers}
                  change={dashboardData.subscriberMetrics.growth['30d']}
                  format="number"
        icon={Users}
                />
                <MetricsCard
                  title="Total Issues Sent"
                  value={dashboardData.tenant.totalIssues}
                  format="number"
                  icon={Mail}
                />
                <MetricsCard
                  title="Average Open Rate"
                  value={dashboardData.performanceOverview.avgOpenRate}
                  format="percentage"
                  icon={TrendingUp}
                />
                <MetricsCard
                  title="Average Click Rate"
                  value={dashboardData.performanceOverview.avgClickRate}
                  format="percentage"
                  icon={MousePointer}
                />
              </div>

              {/* Performance Overview */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                <div className="lg:col-span-2">
                  {dashboardData.issues.length > 0 ? (
                    <IssuePerformanceChart issues={dashboardData.issues} />
                  ) : (
                    <div className="bg-white rounded-lg shadow p-6">
                      <h3 className="text-lg font-medium text-gray-900 mb-4">Newsletter Issue Performance</h3>
                      <div className="text-center py-12">
                        <BarChart3 className="mx-auto h-12 w-12 text-gray-400" />
                        <h3 className="mt-2 text-sm font-medium text-gray-900">No issues found</h3>
                        <p className="mt-1 text-sm text-gray-500">
                          No newsletter issues have been sent in the selected timeframe.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  {/* Sender Status Widget */}
                  <SenderStatusWidget />

                  {/* Performance Summary */}
                  <div className="bg-white rounded-lg shadow p-6">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Performance Summary</h3>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Open Rate</span>
                        <span className="font-medium">{formatPercentage(dashboardData.performanceOverview.avgOpenRate / 100)}</span>
                      </div>
                      <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full"
                          style={{ width: `${Math.min(dashboardData.performanceOverview.avgOpenRate, 100)}%` }}
                        ></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Click Rate</span>
                        <span className="font-medium">{formatPercentage(dashboardData.performanceOverview.avgClickRate / 100)}</span>
                      </div>
                      <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-green-600 h-2 rounded-full"
                          style={{ width: `${Math.min(dashboardData.performanceOverview.avgClickRate, 100)}%` }}
                        ></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Bounce Rate</span>
                        <span className="font-medium">{formatPercentage(dashboardData.performanceOverview.avgBounceRate / 100)}</span>
                      </div>
                      <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-red-600 h-2 rounded-full"
                          style={{ width: `${Math.min(dashboardData.performanceOverview.avgBounceRate, 100)}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-gray-200">
                      <div className="text-sm text-gray-600">Total Emails Sent</div>
                      <div className="text-2xl font-semibold text-gray-900">
                        {formatNumber(dashboardData.performanceOverview.totalSent)}
                      </div>
                    </div>

                    {dashboardData.performanceOverview.bestPerformingIssue && (
                      <div className="pt-4 border-t border-gray-200">
                        <div className="text-sm text-gray-600">Best Performing Issue</div>
                        <div className="text-sm font-medium text-gray-900 mt-1">
                          {dashboardData.performanceOverview.bestPerformingIssue.title}
                        </div>
                        <div className="text-xs text-gray-500">
                          {formatPercentage((dashboardData.performanceOverview.bestPerformingIssue.metrics?.openRate || 0) / 100)} open rate
                        </div>
                      </div>
                    )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Engagement Metrics */}
              {dashboardData.performanceOverview.totalSent > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                  <EngagementMetrics performanceOverview={dashboardData.performanceOverview} />

                  {/* Subscriber Growth */}
                  <div className="bg-white rounded-lg shadow p-6">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Subscriber Growth</h3>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Current Subscribers</span>
                        <span className="text-2xl font-semibold text-gray-900">
                          {formatNumber(dashboardData.subscriberMetrics.current)}
                        </span>
                      </div>

                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">7-day growth</span>
                          <span className={`text-sm font-medium ${
                            dashboardData.subscriberMetrics.growth['7d'] >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {dashboardData.subscriberMetrics.growth['7d'] >= 0 ? '+' : ''}
                            {dashboardData.subscriberMetrics.growth['7d']}
                          </span>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">30-day growth</span>
                          <span className={`text-sm font-medium ${
                            dashboardData.subscriberMetrics.growth['30d'] >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {dashboardData.subscriberMetrics.growth['30d'] >= 0 ? '+' : ''}
                            {dashboardData.subscriberMetrics.growth['30d']}
                          </span>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">90-day growth</span>
                          <span className={`text-sm font-medium ${
                            dashboardData.subscriberMetrics.growth['90d'] >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {dashboardData.subscriberMetrics.growth['90d'] >= 0 ? '+' : ''}
                            {dashboardData.subscriberMetrics.growth['90d']}
                          </span>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-gray-200">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Churn Rate</span>
                          <span className="text-sm font-medium text-gray-900">
                            {formatPercentage(dashboardData.subscriberMetrics.churnRate / 100)}
                          </span>
                        </div>

                        <div className="flex justify-between items-center mt-2">
                          <span className="text-sm text-gray-600">Engagement Rate</span>
                          <span className="text-sm font-medium text-gray-900">
                            {formatPercentage(dashboardData.subscriberMetrics.engagementRate / 100)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Recent Issues */}
              {dashboardData.issues.length > 0 && (
                <div className="bg-white rounded-lg shadow">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-medium text-gray-900">Recent Issues</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Issue
                          </th>
                          <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                            Sent Date
                          </th>
                          <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Open Rate
                          </th>
                          <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
                            Click Rate
                          </th>
                          <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">
                            Delivered
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {dashboardData.issues.slice(0, 10).map((issue) => (
                          <tr key={issue.id} className="hover:bg-gray-50">
                            <td className="px-4 sm:px-6 py-4">
                              <div className="text-sm font-medium text-gray-900 truncate max-w-xs">{issue.title}</div>
                              <div className="text-sm text-gray-500 truncate max-w-xs sm:hidden">
                                {new Date(issue.sentDate).toLocaleDateString()}
                              </div>
                              <div className="text-xs text-gray-500 truncate max-w-xs hidden sm:block">{issue.id}</div>
                            </td>
                            <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900 hidden sm:table-cell">
                              <div className="flex items-center">
                                <Calendar className="w-4 h-4 mr-2 text-gray-400" />
                                {new Date(issue.sentDate).toLocaleDateString()}
                              </div>
                            </td>
                            <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {issue.metrics?.openRate ? formatPercentage(issue.metrics.openRate / 100) : 'N/A'}
                            </td>
                            <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900 hidden md:table-cell">
                              {issue.metrics?.clickThroughRate ? formatPercentage(issue.metrics.clickThroughRate / 100) : 'N/A'}
                            </td>
                            <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900 hidden lg:table-cell">
                              {issue.metrics?.delivered ? formatNumber(issue.metrics.delivered) : 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Notification Debug Panel - Development Only */}
              {process.env.NODE_ENV === 'development' && (
                <NotificationDebug />
              )}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="text-gray-500">No dashboard data available</div>
            </div>
          )}
        </div>
    </div>
  );
}
