import React from 'react';
import { Loader2, AlertCircle, CalendarOff } from 'lucide-react';
import type { ReportSummaryItem } from '@/types/reports';

export interface ReportCardStateProps {
  report: ReportSummaryItem;
}

/**
 * What a report row shows when it has no figures to show.
 *
 * Three ways that happens, and they are not the same thing: it has not
 * finished, it failed, or it finished and the range genuinely contained no
 * issues. The last is a real answer, so it reads as one rather than as
 * something having gone wrong.
 */
export const ReportCardState: React.FC<ReportCardStateProps> = ({ report }) => {
  if (report.status === 'pending') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        Generating. This usually takes under a minute.
      </div>
    );
  }

  if (report.status === 'failed') {
    return (
      <div className="flex items-start gap-2 text-sm text-error-600 dark:text-error-400">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Could not be generated.
          {report.failureReason ? (
            <span className="text-muted-foreground"> {report.failureReason}</span>
          ) : null}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <CalendarOff className="w-4 h-4" aria-hidden="true" />
      No issues went out in this range.
    </div>
  );
};

/** The line under a report's title, which depends on how far along it is. */
export const ReportCardSubtitle: React.FC<ReportCardStateProps> = ({ report }) => {
  if (report.status === 'pending') {
    return <>Requested {new Date(report.createdAt).toLocaleString('en-US')}</>;
  }

  const issues = report.summary?.issuesSent;
  if (issues == null) {
    return <>{report.reportType === 'adhoc' ? 'Custom range' : 'Scheduled report'}</>;
  }

  return <>{issues} {issues === 1 ? 'issue' : 'issues'} sent</>;
};

export default ReportCardState;
