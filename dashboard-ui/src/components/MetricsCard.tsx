import { memo } from 'react';
import { TrendingUp, TrendingDown, Minus, LucideIcon } from 'lucide-react';
import { StatTile } from '@readysetcloud/ui';
import type { StatusBadgeTone } from '@readysetcloud/ui';
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

const healthTone: Record<HealthStatusResult['status'], StatusBadgeTone> = {
  healthy: 'success',
  warning: 'warning',
  critical: 'error',
};

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
    return String(val);
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

  const isStable = trendComparison ? trendComparison.direction === 'stable' : true;

  return (
    <StatTile
      label={title}
      value={formatValue(value)}
      delta={trendComparison && !isStable ? trendComparison.percentChange : undefined}
      invertDelta={invertTrendColors}
      status={healthStatus ? { tone: healthTone[healthStatus.status], label: healthStatus.label } : undefined}
      meta={trendComparison ? `${isStable ? 'No change ' : ''}vs. previous period` : undefined}
      icon={Icon ? <Icon /> : undefined}
      sparkline={sparkline}
    >
      {change !== undefined && (
        <div className="mt-3 flex items-center">
          {getTrendIcon()}
          <span className={`ml-2 text-xs sm:text-sm font-medium ${getTrendColor()} truncate`}>
            {Math.abs(change || 0)}% from last period
          </span>
        </div>
      )}
    </StatTile>
  );
});

export default MetricsCard;
