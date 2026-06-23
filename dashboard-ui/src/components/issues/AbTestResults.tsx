import React, { useMemo } from 'react';
import { FlaskConical, Trophy, Mail, Clock, CheckCircle2, MinusCircle, Loader2, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { formatDate } from '../../utils/issueDetailUtils';
import { cn } from '../../utils/cn';
import type { AbTest, VariantStats, VariantId, AbTestVariant } from '../../types/issues';

export interface AbTestResultsProps {
  /** The issue's A/B test configuration and results. */
  abTest: AbTest;
  /** Per-variant engagement counters returned alongside the issue. */
  variantStats?: VariantStats[];
}

const VARIANT_LABELS: Record<VariantId, string> = {
  a: 'Variant A (Control)',
  b: 'Variant B (Challenger)',
};

const STATUS_CONFIG: Record<NonNullable<AbTest['status']>, { label: string; className: string }> = {
  pending: {
    label: 'Pending',
    className: 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-500',
  },
  testing: {
    label: 'Testing',
    className: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-800/60 dark:text-blue-100 dark:border-blue-400',
  },
  evaluating: {
    label: 'Evaluating',
    className: 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-800/60 dark:text-yellow-100 dark:border-yellow-400',
  },
  sent: {
    label: 'Sent',
    className: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-800/60 dark:text-green-100 dark:border-green-400',
  },
  inconclusive: {
    label: 'Inconclusive',
    className: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-800/60 dark:text-orange-100 dark:border-orange-400',
  },
};

const formatPercent = (successes: number, deliveries: number): string => {
  if (!deliveries || deliveries <= 0) return '—';
  return `${((successes / deliveries) * 100).toFixed(1)}%`;
};

interface VariantCardProps {
  variantId: VariantId;
  dimension: AbTest['dimension'];
  variant?: AbTestVariant;
  stats?: VariantStats;
  isWinner: boolean;
  winMetric: NonNullable<AbTest['winMetric']>;
}

const VariantCard: React.FC<VariantCardProps> = ({
  variantId,
  dimension,
  variant,
  stats,
  isWinner,
  winMetric,
}) => {
  const deliveries = stats?.deliveries ?? 0;
  const opens = stats?.opens ?? 0;
  const clicks = stats?.clicks ?? 0;

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-colors',
        isWinner
          ? 'border-success-400 bg-success-50 dark:border-success-500 dark:bg-success-900/20'
          : 'border-border bg-muted/40'
      )}
      aria-label={`${VARIANT_LABELS[variantId]} results`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className="text-sm font-semibold text-foreground">{VARIANT_LABELS[variantId]}</span>
        {isWinner && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-success-100 text-success-800 border-success-300 dark:bg-success-800/60 dark:text-success-100 dark:border-success-400"
          >
            <Trophy className="w-3 h-3" aria-hidden="true" />
            Winner
          </span>
        )}
      </div>

      <div className="text-xs sm:text-sm text-muted-foreground mb-4 break-words min-h-[1.25rem]">
        {dimension === 'subject' ? (
          <span title={variant?.subject}>{variant?.subject || 'No subject set'}</span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            {variant?.sendAt ? formatDate(variant.sendAt) : 'No send time set'}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <div className={cn('rounded-md p-2', winMetric === 'openRate' && 'ring-1 ring-primary-300 dark:ring-primary-700')}>
          <dt className="text-xs text-muted-foreground font-medium">Open rate</dt>
          <dd className="text-lg sm:text-xl font-bold text-foreground">{formatPercent(opens, deliveries)}</dd>
          <dd className="text-xs text-muted-foreground">{opens} / {deliveries} delivered</dd>
        </div>
        <div className={cn('rounded-md p-2', winMetric === 'clickRate' && 'ring-1 ring-primary-300 dark:ring-primary-700')}>
          <dt className="text-xs text-muted-foreground font-medium">Click rate</dt>
          <dd className="text-lg sm:text-xl font-bold text-foreground">{formatPercent(clicks, deliveries)}</dd>
          <dd className="text-xs text-muted-foreground">{clicks} / {deliveries} delivered</dd>
        </div>
      </dl>
    </div>
  );
};

VariantCard.displayName = 'VariantCard';

