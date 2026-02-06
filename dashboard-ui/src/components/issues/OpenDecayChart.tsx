import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { OpenDecayPoint } from '../../types/issues';

interface OpenDecayChartProps {
  openDecay: OpenDecayPoint[];
}

const OpenDecayChart: React.FC<OpenDecayChartProps> = ({ openDecay }) => {
  if (!openDecay || openDecay.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No open activity data available
      </div>
    );
  }

  const chartData = openDecay.map(point => ({
    hour: point.hour,
    opens: point.opens,
    cumulativeOpens: point.cumulativeOpens
  }));

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="hour" />
          <YAxis />
          <Tooltip
            formatter={(value: number) => value.toLocaleString()}
            labelFormatter={(label: number) => `Hour ${label}`}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="opens"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="cumulativeOpens"
            stroke="#6366f1"
            strokeWidth={2}
            dot={{ fill: '#6366f1', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default OpenDecayChart;
