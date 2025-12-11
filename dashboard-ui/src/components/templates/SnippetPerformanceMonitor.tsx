import React, { useState, useEffect, useCallback } from 'react';
import { ChartBarIcon, ClockIcon, CpuChipIcon, EyeIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { snippetCacheManager } from '@/utils/snippetCacheManager';
import { usePerformanceMonitor, useMemoryMonitor } from '@/utils/performanceOptimizations';
import { cn } from '@/utils/cn';

interface PerformanceMetrics {
  renderTime: number;
  cacheHitRate: number;
  memoryUsage: number;
  itemsRendered: number;
  scrollPerformance: number;
}

interface SnippetPerformanceMonitorProps {
  isVisible?: boolean;
  onToggle?: () => void;
  className?: string;
}

export const SnippetPerformanceMonitor: React.FC<SnippetPerformanceMonitorProps> = ({
  isVisible = false,
  onToggle,
  className
}) => {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    renderTime: 0,
    cacheHitRate: 0,
    memoryUsage: 0,
    itemsRendered: 0,
    scrollPerformance: 0
  });

  const [isExpanded, setIsExpanded] = useState(false);
  const { startMeasure, endMeasure, getMetrics } = usePerformanceMonitor('snippet-browser');
  const { memoryUsage, isHighMemory } = useMemoryMonitor();

  // Update metrics periodically
  useEffect(() => {
    const updateMetrics = () => {
      const cacheStats = snippetCacheManager.getStats();
      const performanceMetrics = getMetrics();

      setMetrics({
        renderTime: performanceMetrics.average,
        cacheHitRate: (cacheStats.snippets.hitRate + cacheStats.previews.hitRate) / 2,
        memoryUsage: memoryUsage || 0,
        itemsRendered: 0, // Would be passed from parent component
        scrollPerformance: performanceMetrics.average
      });
    };

    if (isVisible) {
      updateMetrics();
      const interval = setInterval(updateMetrics, 2000); // Update every 2 seconds
      return () => clearInterval(interval);
    }
  }, [isVisible, getMetrics, memoryUsage]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatTime = (ms: number): string => {
    if (ms < 1) return '<1ms';
    return `${Math.round(ms)}ms`;
  };

  const getPerformanceColor = (value: number, thresholds: { good: number; warning: number }): string => {
    if (value <= thresholds.good) return 'text-green-600';
    if (value <= thresholds.warning) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getCacheColor = (hitRate: number): string => {
    if (hitRate >= 80) return 'text-green-600';
    if (hitRate >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  if (!isVisible) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggle}
        className={cn('fixed bottom-4 right-4 z-50', className)}
        title="Show performance monitor"
      >
        <ChartBarIcon className="w-4 h-4" />
      </Button>
    );
  }

  return (
    <Card className={cn(
      'fixed bottom-4 right-4 z-50 w-80 bg-white shadow-lg border',
      isHighMemory && 'border-red-300 bg-red-50',
      className
    )}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm flex items-center">
            <ChartBarIcon className="w-4 h-4 mr-2" />
            Performance Monitor
            {isHighMemory && (
              <Badge variant="default" className="ml-2 text-xs bg-red-100 text-red-800">
                High Memory
              </Badge>
            )}
          </h3>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 h-auto"
            >
              <EyeIcon className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              className="p-1 h-auto"
            >
              ×
            </Button>
          </div>
        </div>

        {/* Quick metrics */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="text-center">
            <div className={cn(
              'text-lg font-semibold',
              getPerformanceColor(metrics.renderTime, { good: 16, warning: 33 })
            )}>
              {formatTime(metrics.renderTime)}
            </div>
            <div className="text-xs text-slate-600">Render Time</div>
          </div>
          <div className="text-center">
            <div className={cn(
              'text-lg font-semibold',
              getCacheColor(metrics.cacheHitRate)
            )}>
              {Math.round(metrics.cacheHitRate)}%
            </div>
            <div className="text-xs text-slate-600">Cache Hit Rate</div>
          </div>
        </div>

        {isExpanded && (
          <>
            {/* Detailed metrics */}
            <div className="space-y-2 mb-3 pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center">
                  <CpuChipIcon className="w-3 h-3 mr-1" />
                  Memory Usage
                </span>
                <span className={cn(
                  'font-medium',
                  isHighMemory ? 'text-red-600' : 'text-slate-700'
                )}>
                  {formatBytes(metrics.memoryUsage)}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center">
                  <ClockIcon className="w-3 h-3 mr-1" />
                  Scroll Performance
                </span>
                <span className={cn(
                  'font-medium',
                  getPerformanceColor(metrics.scrollPerformance, { good: 16, warning: 33 })
                )}>
                  {formatTime(metrics.scrollPerformance)}
                </span>
              </div>
            </div>

            {/* Cache statistics */}
            <div className="pt-3 border-t border-slate-200">
              <h4 className="font-medium text-xs text-slate-700 mb-2">Cache Statistics</h4>
              <CacheStatistics />
            </div>

            {/* Performance tips */}
            {(isHighMemory || metrics.renderTime > 33 || metrics.cacheHitRate < 60) && (
              <div className="pt-3 border-t border-slate-200">
                <h4 className="font-medium text-xs text-slate-700 mb-2">Performance Tips</h4>
                <PerformanceTips
                  isHighMemory={isHighMemory}
                  slowRender={metrics.renderTime > 33}
                  lowCacheHit={metrics.cacheHitRate < 60}
                />
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
};

const CacheStatistics: React.FC = () => {
  const [stats, setStats] = useState(snippetCacheManager.getStats());

  useEffect(() => {
    const interval = setInterval(() => {
      setStats(snippetCacheManager.getStats());
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-1 text-xs">
      <div className="flex justify-between">
        <span>Snippets:</span>
        <span>{stats.snippets.total} cached</span>
      </div>
      <div className="flex justify-between">
        <span>Previews:</span>
        <span>{stats.previews.total} cached</span>
      </div>
      <div className="flex justify-between">
        <span>Thumbnails:</span>
        <span>{stats.thumbnails.total} cached</span>
      </div>
      <div className="flex justify-between">
        <span>Memory:</span>
        <span className={cn(
          stats.memory.percentage > 80 ? 'text-red-600' : 'text-slate-600'
        )}>
          {Math.round(stats.memory.percentage)}%
        </span>
      </div>
    </div>
  );
};

interface PerformanceTipsProps {
  isHighMemory: boolean;
  slowRender: boolean;
  lowCacheHit: boolean;
}

const PerformanceTips: React.FC<PerformanceTipsProps> = ({
  isHighMemory,
  slowRender,
  lowCacheHit
}) => {
  const tips = [];

  if (isHighMemory) {
    tips.push('Clear cache to reduce memory usage');
  }

  if (slowRender) {
    tips.push('Reduce visible items or enable virtualization');
  }

  if (lowCacheHit) {
    tips.push('Allow more time for cache warming');
  }

  return (
    <div className="space-y-1">
      {tips.map((tip, index) => (
        <div key={index} className="text-xs text-slate-600 flex items-start">
          <span className="text-blue-500 mr-1">•</span>
          {tip}
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => snippetCacheManager.clearCache()}
        className="mt-2 text-xs px-2 py-1 h-auto"
      >
        Clear Cache
      </Button>
    </div>
  );
};

// Hook for using performance monitor in components
export const useSnippetPerformanceMonitor = () => {
  const { startMeasure, endMeasure } = usePerformanceMonitor('snippet-operation');

  const measureOperation = useCallback(async (
    operation: () => Promise<any> | any,
    operationName: string
  ): Promise<any> => {
    startMeasure();

    try {
      const result = await operation();
      const duration = endMeasure();

      if (duration && duration > 100) { // Log slow operations
        console.warn(`Slow snippet operation: ${operationName} took ${duration}ms`);
      }

      return result;
    } catch (error) {
      endMeasure();
      throw error;
    }
  }, [startMeasure, endMeasure]);

  return { measureOperation };
};
