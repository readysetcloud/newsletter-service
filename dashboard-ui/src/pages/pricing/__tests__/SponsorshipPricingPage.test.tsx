import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SponsorshipPricingPage } from '../SponsorshipPricingPage';
import type { PricingData, PricingHistoryData, Questionnaire, InterestCompositionTopic } from '@/types';
import type { ApiResponse } from '@/types/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetPricing = vi.fn();
const mockGetPricingHistory = vi.fn();
const mockGetQuestionnaire = vi.fn();
const mockGenerateReport = vi.fn();

vi.mock('@/services/pricingService', () => ({
  pricingService: {
    getPricing: (...args: unknown[]) => mockGetPricing(...args),
    getPricingHistory: (...args: unknown[]) => mockGetPricingHistory(...args),
    getQuestionnaire: (...args: unknown[]) => mockGetQuestionnaire(...args),
    triggerRecalculation: vi.fn(),
    pollRecalculationStatus: vi.fn(),
    submitQuestionnaire: vi.fn(),
    generateNarrative: vi.fn(),
  },
}));

vi.mock('@/services/reportService', () => ({
  reportService: {
    generateReport: (...args: unknown[]) => mockGenerateReport(...args),
  },
}));

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string; [key: string]: unknown }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useLocation: () => ({ pathname: '/pricing' }),
  useNavigate: () => vi.fn(),
  BrowserRouter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock AuthContext
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin' }, isAuthenticated: true }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock useTheme hook
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

// Mock Recharts to avoid canvas issues in jsdom
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makePricingData(overrides?: Partial<PricingData>): ApiResponse<PricingData> {
  return {
    success: true,
    data: {
      hasPricing: true,
      firstCalculationPending: false,
      current: {
        recommendedPrice: 150,
        baselinePrice: 100,
        multiplier: { raw: 1.5, clamped: 1.5, smoothed: 1.5 },
        confidence: 'high',
        justification: 'Good metrics',
        metrics: {
          subscriberCount: 10000,
          avgOpenRate: 0.48,
          avgClickRate: 0.12,
          avgBounceRate: 0.02,
          avgComplaintRate: 0.001,
          subscriberGrowthRate: 0.05,
          publishedIssueCount: 20,
        },
        calculatedAt: '2025-01-15T12:00:00Z',
        metricsAsOf: '2025-01-14T12:00:00Z',
        weekWindow: '2025-W03',
        isFallback: false,
        smoothingApplied: false,
      },
      ...overrides,
    },
  };
}

function makeEmptyPricingData(): ApiResponse<PricingData> {
  return {
    success: true,
    data: {
      hasPricing: false,
      firstCalculationPending: false,
      current: null,
    },
  };
}

function makeHistoryData(): ApiResponse<PricingHistoryData> {
  return { success: true, data: { history: [], count: 0 } };
}

function makePricingDataWithComposition(
  topics: InterestCompositionTopic[],
): ApiResponse<PricingData> {
  const base = makePricingData();
  return {
    ...base,
    data: {
      ...base.data!,
      current: {
        ...base.data!.current!,
        interestComposition: {
          totalSubscribers: 500,
          topics,
        },
      },
    },
  };
}