export const AbTestResults: React.FC<AbTestResultsProps> = ({
  abTest,
  variantStats,
}) => {
  const status = abTest.status ?? 'pending';
  const winMetric = abTest.winMetric ?? 'openRate';
  const evaluation = abTest.evaluation ?? null;
  const winnerVariantId = abTest.winnerVariantId ?? null;

  const statsById = useMemo(() => {
    const map = new Map<VariantId, VariantStats>();
    (variantStats ?? []).forEach((s) => map.set(s.variantId, s));
    return map;
  }, [variantStats]);

  const variantById = useMemo(() => {
    const map = new Map<VariantId, AbTestVariant>();
    (abTest.variants ?? []).forEach((v) => map.set(v.variantId, v));
    return map;
  }, [abTest.variants]);

  const isDecided = status === 'sent' || status === 'inconclusive' || status === 'evaluating';

  const dimensionLabel = abTest.dimension === 'subject' ? 'Subject line' : 'Send time';
  const statusConfig = STATUS_CONFIG[status];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5" aria-hidden="true" />
            A/B Test Results
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs sm:text-sm text-muted-foreground font-medium">
              {abTest.dimension === 'subject' ? (
                <Mail className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Clock className="w-4 h-4" aria-hidden="true" />
              )}
              {dimensionLabel}
            </span>
            <span
              className={cn(
                'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
                statusConfig.className
              )}
              role="status"
              aria-label={`A/B test status: ${statusConfig.label}`}
            >
              {statusConfig.label}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div
          className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4"
          role="region"
          aria-label="A/B test variant results"
        >
          <VariantCard
            variantId="a"
            dimension={abTest.dimension}
            variant={variantById.get('a')}
            stats={statsById.get('a')}
            isWinner={winnerVariantId === 'a'}
            winMetric={winMetric}
          />
          <VariantCard
            variantId="b"
            dimension={abTest.dimension}
            variant={variantById.get('b')}
            stats={statsById.get('b')}
            isWinner={winnerVariantId === 'b'}
            winMetric={winMetric}
          />
        </div>

        {/* Significance summary */}
        <div
          className="rounded-lg border border-border bg-muted/40 p-4 mb-4"
          role="status"
          aria-live="polite"
        >
          {!isDecided ? (
            <div className="flex items-start gap-2">
              <Loader2 className="w-4 h-4 mt-0.5 text-blue-600 dark:text-blue-400 animate-spin" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">Test in progress — awaiting results</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The winner will be determined once enough engagement data is collected.
                </p>
              </div>
            </div>
          ) : status === 'inconclusive' ? (
            <div className="flex items-start gap-2">
              <MinusCircle className="w-4 h-4 mt-0.5 text-orange-600 dark:text-orange-400" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">Inconclusive — control was sent</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  No statistically significant difference was found, so the control variant (A) was sent to the remaining audience.
                </p>
              </div>
            </div>
          ) : evaluation?.significant ? (
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 text-success-600 dark:text-success-400" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Significant at {Math.round((evaluation.confidence ?? 0) * 100)}% confidence
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {winnerVariantId ? `${VARIANT_LABELS[winnerVariantId]} won` : 'A winner was determined'}
                  {' '}on {winMetric === 'openRate' ? 'open rate' : 'click rate'}.
                  <span className="ml-1 opacity-75">
                    (p = {evaluation.pValue.toFixed(3)}, z = {evaluation.zScore.toFixed(2)})
                  </span>
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <MinusCircle className="w-4 h-4 mt-0.5 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">Not yet significant</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The difference between variants has not reached the configured confidence threshold.
                  {evaluation && (
                    <span className="ml-1 opacity-75">
                      (p = {evaluation.pValue.toFixed(3)}, z = {evaluation.zScore.toFixed(2)})
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Win metric caveat for open-rate tests */}
        {winMetric === 'openRate' && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-900/20 p-3 mb-4">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 dark:text-amber-400 flex-shrink-0" aria-hidden="true" />
            <p className="text-xs text-amber-800 dark:text-amber-200">
              This test is decided on open rate. Apple Mail Privacy Protection can inflate open rates, so
              click rate may be a more reliable signal.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

AbTestResults.displayName = 'AbTestResults';

export default AbTestResults;
