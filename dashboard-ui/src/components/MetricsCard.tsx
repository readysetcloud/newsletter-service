import { memo } from 'react';
import { TrendingUp, TrendingDown, Minus, LucideIcon } from 'lucide-react';
import TrendIndicator from './analytics/TrendIndicator';
import HealthStatusLabel from './analytics/HealthStatusLabel';
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
}

const MetricsCard = memo(function MetricsCard({
  title,
  value,
  change,
  format = 'number',
  icon: Icon,
  trendComparison,
  invertTrendColors = false,
  healthStatus
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

  return (
    <div className="bg-surface rounded-lg shadow p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">{title}</p>
          <p className="text-xl sm:text-2xl font-semibold text-foreground mt-1">{formatValue(value)}</p>
        </div>
        {Icon && (
          <div className="p-2 sm:p-3 bg-primary-50 rounded-full flex-shrink-0 ml-3">
            <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-primary-600" />
          </div>
        )}
      </div>

      {change !== undefined && (
        <div className="mt-3 sm:mt-4 flex items-center">
          {getTrendIcon()}
          <span className={`ml-2 text-xs sm:text-sm font-medium ${getTrendColor()} truncate`}>
            {Math.abs(change || 0)}% from last period
          </span>
        </div>
      )}

      {trendComparison && (
        <div className="mt-3 sm:mt-4 flex items-center gap-2">
          <TrendIndicator
            current={trendComparison.current}
            previous={trendComparison.previous}
            format={format}
            invertColors={invertTrendColors}
          />
          {healthStatus && (
            <HealthStatusLabel
              status={healthStatus.status}
              label={healthStatus.label}
            />
          )}
        </div>
      )}
    </div>
  );
});

export default MetricsCard;
