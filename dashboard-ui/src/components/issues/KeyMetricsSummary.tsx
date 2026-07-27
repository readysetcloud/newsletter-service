import React, { useMemo } from 'react';
import { StatTile, SegmentedControl } from '@readysetcloud/ui';
import { InfoTooltip } from '../ui/InfoTooltip';
import { calculateComparison, formatPercentageValue, formatNumber } from '../../utils/issueDetailUtils';
import type { IssueMetrics } from '../../types/issues';

export type ComparisonMode = 'average' | 'last' | 'best';

export type MetricSparklines = Partial<Record<
  'openRate' | 'clickRate' | 'clickToOpenRate' | 'bounceRate' | 'complaintRate' | 'unsubscribeRate',
  number[]
>>;

export interface KeyMetricsSummaryProps {
  metrics: {
    deliveries: number;
    openRate: number;
    clickRate: number;
    clickToOpenRate: number;
    bounceRate: number;
    complaintRate: number;
    unsubscribeRate: number;
  };
  comparisons?: {
    average?: IssueMetrics;
    lastIssue?: IssueMetrics;
    bestIssue?: IssueMetrics;
  };
  highlightMode?: ComparisonMode;
  /**
   * Per-metric history across recent issues (oldest first, current issue
   * last). When present each tile renders a trend sparkline.
   */
  sparklines?: MetricSparklines;
  /**
   * When provided, a segmented control lets the user switch the comparison
   * baseline (average / last issue / best issue).
   */
  onHighlightModeChange?: (mode: ComparisonMode) => void;
}

interface MetricStatus {
  level: 'warning' | 'critical';
  label: string;
}

