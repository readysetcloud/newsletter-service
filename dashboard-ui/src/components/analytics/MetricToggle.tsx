export type GeoMetric =
  | 'clicks'
  | 'opens'
  | 'uniqueClicks'
  | 'uniqueOpens'
  | 'engagementRate'
  | 'uniqueEngagementRate';

export interface MetricToggleProps {
  selectedMetric: GeoMetric;
  onMetricChange: (metric: GeoMetric) => void;
}

export function MetricToggle({ selectedMetric, onMetricChange }: MetricToggleProps) {
  const metrics: Array<{ value: GeoMetric; label: string }> = [
    { value: 'clicks', label: 'Clicks' },
    { value: 'opens', label: 'Opens' },
    { value: 'uniqueClicks', label: 'Unique Clicks' },
    { value: 'uniqueOpens', label: 'Unique Opens' },
    { value: 'engagementRate', label: 'Engagement Rate' },
    { value: 'uniqueEngagementRate', label: 'Unique Engagement Rate' }
  ];

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      <select
        value={selectedMetric}
        onChange={(e) => onMetricChange(e.target.value as GeoMetric)}
        className="sm:hidden w-full text-sm border border-border rounded-md px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Select metric"
      >
        {metrics.map(metric => (
          <option key={metric.value} value={metric.value}>
            {metric.label}
          </option>
        ))}
      </select>
      <div className="hidden sm:flex flex-wrap gap-2">
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
    </div>
  );
}
