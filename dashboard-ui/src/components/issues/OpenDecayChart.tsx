import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, ReferenceArea } from 'recharts';
import { InfoTooltip } from '../ui/InfoTooltip';
import type { OpenDecayPoint } from '../../types/issues';

interface OpenDecayChartProps {
  openDecay: OpenDecayPoint[];
}

// Helper to format time labels
function formatTimeLabel(hour: number): string {
  if (hour === 0) return '0h';
  if (hour < 24) return `${hour}h`;
  if (hour < 168) return `${Math.floor(hour / 24)}d`;
  return `${Math.floor(hour / 168)}w`;
}

// Helper to calculate statistics
function calculateStats(data: OpenDecayPoint[]) {
  const values = data.map(d => d.opens);
  const sortedValues = [...values].sort((a, b) => a - b);

  const median = sortedValues[Math.floor(sortedValues.length / 2)];
  const q1Index = Math.floor(sortedValues.length * 0.25);
  const q3Index = Math.floor(sortedValues.length * 0.75);
  const q1 = sortedValues[q1Index];
  const q3 = sortedValues[q3Index];

  // Find peak engagement
  const maxOpens = Math.max(...values);
  const peakHour = data.find(d => d.opens === maxOpens)?.hour || 0;

  return { median, q1, q3, peakHour, maxOpens };
}

const OpenDecayChart: React.FC<OpenDecayChartProps> = ({ openDecay }) => {
  if (!openDecay || openDecay.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground" role="status">
        No open activity data available
      </div>
    );
  }

  const chartData = openDecay.map(point => ({
    hour: point.hour,
    opens: point.opens,
    cumulativeOpens: point.cumulativeOpens
  }));

  const stats = calculateStats(openDecay);
  const criticalWindowEnd = Math.min(24, openDecay[openDecay.length - 1]?.hour || 24);

  // Generate text description for screen readers
  const totalOpens = chartData[chartData.length - 1]?.cumulativeOpens || 0;
  const screenReaderDescription = `Open activity chart showing ${totalOpens.toLocaleString()} total opens over ${openDecay.length} hours. Peak engagement occurred at hour ${stats.peakHour} with ${stats.maxOpens.toLocaleString()} opens. Median open rate is ${stats.median} opens per hour.`;

  return (
    <div className="bg-surface rounded-lg shadow p-4 sm:p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-base sm:text-lg font-medium text-foreground">
            Open Activity Over Time
          </h3>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Peak engagement at hour {stats.peakHour} ({stats.maxOpens.toLocaleString()} opens)
          </p>
        </div>
        <InfoTooltip
          label="Open Decay Explanation"
          description="Open decay shows how email opens decrease over time. The first 24 hours (highlighted) are the critical window when most subscribers check their inbox. The shaded area represents the 25th-75th percentile range."
        />
      </div>

      <div
        className="w-full h-64 sm:h-80"
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
              fill="#dcfce7"
              fillOpacity={0.3}
              label={{ value: 'Critical Window', position: 'top', fill: '#166534', fontSize: 10 }}
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
              label={{ value: 'Opens', angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: '#6b7280' } }}
            />
            <Tooltip
              formatter={(value: number) => value.toLocaleString()}
              labelFormatter={(label: number) => `Hour ${label}`}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="opens"
              stroke="#10b981"
              strokeWidth={2}
              name="Opens per Hour"
              dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="cumulativeOpens"
              stroke="#6366f1"
              strokeWidth={2}
              name="Cumulative Opens"
              dot={{ fill: '#6366f1', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Screen reader only detailed data */}
      <div className="sr-only" role="region" aria-label="Detailed open data">
        <table>
          <caption>Open activity by hour</caption>
          <thead>
            <tr>
              <th>Hour</th>
              <th>Opens</th>
              <th>Cumulative Opens</th>
            </tr>
          </thead>
          <tbody>
            {chartData.map((point, index) => (
              <tr key={index}>
                <td>{point.hour}</td>
                <td>{point.opens}</td>
                <td>{point.cumulativeOpens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg">
        <p className="font-semibold mb-1">Understanding Open Decay:</p>
        <p>
          This chart shows how email opens change over time. The highlighted &quot;Critical Window&quot; (first 24 hours)
          typically captures the majority of opens as subscribers check their inbox. The median line shows the typical open rate,
          while the peak indicates when your audience was most likely to open emails.
        </p>
      </div>
    </div>
  );
};

export default OpenDecayChart;
