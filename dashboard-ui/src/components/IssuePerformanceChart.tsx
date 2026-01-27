import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

import type { Issue } from '@/types/api';

interface IssuePerformanceChartProps {
  issues: Issue[];
}

type TooltipPayloadItem = {
  name?: string;
  value?: number;
  color?: string;
};

function CustomTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) {
  if (active && Array.isArray(payload) && payload.length > 0) {
    return (
      <div className="bg-surface p-4 border border-border rounded-lg shadow-lg">
        <p className="font-medium text-foreground">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-sm" style={{ color: entry.color }}>
            {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(2) : '0.00'}%
          </p>
        ))}
      </div>
    );
  }
  return null;
}

export default function IssuePerformanceChart({ issues }: IssuePerformanceChartProps) {
  const chartData = issues?.map(issue => ({
    name: issue.title,
    id: issue.id,
    date: issue.sentDate,
    openRate: issue.metrics?.openRate || 0,
    clickRate: issue.metrics?.clickThroughRate || 0,
    bounceRate: issue.metrics?.bounceRate || 0
  })).reverse() || [];

  return (
    <div className="bg-surface rounded-lg shadow p-6">
      <h3 className="text-lg font-medium text-foreground mb-4">Newsletter Issue Performance Trends</h3>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis
              tick={{ fontSize: 12 }}
              label={{ value: 'Rate (%)', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip content={CustomTooltip} />
            <Legend />
            <Line
              type="monotone"
              dataKey="openRate"
              stroke="#3b82f6"
              strokeWidth={2}
              name="Open Rate"
              dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="clickRate"
              stroke="#10b981"
              strokeWidth={2}
              name="Click Rate"
              dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="bounceRate"
              stroke="#ef4444"
              strokeWidth={2}
              name="Bounce Rate"
              dot={{ fill: '#ef4444', strokeWidth: 2, r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
