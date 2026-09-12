import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, ArrowUpRight, ArrowDownRight, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { Card } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/Loading';
import { SectionError } from '@/components/ui/SectionError';
import { GenerateReportForm } from '@/components/reports/GenerateReportForm';
import { ReportKindChip } from '@/components/reports/ReportKindChip';
import { ReportCardState, ReportCardSubtitle } from '@/components/reports/ReportCardState';
import { reportsService } from '@/services/reportsService';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { ReportSummaryItem } from '@/types/reports';

const formatPercent = (value: number): string => `${value.toFixed(1)}%`;

const formatNumber = (value: number): string => value.toLocaleString('en-US');

const formatSignedNumber = (value: number): string =>
  `${value > 0 ? '+' : ''}${value.toLocaleString('en-US')}`;

/**
 * How often to re-read the list while something is still being generated.
 *
 * Reports are ordered by when they were started, so anything just requested is
 * the first row and polling the list is enough to follow it. Once in-app
 * notifications exist this goes away.
 */
const POLL_INTERVAL_MS = 5000;

/** Reports are listed newest-first, so a new one is always on the first page. */
const PAGE_SIZE = 20;

/** Reports being generated at once, per tenant. Mirrors the API's own limit. */
const MAX_CONCURRENT = 3;

const isPending = (report: ReportSummaryItem) => report.status === 'pending';

/** A report has figures to show only once it has finished with issues in range. */
const isReadable = (report: ReportSummaryItem) =>
  report.status === 'complete' && !!report.summary;

/** Net subscriber change, coloured and signed. */
const NetChange: React.FC<{ value: number }> = ({ value }) => {
  const positive = value >= 0;
  const Arrow = positive ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={`inline-flex items-center gap-1 font-medium ${
        positive
          ? 'text-success-600 dark:text-success-400'
          : 'text-error-600 dark:text-error-400'
      }`}
    >
      <Arrow className="w-4 h-4" aria-hidden="true" />
      {formatSignedNumber(value)}
    </span>
  );
};

/** Period name, kind, and the line that says how far along it is. */
const ReportPeriod: React.FC<{ report: ReportSummaryItem }> = ({ report }) => (
  <div className="min-w-0">
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-medium text-foreground">{report.periodLabel}</span>
      <ReportKindChip reportType={report.reportType} />
    </div>
    <div className="text-xs text-muted-foreground mt-0.5">
      <ReportCardSubtitle report={report} />
    </div>
  </div>
);

