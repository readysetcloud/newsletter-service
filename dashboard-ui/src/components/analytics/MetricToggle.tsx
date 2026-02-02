export interface MetricToggleProps {
  selectedMetric: 'clicks' | 'opens' | 'engagementRate';
  onMetricChange: (metric: 'clicks' | 'opens' | 'engagementRate') => void;
}

export function MetricToggle({ selectedMetric, onMetricChange }: MetricToggleProps) {
  const metrics: Array<{ value: 'clicks' | 'opens' | 'engagementRate'; label: string }> = [
    { value: 'clicks', label: 'Clicks' },
    { value: 'opens', label: 'Opens' },
    { value: 'engagementRate', label: 'Engagement Rate' }
  ];

  return (
    <div className="flex gap-2 mb-4">
      {metrics.map(metric => (
        <button
          key={metric.value}
          onClick={() => onMetricChange(metric.value)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            selectedMetric === metric.value
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          {metric.label}
        </button>
      ))}
    </div>
  );
}
