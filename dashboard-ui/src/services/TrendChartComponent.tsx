import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';

const CHART_WIDTH = 500;
const CHART_HEIGHT = 250;
const COLOR_PRICE_LINE = '#0b82e6';
const COLOR_SUBSCRIBER_LINE = '#94a3b8';

export interface ChartDataPoint {
  date: string;
  recommendedPrice: number;
  subscriberCount: number;
}

export { CHART_WIDTH, CHART_HEIGHT };

export function TrendChartComponent({ data }: { data: ChartDataPoint[] }) {
  return (
    <LineChart width={CHART_WIDTH} height={CHART_HEIGHT} data={data} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
      <XAxis
        dataKey="date"
        tick={{ fontSize: 10, fill: '#64748b' }}
        tickLine={false}
      />
      <YAxis
        yAxisId="price"
        orientation="left"
        tick={{ fontSize: 10, fill: COLOR_PRICE_LINE }}
        tickLine={false}
        axisLine={false}
      />
      <YAxis
        yAxisId="subscribers"
        orientation="right"
        tick={{ fontSize: 10, fill: COLOR_SUBSCRIBER_LINE }}
        tickLine={false}
        axisLine={false}
      />
      <Line
        yAxisId="price"
        type="monotone"
        dataKey="recommendedPrice"
        stroke={COLOR_PRICE_LINE}
        strokeWidth={2}
        dot={false}
        name="Price"
      />
      <Line
        yAxisId="subscribers"
        type="monotone"
        dataKey="subscriberCount"
        stroke={COLOR_SUBSCRIBER_LINE}
        strokeWidth={1.5}
        dot={false}
        name="Subscribers"
      />
    </LineChart>
  );
}
