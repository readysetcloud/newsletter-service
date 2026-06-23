import React, { useMemo } from 'react';
import {
  FlaskConical,
  Trophy,
  Mail,
  Clock,
  Loader2,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  MinusCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { formatDate } from '../../utils/issueDetailUtils';
import { cn } from '../../utils/cn';
import type {
  AbHistoryResponse,
  AbHistoryTest,
  AbHistoryVariant,
  VariantId,
  AbTestDimension,
} from '../../types/issues';

export interface AbTestHistoryProps {
  /** The A/B test history payload (tests + aggregates). */
  data?: AbHistoryResponse | null;
  /** Whether the history is currently loading. */
  loading?: boolean;
  /** An error message to surface instead of the panel body. */
  error?: string | null;
  /** Optional retry handler shown alongside the error state. */
  onRetry?: () => void;
}

const VARIANT_LABELS: Record<VariantId, string> = {
  a: 'A (Control)',
  b: 'B (Challenger)',
};

const formatRate = (value: number): string => `${value.toFixed(1)}%`;

const formatLift = (lift?: number): string => {
  if (lift === undefined || lift === null) return '—';
  const sign = lift > 0 ? '+' : '';
  return `${sign}${lift.toFixed(1)} pts`;
};

const dimensionLabel = (dimension: AbTestDimension): string =>
  dimension === 'subject' ? 'Subject line' : 'Send time';

interface AggregateStatProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
}

const AggregateStat: React.FC<AggregateStatProps> = ({ label, value, hint }) => (
  <div className="rounded-lg border border-border bg-muted/40 p-3">
    <dt className="text-xs text-muted-foreground font-medium">{label}</dt>
    <dd className="text-xl font-bold text-foreground mt-0.5">{value}</dd>
    {hint && <dd className="text-xs text-muted-foreground mt-0.5">{hint}</dd>}
  </div>
);

interface VariantRateProps {
  variant: AbHistoryVariant;
  dimension: AbTestDimension;
  isWinner: boolean;
}

const VariantRate: React.FC<VariantRateProps> = ({ variant, dimension, isWinner }) => (
  <div
    className={cn(
      'rounded-md border p-2 text-xs',
      isWinner
        ? 'border-success-400 bg-success-50 dark:border-success-500 dark:bg-success-900/20'
        : 'border-border bg-muted/40'
    )}
  >
    <div className="flex items-center justify-between gap-1 mb-1">
      <span className="font-semibold text-foreground">{VARIANT_LABELS[variant.variantId]}</span>
      {isWinner && (
        <Trophy className="w-3 h-3 text-success-600 dark:text-success-400" aria-label="Winner" />
      )}
    </div>
    <p className="text-muted-foreground break-words mb-1 min-h-[1rem]">
      {dimension === 'subject'
        ? variant.subject || 'No subject'
        : variant.sendAt
          ? formatDate(variant.sendAt)
          : 'No send time'}
    </p>
    <div className="flex items-center gap-3 text-foreground">
      <span>Open {formatRate(variant.openRate)}</span>
      <span>Click {formatRate(variant.clickRate)}</span>
    </div>
  </div>
);

interface TestRowProps {
  test: AbHistoryTest;
}