function makeQuestionnaireData(): ApiResponse<Questionnaire> {
  return { success: true, data: { version: '1', questions: [] } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SponsorshipPricingPage - Export Button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPricingHistory.mockResolvedValue(makeHistoryData());
    mockGetQuestionnaire.mockResolvedValue(makeQuestionnaireData());
  });

  it('shows export button when hasPricing=true and current exists', async () => {
    mockGetPricing.mockResolvedValue(makePricingData());

    render(<SponsorshipPricingPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export sponsor report/i })).toBeInTheDocument();
    });
  });

  it('hides export button when hasPricing=false', async () => {
    mockGetPricing.mockResolvedValue(makeEmptyPricingData());

    render(<SponsorshipPricingPage />);

    await waitFor(() => {
      expect(screen.getByText(/No Pricing Data Yet/i)).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /export sponsor report/i })).not.toBeInTheDocument();
  });

  it('disables button and shows loading state during generation', async () => {
    mockGetPricing.mockResolvedValue(makePricingData());
    // Make generateReport hang so we can observe the loading state
    let resolveGenerate: () => void;
    mockGenerateReport.mockImplementation(
      () => new Promise<void>((resolve) => { resolveGenerate = resolve; }),
    );

    render(<SponsorshipPricingPage />);

    const btn = await screen.findByRole('button', { name: /export sponsor report/i });
    fireEvent.click(btn);

    await waitFor(() => {
      const loadingBtn = screen.getByRole('button', { name: /generating sponsor report/i });
      expect(loadingBtn).toBeDisabled();
      expect(screen.getByText('Generating…')).toBeInTheDocument();
    });

    // Resolve to clean up
    resolveGenerate!();
    await waitFor(() => {
      expect(screen.getByText('Export Sponsor Report')).toBeInTheDocument();
    });
  });

  it('displays error message when generation fails', async () => {
    mockGetPricing.mockResolvedValue(makePricingData());
    mockGenerateReport.mockRejectedValue(new Error('PDF failed'));

    render(<SponsorshipPricingPage />);

    const btn = await screen.findByRole('button', { name: /export sponsor report/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(
        screen.getByText('Report could not be generated. Please try again.'),
      ).toBeInTheDocument();
    });

    // Button should be re-enabled after error
    expect(screen.getByRole('button', { name: /export sponsor report/i })).not.toBeDisabled();
  });
});

describe('SponsorshipPricingPage - Audience Interest Composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPricingHistory.mockResolvedValue(makeHistoryData());
    mockGetQuestionnaire.mockResolvedValue(makeQuestionnaireData());
  });

  const topics: InterestCompositionTopic[] = [
    { topic: 'ai', displayName: 'AI', confirmed: 170, confirmedPct: 34.0, engaged: 250, engagedPct: 50.0 },
    { topic: 'serverless', displayName: 'Serverless', confirmed: 100, confirmedPct: 20.0, engaged: 150, engagedPct: 30.0 },
  ];

  it('renders the card with top topics and confirmed percentages when interestComposition is present', async () => {
    mockGetPricing.mockResolvedValue(makePricingDataWithComposition(topics));

    render(<SponsorshipPricingPage />);

    await waitFor(() => {
      expect(screen.getByText('Audience Interest Composition')).toBeInTheDocument();
    });

    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('34.0%')).toBeInTheDocument();
    expect(screen.getByText('Serverless')).toBeInTheDocument();
    expect(screen.getByText('20.0%')).toBeInTheDocument();
  });

  it('does not render the card when interestComposition is absent', async () => {
    mockGetPricing.mockResolvedValue(makePricingData());

    render(<SponsorshipPricingPage />);

    await waitFor(() => {
      expect(screen.getByText(/Recommended Sponsorship Price/i)).toBeInTheDocument();
    });

    expect(screen.queryByText('Audience Interest Composition')).not.toBeInTheDocument();
  });

  it('does not render the card when interestComposition has no topics', async () => {
    mockGetPricing.mockResolvedValue(makePricingDataWithComposition([]));

    render(<SponsorshipPricingPage />);

    await waitFor(() => {
      expect(screen.getByText(/Recommended Sponsorship Price/i)).toBeInTheDocument();
    });

    expect(screen.queryByText('Audience Interest Composition')).not.toBeInTheDocument();
  });

  it('caps the number of topics shown at 5', async () => {
    const manyTopics: InterestCompositionTopic[] = Array.from({ length: 8 }, (_, i) => ({
      topic: `topic${i}`,
      displayName: `Topic ${i}`,
      confirmed: 8 - i,
      confirmedPct: 8 - i,
      engaged: 8 - i,
      engagedPct: 8 - i,
    }));
    mockGetPricing.mockResolvedValue(makePricingDataWithComposition(manyTopics));

    render(<SponsorshipPricingPage />);

    await waitFor(() => {
      expect(screen.getByText('Audience Interest Composition')).toBeInTheDocument();
    });

    expect(screen.getByText('Topic 0')).toBeInTheDocument();
    expect(screen.getByText('Topic 4')).toBeInTheDocument();
    expect(screen.queryByText('Topic 5')).not.toBeInTheDocument();
  });
});
