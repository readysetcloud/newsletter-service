import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActionableInsights } from '../ActionableInsights';
import type { IssueTrendItem, TrendsData } from '@/types/issues';

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

describe('ActionableInsights subscriber growth', () => {
  // Issues are newest-first, so an unrecorded newest issue used to enter the
  // growth math as 0 and report a total collapse on a list that had grown.
  it('ignores issues with no recorded list size', () => {
    render(
      <ActionableInsights
        trendsData={trends([issue('12'), issue('11', 1180), issue('10', 1000)])}
      />
    );

    expect(screen.queryByText(/List size shrank/)).not.toBeInTheDocument();
    expect(screen.getByText(/Your list grew 18\.0%/)).toBeInTheDocument();
  });

  it('reports real churn from the recorded issues', () => {
    render(
      <ActionableInsights
        trendsData={trends([issue('12', 900), issue('11', 950), issue('10', 1000)])}
      />
    );

    expect(screen.getByText(/List size shrank 10\.0%/)).toBeInTheDocument();
  });

  it('says nothing about growth when fewer than two issues recorded a list size', () => {
    render(<ActionableInsights trendsData={trends([issue('12'), issue('11', 1180)])} />);

    expect(screen.queryByText(/List size shrank/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your list grew/)).not.toBeInTheDocument();
  });
});
