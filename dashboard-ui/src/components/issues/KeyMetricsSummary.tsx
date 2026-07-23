import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import { InfoTooltip } from '../ui/InfoTooltip';
import { cn } from '../../utils/cn';
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

/**
 * Decorative trend line for a single metric across recent issues. The values
 * are already surfaced as text elsewhere in the tile, so this is aria-hidden.
 */
const Sparkline: React.FC<{ values: number[] }> = React.memo(({ values }) => {
  const geometry = useMemo(() => {
    if (values.length < 2) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const top = 3;
    const bottom = 25;

    const points = values.map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = range === 0 ? (top + bottom) / 2 : bottom - ((value - min) / range) * (bottom - top);
      return { x, y };
    });

    const line = points.map(p => `${p.x},${p.y}`).join(' ');
    const area = `M0,28 L${points.map(p => `${p.x},${p.y}`).join(' L')} L100,28 Z`;
    const last = points[points.length - 1];

    return { line, area, last };
  }, [values]);

  if (!geometry) return null;

  return (
    <div className="relative h-8 mt-2" aria-hidden="true">
      <svg
        className="absolute inset-0 w-full h-full text-primary-500"
        viewBox="0 0 100 28"
        preserveAspectRatio="none"
      >
        <path d={geometry.area} fill="currentColor" opacity={0.12} />
        <polyline
          points={geometry.line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="absolute w-1.5 h-1.5 rounded-full bg-primary-600 -translate-x-1/2 -translate-y-1/2"
        style={{
          left: `${geometry.last.x}%`,
          top: `${(geometry.last.y / 28) * 100}%`,
        }}
      />
    </div>
  );
});

Sparkline.displayName = 'Sparkline';

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
}) => {
  const TrendIcon = comparison?.direction === 'up' ? TrendingUp : TrendingDown;

  return (
    <div className="flex flex-col bg-surface rounded-xl p-3 sm:p-4 border border-border shadow-soft hover:shadow-md hover:border-primary-200 hover:-translate-y-0.5 transition-all min-h-[110px]">
      <div className="flex items-start justify-between gap-1 mb-2">
        <div className="text-[11px] sm:text-xs uppercase tracking-wide text-muted-foreground font-semibold">
          {label}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {status && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                status.level === 'critical'
                  ? 'bg-error-100 text-error-700'
                  : 'bg-warning-100 text-warning-700'
              )}
              role="status"
            >
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              {status.label}
            </span>
          )}
          <InfoTooltip label={tooltipLabel} description={tooltipDescription} />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-0.5">
        <div className="text-xl sm:text-2xl lg:text-3xl font-bold font-display text-foreground tabular-nums leading-none">
          {value}
        </div>
        {comparison && comparison.direction !== 'neutral' && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
              comparison.isPositive
                ? 'bg-success-100 text-success-700'
                : 'bg-error-100 text-error-700'
            )}
          >
            <TrendIcon className="w-3 h-3" aria-hidden="true" />
            {comparison.difference > 0 ? '+' : ''}
            {formatPercentageValue(comparison.difference, 1)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
        {percentage && <span className="whitespace-nowrap">{percentage}</span>}
        {comparison && comparison.direction !== 'neutral' && comparisonLabel && (
          <span className="whitespace-nowrap">{comparisonLabel}</span>
        )}
        {comparison && comparison.direction === 'neutral' && comparisonLabel && (
          <span className="inline-flex items-center gap-1">
            <Minus className="w-3 h-3" aria-hidden="true" />
            No change {comparisonLabel}
          </span>
        )}
      </div>

      {sparkline && sparkline.length >= 2 && (
        <div className="mt-auto">
          <Sparkline values={sparkline} />
        </div>
      )}
    </div>
  );
});

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
            <div
              className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5"
              role="group"
              aria-label="Comparison baseline"
            >
              {availableModes.map(option => (
                <button
                  key={option.mode}
                  type="button"
                  onClick={() => onHighlightModeChange?.(option.mode)}
                  aria-pressed={highlightMode === option.mode}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded-md transition-colors min-h-[28px]',
                    highlightMode === option.mode
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
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
          tooltipLabel="Unsubscribe Rate"
          tooltipDescription="Percentage of delivered recipients who opted out after this issue. Keep this below 0.5% — a healthy list typically sees 0.1-0.3%."
        />
      </div>
    </section>
  );
});

KeyMetricsSummary.displayName = 'KeyMetricsSummary';
