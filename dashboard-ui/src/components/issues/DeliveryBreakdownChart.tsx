import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { InfoTooltip } from '../ui/InfoTooltip';
import { formatNumber } from '../../utils/issueDetailUtils';

export interface DeliveryBreakdownChartProps {
  /** Number of emails successfully delivered to recipients. */
  delivered: number;
  /** Number of emails that bounced (could not be delivered). */
  bounced: number;
}

const COLORS = {
  delivered: '#14b8a6', // success / emerald
  bounced: '#c81e22', // error / red
};

interface ChartDatum {
  key: 'delivered' | 'bounced';
  name: string;
  value: number;
  percentage: number;
  color: string;
}

interface ChartTooltipEntry {
  name?: string | number;
  value?: number | string | readonly (string | number)[];
  payload?: {
    percentage?: number;
    [key: string]: unknown;
  };
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: readonly ChartTooltipEntry[];
}

function CustomTooltip({ active, payload }: ChartTooltipProps) {
  if (active && payload && payload.length > 0) {
    const item = payload[0];
    const label = item?.name ?? 'Value';
    const count = typeof item?.value === 'number' ? item.value : 0;
    const percentage =
      item?.payload && typeof item.payload === 'object' && 'percentage' in item.payload
        ? Number(item.payload.percentage ?? 0)
        : 0;
    return (
      <div className="bg-surface p-3 border border-border rounded-lg shadow-lg">
        <p className="font-medium text-foreground">{label}</p>
        <p className="text-sm text-muted-foreground">
          {formatNumber(count)} ({percentage.toFixed(1)}%)
        </p>
      </div>
    );
  }
  return null;
}

interface BreakdownRowProps {
  color: string;
  label: string;
  value: number;
  percentage: number;
}

const BreakdownRow: React.FC<BreakdownRowProps> = ({ color, label, value, percentage }) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <span
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="text-xs sm:text-sm text-muted-foreground">{label}</span>
    </div>
    <span className="text-xs sm:text-sm font-medium text-foreground">
      {formatNumber(value)} ({percentage.toFixed(1)}%)
    </span>
  </div>
);

export const DeliveryBreakdownChart: React.FC<DeliveryBreakdownChartProps> = React.memo(({
  delivered,
  bounced,
}) => {
  const safeDelivered = Math.max(0, delivered || 0);
  const safeBounced = Math.max(0, bounced || 0);
  const sent = safeDelivered + safeBounced;

  const deliveredPct = sent > 0 ? (safeDelivered / sent) * 100 : 0;
  const bouncedPct = sent > 0 ? (safeBounced / sent) * 100 : 0;

  const chartData = useMemo<ChartDatum[]>(
    () =>
      [
        {
          key: 'delivered' as const,
          name: 'Delivered',
          value: safeDelivered,
          percentage: deliveredPct,
          color: COLORS.delivered,
        },
        {
          key: 'bounced' as const,
          name: 'Bounced',
          value: safeBounced,
          percentage: bouncedPct,
          color: COLORS.bounced,
        },
      ].filter((item) => item.value > 0),
    [safeDelivered, safeBounced, deliveredPct, bouncedPct]
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
            Delivery Breakdown
          </CardTitle>
          <InfoTooltip
            label="Delivery Breakdown"
            description="How this issue's send resolved — the share of messages that were successfully delivered versus those that bounced. Sent is the total of delivered and bounced messages."
          />
        </div>
      </CardHeader>

      <CardContent>
        {sent === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No delivery data available for this issue.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
            {/* Donut chart with total Sent in the center */}
            <div
              className="relative h-56"
              role="img"
              aria-label={`Delivery breakdown: ${formatNumber(safeDelivered)} delivered (${deliveredPct.toFixed(1)}%) and ${formatNumber(safeBounced)} bounced (${bouncedPct.toFixed(1)}%) out of ${formatNumber(sent)} sent.`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    startAngle={90}
                    endAngle={-270}
                  >
                    {chartData.map((entry) => (
                      <Cell key={`cell-${entry.key}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={CustomTooltip} />
                </PieChart>
              </ResponsiveContainer>

              {/* Center label */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl sm:text-3xl font-bold text-foreground">
                  {formatNumber(sent)}
                </span>
                <span className="text-xs sm:text-sm text-muted-foreground">Sent</span>
              </div>
            </div>

            {/* Breakdown list */}
            <div className="space-y-3">
              <BreakdownRow
                color={COLORS.delivered}
                label="Delivered"
                value={safeDelivered}
                percentage={deliveredPct}
              />
              <BreakdownRow
                color={COLORS.bounced}
                label="Bounced"
                value={safeBounced}
                percentage={bouncedPct}
              />
              <div className="flex items-center justify-between pt-3 border-t border-border">
                <span className="text-xs sm:text-sm font-medium text-muted-foreground">Sent</span>
                <span className="text-xs sm:text-sm font-semibold text-foreground">
                  {formatNumber(sent)}
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

DeliveryBreakdownChart.displayName = 'DeliveryBreakdownChart';

export default DeliveryBreakdownChart;
