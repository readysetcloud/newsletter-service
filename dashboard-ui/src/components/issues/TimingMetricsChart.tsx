import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { InfoTooltip } from '../ui/InfoTooltip';
import type { TimingMetrics } from '../../types/issues';

interface TimingMetricsChartProps {
  timingMetrics: TimingMetrics;
}

const formatSeconds = (value: number) => {
  if (value <= 0) return '0s';
  if (value < 60) return `${Math.round(value)}s`;
  if (value < 3600) {
    const minutes = value / 60;
    return `${minutes.toFixed(1)}m`;
  }
  const hours = value / 3600;
  return `${hours.toFixed(1)}h`;
};

const formatSecondsDetailed = (value: number) => {
  if (value <= 0) return '0 seconds';
  if (value < 60) return `${Math.round(value)} seconds`;
  if (value < 3600) {
    const minutes = Math.floor(value / 60);
    const seconds = Math.round(value % 60);
    return seconds > 0 ? `${minutes} minutes ${seconds} seconds` : `${minutes} minutes`;
  }
  const hours = Math.floor(value / 3600);
  const minutes = Math.round((value % 3600) / 60);
  return minutes > 0 ? `${hours} hours ${minutes} minutes` : `${hours} hours`;
};

// Determine engagement speed category
const getEngagementSpeed = (medianTime: number): { color: string; label: string } => {
  if (medianTime < 300) return { color: '#10b981', label: 'Fast' }; // < 5 minutes
  if (medianTime < 3600) return { color: '#f59e0b', label: 'Medium' }; // < 1 hour
  return { color: '#ef4444', label: 'Slow' }; // >= 1 hour
};

export const TimingMetricsChart: React.FC<TimingMetricsChartProps> = ({ timingMetrics }) => {
  const data = [
    {
      name: 'Time to Open',
      median: timingMetrics.medianTimeToOpen,
      p95: timingMetrics.p95TimeToOpen,
      type: 'open'
    },
    {
      name: 'Time to Click',
      median: timingMetrics.medianTimeToClick,
      p95: timingMetrics.p95TimeToClick,
      type: 'click'
    }
  ];

  const openSpeed = getEngagementSpeed(timingMetrics.medianTimeToOpen);
  const clickSpeed = getEngagementSpeed(timingMetrics.medianTimeToClick);

  return (
    <div className="bg-surface rounded-lg shadow p-4 sm:p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-base sm:text-lg font-medium text-foreground">
            Engagement Timing
          </h3>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            How quickly subscribers engage with your content
          </p>
        </div>
        <InfoTooltip
          label="Timing Metrics Explanation"
          description="Median shows when 50% of engagement happened. P95 shows when 95% of engagement happened. Faster times indicate more immediate interest from your audience."
        />
      </div>

      <div className="h-52 sm:h-60">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="horizontal"
            margin={{ top: 10, right: 12, left: 80, bottom: 0 }}
          >
            <XAxis
              type="number"
              tickFormatter={formatSeconds}
              tick={{ fontSize: 12, fill: '#6b7280' }}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 12, fill: '#6b7280' }}
              width={75}
            />
            <Tooltip
              formatter={(value: number, name: string) => [
                formatSecondsDetailed(value),
                name === 'median' ? 'Median (50%)' : 'P95 (95%)'
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value) => value === 'median' ? 'Median (50%)' : 'P95 (95%)'}
            />
            <Bar dataKey="median" radius={[0, 4, 4, 0]}>
              {data.map((entry, index) => {
                const speed = entry.type === 'open' ? openSpeed : clickSpeed;
                return <Cell key={`cell-${index}`} fill={speed.color} />;
              })}
            </Bar>
            <Bar dataKey="p95" fill="#f59e0b" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-muted/30 p-3 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-foreground">Opens</p>
            <span
              className="text-xs font-semibold px-2 py-1 rounded"
              style={{ backgroundColor: `${openSpeed.color}20`, color: openSpeed.color }}
            >
              {openSpeed.label}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            50% of opens happened within{' '}
            <span className="font-semibold text-foreground">
              {formatSecondsDetailed(timingMetrics.medianTimeToOpen)}
            </span>
          </p>
        </div>

        <div className="bg-muted/30 p-3 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-foreground">Clicks</p>
            <span
              className="text-xs font-semibold px-2 py-1 rounded"
              style={{ backgroundColor: `${clickSpeed.color}20`, color: clickSpeed.color }}
            >
              {clickSpeed.label}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            50% of clicks happened within{' '}
            <span className="font-semibold text-foreground">
              {formatSecondsDetailed(timingMetrics.medianTimeToClick)}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
};

