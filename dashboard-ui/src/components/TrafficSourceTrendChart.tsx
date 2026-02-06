import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { TrendsData } from '@/types';

interface TrafficSourceTrendChartProps {
  trendsData: TrendsData;
}

const TrafficSourceTrendChart: React.FC<TrafficSourceTrendChartProps> = ({ trendsData }) => {
  const data = [...trendsData.issues]
    .reverse()
    .map(issue => ({
      issue: `#${issue.id}`,
      email: issue.analyticsSummary?.trafficSource?.clicks.email ?? null,
      web: issue.analyticsSummary?.trafficSource?.clicks.web ?? null
    }))
    .filter(point => point.email !== null || point.web !== null);

  if (data.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center">
        No traffic source data yet
      </div>
    );
  }

  return (
    <div className="h-40 sm:h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <XAxis dataKey="issue" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
          <Tooltip formatter={(value: number) => value.toLocaleString()} />
          <Legend />
          <Line
            type="monotone"
            dataKey="email"
            stroke="#6366f1"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={{ r: 3, strokeWidth: 2 }}
            activeDot={{ r: 5 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="web"
            stroke="#f59e0b"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={{ r: 3, strokeWidth: 2 }}
            activeDot={{ r: 5 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TrafficSourceTrendChart;
