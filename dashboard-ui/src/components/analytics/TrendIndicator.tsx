import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface TrendIndicatorProps {
  current: number;
  previous: number;
  format?: 'percentage' | 'number';
  invertColors?: boolean;
}

export default function TrendIndicator({
  current,
  previous,
  format = 'percentage',
  invertColors = false
}: TrendIndicatorProps) {
  const percentChange = previous === 0
    ? (current > 0 ? 100 : 0)
    : ((current - previous) / previous) * 100;

  const isPositive = percentChange > 0;
  const isNegative = percentChange < 0;
  const isStable = Math.abs(percentChange) < 0.1;

  const getIcon = () => {
    if (isStable) return <Minus className="w-4 h-4" aria-hidden="true" />;
    if (isPositive) return <TrendingUp className="w-4 h-4" aria-hidden="true" />;
    return <TrendingDown className="w-4 h-4" aria-hidden="true" />;
  };

  const getColorClass = () => {
    if (isStable) return 'text-gray-500';

    const shouldBeGreen = invertColors ? isNegative : isPositive;
    return shouldBeGreen ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500';
  };

  const getTrendLabel = () => {
    if (isStable) return 'stable';
    const shouldBeGreen = invertColors ? isNegative : isPositive;
    return shouldBeGreen ? 'improving' : 'declining';
  };

  const formatValue = (val: number) => {
    if (format === 'percentage') return `${Math.abs(val).toFixed(1)}%`;
    return Math.abs(val).toLocaleString();
  };

  return (
    <div
      className={`flex items-center gap-1 ${getColorClass()}`}
      role="status"
      aria-label={`Trend ${getTrendLabel()}: ${formatValue(percentChange)}`}
    >
      {getIcon()}
      <span className="text-sm font-medium">
        {formatValue(percentChange)}
      </span>
    </div>
  );
}
