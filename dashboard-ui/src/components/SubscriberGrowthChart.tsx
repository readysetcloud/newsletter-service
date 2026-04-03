import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { SubscriberTrendsResponse, TrendsData } from '@/types';

interface SubscriberGrowthChartProps {
  trendsData: SubscriberTrendsResponse | TrendsData;
}

function formatTooltipNumber(value: unknown): string {
  return typeof value === 'number' ? value.toLocaleString() : String(value ?? '');
}

export const SubscriberGrowthChart: React.FC<SubscriberGrowthChartProps> = ({ trendsData }) => {
  const lineColor = 'rgb(var(--primary-700))';
  const pointFill = 'rgb(var(--primary-600))';
  const pointStroke = 'rgb(var(--surface))';
  const tickColor = 'rgb(var(--muted-foreground))';
  const gridColor = 'rgb(var(--border) / 0.45)';

  const data = ('points' in trendsData
    ? [...trendsData.points]
        .reverse()
        .map(point => ({
          issue: `#${point.issueNumber}`,
          subscribers: point.subscribers
        }))
    : [...trendsData.issues]
        .reverse()
        .map(issue => ({
          issue: `#${issue.id}`,
          subscribers: issue.metrics.subscribers
        })));

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
          <CartesianGrid vertical={false} stroke={gridColor} strokeDasharray="3 3" />
          <XAxis
            dataKey="issue"
            tick={{ fontSize: 11, fill: tickColor }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 11, fill: tickColor }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip
            cursor={{ stroke: 'rgb(var(--border))', strokeDasharray: '3 3' }}
            contentStyle={{
              background: 'rgb(var(--surface))',
              borderColor: 'rgb(var(--border))',
              borderRadius: 8
            }}
            labelStyle={{ color: 'rgb(var(--foreground))' }}
            itemStyle={{ color: 'rgb(var(--foreground))' }}
            formatter={formatTooltipNumber}
          />
          <Line
            type="monotone"
            dataKey="subscribers"
            stroke={lineColor}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={{ r: 3.5, fill: pointFill, stroke: pointStroke, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: pointFill, stroke: pointStroke, strokeWidth: 2 }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
