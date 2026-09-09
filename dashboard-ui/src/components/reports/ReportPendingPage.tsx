import React, { useEffect } from 'react';
import { ArrowLeft, RefreshCw, Loader2, AlertCircle, CalendarOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { ReportKindChip } from './ReportKindChip';
import type { MonthlyReport } from '@/types/reports';

export interface ReportPendingPageProps {
  report: MonthlyReport;
  onBack: () => void;
  onRefresh: () => void;
}

/** Matches the list page, so a report followed from either place keeps up. */
const POLL_INTERVAL_MS = 5000;

/**
 * The detail page for a report with no figures in it.
 *
 * Three endings share this page and none of them is a broken report: it is
 * still running, it failed, or it finished and nothing went out in the range
 * asked about. Saying which is the whole job here — an empty month and a
 * failed run look identical if you only report the absence of numbers.
 */
export const ReportPendingPage: React.FC<ReportPendingPageProps> = ({
  report,
  onBack,
  onRefresh
}) => {
  const pending = report.status === 'pending';

  // Opening the page while it runs should not mean sitting on a stale view.
  useEffect(() => {
    if (!pending) return undefined;

    const timer = window.setInterval(onRefresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [pending, onRefresh]);

  const { icon, heading, detail } = describe(report);

  return (
    <div className="min-h-screen bg-background">
      <main id="main-content" className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Button onClick={onBack} variant="ghost" size="sm" aria-label="Back to reports list">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Reports
          </Button>
        </div>

        <div className="mb-8 flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {report.periodLabel}
          </h1>
          <ReportKindChip reportType={report.reportType} />
        </div>

        <Card>
          <CardContent className="py-14">
            <div className="text-center" role="status" aria-live="polite">
              {icon}
              <h2 className="text-lg font-medium text-foreground mb-2">{heading}</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">{detail}</p>

              {!pending && (
                <div className="mt-6">
                  <Button onClick={onRefresh} variant="outline">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Check again
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

function describe(report: MonthlyReport) {
  if (report.status === 'pending') {
    return {
      icon: (
        <Loader2
          className="mx-auto h-10 w-10 text-muted-foreground mb-4 animate-spin"
          aria-hidden="true"
        />
      ),
      heading: 'Generating this report',
      detail: 'It usually takes under a minute. This page updates on its own.'
    };
  }

  if (report.status === 'failed') {
    return {
      icon: (
        <AlertCircle
          className="mx-auto h-10 w-10 text-error-600 dark:text-error-400 mb-4"
          aria-hidden="true"
        />
      ),
      heading: 'This report could not be generated',
      detail:
        report.failureReason
        ?? 'Something went wrong while building it. Generating it again is safe.'
    };
  }

  return {
    icon: <CalendarOff className="mx-auto h-10 w-10 text-muted-foreground mb-4" aria-hidden="true" />,
    heading: 'No issues in this range',
    detail:
      'Nothing went out between these dates, so there is nothing to measure. '
      + 'Try a range that includes a send.'
  };
}

export default ReportPendingPage;
