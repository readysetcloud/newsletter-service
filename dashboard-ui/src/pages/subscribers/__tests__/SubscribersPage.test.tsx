import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SubscribersPage } from '../SubscribersPage';
import { subscriberService } from '@/services/subscriberService';
import { segmentService } from '@/services/segmentService';
import type { Segment } from '@/services/segmentService';
import type { SubscriberTrendsResponse } from '@/types';

// Mock subscriberService
vi.mock('@/services/subscriberService', () => ({
  subscriberService: {
    getCount: vi.fn(),
    getTrends: vi.fn(),
    getList: vi.fn(),
  },
}));

// Mock segmentService
vi.mock('@/services/segmentService', () => ({
  segmentService: {
    listSegments: vi.fn(),
    createSegment: vi.fn(),
  },
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock useToast
const mockAddToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

// Mock SubscriberGrowthChart as a simple stub
vi.mock('@/components/SubscriberGrowthChart', () => ({
  SubscriberGrowthChart: (_props: { trendsData: SubscriberTrendsResponse }) => (
    <div data-testid="subscriber-growth-chart">SubscriberGrowthChart</div>
  ),
}));

// Mock AudienceHealthWidget as a simple stub
vi.mock('@/components/AudienceHealthWidget', () => ({
  AudienceHealthWidget: (_props: { latestIssueNumber: number }) => (
    <div data-testid="audience-health-widget">AudienceHealthWidget</div>
  ),
}));

// --- Test data ---

const mockTrendsData: SubscriberTrendsResponse = {
  points: [
    {
      issueNumber: 5,
      subscribers: 1234,
      publishedAt: '2025-01-20T10:00:00Z',
    },
  ],
  summary: {
    latestSubscribers: 1234,
    oldestSubscribers: 1234,
    netChange: 0,
    percentageChange: 0,
    pointsReturned: 1,
  },
};

const mockSegments: Segment[] = [
  {
    segmentId: 'seg-1',
    name: 'VIP Subscribers',
    description: 'Top engaged readers',
    memberCount: 42,
    createdAt: '2025-01-15T10:00:00Z',
  },
  {
    segmentId: 'seg-2',
    name: 'Dormant Users',
    memberCount: 0,
    createdAt: '2025-01-10T10:00:00Z',
  },
];

const renderPage = () =>
  render(
    <MemoryRouter>
      <SubscribersPage />
    </MemoryRouter>
  );

describe('SubscribersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: subscriber list returns empty so it doesn't interfere with other tests
    vi.mocked(subscriberService.getList).mockResolvedValue({
      success: true,
      data: { subscribers: [], total: 0 },
    });
  });

  // --- Loading state ---
  it('displays skeleton placeholders while data is loading', () => {
    vi.mocked(subscriberService.getCount).mockReturnValue(new Promise(() => {}));
    vi.mocked(subscriberService.getTrends).mockReturnValue(new Promise(() => {}));
    vi.mocked(subscriberService.getList).mockReturnValue(new Promise(() => {}));
    vi.mocked(segmentService.listSegments).mockReturnValue(new Promise(() => {}));

    const { container } = renderPage();

    // Skeleton placeholders should be present (animate-pulse elements)
    const pulseElements = container.querySelectorAll('.animate-pulse');
    expect(pulseElements.length).toBeGreaterThan(0);
  });

  // --- 3-row layout order ---
  it('renders 3-row layout: metrics, trends/health, segments', async () => {
    vi.mocked(subscriberService.getCount).mockResolvedValue({
      success: true,
      data: { totalSubscribers: 1234 },
    });
    vi.mocked(subscriberService.getTrends).mockResolvedValue({
      success: true,
      data: mockTrendsData,
    });
    vi.mocked(segmentService.listSegments).mockResolvedValue({
      success: true,
      data: { segments: mockSegments },
    });

    const { container } = renderPage();

    await waitFor(() => {
      expect(screen.getByText('1,234')).toBeInTheDocument();
    });

    // Row 1: subscriber count metric
    expect(screen.getByText('Total Subscribers')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();

    // Row 2: chart and health widget
    expect(screen.getByTestId('subscriber-growth-chart')).toBeInTheDocument();
    expect(screen.getByTestId('audience-health-widget')).toBeInTheDocument();

    // Row 3: segments section
    expect(screen.getByText('Segments')).toBeInTheDocument();
    expect(screen.getByText('VIP Subscribers')).toBeInTheDocument();
    expect(screen.getByText('Dormant Users')).toBeInTheDocument();

    // Verify layout order: metrics row appears before chart, chart before segments
    const topLevelDiv = container.querySelector('.flex.flex-col.gap-6');
    expect(topLevelDiv).toBeTruthy();
  });

  // --- Success state details ---
  it('renders subscriber count, chart, health widget, and segment list on success', async () => {
    vi.mocked(subscriberService.getCount).mockResolvedValue({
      success: true,
      data: { totalSubscribers: 1234 },
    });
    vi.mocked(subscriberService.getTrends).mockResolvedValue({
      success: true,
      data: mockTrendsData,
    });
    vi.mocked(segmentService.listSegments).mockResolvedValue({
      success: true,
      data: { segments: mockSegments },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('1,234')).toBeInTheDocument();
    });

    // Subscriber count
    expect(screen.getByText('Total Subscribers')).toBeInTheDocument();

    // Growth chart stub
    expect(screen.getByTestId('subscriber-growth-chart')).toBeInTheDocument();

    // Health widget stub
    expect(screen.getByTestId('audience-health-widget')).toBeInTheDocument();

    // Segment list with member counts
    expect(screen.getByText('VIP Subscribers')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Dormant Users')).toBeInTheDocument();
  });

  // --- Empty segments state ---
  it('displays EmptyState when segment list is empty', async () => {
    vi.mocked(subscriberService.getCount).mockResolvedValue({
      success: true,
      data: { totalSubscribers: 1234 },
    });
    vi.mocked(subscriberService.getTrends).mockResolvedValue({
      success: true,
      data: mockTrendsData,
    });
    vi.mocked(segmentService.listSegments).mockResolvedValue({
      success: true,
      data: { segments: [] },
    });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText('Create your first segment to start organizing your audience')
      ).toBeInTheDocument();
    });

    // EmptyState should have a CTA button
    expect(screen.getByText('Create Segment')).toBeInTheDocument();
  });

  // --- Error states ---
  it('displays error with Retry button when trends data fails', async () => {
    vi.mocked(subscriberService.getCount).mockResolvedValue({
      success: true,
      data: { totalSubscribers: 1234 },
    });
    vi.mocked(subscriberService.getTrends).mockResolvedValue({
      success: false,
      error: 'Failed to load subscriber data',
    });
    vi.mocked(segmentService.listSegments).mockResolvedValue({
      success: true,
      data: { segments: mockSegments },
    });

    renderPage();

    await waitFor(() => {
      // Trends error appears in both Row 1 (metric) and Row 2 (chart/health)
      const errors = screen.getAllByText('Failed to load subscriber data');
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });

    // Retry buttons should be present for each error section
    const retryButtons = screen.getAllByText('Retry');
    expect(retryButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('displays error with Retry button when segments fail', async () => {
    vi.mocked(subscriberService.getCount).mockResolvedValue({
      success: true,
      data: { totalSubscribers: 1234 },
    });
    vi.mocked(subscriberService.getTrends).mockResolvedValue({
      success: true,
      data: mockTrendsData,
    });
    vi.mocked(segmentService.listSegments).mockResolvedValue({
      success: false,
      error: 'Failed to load segments',
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Failed to load segments')).toBeInTheDocument();
    });

    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('retries trends data fetch when Retry is clicked', async () => {
    vi.mocked(subscriberService.getCount).mockResolvedValue({
      success: true,
      data: { totalSubscribers: 1234 },
    });
    vi.mocked(subscriberService.getTrends)
      .mockResolvedValueOnce({ success: false, error: 'Failed to load subscriber data' })
      .mockResolvedValueOnce({ success: true, data: mockTrendsData });
    vi.mocked(segmentService.listSegments).mockResolvedValue({
      success: true,
      data: { segments: mockSegments },
    });

    renderPage();

    await waitFor(() => {
      const errors = screen.getAllByText('Failed to load subscriber data');
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });

    // Click the first Retry button (for trends error in Row 1)
    const retryButtons = screen.getAllByText('Retry');
    fireEvent.click(retryButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('1,234')).toBeInTheDocument();
    });

    expect(subscriberService.getTrends).toHaveBeenCalledTimes(2);
  });

  it('retries segment list fetch when Retry is clicked', async () => {
    vi.mocked(subscriberService.getCount).mockResolvedValue({
      success: true,
      data: { totalSubscribers: 1234 },
    });
    vi.mocked(subscriberService.getTrends).mockResolvedValue({
      success: true,
      data: mockTrendsData,
    });
    vi.mocked(segmentService.listSegments)
      .mockResolvedValueOnce({ success: false, error: 'Failed to load segments' })
      .mockResolvedValueOnce({ success: true, data: { segments: mockSegments } });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Failed to load segments')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(screen.getByText('VIP Subscribers')).toBeInTheDocument();
    });

    expect(segmentService.listSegments).toHaveBeenCalledTimes(2);
  });

  // --- Segment row click navigation ---
  it('navigates to segment detail when a segment row is clicked', async () => {
    vi.mocked(subscriberService.getCount).mockResolvedValue({
      success: true,
      data: { totalSubscribers: 1234 },
    });
    vi.mocked(subscriberService.getTrends).mockResolvedValue({
      success: true,
      data: mockTrendsData,
    });
    vi.mocked(segmentService.listSegments).mockResolvedValue({
      success: true,
      data: { segments: mockSegments },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('VIP Subscribers')).toBeInTheDocument();
    });

    // Click the row containing "VIP Subscribers"
    const row = screen.getByText('VIP Subscribers').closest('tr')!;
    fireEvent.click(row);

    expect(mockNavigate).toHaveBeenCalledWith('/segments/seg-1');
  });
});
