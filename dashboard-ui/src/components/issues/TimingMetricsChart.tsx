import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { TimingMetrics } from '../../types/issues';

interface TimingMetricsChartProps {
  timingMetrics: TimingMetrics;
}

const formatSeconds = (value: number) => {
  if (value <= 0) return '0s';
  if (value < 60) return `${Math.round(value)}s`;
  const minutes = value / 60;
  return `${minutes.toFixed(1)}m`;
};

export const TimingMetricsChart: React.FC<TimingMetricsChartProps> = ({ timingMetrics }) => {
  const data = [
    {
      name: 'Open',
      median: timingMetrics.medianTimeToOpen,
      p95: timingMetrics.p95TimeToOpen
    },
    {
      name: 'Click',
      median: timingMetrics.medianTimeToClick,
      p95: timingMetrics.p95TimeToClick
    }
  ];

  return (
    <div className="h-52 sm:h-60">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <XAxis dataKey="name" />
          <YAxis tickFormatter={formatSeconds} />
          <Tooltip formatter={(value: number) => formatSeconds(value)} />
          <Legend />
          <Bar dataKey="median" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          <Bar dataKey="p95" fill="#f59e0b" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

