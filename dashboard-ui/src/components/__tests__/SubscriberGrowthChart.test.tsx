import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubscriberGrowthChart } from '../SubscriberGrowthChart';
import type { IssueTrendItem, TrendsData } from '@/types/issues';

// Recharts needs a real layout to render, so capture what the chart was asked
// to plot instead — the data and the y-domain are the whole behavior here.
const chartProps: { data?: Array<{ issue: string; subscribers: number | null }> } = {};
const axisProps: { domain?: [number, number] } = {};

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children, data }: { children: React.ReactNode; data: Array<{ issue: string; subscribers: number | null }> }) => {
    chartProps.data = data;
    return <div data-testid="line-chart">{children}</div>;
  },
  Line: () => null,
  XAxis: () => null,
  YAxis: ({ domain }: { domain: [number, number] }) => {
    axisProps.domain = domain;
    return null;
  },
  Tooltip: () => null,
  CartesianGrid: () => null,
}));

const issue = (id: string, subscribers?: number): IssueTrendItem => ({
  id,
  metrics: {
    openRate: 40,
    clickRate: 10,
    clickToOpenRate: 25,
    bounceRate: 1,
    delivered: 1000,
    opens: 400,
    clicks: 100,
    bounces: 10,
    complaints: 0,
    ...(subscribers !== undefined && { subscribers }),
  },
});

const trends = (issues: IssueTrendItem[]): TrendsData => ({
  issues,
  aggregates: {
    avgOpenRate: 40,
    avgClickRate: 10,
    avgClickToOpenRate: 25,
    avgBounceRate: 1,
    totalDelivered: 1000 * issues.length,
    issueCount: issues.length,
  },
});

describe('SubscriberGrowthChart', () => {
  // The reported bug: the newest issue had no list-size snapshot, the API sent
  // it as 0, and the chart drew a cliff to the axis on a list that had not moved.
  it('plots an issue with no recorded list size as a gap, not as zero', () => {
    render(<SubscriberGrowthChart trendsData={trends([issue('12'), issue('11', 1180), issue('10', 1150)])} />);

    expect(chartProps.data).toEqual([
      { issue: '#10', subscribers: 1150 },
      { issue: '#11', subscribers: 1180 },
      { issue: '#12', subscribers: null },
    ]);
  });

  it('scales the axis to the recorded values only', () => {
    render(<SubscriberGrowthChart trendsData={trends([issue('12'), issue('11', 1180), issue('10', 1150)])} />);

    const [min, max] = axisProps.domain!;
    expect(min).toBeGreaterThan(1000);
    expect(max).toBeGreaterThanOrEqual(1180);
  });

  it('says there is no data when nothing recorded a list size', () => {
    render(<SubscriberGrowthChart trendsData={trends([issue('12'), issue('11')])} />);

    expect(screen.getByText('No subscriber data yet')).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
  });

  // Zero is a real reading — a list that genuinely is empty still plots.
  it('plots a recorded zero', () => {
    render(<SubscriberGrowthChart trendsData={trends([issue('12', 0), issue('11', 5)])} />);

    expect(chartProps.data).toEqual([
      { issue: '#11', subscribers: 5 },
      { issue: '#12', subscribers: 0 },
    ]);
  });
});
