import { issuesService } from '../issuesService';
import { apiClient } from '../api';
import type { Issue, IssueAnalytics, IssueStats } from '@/types/issues';

vi.mock('../api');

const mockApiClient = vi.mocked(apiClient);

/** A complete event-analytics slice — the shape the detail page renders. */
const eventAnalytics: IssueAnalytics = {
  links: [{ url: 'https://example.com', clicks: 4, percentOfTotal: 100, position: 0 }],
  clickDecay: [{ hour: 0, clicks: 4, cumulativeClicks: 4 }],
  geoDistribution: [{ country: 'US', clicks: 4, opens: 9 }],
  deviceBreakdown: { desktop: 3, mobile: 6, tablet: 0 },
  timingMetrics: {
    medianTimeToOpen: 120,
    p95TimeToOpen: 900,
    medianTimeToClick: 300,
    p95TimeToClick: 1800,
  },
  engagementType: { newClickers: 2, returningClickers: 2 },
  trafficSource: { clicks: { email: 4, web: 0 } },
  bounceReasons: { permanent: 1, temporary: 0, suppressed: 0 },
  complaintDetails: [],
};

const baseStats: IssueStats = {
  opens: 66,
  clicks: 170,
  deliveries: 527,
  sends: 537,
  bounces: 9,
  complaints: 1,
  subscribers: 3016,
};

/**
 * The enriched report the aggregation pipeline writes over `stats.analytics`.
 * `currentMetrics` is what marks it as the envelope.
 */
const envelope = (nested: IssueAnalytics | null) => ({
  currentMetrics: { openRate: 33.1, clickThroughRate: 61.92, subscribers: 3016 },
  healthScore: { score: 60, status: 'OK' },
  insightCandidates: [],
  eventAnalytics: nested,
});

const issueWith = (analytics: unknown): Issue =>
  ({
    id: '230',
    issueNumber: 230,
    subject: 'Agent memory is harder than it sounds',
    status: 'published',
    content: '<html></html>',
    contentType: 'html',
    createdAt: '2026-08-21T20:43:23.203Z',
    stats: { ...baseStats, analytics },
  }) as unknown as Issue;

describe('issuesService.getIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unwraps the report envelope down to its event analytics', async () => {
    mockApiClient.get.mockResolvedValue({ success: true, data: issueWith(envelope(eventAnalytics)) });

    const result = await issuesService.getIssue('230');

    expect(mockApiClient.get).toHaveBeenCalledWith('/issues/230');
    expect(result.success).toBe(true);
    expect(result.data?.stats?.analytics).toEqual(eventAnalytics);
  });

  // The case that took the page down: an issue whose event analytics were never
  // built still gets an envelope, carrying `eventAnalytics: null`. Reading that
  // as "no envelope" left the whole report in place as if it were
  // `IssueAnalytics`, which validation rejected, which failed the request.
  it('keeps the issue when the envelope has no event analytics', async () => {
    mockApiClient.get.mockResolvedValue({ success: true, data: issueWith(envelope(null)) });

    const result = await issuesService.getIssue('230');

    expect(result.success).toBe(true);
    expect(result.data?.subject).toBe('Agent memory is harder than it sounds');
    expect(result.data?.stats?.analytics).toBeUndefined();
  });

  it('passes a bare event-analytics slice through untouched', async () => {
    mockApiClient.get.mockResolvedValue({ success: true, data: issueWith(eventAnalytics) });

    const result = await issuesService.getIssue('230');

    expect(result.success).toBe(true);
    expect(result.data?.stats?.analytics).toEqual(eventAnalytics);
  });

  it('drops analytics it cannot read rather than failing the issue', async () => {
    const unreadable = { ...eventAnalytics, links: 'not-an-array' };
    mockApiClient.get.mockResolvedValue({ success: true, data: issueWith(unreadable) });

    const result = await issuesService.getIssue('230');

    expect(result.success).toBe(true);
    expect(result.data?.stats?.analytics).toBeUndefined();
    expect(result.data?.stats?.deliveries).toBe(527);
  });

  it('still fails when the core counters are wrong', async () => {
    const data = issueWith(undefined);
    (data.stats as unknown as Record<string, unknown>).deliveries = 'lots';
    mockApiClient.get.mockResolvedValue({ success: true, data });

    const result = await issuesService.getIssue('230');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid issue stats structure/);
  });
});
