import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IssueDetailPage } from '../IssueDetailPage';
import { issuesService } from '@/services/issuesService';
import { dashboardService } from '@/services/dashboardService';
import { STORAGE_KEYS } from '@/constants/brand';

vi.mock('@/services/issuesService', () => ({
  issuesService: {
    getIssue: vi.fn(),
    updateIssue: vi.fn(),
    deleteIssue: vi.fn(),
    rebuildAnalytics: vi.fn(),
  },
}));

vi.mock('@/services/dashboardService', () => ({
  dashboardService: {
    getTrends: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: '42' }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('@/contexts/SettingsContext', () => ({
  useTenantDateFormat: () => ({
    formatDateTime: (value: string) => value,
    formatDate: (value: string) => value,
    formatLongDate: (value: string) => value.slice(0, 10),
    formatTime: (value: string) => value.slice(11, 16),
    timeZoneLabel: () => 'UTC',
    timeZone: 'UTC',
  }),
}));

const issue = {
  id: '42',
  issueNumber: 42,
  subject: 'Weekly roundup',
  content: '# Hello',
  contentType: 'markdown',
  status: 'published',
  createdAt: '2026-07-01T12:00:00Z',
  publishedAt: '2026-07-02T12:00:00Z',
  stats: {
    subscribers: 1000,
    deliveries: 980,
    opens: 400,
    clicks: 120,
    bounces: 20,
    complaints: 1,
    unsubscribes: 3,
    analytics: {
      links: [
        { url: 'https://example.com/a', clicks: 80, percentOfTotal: 66.7, position: 1 },
        { url: 'https://example.com/b', clicks: 40, percentOfTotal: 33.3, position: 2 },
      ],
      geoDistribution: [{ country: 'US', opens: 300, clicks: 90 }],
      deviceBreakdown: { desktop: 10, mobile: 20, tablet: 1 },
      timingMetrics: {
        medianTimeToOpen: 2,
        p95TimeToOpen: 20,
        medianTimeToClick: 3,
        p95TimeToClick: 30,
      },
      bounceReasons: { hard: 10, soft: 10 },
      complaintDetails: [],
    },
  },
};

/** The toggle control for a collapsible section, by its visible title. */
const sectionHeader = (title: string) =>
  screen.getByRole('button', { name: new RegExp(`(Expand|Collapse) ${title} section`) });

describe('IssueDetailPage collapsible sections', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(issuesService.getIssue).mockResolvedValue({ success: true, data: issue as never });
    vi.mocked(dashboardService.getTrends).mockResolvedValue({ success: true, data: undefined as never });

    // Phone-sized viewport: every section starts collapsed there.
    window.innerWidth = 390;
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    window.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = '';
      thresholds = [];
    } as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens a section when its header is tapped, and closes it again', async () => {
    render(<IssueDetailPage />);

    const header = await screen.findByRole('button', { name: /Expand Engagement Analytics section/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(header);

    await waitFor(() => {
      expect(sectionHeader('Engagement Analytics')).toHaveAttribute('aria-expanded', 'true');
    });

    fireEvent.click(sectionHeader('Engagement Analytics'));

    await waitFor(() => {
      expect(sectionHeader('Engagement Analytics')).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('opens each section independently', async () => {
    render(<IssueDetailPage />);

    await screen.findByRole('button', { name: /Expand Audience Insights section/ });

    fireEvent.click(sectionHeader('Audience Insights'));

    await waitFor(() => {
      expect(sectionHeader('Audience Insights')).toHaveAttribute('aria-expanded', 'true');
    });
    expect(sectionHeader('Engagement Analytics')).toHaveAttribute('aria-expanded', 'false');
    expect(sectionHeader('Deliverability & Quality')).toHaveAttribute('aria-expanded', 'false');
  });

  it('remembers which sections were open', async () => {
    render(<IssueDetailPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Expand Deliverability & Quality section/ }));

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.issueDetailPreferences) || '{}');
      expect(saved.expandedSections).toEqual(['deliverability']);
    });
  });

  it('restores sections saved by older builds as DOM ids', async () => {
    localStorage.setItem(
      STORAGE_KEYS.issueDetailPreferences,
      JSON.stringify({
        expandedSections: ['section-engagement'],
        defaultComparison: 'average',
        showPercentages: true,
        chartStyle: 'line',
      })
    );

    render(<IssueDetailPage />);

    await waitFor(() => {
      expect(sectionHeader('Engagement Analytics')).toHaveAttribute('aria-expanded', 'true');
    });
  });
});
