import React, { useState, useEffect } from 'react';
import { ChartBarIcon, ClockIcon, ServerIcon, CpuChipIcon } from '@heroicons/react/24/outline';

interface PerformanceMetric {
  name: string;
  value: string | number;
  change?: number;
  icon: React.ComponentType<any>;
  color: string;
}

interface CacheStats {
  hitRate: number;
  totalRequests: number;
  avgResponseTime: number;
  memoryUsage: number;
}

export const PerformanceMetrics: React.FC = () => {
  const [cacheStats, setCacheStats] = useState<CacheStats>({
    hitRate: 0,
    totalRequests: 0,
    avgResponseTime: 0,
    memoryUsage: 0
  });

  const [isLoading, setIsLoading] = useState(true);

  // Simulate fetching performance metrics
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        // In a real implementation, this would fetch from CloudWatch or a metrics endpoint
        // For now, we'll simulate some metrics
        await new Promise(resolve => setTimeout(resolve, 1000));

        setCacheStats({
          hitRate: 85.2,
          totalRequests: 1247,
          avgResponseTime: 145,
          memoryUsage: 67.3
        });
      } catch (error) {
        console.error('Failed to fetch performance metrics:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMetrics();

    // Refresh metrics every 30 seconds
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, []);

  const metrics: PerformanceMetric[] = [
    {
      name: 'Cache Hit Rate',
      value: `${cacheStats.hitRate.toFixed(1)}%`,
      change: 2.1,
      icon: ChartBarIcon,
      color: 'text-green-600'
    },
    {
      name: 'Avg Response Time',
      value: `${cacheStats.avgResponseTime}ms`,
      change: -12.5,
      icon: ClockIcon,
      color: 'text-blue-600'
    },
    {
      name: 'Total Requests',
      value: cacheStats.totalRequests.toLocaleString(),
      change: 8.3,
      icon: ServerIcon,
      color: 'text-purple-600'
    },
    {
      name: 'Memory Usage',
      value: `${cacheStats.memoryUsage.toFixed(1)}%`,
      change: -3.2,
      icon: CpuChipIcon,
      color: 'text-orange-600'
    }
  ];

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Performance Metrics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="bg-gray-200 rounded-lg p-4">
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-gray-300 rounded"></div>
                  <div className="ml-3 flex-1">
                    <div className="h-4 bg-gray-300 rounded w-3/4 mb-2"></div>
                    <div className="h-6 bg-gray-300 rounded w-1/2"></div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">Performance Metrics</h3>
        <div className="text-sm text-gray-500">
          Last updated: {new Date().toLocaleTimeString()}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric, index) => (
          <div key={index} className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center">
              <div className={`flex-shrink-0 ${metric.color}`}>
                <metric.icon className="w-8 h-8" />
              </div>
              <div className="ml-3 flex-1">
                <p className="text-sm font-medium text-gray-600">{metric.name}</p>
                <div className="flex items-baseline">
                  <p className="text-2xl font-semibold text-gray-900">{metric.value}</p>
                  {metric.change !== undefined && (
                    <span
                      className={`ml-2 text-sm font-medium ${
                        metric.change > 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {metric.change > 0 ? '+' : ''}{metric.change.toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="font-medium text-gray-600">Cache Status:</span>
            <span className={`ml-2 ${cacheStats.hitRate > 80 ? 'text-green-600' : cacheStats.hitRate > 60 ? 'text-yellow-600' : 'text-red-600'}`}>
              {cacheStats.hitRate > 80 ? 'Excellent' : cacheStats.hitRate > 60 ? 'Good' : 'Needs Improvement'}
            </span>
          </div>
          <div>
            <span className="font-medium text-gray-600">Performance:</span>
            <span className={`ml-2 ${cacheStats.avgResponseTime < 200 ? 'text-green-600' : cacheStats.avgResponseTime < 500 ? 'text-yellow-600' : 'text-red-600'}`}>
              {cacheStats.avgResponseTime < 200 ? 'Fast' : cacheStats.avgResponseTime < 500 ? 'Moderate' : 'Slow'}
            </span>
          </div>
          <div>
            <span className="font-medium text-gray-600">Memory:</span>
            <span className={`ml-2 ${cacheStats.memoryUsage < 70 ? 'text-green-600' : cacheStats.memoryUsage < 85 ? 'text-yellow-600' : 'text-red-600'}`}>
              {cacheStats.memoryUsage < 70 ? 'Healthy' : cacheStats.memoryUsage < 85 ? 'Moderate' : 'High'}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 text-xs text-gray-500">
        <p>
          Cache optimization is active. Templates and snippets are cached for improved performance.
          Hit rate above 80% indicates effective caching strategy.
        </p>
      </div>
    </div>
  );
};
