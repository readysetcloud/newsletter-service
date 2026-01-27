
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import type { PerformanceOverview } from '@/types/api';

interface EngagementMetricsProps {
  performanceOverview: PerformanceOverview;
}

type TooltipPayloadItem = {
  name?: string;
  value?: number;
};

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (active && Array.isArray(payload) && payload.length > 0) {
    const item = payload[0];
    const label = item?.name ?? 'Value';
    const value = typeof item?.value === 'number' ? item.value : 0;
    return (
      <div className="bg-surface p-3 border border-border rounded-lg shadow-lg">
        <p className="font-medium text-foreground">{label}</p>
        <p className="text-sm text-muted-foreground">{value.toFixed(1)}%</p>
      </div>
    );
  }
  return null;
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

  return (
    <div className="bg-surface rounded-lg shadow p-6">
      <h3 className="text-lg font-medium text-foreground mb-4">Engagement Breakdown</h3>
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
            <Tooltip content={CustomTooltip} />
            <Legend
              verticalAlign="bottom"
              height={36}
              formatter={(value, entry: { color?: string }) => (
                <span style={{ color: entry.color }}>{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
