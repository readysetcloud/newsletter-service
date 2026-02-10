import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, ReferenceArea } from 'recharts';
import { InfoTooltip } from '../ui/InfoTooltip';
import type { ClickDecayPoint } from '@/types';

interface ClickDecayChartProps {
  clickDecay: ClickDecayPoint[];
}

type TooltipPayloadItem = {
  name?: string;
  value?: number;
  color?: string;
};

function CustomTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) {
  if (active && Array.isArray(payload) && payload.length > 0) {
    return (
      <div className="bg-surface p-4 border border-border rounded-lg shadow-lg">
        <p className="font-medium text-foreground mb-2">Hour {label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-sm" style={{ color: entry.color }}>
            {entry.name}: {typeof entry.value === 'number' ? entry.value.toLocaleString() : '0'}
          </p>
        ))}
      </div>
    );
  }
  return null;
}

// Helper to format time labels
function formatTimeLabel(hour: number): string {
  if (hour === 0) return '0h';
  if (hour < 24) return `${hour}h`;
  if (hour < 168) return `${Math.floor(hour / 24)}d`;
  return `${Math.floor(hour / 168)}w`;
}

// Helper to calculate statistics
function calculateStats(data: ClickDecayPoint[]) {
  const values = data.map(d => d.clicks);
  const sortedValues = [...values].sort((a, b) => a - b);

  const median = sortedValues[Math.floor(sortedValues.length / 2)];
  const q1Index = Math.floor(sortedValues.length * 0.25);
  const q3Index = Math.floor(sortedValues.length * 0.75);
  const q1 = sortedValues[q1Index];
  const q3 = sortedValues[q3Index];

  // Find peak engagement
  const maxClicks = Math.max(...values);
  const peakHour = data.find(d => d.clicks === maxClicks)?.hour || 0;

  return { median, q1, q3, peakHour, maxClicks };
}

export default function ClickDecayChart({ clickDecay }: ClickDecayChartProps) {
  if (!clickDecay || clickDecay.length === 0) {
    return (
      <div className="bg-surface rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-foreground mb-4">
          Click Activity Over Time
        </h3>
        <div className="flex items-center justify-center h-64" role="status">
          <p className="text-muted-foreground">No click data available</p>
        </div>
      </div>
    );
  }

  const chartData = clickDecay.map(point => ({
    hour: point.hour,
    clicks: point.clicks,
    cumulativeClicks: point.cumulativeClicks
  }));

  const stats = calculateStats(clickDecay);
  const criticalWindowEnd = Math.min(24, clickDecay[clickDecay.length - 1]?.hour || 24);

  // Generate text description for screen readers
  const totalClicks = chartData[chartData.length - 1]?.cumulativeClicks || 0;
  const screenReaderDescription = `Click activity chart showing ${totalClicks.toLocaleString()} total clicks over ${clickDecay.length} hours. Peak engagement occurred at hour ${stats.peakHour} with ${stats.maxClicks.toLocaleString()} clicks. Median click rate is ${stats.median} clicks per hour.`;

  return (
    <div className="bg-surface rounded-lg shadow p-4 sm:p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-base sm:text-lg font-medium text-foreground">
            Click Activity Over Time
          </h3>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Peak engagement at hour {stats.peakHour} ({stats.maxClicks.toLocaleString()} clicks)
          </p>
        </div>
        <InfoTooltip
          label="Click Decay Explanation"
          description="Click decay shows how engagement decreases over time. The first 24 hours (highlighted) are the critical window for maximum engagement. The shaded area represents the 25th-75th percentile range."
        />
      </div>

      <div
        className="h-64 sm:h-80 w-full"
        role="img"
        aria-label={screenReaderDescription}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />

            {/* Highlight critical 24-hour window */}
            <ReferenceArea
              x1={0}
              x2={criticalWindowEnd}
              fill="#fef3c7"
              fillOpacity={0.3}
              label={{ value: 'Critical Window', position: 'top', fill: '#92400e', fontSize: 10 }}
            />

            {/* Median line */}
            <ReferenceLine
              y={stats.median}
              stroke="#6b7280"
              strokeDasharray="5 5"
              label={{ value: `Median: ${stats.median}`, position: 'right', fill: '#6b7280', fontSize: 10 }}
            />

            {/* Peak annotation */}
            <ReferenceLine
              x={stats.peakHour}
              stroke="#ef4444"
              strokeDasharray="3 3"
              label={{ value: 'Peak', position: 'top', fill: '#ef4444', fontSize: 10 }}
            />

            <XAxis
              dataKey="hour"
              tick={{ fontSize: 12, fill: '#6b7280' }}
              tickFormatter={formatTimeLabel}
              label={{ value: 'Time Since Publication', position: 'insideBottom', offset: -5, style: { fontSize: 12, fill: '#6b7280' } }}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#6b7280' }}
              label={{ value: 'Clicks', angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: '#6b7280' } }}
            />
            <Tooltip content={CustomTooltip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="clicks"
              stroke="#3b82f6"
              strokeWidth={2}
              name="Clicks per Hour"
              dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="cumulativeClicks"
              stroke="#10b981"
              strokeWidth={2}
              name="Cumulative Clicks"
              dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Screen reader only detailed data */}
      <div className="sr-only" role="region" aria-label="Detailed click data">
        <table>
          <caption>Click activity by hour</caption>
          <thead>
            <tr>
              <th>Hour</th>
              <th>Clicks</th>
              <th>Cumulative Clicks</th>
            </tr>
          </thead>
          <tbody>
            {chartData.map((point, index) => (
              <tr key={index}>
                <td>{point.hour}</td>
                <td>{point.clicks}</td>
                <td>{point.cumulativeClicks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg">
        <p className="font-semibold mb-1">Understanding Click Decay:</p>
        <p>
          This chart shows how click activity changes over time. The highlighted &quot;Critical Window&quot; (first 24 hours)
          typically captures the majority of engagement. The median line shows the typical click rate,
          while the peak indicates when your audience was most active.
        </p>
      </div>
    </div>
  );
}
