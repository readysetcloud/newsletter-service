import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AbTestResults } from '../AbTestResults';
import type { AbTest, VariantStats } from '@/types/issues';

const addToast = vi.fn();
vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ addToast }),
}));

const baseStats: VariantStats[] = [
  { variantId: 'a', opens: 50, clicks: 10, deliveries: 100 },
  { variantId: 'b', opens: 70, clicks: 20, deliveries: 100 },
];

const subjectTest = (overrides: Partial<AbTest> = {}): AbTest => ({
  dimension: 'subject',
  winMetric: 'openRate',
  variants: [
    { variantId: 'a', subject: 'Control subject' },
    { variantId: 'b', subject: 'Challenger subject' },
  ],
  status: 'testing',
  ...overrides,
});

describe('AbTestResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the dimension header and computes open/click rates', () => {
    render(<AbTestResults abTest={subjectTest()} variantStats={baseStats} />);

    expect(screen.getByText('Subject line')).toBeInTheDocument();
    expect(screen.getByText('Control subject')).toBeInTheDocument();
    // Variant A open rate 50/100 = 50.0%, click rate 10/100 = 10.0%
    expect(screen.getByText('50.0%')).toBeInTheDocument();
    expect(screen.getByText('10.0%')).toBeInTheDocument();
    // Variant B open rate 70/100 = 70.0%
    expect(screen.getByText('70.0%')).toBeInTheDocument();
  });

  it('guards divide-by-zero deliveries', () => {
    render(
      <AbTestResults
        abTest={subjectTest()}
        variantStats={[{ variantId: 'a', opens: 0, clicks: 0, deliveries: 0 }]}
      />
    );
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows in-progress state when not yet decided', () => {
    render(<AbTestResults abTest={subjectTest({ status: 'testing' })} variantStats={baseStats} />);
    expect(screen.getByText(/awaiting results/i)).toBeInTheDocument();
  });

  it('shows significance summary and a Winner badge when significant', () => {
    const abTest = subjectTest({
      status: 'sent',
      winnerVariantId: 'b',
      evaluation: {
        winMetric: 'openRate',
        confidence: 0.95,
        minSamplePerVariant: 50,
        variantA: { successes: 50, deliveries: 100, rate: 0.5 },
        variantB: { successes: 70, deliveries: 100, rate: 0.7 },
        zScore: 2.9,
        pValue: 0.004,
        significant: true,
        winnerVariantId: 'b',
        decidedAt: '2026-06-01T00:00:00Z',
      },
    });
    render(<AbTestResults abTest={abTest} variantStats={baseStats} />);
    expect(screen.getByText(/Significant at 95% confidence/i)).toBeInTheDocument();
    expect(screen.getByText('Winner')).toBeInTheDocument();
  });

  it('shows inconclusive state', () => {
    render(<AbTestResults abTest={subjectTest({ status: 'inconclusive' })} variantStats={baseStats} />);
    expect(screen.getByText(/Inconclusive — control was sent/i)).toBeInTheDocument();
  });

  it('shows the Apple MPP caveat for open-rate tests', () => {
    render(<AbTestResults abTest={subjectTest({ winMetric: 'openRate' })} variantStats={baseStats} />);
    expect(screen.getByText(/Apple Mail Privacy Protection/i)).toBeInTheDocument();
  });

  it('is display-only — it does not render manual declare-winner controls', () => {
    render(<AbTestResults abTest={subjectTest({ status: 'testing' })} variantStats={baseStats} />);
    expect(screen.queryByRole('button', { name: /Declare/i })).not.toBeInTheDocument();
  });

  it('renders send time for send-time tests', () => {
    const abTest: AbTest = {
      dimension: 'sendTime',
      winMetric: 'clickRate',
      variants: [
        { variantId: 'a', sendAt: '2026-06-01T09:00:00Z' },
        { variantId: 'b', sendAt: '2026-06-01T17:00:00Z' },
      ],
      status: 'testing',
    };
    render(<AbTestResults abTest={abTest} variantStats={baseStats} />);
    expect(screen.getByText('Send time')).toBeInTheDocument();
  });

  describe('before the issue has sent', () => {
    it('does not claim a test is running', async () => {
      // A draft's saved config used to render "Test in progress — awaiting
      // results" next to a spinner, describing a test that had not started.
      render(<AbTestResults abTest={subjectTest({ status: undefined })} hasStarted={false} />);

      expect(screen.queryByText(/test in progress/i)).not.toBeInTheDocument();
      expect(
        screen.getByText(/the test starts when this issue sends/i)
      ).toBeInTheDocument();
    });

    it('reports the status as not started', () => {
      render(<AbTestResults abTest={subjectTest({ status: undefined })} hasStarted={false} />);

      expect(screen.getByLabelText(/A\/B test status: Not started/i)).toBeInTheDocument();
    });

    it('is titled as a configuration, not results', () => {
      render(<AbTestResults abTest={subjectTest({ status: undefined })} hasStarted={false} />);

      expect(screen.getByText('A/B Test')).toBeInTheDocument();
      expect(screen.queryByText('A/B Test Results')).not.toBeInTheDocument();
    });

    it('shows no engagement metrics', () => {
      // Rendering "—" and "0 / 0 delivered" reads as a measurement that came
      // back empty rather than one that hasn't happened.
      render(<AbTestResults abTest={subjectTest({ status: undefined })} hasStarted={false} />);

      expect(screen.queryByText(/delivered/)).not.toBeInTheDocument();
      expect(screen.getAllByText(/will be measured on open rate once sent/i)).toHaveLength(2);
    });

    it('still shows what each variant is configured to send', () => {
      render(<AbTestResults abTest={subjectTest({ status: undefined })} hasStarted={false} />);

      expect(screen.getByText('Variant A (Control)')).toBeInTheDocument();
      expect(screen.getByText('Variant B (Challenger)')).toBeInTheDocument();
    });

    it('goes back to reporting results once the issue sends', () => {
      // The same config, after the send has started, is a live test again.
      render(<AbTestResults abTest={subjectTest({ status: 'testing' })} variantStats={baseStats} />);

      expect(screen.getByText('A/B Test Results')).toBeInTheDocument();
      expect(screen.getByText(/test in progress/i)).toBeInTheDocument();
    });
  });
});
