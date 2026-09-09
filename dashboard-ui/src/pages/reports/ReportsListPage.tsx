import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, BarChart3, ArrowUpRight, ArrowDownRight, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { Card, CardContent } from '@/components/ui/Card';
import { GenerateReportForm } from '@/components/reports/GenerateReportForm';
import { ReportKindChip } from '@/components/reports/ReportKindChip';
import { ReportCardState, ReportCardSubtitle } from '@/components/reports/ReportCardState';
import { reportsService } from '@/services/reportsService';
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

const isPending = (report: ReportSummaryItem) => report.status === 'pending';

export const ReportsListPage: React.FC = () => {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [reports, setReports] = useState<ReportSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const nextTokenRef = useRef<string | null>(null);
  nextTokenRef.current = nextToken;

  const generating = reports.filter(isPending).length;

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

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div role="status" aria-live="polite" aria-label="Loading reports">
            <span className="sr-only">Loading reports...</span>
            <div className="mb-8">
              <div className="h-8 w-48 bg-muted rounded animate-pulse mb-2" />
              <div className="h-4 w-64 bg-muted rounded animate-pulse" />
            </div>
            <div className="grid gap-4">
              {[1, 2, 3, 4].map(i => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="h-6 w-32 bg-muted rounded animate-pulse" />
                      <div className="h-4 w-24 bg-muted rounded animate-pulse" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {[1, 2, 3, 4].map(j => (
                        <div key={j} className="space-y-2">
                          <div className="h-3 w-16 bg-muted rounded animate-pulse" />
                          <div className="h-5 w-12 bg-muted rounded animate-pulse" />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error && reports.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div role="alert" aria-live="assertive" className="text-center py-12">
            <h3 className="text-lg font-medium text-foreground mb-2">Failed to load reports</h3>
            <p className="text-sm text-muted-foreground mb-6">{error}</p>
            <Button onClick={handleRetry} aria-label="Retry loading reports">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Reports</h1>
              <p className="text-sm sm:text-base text-muted-foreground mt-1">
                Monthly reports, and any range you ask about
              </p>
            </div>
            <GenerateReportForm
              onGenerate={handleGenerate}
              disabled={generating >= 3}
              disabledReason={
                generating >= 3
                  ? 'Three reports are already being generated. Wait for one to finish.'
                  : undefined
              }
            />
          </div>
        </div>

        {reports.length === 0 ? (
          <div role="status" aria-live="polite">
            <Card>
              <CardContent className="py-16">
                <div className="text-center">
                  <BarChart3 className="mx-auto h-12 w-12 text-muted-foreground mb-4" aria-hidden="true" />
                  <h3 className="text-lg font-medium text-foreground mb-2">No reports yet</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Your first monthly report is generated on the 1st. You do not have to wait
                    for it — pick a range and generate one now.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            <div className="grid gap-4" role="list" aria-label="Monthly reports">
              {reports.map((report) => {
                const readable = report.status === 'complete' && !!report.summary;
                const netChange = report.subscriberGrowth?.netChange ?? 0;
                const isPositive = netChange >= 0;
                const open = () => navigate(`/reports/${report.id}`);

                return (
                  <Card
                    key={report.id}
                    interactive={readable}
                    role="listitem"
                    onClick={readable ? open : undefined}
                    onKeyDown={(e) => {
                      if (readable && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        open();
                      }
                    }}
                    tabIndex={readable ? 0 : -1}
                    aria-label={
                      readable
                        ? `View report for ${report.periodLabel}`
                        : `Report for ${report.periodLabel}, ${report.status}`
                    }
                    className="focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                  >
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between gap-3 mb-5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-lg font-semibold text-foreground">{report.periodLabel}</h2>
                            <ReportKindChip reportType={report.reportType} />
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            <ReportCardSubtitle report={report} />
                          </p>
                        </div>
                        {readable && (
                          <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" aria-hidden="true" />
                        )}
                      </div>

                      {!readable && <ReportCardState report={report} />}

                      {readable && report.summary && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Avg Open Rate
                          </div>
                          <div className="mt-1 text-xl font-semibold text-foreground">
                            {formatPercent(report.summary.avgOpenRate)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Avg Click Rate
                          </div>
                          <div className="mt-1 text-xl font-semibold text-foreground">
                            {formatPercent(report.summary.avgClickRate)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Delivered
                          </div>
                          <div className="mt-1 text-xl font-semibold text-foreground">
                            {formatNumber(report.summary.totalDelivered)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Net Subscribers
                          </div>
                          <div
                            className={`mt-1 flex items-center gap-1 text-xl font-semibold ${
                              isPositive
                                ? 'text-success-600 dark:text-success-400'
                                : 'text-error-600 dark:text-error-400'
                            }`}
                          >
                            {isPositive ? (
                              <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                            ) : (
                              <ArrowDownRight className="w-4 h-4" aria-hidden="true" />
                            )}
                            {formatSignedNumber(netChange)}
                          </div>
                        </div>
                      </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {hasMore && (
              <div className="mt-6 flex justify-center">
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
            )}
          </>
        )}
      </main>
    </div>
  );
};
