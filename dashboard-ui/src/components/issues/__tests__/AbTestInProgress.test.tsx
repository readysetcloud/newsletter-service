import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AbTestInProgress } from '../AbTestInProgress';
import type { ActiveAbTest } from '@/types/issues';

const renderWithRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

const activeTest = (overrides: Partial<ActiveAbTest> = {}): ActiveAbTest => ({
  issueId: '42',
  issueNumber: 42,
  subject: 'Weekly digest',
  dimension: 'subject',
  status: 'testing',
  winMetric: 'openRate',
  evaluateAfterMinutes: 120,
  variants: [
    { variantId: 'a', subject: 'Control subject' },
    { variantId: 'b', subject: 'Challenger subject' },
  ],
  variantStats: [
    { variantId: 'a', opens: 50, clicks: 10, deliveries: 100 },
    { variantId: 'b', opens: 70, clicks: 20, deliveries: 100 },
  ],
  ...overrides,
});

describe('AbTestInProgress', () => {
  it('renders nothing when there are no running tests', () => {
    const { container } = renderWithRouter(<AbTestInProgress tests={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a loading state', () => {
    renderWithRouter(<AbTestInProgress loading />);
    expect(screen.getByText(/checking for running a\/b tests/i)).toBeInTheDocument();
  });

  it('renders an error with a retry affordance', () => {
    renderWithRouter(<AbTestInProgress error="boom" onRetry={() => {}} />);
    expect(screen.getByText(/couldn.t load running a\/b tests/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('renders a running test with live open rates and a link to the issue', () => {
    renderWithRouter(<AbTestInProgress tests={[activeTest()]} />);

    // Count badge + issue link.
    expect(screen.getByText('A/B Tests In Progress')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /issue #42/i });
    expect(link).toHaveAttribute('href', '/issues/42');

    // Status badge reflects the live 'testing' state.
    expect(screen.getByText('Testing')).toBeInTheDocument();

    // Open rates: A 50/100 = 50.0%, B 70/100 = 70.0%.
    expect(screen.getByText('50.0%')).toBeInTheDocument();
    expect(screen.getByText('70.0%')).toBeInTheDocument();
    expect(screen.getByText(/120 min/i)).toBeInTheDocument();
  });

  it('uses click rate when winMetric is clickRate', () => {
    renderWithRouter(
      <AbTestInProgress tests={[activeTest({ winMetric: 'clickRate' })]} />
    );
    // A clicks 10/100 = 10.0%, B clicks 20/100 = 20.0%.
    expect(screen.getByText('10.0%')).toBeInTheDocument();
    expect(screen.getByText('20.0%')).toBeInTheDocument();
    expect(screen.getAllByText('Click rate').length).toBe(2);
  });

  it('guards divide-by-zero deliveries', () => {
    renderWithRouter(
      <AbTestInProgress
        tests={[
          activeTest({
            variantStats: [{ variantId: 'a', opens: 0, clicks: 0, deliveries: 0 }],
          }),
        ]}
      />
    );
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
