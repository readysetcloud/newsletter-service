import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { InfoTooltip } from '../ui/InfoTooltip';
import { calculateComparison, formatPercentageValue, formatNumber } from '../../utils/issueDetailUtils';
import type { IssueMetrics } from '../../types/issues';

export interface KeyMetricsSummaryProps {
  metrics: {
    deliveries: number;
    openRate: number;
    clickRate: number;
    bounceRate: number;
    complaintRate: number;
  };
  comparisons?: {
    average?: IssueMetrics;
    lastIssue?: IssueMetrics;
    bestIssue?: IssueMetrics;
  };
  highlightMode?: 'average' | 'last' | 'best';
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
  colorClass: string;
  comparisonLabel?: string;
}

const MetricCard: React.FC<MetricCardProps> = React.memo(({
  label,
  value,
  percentage,
  comparison,
  tooltipLabel,
  tooltipDescription,
  colorClass,
  comparisonLabel,
}) => {
  return (
    <div className="bg-muted/50 hover:bg-muted hover:shadow-md hover:border-primary-200 dark:hover:border-primary-800 transition-all rounded-lg p-3 sm:p-4 border border-border min-h-[100px] sm:min-h-[120px]">
      <div className="flex items-start justify-between mb-2">
        <div className="text-xs sm:text-sm text-muted-foreground font-medium">{label}</div>
        <InfoTooltip label={tooltipLabel} description={tooltipDescription} />
      </div>

      <div className="flex items-baseline gap-1 sm:gap-2 mb-1">
        <div className="text-xl sm:text-2xl lg:text-3xl font-bold text-foreground">{value}</div>
        {percentage && (
          <div className={`text-xs sm:text-sm font-semibold ${colorClass}`}>{percentage}</div>
        )}
      </div>

      {comparison && comparison.direction !== 'neutral' && (
        <div className="flex items-center gap-1 text-xs mt-2">
          {comparison.direction === 'up' ? (
            <TrendingUp
              className={`w-3 h-3 ${comparison.isPositive ? 'text-success-600' : 'text-error-600'}`}
              aria-hidden="true"
            />
          ) : (
            <TrendingDown
              className={`w-3 h-3 ${comparison.isPositive ? 'text-success-600' : 'text-error-600'}`}
              aria-hidden="true"
            />
          )}
          <span
            className={`font-medium ${comparison.isPositive ? 'text-success-600 dark:text-success-400' : 'text-error-600 dark:text-error-400'}`}
          >
            {comparison.difference > 0 ? '+' : ''}
            {formatPercentageValue(comparison.difference, 1)}
          </span>
          {comparisonLabel && (
            <span className="text-muted-foreground">{comparisonLabel}</span>
          )}
        </div>
      )}

      {comparison && comparison.direction === 'neutral' && comparisonLabel && (
        <div className="flex items-center gap-1 text-xs mt-2">
          <Minus className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground font-medium">No change {comparisonLabel}</span>
        </div>
      )}
    </div>
  );
});

MetricCard.displayName = 'MetricCard';

export const KeyMetricsSummary: React.FC<KeyMetricsSummaryProps> = React.memo(({
  metrics,
  comparisons,
  highlightMode = 'average',
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
    <div
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4"
      role="region"
      aria-label="Key performance metrics"
    >
      <MetricCard
        label="Deliveries"
        value={formatNumber(metrics.deliveries)}
        tooltipLabel="Deliveries"
        tooltipDescription="Total number of emails successfully delivered to recipients."
        colorClass="text-foreground"
      />

      <MetricCard
        label="Open Rate"
        value={formatPercentageValue(metrics.openRate, 1)}
        percentage={`${formatNumber(Math.round((metrics.openRate / 100) * metrics.deliveries))} opens`}
        comparison={openRateComparison}
        comparisonLabel={comparisonLabel}
        tooltipLabel="Open Rate"
        tooltipDescription="Percentage of delivered emails that were opened by recipients. Industry average is typically 15-25%."
        colorClass="text-success-600 dark:text-success-400"
      />

      <MetricCard
        label="Click Rate"
        value={formatPercentageValue(metrics.clickRate, 1)}
        percentage={`${formatNumber(Math.round((metrics.clickRate / 100) * metrics.deliveries))} clicks`}
        comparison={clickRateComparison}
        comparisonLabel={comparisonLabel}
        tooltipLabel="Click Rate"
        tooltipDescription="Percentage of delivered emails where recipients clicked at least one link. Industry average is typically 2-5%."
        colorClass="text-primary-600 dark:text-primary-400"
      />

      <MetricCard
        label="Bounce Rate"
        value={formatPercentageValue(metrics.bounceRate, 1)}
        percentage={`${formatNumber(Math.round((metrics.bounceRate / 100) * metrics.deliveries))} bounces`}
        comparison={bounceRateComparison}
        comparisonLabel={comparisonLabel}
        tooltipLabel="Bounce Rate"
        tooltipDescription="Percentage of emails that could not be delivered. Keep this below 5% to maintain good sender reputation."
        colorClass="text-warning-600 dark:text-warning-400"
      />

      <MetricCard
        label="Complaint Rate"
        value={formatPercentageValue(metrics.complaintRate, 2)}
        percentage={`${formatNumber(Math.round((metrics.complaintRate / 100) * metrics.deliveries))} complaints`}
        comparison={complaintRateComparison}
        comparisonLabel={comparisonLabel}
        tooltipLabel="Complaint Rate"
        tooltipDescription="Percentage of recipients who marked your email as spam. Keep this below 0.1% to avoid deliverability issues."
        colorClass={
          metrics.complaintRate > 0.1
            ? 'text-error-600 dark:text-error-400'
            : 'text-error-600 dark:text-error-400'
        }
      />
    </div>
  );
});

KeyMetricsSummary.displayName = 'KeyMetricsSummary';
