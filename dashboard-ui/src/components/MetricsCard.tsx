import { TrendingUp, TrendingDown, Minus, LucideIcon } from 'lucide-react';

interface MetricsCardProps {
  title: string;
  value: number;
  change?: number;
  format?: 'number' | 'percentage';
  icon?: LucideIcon;
}

export default function MetricsCard({ title, value, change, format = 'number', icon: Icon }: MetricsCardProps) {
  const formatValue = (val: number) => {
    if (format === 'percentage') return `${val?.toFixed(1) || '0.0'}%`;
    if (format === 'number') return val?.toLocaleString() || '0';
    return val;
  };

  const getTrendIcon = () => {
    if (change && change > 0) return <TrendingUp className="w-4 h-4 text-green-500" />;
    if (change && change < 0) return <TrendingDown className="w-4 h-4 text-red-500" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  const getTrendColor = () => {
    if (change && change > 0) return 'text-green-600';
    if (change && change < 0) return 'text-red-600';
    return 'text-gray-500';
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm font-medium text-gray-600 truncate">{title}</p>
          <p className="text-xl sm:text-2xl font-semibold text-gray-900 mt-1">{formatValue(value)}</p>
        </div>
        {Icon && (
          <div className="p-2 sm:p-3 bg-blue-50 rounded-full flex-shrink-0 ml-3">
            <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
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
    </div>
  );
}
