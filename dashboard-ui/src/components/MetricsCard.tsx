import { memo } from 'react';
import { TrendingUp, TrendingDown, Minus, LucideIcon } from 'lucide-react';
import HealthStatusLabel from './analytics/HealthStatusLabel';
import { TrendSparkline } from './ui/TrendSparkline';
import { cn } from '@/utils/cn';
import type { TrendComparison } from '@/types';
import type { HealthStatusResult } from '@/utils/analyticsCalculations';

interface MetricsCardProps {
  title: string;
  value: number;
  change?: number;
  format?: 'number' | 'percentage';
  icon?: LucideIcon;
  trendComparison?: TrendComparison;
  invertTrendColors?: boolean;
  healthStatus?: HealthStatusResult;
  /** Metric history across recent issues (oldest first) for the trend sparkline. */
  sparkline?: number[];
}

const MetricsCard = memo(function MetricsCard({
  title,
  value,
  change,
  format = 'number',
  icon: Icon,
  trendComparison,
  invertTrendColors = false,
  healthStatus,
  sparkline
}: MetricsCardProps) {
  const formatValue = (val: number) => {
    if (format === 'percentage') return `${val?.toFixed(1) || '0.0'}%`;
    if (format === 'number') return val?.toLocaleString() || '0';
    return val;
  };

  const getTrendIcon = () => {
    if (change && change > 0) return <TrendingUp className="w-4 h-4 text-success-500" />;
    if (change && change < 0) return <TrendingDown className="w-4 h-4 text-error-500" />;
    return <Minus className="w-4 h-4 text-muted-foreground" />;
  };

  const getTrendColor = () => {
    if (change && change > 0) return 'text-success-600';
    if (change && change < 0) return 'text-error-600';
    return 'text-muted-foreground';
  };

  const percentChange = trendComparison?.percentChange ?? 0;
  const isStable = trendComparison ? trendComparison.direction === 'stable' : true;
  const isImprovement = invertTrendColors ? percentChange < 0 : percentChange > 0;
  const DeltaIcon = percentChange > 0 ? TrendingUp : TrendingDown;

  return (
    <div className="flex flex-col bg-surface rounded-xl p-4 sm:p-5 border border-border shadow-soft hover:shadow-md hover:border-primary-200 hover:-translate-y-0.5 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] sm:text-xs uppercase tracking-wide text-muted-foreground font-semibold truncate">
            {title}
          </p>
          <div className="flex items-center gap-2 flex-wrap mt-1.5">
            <p className="text-2xl sm:text-3xl font-bold font-display text-foreground tabular-nums leading-none">
              {formatValue(value)}
            </p>
            {trendComparison && !isStable && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                  isImprovement
                    ? 'bg-success-100 text-success-700'
                    : 'bg-error-100 text-error-700'
                )}
                role="status"
                aria-label={`Trend ${isImprovement ? 'improving' : 'declining'}: ${Math.abs(percentChange).toFixed(1)}%`}
              >
                <DeltaIcon className="w-3 h-3" aria-hidden="true" />
                {percentChange > 0 ? '+' : ''}
                {percentChange.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        {Icon && (
          <div className="p-2 sm:p-2.5 bg-primary-50 rounded-full flex-shrink-0">
            <Icon className="w-5 h-5 text-primary-600" aria-hidden="true" />
          </div>
        )}
      </div>

      {(trendComparison || healthStatus) && (
        <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
          {trendComparison && (
            <span className="whitespace-nowrap">
              {isStable ? 'No change' : ''} vs. previous period
            </span>
          )}
          {healthStatus && (
            <HealthStatusLabel
              status={healthStatus.status}
              label={healthStatus.label}
            />
          )}
        </div>
      )}

      {change !== undefined && (
        <div className="mt-3 flex items-center">
          {getTrendIcon()}
          <span className={`ml-2 text-xs sm:text-sm font-medium ${getTrendColor()} truncate`}>
            {Math.abs(change || 0)}% from last period
          </span>
        </div>
      )}

      {sparkline && sparkline.length >= 2 && (
        <TrendSparkline values={sparkline} className="mt-3" />
      )}
    </div>
  );
});

export default MetricsCard;
