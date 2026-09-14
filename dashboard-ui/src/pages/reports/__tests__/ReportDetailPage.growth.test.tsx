import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ReportDetailPage } from '../ReportDetailPage';
import { reportsService } from '@/services/reportsService';

/**
 * A report whose subscriber growth could not be measured.
 *
 * Growth is derived from per-issue subscriber snapshots, and
 * `build-monthly-report-data.mjs` deliberately refuses to invent it from fewer
 * than two measured issues — reporting an unmeasured period as a total
 * collapse is the bug that refusal exists to prevent. So `netChange` and
 * `growthRate` come back null, which any on-demand range holding a single
 * issue produces.
 *
 * The frontend typed all four fields as plain numbers, so nothing caught
 * `null.toLocaleString()` taking down the whole page. This is the real payload
 * shape from the report that did it.
 */

vi.mock('@/services/reportsService', () => ({
  reportsService: { getReport: vi.fn(), listReports: vi.fn(), createReport: vi.fn() }
}));

vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

const mocked = vi.mocked(reportsService);

const unmeasuredGrowthReport = {
  id: '01M2GPE61E95HAHGKP6E2A0BCZ',
  periodLabel: '15 Aug – 13 Sep 2026',
  periodStart: '2026-08-15T05:00:00.000Z',
  periodEnd: '2026-09-14T05:00:00.000Z',
  generatedAt: '2026-09-14T19:31:31.836Z',
  createdAt: '2026-09-14T19:31:23.310Z',
  reportType: 'adhoc' as const,
  status: 'complete' as const,
  report: {
    summary: {
      issuesSent: 1,
      totalDelivered: 2558,
      totalOpens: 651,
      totalUniqueOpens: 651,
      totalClicks: 1626,
      totalBounces: 56,
      totalSends: 2607,
      totalUnsubscribes: 0,
      avgOpenRate: 25.45,
      avgClickRate: 63.57,
      avgClickToOpenRate: 249.77,
      avgBounceRate: 2.15
    },
    subscriberGrowth: {
      startCount: 3164,
      endCount: 3164,
      // The two that crashed the page.
      netChange: null,
      growthRate: null,
      measuredIssues: 1,
      byIssue: [{ issue: 232, date: '2026-09-08T15:13:37.380Z', subscribers: 3164 }]
    },
    topLinks: [],
    issues: [],
    insights: [],
    // Always populated past the hasIssues guard — the builder derives it from
    // the issue list, and a range with no issues never reaches this branch.
    bestIssue: {
      byOpenRate: { issueNumber: 232, subject: 'Emerging behavior with AI agents', value: 25.45 },
      byClickRate: { issueNumber: 232, subject: 'Emerging behavior with AI agents', value: 63.57 },
      byClicks: { issueNumber: 232, subject: 'Emerging behavior with AI agents', value: 1626 }
    }
  }
};

const renderDetail = () =>
  render(
    <MemoryRouter initialEntries={['/reports/01M2GPE61E95HAHGKP6E2A0BCZ']}>
      <Routes>
        <Route path="/reports/:id" element={<ReportDetailPage />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getReport.mockResolvedValue({ success: true, data: unmeasuredGrowthReport as never });
});

describe('a report with no measurable subscriber growth', () => {
  it('renders instead of taking the page down', async () => {
    // The regression: `null.toLocaleString()` threw during render and the route
    // error boundary swallowed the whole report.
    renderDetail();

    expect(await screen.findByText('Subscriber Growth')).toBeInTheDocument();
  });

  it('shows the counts it does have', async () => {
    renderDetail();

    await screen.findByText('Subscriber Growth');
    expect(screen.getAllByText('3,164').length).toBeGreaterThan(0);
  });

  it('says it has no figure rather than showing zero', async () => {
    // "+0" is a different claim: nobody joined or left, versus nobody counted.
    renderDetail();

    await screen.findByText('Subscriber Growth');
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('explains why the figure is missing', async () => {
    renderDetail();

    expect(await screen.findByText(/needs at least two issues/i)).toBeInTheDocument();
  });

  it('says how many issues it actually measured', async () => {
    renderDetail();

    expect(await screen.findByText(/this one has 1/i)).toBeInTheDocument();
  });
});

describe('a report where no issue carried a subscriber count', () => {
  // The deeper half of the same bug. `build-monthly-report-data.mjs` keeps
  // `subscribers` as a snapshot and passes a missing one through as null, so
  // `byIssue` can hold nulls even when the aggregates are present — and here,
  // where nothing was measured, everything is null at once.
  const unmeasured = {
    ...unmeasuredGrowthReport,
    report: {
      ...unmeasuredGrowthReport.report,
      subscriberGrowth: {
        startCount: null,
        endCount: null,
        netChange: null,
        growthRate: null,
        measuredIssues: 0,
        byIssue: [{ issue: 231, date: '2026-09-01T15:13:37.380Z', subscribers: null }]
      }
    }
  };

  beforeEach(() => {
    mocked.getReport.mockResolvedValue({ success: true, data: unmeasured as never });
  });

  it('renders rather than crashing on formatNumber(null)', async () => {
    renderDetail();

    expect(await screen.findByText('Subscriber Growth')).toBeInTheDocument();
  });

  it('still lists the issue it could not measure', async () => {
    renderDetail();

    await screen.findByText('Subscriber Growth');
    expect(screen.getByText('#231')).toBeInTheDocument();
  });

  it('shows no count rather than a zero for that issue', async () => {
    // A 0 here would repeat the exact claim the API refuses to make: an
    // unmeasured issue reading as an issue that went to nobody.
    renderDetail();

    await screen.findByText('Subscriber Growth');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('says it measured none of them', async () => {
    renderDetail();

    expect(await screen.findByText(/this one has 0/i)).toBeInTheDocument();
  });
});

describe('a report that did measure growth', () => {
  it('still renders the figure and its direction', async () => {
    mocked.getReport.mockResolvedValue({
      success: true,
      data: {
        ...unmeasuredGrowthReport,
        report: {
          ...unmeasuredGrowthReport.report,
          subscriberGrowth: {
            ...unmeasuredGrowthReport.report.subscriberGrowth,
            netChange: 142,
            growthRate: 4.7,
            measuredIssues: 4
          }
        }
      } as never
    });

    renderDetail();

    await waitFor(() => expect(screen.getByText('+142')).toBeInTheDocument());
    expect(screen.getByText('4.7%')).toBeInTheDocument();
    expect(screen.queryByText(/needs at least two issues/i)).not.toBeInTheDocument();
  });
});