export const ReportsListPage: React.FC = () => {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [reports, setReports] = useState<ReportSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Rendered one way or the other, never both: five numeric columns do not fit
  // a phone, and two copies of the list would be two copies to a screen reader.
  const isNarrow = useMediaQuery('(max-width: 767px)');

  const nextTokenRef = useRef<string | null>(null);
  nextTokenRef.current = nextToken;

  const generating = reports.filter(isPending).length;
  const atLimit = generating >= MAX_CONCURRENT;

  const loadReports = useCallback(async (reset = false) => {
    try {
      if (reset) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      const params = {
        limit: PAGE_SIZE,
        ...(reset ? {} : { nextToken: nextTokenRef.current || undefined }),
      };

      const response = await reportsService.listReports(params);

      if (response.success && response.data) {
        const { reports: newReports, nextToken: newNextToken } = response.data;
        if (reset) {
          setReports(newReports);
        } else {
          setReports(prev => [...prev, ...newReports]);
        }
        setNextToken(newNextToken || null);
        setHasMore(!!newNextToken);
      } else {
        const errorMsg = response.error || 'Failed to load reports';
        setError(errorMsg);
        addToast({
          title: 'Failed to Load Reports',
          message: errorMsg,
          type: 'error',
          action: {
            label: 'Retry',
            onClick: () => loadReports(true),
          },
        });
      }
    } catch (err) {
      console.error('Error loading reports:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to load reports';
      setError(errorMsg);
      addToast({
        title: 'Failed to Load Reports',
        message: errorMsg,
        type: 'error',
        action: {
          label: 'Retry',
          onClick: () => loadReports(true),
        },
      });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadReports(true);
  }, [loadReports]);

  // Re-read the first page while anything is unfinished, and stop as soon as
  // nothing is. Silent: a background refresh must not raise a toast or blank
  // the list someone is reading.
  const refreshQuietly = useCallback(async () => {
    const response = await reportsService.listReports({ limit: PAGE_SIZE });
    if (response.success && response.data) {
      setReports(response.data.reports);
      setNextToken(response.data.nextToken || null);
      setHasMore(!!response.data.nextToken);
    }
  }, []);

  useEffect(() => {
    if (generating === 0) return undefined;

    const timer = window.setInterval(() => {
      void refreshQuietly();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [generating, refreshQuietly]);

  const handleGenerate = useCallback(
    async (range: { periodStart: string; periodEnd: string }) => {
      const response = await reportsService.createReport(range);

      if (!response.success || !response.data) {
        addToast({
          title: 'Could not start the report',
          message: response.error || 'Please try again.',
          type: 'error',
        });
        // Thrown, not returned. The API client resolves a refusal as
        // `{ success: false }` rather than rejecting, so returning here would
        // look like success to the form, which would close and take the dates
        // someone chose with it.
        throw new Error(response.error || 'Could not start the report');
      }

      addToast({
        title: 'Generating report',
        message: `${response.data.periodLabel} will appear in the list when it is ready.`,
        type: 'success',
      });

      await refreshQuietly();
    },
    [addToast, refreshQuietly]
  );

  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      loadReports(false);
    }
  }, [loadingMore, hasMore, loadReports]);

  const handleRetry = useCallback(() => {
    setError(null);
    loadReports(true);
  }, [loadReports]);

  const openReport = useCallback(
    (report: ReportSummaryItem) => navigate(`/reports/${report.id}`),
    [navigate]
  );

  /**
   * The interactive bits of a row, which only a readable report gets. A report
   * still generating, or one that failed, is a row you read rather than open —
   * so it is not focusable and has nothing to click through to.
   */
  const rowProps = (report: ReportSummaryItem) => {
    const readable = isReadable(report);

    return {
      tabIndex: readable ? 0 : -1,
      onClick: readable ? () => openReport(report) : undefined,
      onKeyDown: readable
        ? (event: React.KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openReport(report);
            }
          }
        : undefined,
      'aria-label': readable
        ? `View report for ${report.periodLabel}`
        : `Report for ${report.periodLabel}, ${report.status}`,
    };
  };

  const loadMore = hasMore ? (
    <div className="mt-4 flex justify-center">
      <Button
        variant="outline"
        onClick={handleLoadMore}
        isLoading={loadingMore}
        disabled={loadingMore}
        aria-label="Load more reports"
      >
        {loadingMore ? 'Loading...' : 'Load More'}
      </Button>
    </div>
  ) : null;

  const renderList = () => {
    if (loading) {
      return (
        <div role="status" aria-live="polite" aria-label="Loading reports">
          <span className="sr-only">Loading reports...</span>
          <LoadingSkeleton lines={5} />
        </div>
      );
    }

    if (error && reports.length === 0) {
      return <SectionError message={error} onRetry={handleRetry} retryLabel="Retry loading reports" />;
    }

    if (reports.length === 0) {
      return (
        <div className="text-center py-10" role="status" aria-live="polite">
          <BarChart3 className="mx-auto h-12 w-12 text-muted-foreground mb-4" aria-hidden="true" />
          <h4 className="text-base font-medium text-foreground mb-2">No reports yet</h4>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Your first monthly report is generated on the 1st. You do not have to wait for
            it — pick a range above and generate one now.
          </p>
        </div>
      );
    }

    if (isNarrow) {
      return (
        <>
          {/* The same rows stacked, since five numeric columns do not fit */}
          <div className="divide-y divide-border" role="list" aria-label="Reports list">
            {reports.map((report) => {
              const readable = isReadable(report);

              return (
                <div
                  key={report.id}
                  role="listitem"
                  className={`py-3 ${
                    readable
                      ? 'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring'
                      : ''
                  }`}
                  {...rowProps(report)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <ReportPeriod report={report} />
                    {readable && (
                      <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" aria-hidden="true" />
                    )}
                  </div>

                  {readable && report.summary ? (
                    <dl className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <dt className="text-xs text-muted-foreground">Open Rate</dt>
                        <dd className="text-sm font-medium text-foreground">
                          {formatPercent(report.summary.avgOpenRate)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Click Rate</dt>
                        <dd className="text-sm font-medium text-foreground">
                          {formatPercent(report.summary.avgClickRate)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Delivered</dt>
                        <dd className="text-sm font-medium text-foreground">
                          {formatNumber(report.summary.totalDelivered)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Net Subscribers</dt>
                        <dd className="text-sm">
                          <NetChange value={report.subscriberGrowth?.netChange ?? 0} />
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <div className="mt-2">
                      <ReportCardState report={report} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {loadMore}
        </>
      );
    }

    return (
      <>
        {/* A row per report, so rates can be compared down a column */}
        <div className="overflow-x-auto">
          <table className="w-full" aria-label="Reports list">
            <thead>
              <tr className="bg-muted">
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                  Period
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                  Open Rate
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                  Click Rate
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                  Delivered
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                  Net Subscribers
                </th>
                <th scope="col" className="px-4 py-3 w-8">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => {
                const readable = isReadable(report);

                return (
                  <tr
                    key={report.id}
                    className={`border-t border-border transition-colors ${
                      readable
                        ? 'hover:bg-muted/50 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring'
                        : ''
                    }`}
                    {...rowProps(report)}
                  >
                    <td className="px-4 py-3 text-sm">
                      <ReportPeriod report={report} />
                    </td>

                    {readable && report.summary ? (
                      <>
                        <td className="px-4 py-3 text-sm text-right text-foreground tabular-nums">
                          {formatPercent(report.summary.avgOpenRate)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-foreground tabular-nums">
                          {formatPercent(report.summary.avgClickRate)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-foreground tabular-nums">
                          {formatNumber(report.summary.totalDelivered)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums">
                          <NetChange value={report.subscriberGrowth?.netChange ?? 0} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ChevronRight className="w-4 h-4 text-muted-foreground inline" aria-hidden="true" />
                        </td>
                      </>
                    ) : (
                      <td className="px-4 py-3 text-sm" colSpan={5}>
                        <ReportCardState report={report} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {loadMore}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Row 1: the control that starts a report, above the list it lands in */}
      <Card padding="md">
        <GenerateReportForm
          onGenerate={handleGenerate}
          disabled={atLimit}
          disabledReason={
            atLimit
              ? `${MAX_CONCURRENT} reports are already being generated. Wait for one to finish.`
              : undefined
          }
        />
      </Card>

      {/* Row 2: every report, newest first */}
      <Card padding="md">
        <h3 className="text-lg font-semibold text-foreground mb-4">Reports</h3>
        {renderList()}
      </Card>
    </div>
  );
};
