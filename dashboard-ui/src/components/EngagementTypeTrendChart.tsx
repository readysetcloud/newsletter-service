import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { TrendsData } from '@/types';

interface EngagementTypeTrendChartProps {
  trendsData: TrendsData;
}

const EngagementTypeTrendChart: React.FC<EngagementTypeTrendChartProps> = ({ trendsData }) => {
  const data = [...trendsData.issues]
    .reverse()
    .map(issue => ({
      issue: `#${issue.id}`,
      newClickers: issue.analyticsSummary?.engagementType?.newClickers ?? null,
      returningClickers: issue.analyticsSummary?.engagementType?.returningClickers ?? null
    }))
    .filter(point => point.newClickers !== null || point.returningClickers !== null);

  if (data.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center">
        No engagement type data yet
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
            dataKey="newClickers"
            stroke="#3b82f6"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={{ r: 3, strokeWidth: 2 }}
            activeDot={{ r: 5 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="returningClickers"
            stroke="#10b981"
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

export default EngagementTypeTrendChart;
