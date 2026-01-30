import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useNavigate } from 'react-router-dom';

import type { TrendsData } from '@/types';

interface IssuePerformanceChartProps {
  trendsData: TrendsData;
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

export default function IssuePerformanceChart({ trendsData }: IssuePerformanceChartProps) {
  const navigate = useNavigate();

  const chartData = trendsData.issues.map(issue => ({
    name: `Issue #${issue.id}`,
    id: issue.id,
    openRate: issue.metrics.openRate,
    clickRate: issue.metrics.clickRate,
    bounceRate: issue.metrics.bounceRate
  })).reverse();

  const handleChartClick = (data: { activePayload?: Array<{ payload?: { id: string } }> }) => {
    if (data?.activePayload?.[0]?.payload?.id) {
      navigate(`/issues/${data.activePayload[0].payload.id}`);
    }
  };

  return (
    <div className="bg-surface rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-foreground">
          Issue Performance Trends
        </h3>
        <span className="text-sm text-muted-foreground">
          Last {trendsData.aggregates.issueCount} issues
        </span>
      </div>
      <div className="h-80">
        {trendsData.issues.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-muted-foreground text-lg mb-2">No published issues yet</p>
              <p className="text-muted-foreground text-sm">Publish your first issue to see performance trends</p>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} onClick={handleChartClick}>
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
                dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4, cursor: 'pointer' }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="clickRate"
                stroke="#10b981"
                strokeWidth={2}
                name="Click Rate"
                dot={{ fill: '#10b981', strokeWidth: 2, r: 4, cursor: 'pointer' }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="bounceRate"
                stroke="#ef4444"
                strokeWidth={2}
                name="Bounce Rate"
                dot={{ fill: '#ef4444', strokeWidth: 2, r: 4, cursor: 'pointer' }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
