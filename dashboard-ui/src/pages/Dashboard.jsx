import { useState, useEffect } from 'react';
import { Users, Mail, TrendingUp, BarChart3, RefreshCw } from 'lucide-react';
import MetricsCard from '../components/MetricsCard';
import IssuePerformanceChart from '../components/IssuePerformanceChart';
import { useNotifications } from '../hooks/useNotifications';

export default function Dashboard() {
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeframe, setTimeframe] = useState('30d');

  const { isSubscribed, error: notificationError } = useNotifications();

  useEffect(() => {
    fetchDashboardData();
  }, [timeframe]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      // Replace with your actual API endpoint
      const response = await fetch(`/api/readysetcloud/dashboard?timeframe=${timeframe}`);
      const data = await response.json();
      setDashboardData(data);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Failed to load dashboard: {error}</p>
          <button
            onClick={refresh}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const { tenant, issues, subscriberMetrics, performanceOverview } = dashboardData || {};

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Newsletter Dashboard</h1>
              <p className="text-gray-600">{tenant?.name || 'Ready Set Cloud'}</p>
            </div>
            <div className="flex items-center space-x-4">
              {/* Simple connection status */}
              <div className="flex items-center space-x-2 text-sm">
                <div className={`w-2 h-2 rounded-full ${isSubscribed ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className={isSubscribed ? 'text-green-600' : 'text-red-600'}>
                  {isSubscribed ? 'Live' : 'Offline'}
                </span>
                {notificationError && (
                  <span className="text-red-500 text-xs">({notificationError})</span>
                )}
              </div>

              <button
                onClick={fetchDashboardData}
                className="p-2 hover:bg-gray-100 rounded"
                title="Refresh data"
              >
                <RefreshCw className="w-4 h-4 text-gray-600" />
              </button>

              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 bg-white text-sm"
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <MetricsCard
            title="Total Subscribers"
            value={tenant?.subscribers || 0}
            change={subscriberMetrics?.growth?.[timeframe]}
            icon={Users}
          />
          <MetricsCard
            title="Issues Sent"
            value={tenant?.totalIssues || 0}
            icon={Mail}
          />
          <MetricsCard
            title="Avg Open Rate"
            value={performanceOverview?.avgOpenRate || 0}
            format="percentage"
            icon={TrendingUp}
          />
          <MetricsCard
            title="Avg Click Rate"
            value={performanceOverview?.avgClickRate || 0}
            format="percentage"
            icon={BarChart3}
          />
        </div>

        {/* Performance Chart */}
        <div className="mb-8">
          <IssuePerformanceChart issues={issues} />
        </div>

        {/* Recent Issues Table */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Recent Newsletter Issues</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Issue
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Sent Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Open Rate
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Click Rate
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {issues?.map((issue) => (
                  <tr key={issue.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{issue.title}</div>
                      <div className="text-xs text-gray-500">{issue.id}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(issue.sentDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {issue.metrics?.openRate?.toFixed(2) || 0}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {issue.metrics?.clickThroughRate?.toFixed(2) || 0}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                        Sent
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>


    </div>
  );
}
