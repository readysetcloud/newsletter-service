import React, { memo, useState, useEffect, useCallback } from 'react';
import { Activity, Clock, Database, Zap, TrendingUp, AlertCircle } from 'lucide-react';
import { variableCacheManager } from '@/utils/variableCacheManager';
import { performanceMonitor } from '@/utils/performance';
import { cn } from '@/utils/cn';

interface VariablePerformanceMonitorProps {
  className?: string;
  showDetails?: boolean;
  refreshInterval?: number;
}

interface PerformanceStats {
  cache: {
    search: { total: number; hitRate: number; avgResponseTime: number };
    filter: { total: number; hitRate: number };
    definitions: { total: number; hitRate: number; lastUpdated?: Date };
    memory: { used: number; limit: number; percentage: number };
  };
  performance: {
    searchTime: number;
    filterTime: number;
    renderTime: number;
    memoryUsage: number;
  };
}

const VariablePerformanceMonitor = memo<VariablePerformanceMonitorProps>(({
  className,
  showDetails = false,
  refreshInterval = 5000
}) => {
  const [stats, setStats] = useState<PerformanceStats | null>(null);
  const [isExpanded, setIsExpanded] = useState(showDetails);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  // Collect performance statistics
  const collectStats = useCallback((): PerformanceStats => {
    const cacheStats = variableCacheManager.getStats();

    // Get performance metrics
    const searchMetrics = performanceMonitor.getMetricsByName('variable-search');
const filterMetrics = performanceMonitor.getMetricsByName('variable-filter');
    const renderMetrics = performanceMonitor.getMetricsByName('component-VariablePicker');

    const avgSearchTime = searchMetrics.length > 0
      ? searchMetrics.reduce((sum, m) => sum + m.duration, 0) / searchMetrics.length
      : 0;

    const avgFilterTime = filterMetrics.length > 0
      ? filterMetrics.reduce((sum, m) => sum + m.duration, 0) / filterMetrics.length
      : 0;

    const avgRenderTime = renderMetrics.length > 0
      ? renderMetrics.reduce((sum, m) => sum + m.duration, 0) / renderMetrics.length
      : 0;

    // Estimate memory usage
    let memoryUsage = 0;
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      memoryUsage = memory.usedJSHeapSize || 0;
    }

    return {
      cache: cacheStats,
      performance: {
        searchTime: avgSearchTime,
        filterTime: avgFilterTime,
        renderTime: avgRenderTime,
        memoryUsage
      }
    };
  }, []);

  // Update stats periodically
  useEffect(() => {
    const updateStats = () => {
      setStats(collectStats());
      setLastUpdate(new Date());
    };

    updateStats(); // Initial update

    const interval = setInterval(updateStats, refreshInterval);
    return () => clearInterval(interval);
  }, [collectStats, refreshInterval]);

  // Format memory size
  const formatMemory = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }, []);

  // Format percentage
  const formatPercentage = useCallback((value: number): string => {
    return `${value.toFixed(1)}%`;
  }, []);

  // Format time
  const formatTime = useCallback((ms: number): string => {
    if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }, []);

  // Get status color based on performance
  const getStatusColor = useCallback((type: 'cache' | 'memory' | 'performance', value: number): string => {
    switch (type) {
      case 'cache':
        if (value >= 80) return 'text-green-600';
        if (value >= 60) return 'text-yellow-600';
        return 'text-red-600';
      case 'memory':
        if (value <= 50) return 'text-green-600';
        if (value <= 80) return 'text-yellow-600';
        return 'text-red-600';
      case 'performance':
        if (value <= 50) return 'text-green-600';
        if (value <= 100) return 'text-yellow-600';
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  }, []);

  if (!stats) {
    return (
      <div className={cn('p-4 bg-gray-50 rounded-lg', className)}>
        <div className="flex items-center gap-2 text-gray-500">
          <Activity className="w-4 h-4 animate-pulse" />
          <span className="text-sm">Loading performance data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('bg-white border border-gray-200 rounded-lg', className)}>
      {/* Header */}
      <div
        className="p-3 border-b border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-600" />
            <span className="font-medium text-gray-900">Variable Performance</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {/* Quick stats */}
            <div className="flex items-center gap-1">
              <Database className="w-3 h-3 text-gray-400" />
              <span className={getStatusColor('cache', stats.cache.search.hitRate)}>
                {formatPercentage(stats.cache.search.hitRate)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-gray-400" />
              <span className={getStatusColor('performance', stats.performance.searchTime)}>
                {formatTime(stats.performance.searchTime)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Zap className="w-3 h-3 text-gray-400" />
              <span className={getStatusColor('memory', stats.cache.memory.percentage)}>
                {formatPercentage(stats.cache.memory.percentage)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed stats */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Cache Performance */}
          <div>
            <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
              <Database className="w-4 h-4" />
              Cache Performance
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500 mb-1">Search Cache</div>
                <div className="font-medium">
                  <span className={getStatusColor('cache', stats.cache.search.hitRate)}>
                    {formatPercentage(stats.cache.search.hitRate)}
                  </span>
                  <span className="text-gray-400 text-xs ml-1">
                    ({stats.cache.search.total} entries)
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  Avg: {formatTime(stats.cache.search.avgResponseTime)}
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500 mb-1">Filter Cache</div>
                <div className="font-medium">
                  <span className={getStatusColor('cache', stats.cache.filter.hitRate)}>
                    {formatPercentage(stats.cache.filter.hitRate)}
                  </span>
                  <span className="text-gray-400 text-xs ml-1">
                    ({stats.cache.filter.total} entries)
                  </span>
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500 mb-1">Definitions</div>
                <div className="font-medium">
                  <span className={getStatusColor('cache', stats.cache.definitions.hitRate)}>
                    {formatPercentage(stats.cache.definitions.hitRate)}
                  </span>
                  <span className="text-gray-400 text-xs ml-1">
                    ({stats.cache.definitions.total} entries)
                  </span>
                </div>
                {stats.cache.definitions.lastUpdated && (
                  <div className="text-xs text-gray-500">
                    Updated: {stats.cache.definitions.lastUpdated.toLocaleTimeString()}
                  </div>
                )}
              </div>

              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500 mb-1">Memory Usage</div>
                <div className="font-medium">
                  <span className={getStatusColor('memory', stats.cache.memory.percentage)}>
                    {formatMemory(stats.cache.memory.used)}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  {formatPercentage(stats.cache.memory.percentage)} of {formatMemory(stats.cache.memory.limit)}
                </div>
              </div>
            </div>
          </div>

          {/* Performance Metrics */}
          <div>
            <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Performance Metrics
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500 mb-1">Search Time</div>
                <div className={cn('font-medium', getStatusColor('performance', stats.performance.searchTime))}>
                  {formatTime(stats.performance.searchTime)}
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500 mb-1">Filter Time</div>
                <div className={cn('font-medium', getStatusColor('performance', stats.performance.filterTime))}>
                  {formatTime(stats.performance.filterTime)}
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500 mb-1">Render Time</div>
                <div className={cn('font-medium', getStatusColor('performance', stats.performance.renderTime))}>
                  {formatTime(stats.performance.renderTime)}
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500 mb-1">JS Heap</div>
                <div className="font-medium text-gray-700">
                  {formatMemory(stats.performance.memoryUsage)}
                </div>
              </div>
            </div>
          </div>

          {/* Performance Recommendations */}
          {(stats.cache.memory.percentage > 80 ||
            stats.performance.searchTime > 100 ||
            stats.cache.search.hitRate < 60) && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5" />
                <div>
                  <div className="font-medium text-yellow-800 mb-1">Performance Recommendations</div>
                  <ul className="text-sm text-yellow-700 space-y-1">
                    {stats.cache.memory.percentage > 80 && (
                      <li>• Memory usage is high. Consider clearing cache or reducing cache size.</li>
                    )}
                    {stats.performance.searchTime > 100 && (
                      <li>• Search performance is slow. Check network connectivity or reduce query complexity.</li>
                    )}
                    {stats.cache.search.hitRate < 60 && (
                      <li>• Low cache hit rate. Consider increasing cache TTL or preloading common queries.</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Last Update */}
          <div className="text-xs text-gray-500 text-center pt-2 border-t border-gray-100">
            Last updated: {lastUpdate.toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
});

VariablePerformanceMonitor.displayName = 'VariablePerformanceMonitor';

export default VariablePerformanceMonitor;
