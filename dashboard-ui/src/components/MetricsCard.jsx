import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function MetricsCard({ title, value, change, format = 'number', icon: Icon }) {
  const formatValue = (val) => {
    if (format === 'percentage') return `${val}%`;
    if (format === 'number') return val?.toLocaleString() || '0';
    return val;
  };

  const getTrendIcon = () => {
    if (change > 0) return <TrendingUp className="w-4 h-4 text-green-500" />;
    if (change < 0) return <TrendingDown className="w-4 h-4 text-red-500" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  const getTrendColor = () => {
    if (change > 0) return 'text-green-600';
    if (change < 0) return 'text-red-600';
    return 'text-gray-500';
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-2xl font-semibold text-gray-900">{formatValue(value)}</p>
        </div>
        {Icon && (
          <div className="p-3 bg-blue-50 rounded-full">
            <Icon className="w-6 h-6 text-blue-600" />
          </div>
        )}
      </div>

      {change !== undefined && (
        <div className="mt-4 flex items-center">
          {getTrendIcon()}
          <span className={`ml-2 text-sm font-medium ${getTrendColor()}`}>
            {Math.abs(change)}% from last period
          </span>
        </div>
      )}
    </div>
  );
}
