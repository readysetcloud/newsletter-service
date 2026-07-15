import React from 'react';
import { Link } from 'react-router-dom';
import {
  FlaskConical,
  Mail,
  Clock,
  Loader2,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { cn } from '../../utils/cn';
import type {
  ActiveAbTest,
  AbTestStatus,
  VariantId,
  AbTestWinMetric,
  VariantStats,
} from '../../types/issues';

export interface AbTestInProgressProps {
  /** In-progress A/B tests to surface. */
  tests?: ActiveAbTest[];
  /** Whether the active tests are currently loading. */
  loading?: boolean;
  /** An error message to surface instead of the panel body. */
  error?: string | null;
  /** Optional retry handler shown alongside the error state. */
  onRetry?: () => void;
}

const VARIANT_LABELS: Record<VariantId, string> = {
  a: 'A',
  b: 'B',
};

// Only the non-final states reach this panel; each gets a spinner to read as
// "live". Mirrors the badge styling used on the issue-detail A/B results panel.
const STATUS_CONFIG: Record<
  Extract<AbTestStatus, 'pending' | 'testing' | 'evaluating'>,
  { label: string; className: string }
> = {
  pending: {
    label: 'Starting',
    className:
      'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-500',
  },
  testing: {
    label: 'Testing',
    className:
      'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-800/60 dark:text-blue-100 dark:border-blue-400',
  },
  evaluating: {
    label: 'Evaluating',
    className:
      'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-800/60 dark:text-yellow-100 dark:border-yellow-400',
  },
};

const formatRate = (successes: number, deliveries: number): string => {
  if (!deliveries || deliveries <= 0) return '—';
  return `${((successes / deliveries) * 100).toFixed(1)}%`;
};

const statsFor = (
  variantStats: VariantStats[],
  variantId: VariantId
): VariantStats | undefined => variantStats.find((s) => s.variantId === variantId);

interface VariantProgressProps {
  variantId: VariantId;
  label: string;
  stats?: VariantStats;
  winMetric: AbTestWinMetric;
}

const VariantProgress: React.FC<VariantProgressProps> = ({
  variantId,
  label,
  stats,
  winMetric,
}) => {
  const deliveries = stats?.deliveries ?? 0;
  const successes =
    winMetric === 'clickRate' ? stats?.clicks ?? 0 : stats?.opens ?? 0;

  return (
    <div className="rounded-md border border-border bg-muted/40 p-2" aria-label={`Variant ${VARIANT_LABELS[variantId]} progress`}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-semibold text-foreground">
          Variant {VARIANT_LABELS[variantId]}
        </span>
        <span className="text-xs text-muted-foreground">
          {winMetric === 'clickRate' ? 'Click rate' : 'Open rate'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground truncate mb-1" title={label}>
        {label}
      </p>
      <div className="text-lg font-bold text-foreground">
        {formatRate(successes, deliveries)}
      </div>
      <div className="text-xs text-muted-foreground">
        {successes} / {deliveries} delivered
      </div>
    </div>
  );
};

const variantDescriptor = (test: ActiveAbTest, variantId: VariantId): string => {
  const variant = test.variants.find((v) => v.variantId === variantId);
  if (!variant) return '';
  if (test.dimension === 'subject') return variant.subject || 'No subject set';
  return variant.sendAt || 'No send time set';
};

const TestCard: React.FC<{ test: ActiveAbTest }> = ({ test }) => {
  const status = STATUS_CONFIG[test.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.testing;
  const winMetric = test.winMetric ?? 'openRate';

  return (
    <div className="rounded-lg border border-border bg-background p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <Link
            to={`/issues/${test.issueId}`}
            className="group inline-flex items-center gap-1 text-sm font-semibold text-foreground hover:text-primary-600 dark:hover:text-primary-400"
          >
            Issue #{test.issueNumber}
            <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
          </Link>
          <p className="text-xs text-muted-foreground truncate" title={test.subject}>
            {test.subject}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-medium">
            {test.dimension === 'subject' ? (
              <Mail className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">
              {test.dimension === 'subject' ? 'Subject line' : 'Send time'}
            </span>
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border',
              status.className
            )}
            role="status"
            aria-label={`A/B test status: ${status.label}`}
          >
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
            {status.label}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <VariantProgress
          variantId="a"
          label={variantDescriptor(test, 'a')}
          stats={statsFor(test.variantStats, 'a')}
          winMetric={winMetric}
        />
        <VariantProgress
          variantId="b"
          label={variantDescriptor(test, 'b')}
          stats={statsFor(test.variantStats, 'b')}
          winMetric={winMetric}
        />
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        The winner is sent to the rest of your list automatically once the hold-out
        window closes
        {typeof test.evaluateAfterMinutes === 'number'
          ? ` (about ${test.evaluateAfterMinutes} min after the test send).`
          : '.'}
      </p>
    </div>
  );
};

/**
 * Dashboard panel that surfaces A/B tests that are actively running — the sample
 * has been sent but the winner has not been decided yet — with live per-variant
 * engagement. Renders nothing when there are no active tests so the dashboard
 * stays uncluttered between tests.
 */
export const AbTestInProgress: React.FC<AbTestInProgressProps> = ({
  tests,
  loading = false,
  error = null,
  onRetry,
}) => {
  if (loading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            Checking for running A/B tests…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-start gap-2" role="alert">
            <AlertCircle className="w-4 h-4 mt-0.5 text-error-500 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">Couldn’t load running A/B tests</p>
              <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-2 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
                >
                  Try again
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Nothing running — render nothing so the section collapses cleanly.
  if (!tests || tests.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5" aria-hidden="true" />
          A/B Tests In Progress
          <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-semibold bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200">
            {tests.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {tests.map((test) => (
            <TestCard key={test.issueId} test={test} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

AbTestInProgress.displayName = 'AbTestInProgress';

export default AbTestInProgress;
