import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { TrendsData } from '@/types';

interface SubscriberGrowthChartProps {
  trendsData: TrendsData;
}

export const SubscriberGrowthChart: React.FC<SubscriberGrowthChartProps> = ({ trendsData }) => {
  const data = [...trendsData.issues]
    .reverse()
    .map(issue => ({
      issue: `#${issue.id}`,
      subscribers: issue.metrics.subscribers
    }));

  if (data.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center">
        No subscriber data yet
      </div>
    );
  }

  return (
    <div className="h-36 sm:h-44">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="issue"
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip
            cursor={{ stroke: 'hsl(var(--border))', strokeDasharray: '3 3' }}
            contentStyle={{
              background: 'hsl(var(--surface))',
              borderColor: 'hsl(var(--border))',
              borderRadius: 8
            }}
            formatter={(value: number) => value.toLocaleString()}
          />
          <Line
            type="monotone"
            dataKey="subscribers"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={{ r: 3, strokeWidth: 2 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
