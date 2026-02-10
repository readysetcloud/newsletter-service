import React, { useMemo } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Button } from '../ui/Button';
import type { InsightV2 } from '../../types/issues';

export interface InsightsHeroSectionProps {
  insights: InsightV2[];
  onRefreshInsights?: () => void;
  isRefreshing?: boolean;
  className?: string;
}

const severityConfig = {
  action: {
    label: 'Action Required',
    icon: AlertCircle,
    colorClasses: 'bg-error-50 border-error-200 dark:bg-error-900/20 dark:border-error-800',
    iconClasses: 'text-error-600 dark:text-error-400',
    badgeClasses: 'bg-error-100 text-error-700 border-error-300 dark:bg-error-800/60 dark:text-error-100 dark:border-error-600',
    priority: 1,
  },
  watch: {
    label: 'Watch',
    icon: AlertTriangle,
    colorClasses: 'bg-warning-50 border-warning-200 dark:bg-warning-900/20 dark:border-warning-800',
    iconClasses: 'text-warning-600 dark:text-warning-400',
    badgeClasses: 'bg-warning-100 text-warning-700 border-warning-300 dark:bg-warning-800/60 dark:text-warning-100 dark:border-warning-600',
    priority: 2,
  },
  info: {
    label: 'Good',
    icon: CheckCircle,
    colorClasses: 'bg-success-50 border-success-200 dark:bg-success-900/20 dark:border-success-800',
    iconClasses: 'text-success-600 dark:text-success-400',
    badgeClasses: 'bg-success-100 text-success-700 border-success-300 dark:bg-success-800/60 dark:text-success-100 dark:border-success-600',
    priority: 3,
  },
} as const;

const confidenceConfig = {
  high: {
    label: 'High Confidence',
    colorClasses: 'bg-primary-100 text-primary-700 border-primary-300 dark:bg-primary-800/60 dark:text-primary-100 dark:border-primary-600',
  },
  med: {
    label: 'Medium Confidence',
    colorClasses: 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-500',
  },
  low: {
    label: 'Low Confidence',
    colorClasses: 'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-500',
  },
} as const;

const sortInsightsBySeverity = (insights: InsightV2[]): InsightV2[] => {
  return [...insights].sort((a, b) => {
    const priorityA = severityConfig[a.severity]?.priority ?? 999;
    const priorityB = severityConfig[b.severity]?.priority ?? 999;
    return priorityA - priorityB;
  });
};

export const InsightsHeroSection: React.FC<InsightsHeroSectionProps> = React.memo(({
  insights,
  onRefreshInsights,
  isRefreshing = false,
  className,
}) => {
  const sortedInsights = useMemo(() => sortInsightsBySeverity(insights), [insights]);

  if (!insights || insights.length === 0) {
    return (
      <section
        className={cn(
          'bg-gradient-to-br from-primary-50 to-primary-100/50 dark:from-primary-900/20 dark:to-primary-800/10',
          'rounded-lg border border-primary-200 dark:border-primary-800',
          'p-6 sm:p-8',
          className
        )}
        aria-labelledby="insights-heading"
      >
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-800/60 mb-4">
            <AlertCircle className="w-6 h-6 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          </div>
          <h2 id="insights-heading" className="text-lg font-semibold text-foreground mb-2">
            No Insights Yet
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Analytics can take a few minutes to appear after publish. Refresh this page in a few minutes to see the latest insights.
          </p>
          {onRefreshInsights && (
            <Button
              onClick={onRefreshInsights}
              variant="outline"
              size="sm"
              disabled={isRefreshing}
              className="mt-4"
              aria-label="Refresh insights to get latest analytics data"
              aria-busy={isRefreshing}
            >
              <RefreshCw className={cn('w-4 h-4 mr-2', isRefreshing && 'animate-spin')} aria-hidden="true" />
              {isRefreshing ? 'Refreshing...' : 'Refresh Insights'}
            </Button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn(
        'bg-gradient-to-br from-primary-50 to-primary-100/50 dark:from-primary-900/20 dark:to-primary-800/10',
        'rounded-lg border border-primary-200 dark:border-primary-800',
        'p-6 sm:p-8',
        className
      )}
      aria-labelledby="insights-heading"
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 id="insights-heading" className="text-xl sm:text-2xl font-bold text-foreground">
            Insights
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Actionable recommendations based on your issue performance
          </p>
        </div>
        {onRefreshInsights && (
          <Button
            onClick={onRefreshInsights}
            variant="ghost"
            size="sm"
            disabled={isRefreshing}
            aria-label="Refresh insights to get latest analytics data"
            aria-busy={isRefreshing}
            className="flex-shrink-0"
          >
            <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} aria-hidden="true" />
          </Button>
        )}
      </div>

      <ul
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        aria-label="Insight cards"
      >
        {sortedInsights.map((insight, index) => {
          const config = severityConfig[insight.severity];
          const confidenceConf = confidenceConfig[insight.confidence];
          const Icon = config.icon;

          return (
            <li
              key={`${insight.type}-${index}`}
              className={cn(
                'rounded-lg border p-5',
                'transition-all duration-200',
                'hover:shadow-md hover:scale-[1.02]',
                config.colorClasses
              )}
            >
              <article>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Icon
                      className={cn('w-5 h-5 flex-shrink-0', config.iconClasses)}
                      aria-hidden="true"
                    />
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-xs font-semibold uppercase tracking-wide text-foreground truncate">
                        {insight.type}
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border w-fit',
                          config.badgeClasses
                        )}
                        role="status"
                        aria-label={`Severity: ${config.label}`}
                      >
                        {config.label}
                      </span>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border flex-shrink-0',
                      confidenceConf.colorClasses
                    )}
                    aria-label={`Confidence: ${confidenceConf.label}`}
                  >
                    {confidenceConf.label}
                  </span>
                </div>

                <div className="mb-3">
                  <p className="text-sm font-semibold text-foreground leading-snug">
                    {insight.summary}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {insight.recommendation}
                  </p>
                </div>

                {insight.evidence && insight.evidence.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-current/10">
                    <ul className="space-y-1 text-xs text-muted-foreground" aria-label="Supporting evidence">
                      {insight.evidence.map((evidence, evidenceIndex) => (
                        <li key={evidenceIndex} className="flex items-start gap-2">
                          <span className="font-medium">{evidence.metric}:</span>
                          <span>{evidence.value || evidence.note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
});

InsightsHeroSection.displayName = 'InsightsHeroSection';

// eslint-disable-next-line react-refresh/only-export-components
export { sortInsightsBySeverity };
