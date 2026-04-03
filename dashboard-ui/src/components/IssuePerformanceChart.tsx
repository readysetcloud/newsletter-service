import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useNavigate } from 'react-router-dom';

import type { TrendsData } from '@/types';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

interface IssuePerformanceChartProps {
  trendsData: TrendsData;
}

interface ChartTooltipEntry {
  color?: string;
  name?: string | number;
  value?: number | string | readonly (string | number)[];
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly ChartTooltipEntry[];
}

interface ActivePayloadPoint {
  payload?: {
    id?: string;
  };
}

interface ChartClickState {
  activePayload?: readonly ActivePayloadPoint[];
}

function CustomTooltip({
  active,
  payload,
  label
}: ChartTooltipProps) {
  if (active && payload && payload.length > 0) {
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
    clickToOpenRate: issue.metrics.clickToOpenRate,
    bounceRate: issue.metrics.bounceRate
  })).reverse();

  const handleChartClick = (data: unknown) => {
    const activePayload = (data as ChartClickState | undefined)?.activePayload;
    if (activePayload?.[0]?.payload?.id) {
      navigate(`/issues/${activePayload[0].payload.id}`);
    }
  };

  // Calculate right axis domain based on click/bounce/CTOR rate range
  const lowScaleValues = chartData.flatMap(d => [d.clickRate, d.bounceRate, d.clickToOpenRate]);
  const rightMax = Math.max(Math.ceil(Math.max(...lowScaleValues, 1) * 1.3), 5);

  return (
    <div className="bg-surface rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
          Issue Performance Trends
          <InfoTooltip
            label="Performance trends"
            description="Open rate uses the left axis. Click and bounce rates use the right axis for better visibility."
          />
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
                yAxisId="left"
                tick={{ fontSize: 12 }}
                label={{ value: 'Open Rate (%)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                domain={[0, 100]}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 12 }}
                label={{ value: 'Click / Bounce (%)', angle: 90, position: 'insideRight', style: { fontSize: 11 } }}
                domain={[0, rightMax]}
              />
              <Tooltip content={CustomTooltip} />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="openRate"
                stroke="#3b82f6"
                strokeWidth={2}
                name="Open Rate"
                dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4, cursor: 'pointer' }}
                activeDot={{ r: 6 }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="clickRate"
                stroke="#10b981"
                strokeWidth={2}
                name="Click Rate (CTR)"
                dot={{ fill: '#10b981', strokeWidth: 2, r: 4, cursor: 'pointer' }}
                activeDot={{ r: 6 }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="clickToOpenRate"
                stroke="#8b5cf6"
                strokeWidth={2}
                name="Click-to-Open (CTOR)"
                dot={{ fill: '#8b5cf6', strokeWidth: 2, r: 4, cursor: 'pointer' }}
                activeDot={{ r: 6 }}
              />
              <Line
                yAxisId="right"
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
