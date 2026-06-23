import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AbTestHistory } from '../AbTestHistory';
import type { AbHistoryResponse } from '@/types/issues';

const sampleData: AbHistoryResponse = {
  tests: [
    {
      issueNumber: 42,
      dimension: 'subject',
      winMetric: 'openRate',
      status: 'sent',
      winnerVariantId: 'b',
      significant: true,
      confidence: 0.95,
      lift: 15.0,
      decidedAt: '2026-06-01T00:00:00Z',
      variants: [
        { variantId: 'a', subject: 'Control', opens: 300, clicks: 50, deliveries: 1000, openRate: 30.0, clickRate: 5.0 },
        { variantId: 'b', subject: 'Challenger', opens: 450, clicks: 90, deliveries: 1000, openRate: 45.0, clickRate: 9.0 },
      ],
    },
    {
      issueNumber: 40,
      dimension: 'sendTime',
      winMetric: 'clickRate',
      status: 'inconclusive',
      winnerVariantId: null,
      significant: false,
      variants: [
        { variantId: 'a', sendAt: '2026-05-20T09:00:00Z', opens: 200, clicks: 30, deliveries: 800, openRate: 25.0, clickRate: 3.75 },
        { variantId: 'b', sendAt: '2026-05-20T17:00:00Z', opens: 210, clicks: 32, deliveries: 800, openRate: 26.25, clickRate: 4.0 },
      ],
    },
  ],
  aggregates: {
    totalTests: 4,
    significantTests: 3,
    subjectTests: 2,
    sendTimeTests: 2,
    avgWinningLift: 8.0,
    topSendHoursUtc: [{ hourUtc: 9, wins: 2 }],
  },
};

describe('AbTestHistory', () => {
  it('renders headline aggregates and a test row', () => {
    render(<AbTestHistory data={sampleData} />);

    // Aggregates
    expect(screen.getByText('Total tests')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('3 significant')).toBeInTheDocument();
    expect(screen.getByText('Avg winning lift')).toBeInTheDocument();
    expect(screen.getByText('+8.0 pts')).toBeInTheDocument();
    // Top send hour 09:00 UTC (exact aggregate value)
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByText('Top send hours (UTC)')).toBeInTheDocument();

    // Test row
    expect(screen.getByText('Issue #42')).toBeInTheDocument();
    expect(screen.getByText('Not significant')).toBeInTheDocument();
    expect(screen.getByText('Winner B (Challenger)')).toBeInTheDocument();
    expect(screen.getByText('Lift +15.0 pts')).toBeInTheDocument();
    // Per-variant rates
    expect(screen.getByText('Open 45.0%')).toBeInTheDocument();
    expect(screen.getByText('Click 9.0%')).toBeInTheDocument();
  });

  it('shows the Apple MPP caveat when an open-rate test is present', () => {
    render(<AbTestHistory data={sampleData} />);
    expect(screen.getAllByText(/Apple Mail Privacy Protection|MPP caveat/i).length).toBeGreaterThan(0);
  });

  it('renders the empty state when there are no tests', () => {
    render(
      <AbTestHistory
        data={{
          tests: [],
          aggregates: {
            totalTests: 0,
            significantTests: 0,
            subjectTests: 0,
            sendTimeTests: 0,
            topSendHoursUtc: [],
          },
        }}
      />
    );
    expect(screen.getByText('No A/B tests yet')).toBeInTheDocument();
  });

  it('renders the loading state', () => {
    render(<AbTestHistory loading />);
    expect(screen.getByText(/Loading A\/B test history/i)).toBeInTheDocument();
  });

  it('renders the error state', () => {
    render(<AbTestHistory error="Boom" />);
    expect(screen.getByText('Couldn’t load A/B test history')).toBeInTheDocument();
    expect(screen.getByText('Boom')).toBeInTheDocument();
  });
});
