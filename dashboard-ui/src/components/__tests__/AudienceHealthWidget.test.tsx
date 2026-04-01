import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AudienceHealthWidget } from '../AudienceHealthWidget';
import { apiClient } from '@/services/api';

// Mock the API client
vi.mock('@/services/api', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

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
});
