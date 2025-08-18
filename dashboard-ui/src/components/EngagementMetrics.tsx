
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import type { PerformanceOverview } from '@/types/api';

interface EngagementMetricsProps {
  performanceOverview: PerformanceOverview;
}

export function EngagementMetrics({ performanceOverview }: EngagementMetricsProps) {
  const data = [
    {
      name: 'Opened',
      value: performanceOverview.avgOpenRate,
      color: '#3b82f6'
    },
    {
      name: 'Clicked',
      value: performanceOverview.avgClickRate,
      color: '#10b981'
    },
    {
      name: 'Bounced',
      value: performanceOverview.avgBounceRate,
      color: '#ef4444'
    },
    {
      name: 'Other',
      value: Math.max(0, 100 - performanceOverview.avgOpenRate - performanceOverview.avgClickRate - performanceOverview.avgBounceRate),
      color: '#6b7280'
    }
  ].filter(item => item.value > 0);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-medium text-gray-900">{data.name}</p>
          <p className="text-sm text-gray-600">{data.value.toFixed(1)}%</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Engagement Breakdown</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={80}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="bottom"
              height={36}
              formatter={(value, entry: any) => (
                <span style={{ color: entry.color }}>{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