interface MetricCardProps {
  label: string;
  value: string;
  percentage?: string;
  comparison?: {
    difference: number;
    direction: 'up' | 'down' | 'neutral';
    isPositive: boolean;
  };
  tooltipLabel: string;
  tooltipDescription: string;
  comparisonLabel?: string;
  sparkline?: number[];
  status?: MetricStatus;
  /** Set when a falling metric is good (bounce rate, complaints, unsubscribes). */
  invertDelta?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = React.memo(({
  label,
  value,
  percentage,
  comparison,
  tooltipLabel,
  tooltipDescription,
  comparisonLabel,
  sparkline,
  status,
  invertDelta,
}) => (
  <StatTile
    label={
      <span className="inline-flex items-center gap-1.5">
        {label}
        <InfoTooltip label={tooltipLabel} description={tooltipDescription} />
      </span>
    }
    value={value}
    delta={comparison && comparison.direction !== 'neutral' ? comparison.difference : undefined}
    invertDelta={invertDelta}
    status={status ? { tone: status.level === 'critical' ? 'error' : 'warning', label: status.label } : undefined}
    meta={
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        {percentage && <span className="whitespace-nowrap">{percentage}</span>}
        {comparison && comparison.direction !== 'neutral' && comparisonLabel && (
          <span className="whitespace-nowrap">{comparisonLabel}</span>
        )}
        {comparison && comparison.direction === 'neutral' && comparisonLabel && (
          <span className="whitespace-nowrap">No change {comparisonLabel}</span>
        )}
      </span>
    }
    sparkline={sparkline && sparkline.length >= 2 ? sparkline : undefined}
  />
));

MetricCard.displayName = 'MetricCard';

const MODE_OPTIONS: Array<{ mode: ComparisonMode; label: string; comparisonKey: 'average' | 'lastIssue' | 'bestIssue' }> = [
  { mode: 'average', label: 'Average', comparisonKey: 'average' },
  { mode: 'last', label: 'Last issue', comparisonKey: 'lastIssue' },
  { mode: 'best', label: 'Best issue', comparisonKey: 'bestIssue' },
];

function getBounceStatus(rate: number): MetricStatus | undefined {
  if (rate > 10) return { level: 'critical', label: 'Critical' };
  if (rate > 5) return { level: 'warning', label: 'High' };
  return undefined;
}

function getComplaintStatus(rate: number): MetricStatus | undefined {
  if (rate > 0.1) return { level: 'critical', label: 'Critical' };
  if (rate > 0.05) return { level: 'warning', label: 'High' };
  return undefined;
}

function getUnsubscribeStatus(rate: number): MetricStatus | undefined {
  if (rate > 1) return { level: 'critical', label: 'Critical' };
  if (rate > 0.5) return { level: 'warning', label: 'High' };
  return undefined;
}

export const KeyMetricsSummary: React.FC<KeyMetricsSummaryProps> = React.memo(({
  metrics,
  comparisons,
  highlightMode = 'average',
  sparklines,
  onHighlightModeChange,
}) => {
  const activeComparison = useMemo(() => {
    if (!comparisons) return undefined;

    return highlightMode === 'last'
      ? comparisons.lastIssue
      : highlightMode === 'best'
        ? comparisons.bestIssue
        : comparisons.average;
  }, [comparisons, highlightMode]);

  const comparisonLabel = useMemo(() => {
    if (!activeComparison) return undefined;

    return highlightMode === 'last'
      ? 'vs. last'
      : highlightMode === 'best'
        ? 'vs. best'
        : 'vs. avg';
  }, [activeComparison, highlightMode]);

  const availableModes = useMemo(
    () => MODE_OPTIONS.filter(option => comparisons?.[option.comparisonKey]),
    [comparisons]
  );

  const showModeToggle = !!onHighlightModeChange && availableModes.length > 1;

  const openRateComparison = useMemo(() =>
    activeComparison
      ? calculateComparison(metrics.openRate, activeComparison.openRate, 'positive')
      : undefined,
    [activeComparison, metrics.openRate]
  );

  const clickRateComparison = useMemo(() =>
    activeComparison
      ? calculateComparison(metrics.clickRate, activeComparison.clickRate, 'positive')
      : undefined,
    [activeComparison, metrics.clickRate]
  );

  const clickToOpenRateComparison = useMemo(() =>
    activeComparison
      ? calculateComparison(metrics.clickToOpenRate, activeComparison.clickToOpenRate, 'positive')
      : undefined,
    [activeComparison, metrics.clickToOpenRate]
  );

  const unsubscribeRateComparison = useMemo(() => {
    if (!activeComparison || activeComparison.unsubscribes === undefined || !activeComparison.delivered) {
      return undefined;
    }
    const comparisonRate = (activeComparison.unsubscribes / activeComparison.delivered) * 100;
    return calculateComparison(metrics.unsubscribeRate, comparisonRate, 'negative');
  }, [activeComparison, metrics.unsubscribeRate]);

  const bounceRateComparison = useMemo(() =>
    activeComparison
      ? calculateComparison(metrics.bounceRate, activeComparison.bounceRate, 'negative')
      : undefined,
    [activeComparison, metrics.bounceRate]
  );

  const complaintRateComparison = useMemo(() =>
    activeComparison
      ? calculateComparison(
          metrics.complaintRate,
          (activeComparison.complaints / activeComparison.delivered) * 100,
          'negative'
        )
      : undefined,
    [activeComparison, metrics.complaintRate]
  );

  return (
    <section aria-label="Key metrics">
      {showModeToggle && (
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Key Metrics
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden sm:inline">Compare to</span>
            <SegmentedControl
              options={availableModes.map(option => ({ value: option.mode, label: option.label }))}
              value={highlightMode}
              onChange={mode => onHighlightModeChange?.(mode)}
              aria-label="Comparison baseline"
            />
          </div>
        </div>
      )}

      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4"
        role="region"
        aria-label="Key performance metrics"
      >
        <MetricCard
          label="Open Rate"
          value={formatPercentageValue(metrics.openRate, 1)}
          percentage={`${formatNumber(Math.round((metrics.openRate / 100) * metrics.deliveries))} opens`}
          comparison={openRateComparison}
          comparisonLabel={comparisonLabel}
          sparkline={sparklines?.openRate}
          tooltipLabel="Open Rate"
          tooltipDescription="Percentage of delivered emails that were opened by recipients. Industry average is typically 15-25%."
        />

        <MetricCard
          label="Click Rate"
          value={formatPercentageValue(metrics.clickRate, 1)}
          percentage={`${formatNumber(Math.round((metrics.clickRate / 100) * metrics.deliveries))} clicks`}
          comparison={clickRateComparison}
          comparisonLabel={comparisonLabel}
          sparkline={sparklines?.clickRate}
          tooltipLabel="Click Rate"
          tooltipDescription="Percentage of delivered emails where recipients clicked at least one link. Industry average is typically 2-5%."
        />

        <MetricCard
          label="Click-to-Open Rate"
          value={formatPercentageValue(metrics.clickToOpenRate, 1)}
          percentage="of opens"
          comparison={clickToOpenRateComparison}
          comparisonLabel={comparisonLabel}
          sparkline={sparklines?.clickToOpenRate}
          tooltipLabel="Click-to-Open Rate (CTOR)"
          tooltipDescription="Percentage of recipients who opened the email and then clicked a link. It isolates content and copy effectiveness from subject-line performance. Industry average is typically 10-15%."
        />

        <MetricCard
          label="Bounce Rate"
          value={formatPercentageValue(metrics.bounceRate, 1)}
          percentage={`${formatNumber(Math.round((metrics.bounceRate / 100) * metrics.deliveries))} bounces`}
          comparison={bounceRateComparison}
          comparisonLabel={comparisonLabel}
          sparkline={sparklines?.bounceRate}
          status={getBounceStatus(metrics.bounceRate)}
          invertDelta
          tooltipLabel="Bounce Rate"
          tooltipDescription="Percentage of emails that could not be delivered. Keep this below 5% to maintain good sender reputation."
        />

        <MetricCard
          label="Complaint Rate"
          value={formatPercentageValue(metrics.complaintRate, 2)}
          percentage={`${formatNumber(Math.round((metrics.complaintRate / 100) * metrics.deliveries))} complaints`}
          comparison={complaintRateComparison}
          comparisonLabel={comparisonLabel}
          sparkline={sparklines?.complaintRate}
          status={getComplaintStatus(metrics.complaintRate)}
          invertDelta
          tooltipLabel="Complaint Rate"
          tooltipDescription="Percentage of recipients who marked your email as spam. Keep this below 0.1% to avoid deliverability issues."
        />

        <MetricCard
          label="Unsubscribe Rate"
          value={formatPercentageValue(metrics.unsubscribeRate, 2)}
          percentage={`${formatNumber(Math.round((metrics.unsubscribeRate / 100) * metrics.deliveries))} unsubscribes`}
          comparison={unsubscribeRateComparison}
          comparisonLabel={comparisonLabel}
          sparkline={sparklines?.unsubscribeRate}
          status={getUnsubscribeStatus(metrics.unsubscribeRate)}
          invertDelta
          tooltipLabel="Unsubscribe Rate"
          tooltipDescription="Percentage of delivered recipients who opted out after this issue. Keep this below 0.5% — a healthy list typically sees 0.1-0.3%."
        />
      </div>
    </section>
  );
});

KeyMetricsSummary.displayName = 'KeyMetricsSummary';
