import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import type { TrafficSource } from '../../types/issues';

export interface TrafficSourceChartProps {
  trafficSource: TrafficSource;
}

export const TrafficSourceChart: React.FC<TrafficSourceChartProps> = ({ trafficSource }) => {
  const data = [
    { name: 'Email', value: trafficSource.clicks.email },
    { name: 'Web', value: trafficSource.clicks.web }
  ].filter(item => item.value > 0);

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No traffic source data available
      </div>
    );
  }

  const colors = ['#3b82f6', '#10b981'];

  return (
    <div className="h-56 sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={3}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value: number) => value.toLocaleString()} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

