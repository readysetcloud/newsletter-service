import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { ClickDecayPoint } from '@/types';

interface ClickDecayChartProps {
  clickDecay: ClickDecayPoint[];
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
        <p className="font-medium text-foreground mb-2">Hour {label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-sm" style={{ color: entry.color }}>
            {entry.name}: {typeof entry.value === 'number' ? entry.value.toLocaleString() : '0'}
          </p>
        ))}
      </div>
    );
  }
  return null;
}

export default function ClickDecayChart({ clickDecay }: ClickDecayChartProps) {
  if (!clickDecay || clickDecay.length === 0) {
    return (
      <div className="bg-surface rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-foreground mb-4">
          Click Activity Over Time
        </h3>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">No click data available</p>
        </div>
      </div>
    );
  }

  const chartData = clickDecay.map(point => ({
    hour: point.hour,
    clicks: point.clicks,
    cumulativeClicks: point.cumulativeClicks
  }));

  return (
    <div className="bg-surface rounded-lg shadow p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-medium text-foreground mb-4">
        Click Activity Over Time
      </h3>
      <div className="h-64 sm:h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 12, fill: '#6b7280' }}
              label={{ value: 'Hours Since Publication', position: 'insideBottom', offset: -5, style: { fontSize: 12, fill: '#6b7280' } }}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#6b7280' }}
              label={{ value: 'Clicks', angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: '#6b7280' } }}
            />
            <Tooltip content={CustomTooltip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="clicks"
              stroke="#3b82f6"
              strokeWidth={2}
              name="Clicks per Hour"
              dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="cumulativeClicks"
              stroke="#10b981"
              strokeWidth={2}
              name="Cumulative Clicks"
              dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
