import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { TrendsData } from '@/types';

interface SubscriberGrowthChartProps {
  trendsData: TrendsData;
}

function formatTooltipNumber(value: unknown): string {
  return typeof value === 'number' ? value.toLocaleString() : String(value ?? '');
}

export const SubscriberGrowthChart: React.FC<SubscriberGrowthChartProps> = ({ trendsData }) => {
  const data = [...trendsData.issues]
    .reverse()
    .map(issue => ({
      issue: `#${issue.id}`,
      subscribers: issue.metrics.subscribers
    }));

  const yDomain = useMemo(() => {
    const values = data.map(d => d.subscribers);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max(Math.round((max - min) * 0.1), 1);
    return [min - padding, max + padding] as [number, number];
  }, [data]);

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
            domain={yDomain}
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
            formatter={formatTooltipNumber}
          />
          <Line
            type="monotone"
            dataKey="subscribers"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={{ r: 3, fill: 'hsl(var(--primary))', strokeWidth: 2 }}
            activeDot={{ r: 5 }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
