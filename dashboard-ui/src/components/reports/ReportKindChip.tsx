import React from 'react';
import type { ReportType } from '@/types/reports';

export interface ReportKindChipProps {
  reportType: ReportType;
}

/**
 * Tells a scheduled report apart from one somebody asked for.
 *
 * Both kinds share one chronological list, so the distinction has to be
 * carried by the row rather than by a heading — a custom report for March
 * sits wherever it was made, not in a section of its own.
 */
export const ReportKindChip: React.FC<ReportKindChipProps> = ({ reportType }) => {
  const custom = reportType === 'adhoc';

  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        custom
          ? 'bg-warning-100 text-warning-800 dark:bg-warning-900/40 dark:text-warning-300'
          : 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300'
      }`}
    >
      {custom ? 'Custom range' : 'Scheduled'}
    </span>
  );
};

export default ReportKindChip;
