import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { TrendsData } from '@/types';

interface QualitySignalsChartProps {
  trendsData: TrendsData;
}

const formatNumber = (value: unknown) => (
  typeof value === 'number' ? value.toLocaleString() : String(value ?? '')
);

const QualitySignalsChart: React.FC<QualitySignalsChartProps> = ({ trendsData }) => {
  const data = [...trendsData.issues]
    .reverse()
    .map(issue => ({
      issue: `#${issue.id}`,
      bounces: issue.metrics.bounces,
      complaints: issue.metrics.complaints
    }));

  if (data.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center">
        No quality signal data yet
      </div>
    );
  }

  return (
    <div className="h-44 sm:h-52">
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
          <Tooltip formatter={formatNumber} />
          <Legend />
          <Line
            type="monotone"
            dataKey="bounces"
            stroke="#f97316"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={{ r: 3, strokeWidth: 2 }}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="complaints"
            stroke="#c81e22"
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

export default QualitySignalsChart;
