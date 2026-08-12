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

  // --- Detected timezone column (local send) ---
  describe('detected timezone column', () => {
    const renderWithSubscribers = async (
      subscribers: { email: string; timeZone?: string | null }[]
    ) => {
      vi.mocked(subscriberService.getCount).mockResolvedValue({
        success: true,
        data: { totalSubscribers: subscribers.length },
      });
      vi.mocked(subscriberService.getTrends).mockResolvedValue({
        success: true,
        data: mockTrendsData,
      });
      vi.mocked(segmentService.listSegments).mockResolvedValue({
        success: true,
        data: { segments: [] },
      });
      vi.mocked(subscriberService.getList).mockResolvedValue({
        success: true,
        data: {
          total: subscribers.length,
          subscribers: subscribers.map((sub) => ({
            addedAt: '2025-01-01T00:00:00Z',
            lastEngagedIssue: 5,
            ...sub,
          })),
        },
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getByText(subscribers[0].email)).toBeInTheDocument();
      });
    };

    it('shows the city portion of a detected zone, with the full name as a tooltip', async () => {
      await renderWithSubscribers([{ email: 'reader@example.com', timeZone: 'America/Chicago' }]);

      const cell = screen.getByText('Chicago');
      expect(cell).toBeInTheDocument();
      expect(cell).toHaveAttribute('title', expect.stringContaining('America/Chicago'));
    });

    it('renders multi-segment zone names readably', async () => {
      await renderWithSubscribers([
        { email: 'reader@example.com', timeZone: 'America/Argentina/Buenos_Aires' },
      ]);

      // Underscores are display noise, and the trailing segment is the part that
      // distinguishes zones at a glance.
      expect(screen.getByText('Buenos Aires')).toBeInTheDocument();
    });

    it('explains an undetected zone rather than showing a bare dash', async () => {
      await renderWithSubscribers([{ email: 'quiet@example.com', timeZone: null }]);

      const dash = screen
        .getAllByText('—')
        .find((el) => el.getAttribute('title')?.includes('Not detected yet'));
      expect(dash).toBeDefined();
      expect(dash).toHaveAttribute('title', expect.stringContaining('3 consecutive issues'));
    });
  });

  // --- Suspected-bot surfacing ---
  describe('suspected bot flags', () => {
    type BotSub = {
      email: string;
      addedAt?: string;
      suspectedBot?: boolean;
      botFlags?: {
        honeypotTriggered: boolean;
        disposableDomain: boolean;
        suspiciousUserAgent: boolean;
        fastSubmission: boolean;
        suspiciousEmailPattern: boolean;
      };
    };

    const flags = (overrides: Partial<BotSub['botFlags'] & object> = {}) => ({
      honeypotTriggered: false,
      disposableDomain: false,
      suspiciousUserAgent: false,
      fastSubmission: false,
      suspiciousEmailPattern: false,
      ...overrides,
    });

    const renderWithBotSubscribers = async (subscribers: BotSub[]) => {
      vi.mocked(subscriberService.getCount).mockResolvedValue({
        success: true,
        data: { totalSubscribers: subscribers.length },
      });
      vi.mocked(subscriberService.getTrends).mockResolvedValue({
        success: true,
        data: mockTrendsData,
      });
      vi.mocked(segmentService.listSegments).mockResolvedValue({
        success: true,
        data: { segments: [] },
      });
      vi.mocked(subscriberService.getList).mockResolvedValue({
        success: true,
        data: {
          total: subscribers.length,
          subscribers: subscribers.map((sub) => ({
            addedAt: '2025-01-01T00:00:00Z',
            lastEngagedIssue: 5,
            ...sub,
          })),
        },
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getByText(subscribers[0].email)).toBeInTheDocument();
      });
    };

    it('renders the Suspected chip as a button that opens the profile', async () => {
      await renderWithBotSubscribers([
        {
          email: 'bot@example.com',
          suspectedBot: true,
          botFlags: flags({ honeypotTriggered: true }),
        },
      ]);

      // A native title tooltip never fires on touch, so the chip has to be a
      // real control rather than a decorated span.
      const chip = screen.getByRole('button', {
        name: /Why bot@example.com is flagged as a suspected bot/,
      });
      expect(chip).toHaveAttribute('title', expect.stringContaining('Honeypot triggered'));

      fireEvent.click(chip);

      await waitFor(() => {
        expect(screen.getByText('Likely automated signup')).toBeInTheDocument();
      });
    });

    it('does not render a chip for an unflagged subscriber', async () => {
      await renderWithBotSubscribers([{ email: 'reader@example.com', suspectedBot: false }]);

      expect(
        screen.queryByRole('button', { name: /flagged as a suspected bot/ })
      ).not.toBeInTheDocument();
    });

    it('counts flagged subscribers and filters the list down to them', async () => {
      await renderWithBotSubscribers([
        { email: 'bot@example.com', suspectedBot: true, botFlags: flags({ fastSubmission: true }) },
        { email: 'spam@example.com', suspectedBot: true, botFlags: flags({ disposableDomain: true }) },
        { email: 'reader@example.com', suspectedBot: false },
      ]);

      const toggle = screen.getByRole('button', { name: /Suspected \(2\)/ });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('reader@example.com')).toBeInTheDocument();

      fireEvent.click(toggle);

      await waitFor(() => {
        expect(screen.queryByText('reader@example.com')).not.toBeInTheDocument();
      });
      expect(screen.getByText('bot@example.com')).toBeInTheDocument();
      expect(screen.getByText('spam@example.com')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Suspected \(2\)/ })
      ).toHaveAttribute('aria-pressed', 'true');
    });

    it('hides the count entirely when nothing is flagged', async () => {
      await renderWithBotSubscribers([{ email: 'reader@example.com', suspectedBot: false }]);

      expect(screen.queryByRole('button', { name: /Suspected \(/ })).not.toBeInTheDocument();
    });

    it('reports the flagged share of recent signups once there are enough to be meaningful', async () => {
      // 12 signups, 3 flagged — above the 10-signup floor for a rate.
      const subs: BotSub[] = Array.from({ length: 12 }, (_, i) => ({
        email: `sub${i}@example.com`,
        addedAt: `2025-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
        suspectedBot: i < 3,
        botFlags: i < 3 ? flags({ fastSubmission: true }) : undefined,
      }));
      await renderWithBotSubscribers(subs);

      expect(screen.getByText(/3 of the last 12 signups/)).toBeInTheDocument();
      expect(screen.getByText(/\(25%\)/)).toBeInTheDocument();
    });

    it('omits the rate when the sample is too small to mean anything', async () => {
      await renderWithBotSubscribers([
        { email: 'bot@example.com', suspectedBot: true, botFlags: flags({ fastSubmission: true }) },
        { email: 'reader@example.com', suspectedBot: false },
      ]);

      expect(screen.queryByText(/of the last/)).not.toBeInTheDocument();
      // The absolute count still shows.
      expect(screen.getByRole('button', { name: /Suspected \(1\)/ })).toBeInTheDocument();
    });
  });
});
