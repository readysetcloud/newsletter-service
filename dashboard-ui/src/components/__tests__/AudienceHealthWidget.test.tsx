import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudienceHealthWidget } from '../AudienceHealthWidget';
import { apiClient } from '@/services/api';
import { churnService } from '@/services/churnService';

// Mock the API client
vi.mock('@/services/api', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

// Mock the churn service — keep the real reason labels/types, stub the network.
vi.mock('@/services/churnService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/churnService')>();
  return {
    ...actual,
    churnService: { getAtRisk: vi.fn() },
  };
});

const cohortsResponse = {
  success: true,
  data: {
    cohorts: {
      highlyEngaged: { count: 5, percentage: 50.0 },
      occasional: { count: 3, percentage: 30.0 },
      dormant: { count: 2, percentage: 20.0 },
      total: 10,
    },
  },
};

// Mock recharts to avoid rendering issues in jsdom
vi.mock('recharts', () => ({
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ children }: { children: React.ReactNode }) => <div data-testid="pie">{children}</div>,
  Cell: () => <div data-testid="cell" />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  Legend: () => null,
}));

describe('AudienceHealthWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no at-risk data so the section stays hidden unless a test opts in.
    vi.mocked(churnService.getAtRisk).mockResolvedValue({ success: false, error: 'no data' });
  });

  it('shows loading state initially', () => {
    vi.mocked(apiClient.get).mockReturnValue(new Promise(() => {})); // never resolves
    render(<AudienceHealthWidget latestIssueNumber={10} />);
    expect(screen.getByText('Loading audience health…')).toBeInTheDocument();
  });

  it('displays bootstrap message when bootstrap is true', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      success: true,
      data: { bootstrap: true },
    });

    render(<AudienceHealthWidget latestIssueNumber={10} />);

    await waitFor(() => {
      expect(screen.getByText(/Engagement tracking data is being collected/)).toBeInTheDocument();
    });
  });

  it('displays cohort distribution with counts and percentages', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      success: true,
      data: {
        cohorts: {
          highlyEngaged: { count: 50, percentage: 50.0 },
          occasional: { count: 30, percentage: 30.0 },
          dormant: { count: 20, percentage: 20.0 },
          total: 100,
        },
      },
    });

    render(<AudienceHealthWidget latestIssueNumber={10} />);

    await waitFor(() => {
      expect(screen.getByText('Audience Health')).toBeInTheDocument();
    });

    expect(screen.getByText('50 (50.0%)')).toBeInTheDocument();
    expect(screen.getByText('30 (30.0%)')).toBeInTheDocument();
    expect(screen.getByText('20 (20.0%)')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('displays error message on API failure', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      success: false,
      error: 'Server error',
    });

    render(<AudienceHealthWidget latestIssueNumber={10} />);

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('passes latestIssueNumber as query parameter', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      success: true,
      data: { bootstrap: true },
    });

    render(<AudienceHealthWidget latestIssueNumber={25} />);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        '/subscribers/health?latestIssueNumber=25'
      );
    });
  });

  it('renders donut chart when cohort data is available', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      success: true,
      data: {
        cohorts: {
          highlyEngaged: { count: 10, percentage: 33.3 },
          occasional: { count: 10, percentage: 33.3 },
          dormant: { count: 10, percentage: 33.4 },
          total: 30,
        },
      },
    });

    render(<AudienceHealthWidget latestIssueNumber={5} />);

    await waitFor(() => {
      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });
  });

  it('has accessible aria-label on chart', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      success: true,
      data: {
        cohorts: {
          highlyEngaged: { count: 5, percentage: 50.0 },
          occasional: { count: 3, percentage: 30.0 },
          dormant: { count: 2, percentage: 20.0 },
          total: 10,
        },
      },
    });

    render(<AudienceHealthWidget latestIssueNumber={10} />);

    await waitFor(() => {
      const chartContainer = screen.getByRole('img');
      expect(chartContainer).toHaveAttribute('aria-label',
        'Audience health: 5 highly engaged, 3 occasional, 2 dormant out of 10 total subscribers'
      );
    });
  });

  describe('At Risk section', () => {
    const atRiskResponse = {
      success: true,
      data: {
        atRisk: [
          {
            email: 'fader@example.com',
            lastEngagedIssue: 15,
            engagementCount: 4,
            reasons: ['fading'],
          },
          {
            email: 'lapsed@example.com',
            lastEngagedIssue: 12,
            engagementCount: 6,
            reasons: ['streak_break', 'interest_stale'],
            topTopic: 'ai',
          },
        ],
        summary: {
          total: 2,
          byReason: { fading: 1, interestStale: 1, streakBreak: 1 },
        },
      },
    };

    it('shows the at-risk count badge when data is present', async () => {
      vi.mocked(apiClient.get).mockResolvedValue(cohortsResponse);
      vi.mocked(churnService.getAtRisk).mockResolvedValue(atRiskResponse);

      render(<AudienceHealthWidget latestIssueNumber={20} />);

      await waitFor(() => {
        expect(screen.getByText('At Risk')).toBeInTheDocument();
      });
      // The count badge reflects the summary total.
      expect(screen.getByText('2')).toBeInTheDocument();
      // Collapsed by default — subscriber emails not rendered yet.
      expect(screen.queryByText('fader@example.com')).not.toBeInTheDocument();
    });

    it('expands to reveal subscribers and human-readable reason chips', async () => {
      const user = userEvent.setup();
      vi.mocked(apiClient.get).mockResolvedValue(cohortsResponse);
      vi.mocked(churnService.getAtRisk).mockResolvedValue(atRiskResponse);

      render(<AudienceHealthWidget latestIssueNumber={20} />);

      await waitFor(() => {
        expect(screen.getByText('At Risk')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /At Risk/i }));

      expect(screen.getByText('fader@example.com')).toBeInTheDocument();
      expect(screen.getByText('lapsed@example.com')).toBeInTheDocument();
      expect(screen.getByText('Fading')).toBeInTheDocument();
      expect(screen.getByText('Streak broken')).toBeInTheDocument();
      expect(screen.getByText('Interests gone stale (AI)')).toBeInTheDocument();
    });

    it('hides the section when the churn endpoint fails', async () => {
      vi.mocked(apiClient.get).mockResolvedValue(cohortsResponse);
      vi.mocked(churnService.getAtRisk).mockResolvedValue({ success: false, error: 'boom' });

      render(<AudienceHealthWidget latestIssueNumber={20} />);

      await waitFor(() => {
        expect(screen.getByText('Audience Health')).toBeInTheDocument();
      });
      expect(screen.queryByText('At Risk')).not.toBeInTheDocument();
    });

    it('hides the section when nobody is at risk', async () => {
      vi.mocked(apiClient.get).mockResolvedValue(cohortsResponse);
      vi.mocked(churnService.getAtRisk).mockResolvedValue({
        success: true,
        data: { atRisk: [], summary: { total: 0, byReason: { fading: 0, interestStale: 0, streakBreak: 0 } } },
      });

      render(<AudienceHealthWidget latestIssueNumber={20} />);

      await waitFor(() => {
        expect(screen.getByText('Audience Health')).toBeInTheDocument();
      });
      expect(screen.queryByText('At Risk')).not.toBeInTheDocument();
    });
  });
});