const TestRow: React.FC<TestRowProps> = ({ test }) => {
  const winnerId = test.winnerVariantId ?? null;
  return (
    <li className="rounded-lg border border-border p-4" aria-label={`Issue #${test.issueNumber} A/B test`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground">Issue #{test.issueNumber}</span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-medium">
            {test.dimension === 'subject' ? (
              <Mail className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {dimensionLabel(test.dimension)}
          </span>
          {test.decidedAt && (
            <span className="text-xs text-muted-foreground">{formatDate(test.decidedAt, false)}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {test.significant ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-success-100 text-success-800 border-success-300 dark:bg-success-800/60 dark:text-success-100 dark:border-success-400">
              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
              Significant
              {test.confidence !== undefined && ` (${Math.round(test.confidence * 100)}%)`}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-500">
              <MinusCircle className="w-3 h-3" aria-hidden="true" />
              Not significant
            </span>
          )}
          {winnerId && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-success-100 text-success-800 border-success-300 dark:bg-success-800/60 dark:text-success-100 dark:border-success-400">
              <Trophy className="w-3 h-3" aria-hidden="true" />
              Winner {VARIANT_LABELS[winnerId]}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mb-3 text-xs text-muted-foreground">
        <span>
          Decided on {test.winMetric === 'openRate' ? 'open rate' : 'click rate'}
          {test.winMetric === 'openRate' && (
            <span
              className="inline-flex items-center gap-1 ml-1 text-amber-700 dark:text-amber-300"
              title="Apple Mail Privacy Protection can inflate open rates."
            >
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              MPP caveat
            </span>
          )}
        </span>
        <span className="font-medium text-foreground">Lift {formatLift(test.lift)}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {test.variants.map((variant) => (
          <VariantRate
            key={variant.variantId}
            variant={variant}
            dimension={test.dimension}
            isWinner={winnerId === variant.variantId}
          />
        ))}
      </div>
    </li>
  );
};

export const AbTestHistory: React.FC<AbTestHistoryProps> = ({
  data,
  loading = false,
  error = null,
  onRetry,
}) => {
  const aggregates = data?.aggregates;
  const tests = useMemo(() => data?.tests ?? [], [data]);

  const hasOpenRateTest = useMemo(
    () => tests.some((t) => t.winMetric === 'openRate'),
    [tests]
  );

  const topSendHours = aggregates?.topSendHoursUtc ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5" aria-hidden="true" />
          A/B Test History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div
            className="flex items-center justify-center gap-2 py-12 text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            <span className="text-sm">Loading A/B test history…</span>
          </div>
        ) : error ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-error-200 bg-error-50 p-4"
            role="alert"
            aria-live="assertive"
          >
            <AlertCircle className="w-5 h-5 mt-0.5 text-error-500 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-error-800">Couldn’t load A/B test history</p>
              <p className="text-xs text-error-700 mt-0.5">{error}</p>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="mt-2 px-3 py-1.5 rounded-md text-xs font-medium bg-error-100 text-error-800 hover:bg-error-200 focus:outline-none focus:ring-2 focus:ring-error-500 focus:ring-offset-2"
                >
                  Try again
                </button>
              )}
            </div>
          </div>
        ) : tests.length === 0 ? (
          <div className="text-center py-12" role="status">
            <FlaskConical className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-foreground">No A/B tests yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Once you run subject-line or send-time experiments, their results and trends will appear here.
            </p>
          </div>
        ) : (
          <>
            {/* Headline aggregates */}
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <AggregateStat
                label="Total tests"
                value={aggregates?.totalTests ?? tests.length}
                hint={`${aggregates?.significantTests ?? 0} significant`}
              />
              <AggregateStat
                label="By dimension"
                value={`${aggregates?.subjectTests ?? 0} / ${aggregates?.sendTimeTests ?? 0}`}
                hint="Subject / Send-time"
              />
              <AggregateStat
                label="Avg winning lift"
                value={formatLift(aggregates?.avgWinningLift)}
                hint="Significant winners"
              />
              <AggregateStat
                label="Top send hours (UTC)"
                value={
                  topSendHours.length > 0
                    ? topSendHours
                        .map((h) => `${String(h.hourUtc).padStart(2, '0')}:00`)
                        .join(', ')
                    : '—'
                }
                hint={
                  topSendHours.length > 0
                    ? topSendHours.map((h) => `${h.wins} win${h.wins === 1 ? '' : 's'}`).join(' · ')
                    : 'No send-time wins'
                }
              />
            </dl>

            {/* Aggregate-level MPP caveat */}
            {hasOpenRateTest && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-900/20 p-3 mb-4">
                <AlertTriangle
                  className="w-4 h-4 mt-0.5 text-amber-600 dark:text-amber-400 flex-shrink-0"
                  aria-hidden="true"
                />
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Some tests below are decided on open rate. Apple Mail Privacy Protection can inflate open
                  rates, so click rate may be a more reliable signal.
                </p>
              </div>
            )}

            <ul className="space-y-3" aria-label="Past A/B tests">
              {tests.map((test) => (
                <TestRow key={test.issueNumber} test={test} />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
};

AbTestHistory.displayName = 'AbTestHistory';

export default AbTestHistory;
