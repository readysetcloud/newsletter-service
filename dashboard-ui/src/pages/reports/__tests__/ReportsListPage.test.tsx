import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReportsListPage } from '../ReportsListPage';
import { reportsService } from '@/services/reportsService';
import type { ReportSummaryItem } from '@/types/reports';

vi.mock('@/services/reportsService', () => ({
  reportsService: {
    listReports: vi.fn(),
    createReport: vi.fn()
  }
}));

// One stable object, deliberately. Returning a fresh `addToast` per render
// changes the identity of the callbacks that depend on it, which re-fires the
// page's load effect and makes call counts meaningless.
const toast = { addToast: vi.fn() };
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => toast
}));

const mocked = vi.mocked(reportsService);

const summary = {
  issuesSent: 4,
  totalDelivered: 4000,
  totalOpens: 2000,
  totalClicks: 400,
  totalBounces: 20,
  totalUnsubscribes: 8,
  avgOpenRate: 50,
  avgClickRate: 10,
  avgClickToOpenRate: 20,
  avgBounceRate: 0.5
};

const report = (over: Partial<ReportSummaryItem> = {}): ReportSummaryItem => ({
  id: '2026-05',
  month: '2026-05',
  monthLabel: 'May 2026',
  periodLabel: 'May 2026',
  periodStart: '2026-05-01T00:00:00.000Z',
  periodEnd: '2026-06-01T00:00:00.000Z',
  createdAt: '2026-06-01T14:00:00.000Z',
  generatedAt: '2026-06-01T14:02:00.000Z',
  reportType: 'monthly',
  status: 'complete',
  summary,
  subscriberGrowth: { startCount: 1000, endCount: 1100, netChange: 100, growthRate: 10 },
  ...over
});

const listOf = (...reports: ReportSummaryItem[]) => ({
  success: true as const,
  data: { reports }
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <ReportsListPage />
    </MemoryRouter>
  );

describe('ReportsListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocked.listReports.mockResolvedValue(listOf(report()));
  });

  it('lists a finished report with its figures', async () => {
    renderPage();

    expect(await screen.findByText('May 2026')).toBeInTheDocument();
    expect(screen.getByText('50.0%')).toBeInTheDocument();
    expect(screen.getByText('4 issues sent')).toBeInTheDocument();
  });

  describe('telling the two kinds apart', () => {
    it('marks a scheduled report', async () => {
      renderPage();

      expect(await screen.findByText('Scheduled')).toBeInTheDocument();
    });

    it('marks one somebody asked for', async () => {
      mocked.listReports.mockResolvedValue(
        listOf(report({ id: '01JBQ', reportType: 'adhoc', periodLabel: '1–14 Jun 2026', month: undefined, monthLabel: undefined }))
      );

      renderPage();

      expect(await screen.findByText('Custom range')).toBeInTheDocument();
      expect(screen.getByText('1–14 Jun 2026')).toBeInTheDocument();
    });
  });

  describe('a report with no figures', () => {
    it('shows an unfinished one as generating, not as broken', async () => {
      mocked.listReports.mockResolvedValue(
        listOf(report({
          id: '01JBQ',
          reportType: 'adhoc',
          status: 'pending',
          periodLabel: '1–14 Jun 2026',
          summary: undefined,
          subscriberGrowth: undefined,
          generatedAt: undefined
        }))
      );

      renderPage();

      expect(await screen.findByText(/generating/i)).toBeInTheDocument();
    });

    it('says why a failed one failed', async () => {
      mocked.listReports.mockResolvedValue(
        listOf(report({
          status: 'failed',
          failureReason: 'Lambda.Unknown: Bedrock throttled the request',
          summary: undefined,
          subscriberGrowth: undefined
        }))
      );

      renderPage();

      expect(await screen.findByText(/could not be generated/i)).toBeInTheDocument();
      expect(screen.getByText(/Bedrock throttled/)).toBeInTheDocument();
    });

    it('treats an empty range as an answer rather than a failure', async () => {
      // A quiet fortnight is a fair question with a real answer, and must not
      // read like something went wrong.
      mocked.listReports.mockResolvedValue(
        listOf(report({
          id: '01JBQ',
          reportType: 'adhoc',
          status: 'complete',
          periodLabel: '1–14 Jun 2026',
          summary: undefined,
          subscriberGrowth: undefined
        }))
      );

      renderPage();

      expect(await screen.findByText(/no issues went out/i)).toBeInTheDocument();
      expect(screen.queryByText(/could not be generated/i)).not.toBeInTheDocument();
    });

    it('does not offer to open one that has nothing to show', async () => {
      mocked.listReports.mockResolvedValue(
        listOf(report({ status: 'pending', summary: undefined, subscriberGrowth: undefined }))
      );

      renderPage();

      await screen.findByText(/generating/i);
      // Opening it would land on a page with nothing on it.
      expect(screen.getByRole('listitem')).toHaveAttribute('tabIndex', '-1');
    });
  });

  describe('following work in flight', () => {
    it('re-reads the list while something is still generating', async () => {
      vi.useFakeTimers();
      mocked.listReports.mockResolvedValue(
        listOf(report({ status: 'pending', summary: undefined, subscriberGrowth: undefined }))
      );

      renderPage();
      // Waiting for the row, not the call: the interval is only armed once the
      // pending report is in state, which is a tick after the request returns.
      await vi.waitFor(() => expect(screen.getByText(/generating/i)).toBeInTheDocument());
      const beforePolling = mocked.listReports.mock.calls.length;

      await vi.advanceTimersByTimeAsync(5000);

      expect(mocked.listReports.mock.calls.length).toBeGreaterThan(beforePolling);
      vi.useRealTimers();
    });

    it('stops once everything has finished', async () => {
      vi.useFakeTimers();
      renderPage();
      await vi.waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());

      await vi.advanceTimersByTimeAsync(20000);

      // Nothing pending, so nothing to poll for.
      expect(mocked.listReports).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });

  it('refuses to start a fourth report while three are running', async () => {
    const pending = (id: string) =>
      report({ id, status: 'pending', summary: undefined, subscriberGrowth: undefined });
    mocked.listReports.mockResolvedValue(listOf(pending('a'), pending('b'), pending('c')));

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /new report/i })).toBeDisabled()
    );
  });
});
