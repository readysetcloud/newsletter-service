import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  RefreshCw,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  Users,
  Link2,
  FileText,
  Award,
  AlertTriangle,
  CheckCircle,
  ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/utils/cn';
import { reportsService } from '@/services/reportsService';
import type { MonthlyReport, ReportInsightSeverity } from '@/types/reports';

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const formatNumber = (value: number): string => value.toLocaleString('en-US');
const formatSignedNumber = (value: number): string =>
  `${value > 0 ? '+' : ''}${value.toLocaleString('en-US')}`;

const formatDate = (dateString: string): string =>
  new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

/**
 * Severity styling mirrors the issues analytics `InsightsHeroSection` palette:
 * action = error (red), watch = warning (amber), info = success (green).
 */
const severityConfig: Record<
  ReportInsightSeverity,
  {
    label: string;
    icon: React.FC<{ className?: string }>;
    colorClasses: string;
    iconClasses: string;
    badgeClasses: string;
  }
> = {
  action: {
    label: 'Action Required',
    icon: AlertCircle,
    colorClasses: 'bg-error-50 border-error-200 dark:bg-error-900/20 dark:border-error-800',
    iconClasses: 'text-error-600 dark:text-error-400',
    badgeClasses:
      'bg-error-100 text-error-700 border-error-300 dark:bg-error-800/60 dark:text-error-100 dark:border-error-600',
  },
  watch: {
    label: 'Watch',
    icon: AlertTriangle,
    colorClasses: 'bg-warning-50 border-warning-200 dark:bg-warning-900/20 dark:border-warning-800',
    iconClasses: 'text-warning-600 dark:text-warning-400',
    badgeClasses:
      'bg-warning-100 text-warning-700 border-warning-300 dark:bg-warning-800/60 dark:text-warning-100 dark:border-warning-600',
  },
  info: {
    label: 'Good',
    icon: CheckCircle,
    colorClasses: 'bg-success-50 border-success-200 dark:bg-success-900/20 dark:border-success-800',
    iconClasses: 'text-success-600 dark:text-success-400',
    badgeClasses:
      'bg-success-100 text-success-700 border-success-300 dark:bg-success-800/60 dark:text-success-100 dark:border-success-600',
  },
};

const SEVERITY_PRIORITY: Record<ReportInsightSeverity, number> = {
  action: 1,
  watch: 2,
  info: 3,
};

interface StatCardProps {
  label: string;
  value: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value }) => (
  <div className="rounded-lg border border-border bg-surface p-4">
    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</div>
    <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
  </div>
);

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, icon, children }) => (
  <Card className="mb-6">
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <span className="text-primary-600 dark:text-primary-400">{icon}</span>
        {title}
      </CardTitle>
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);

export const ReportDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleBack = useCallback(() => navigate('/reports'), [navigate]);

  const loadReport = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);

      const response = await reportsService.getReport(id);

      if (response.success && response.data) {
        setReport(response.data);
      } else {
        const errorMsg = response.error || 'Failed to load report';
        setError(errorMsg);
        addToast({
          title: 'Failed to Load Report',
          message: errorMsg,
          type: 'error',
          action: {
            label: 'Retry',
            onClick: () => loadReport(),
          },
        });
      }
    } catch (err) {
      console.error('Error loading report:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to load report';
      setError(errorMsg);
      addToast({
        title: 'Failed to Load Report',
        message: errorMsg,
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [id, addToast]);

  useEffect(() => {
    if (id) {
      loadReport();
    }
  }, [id, loadReport]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div role="status" aria-live="polite" aria-label="Loading report">
            <span className="sr-only">Loading report...</span>
            <div className="mb-6 h-9 w-32 bg-muted rounded animate-pulse" />
            <div className="h-8 w-56 bg-muted rounded animate-pulse mb-2" />
            <div className="h-4 w-72 bg-muted rounded animate-pulse mb-8" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                <div key={i} className="rounded-lg border border-border bg-surface p-4">
                  <div className="h-3 w-16 bg-muted rounded animate-pulse mb-2" />
                  <div className="h-6 w-12 bg-muted rounded animate-pulse" />
                </div>
              ))}
            </div>
            <div className="h-64 bg-muted rounded animate-pulse" />
          </div>
        </main>
      </div>
    );
  }

  if (error || !report) {
    const isNotFound = !error || /not found|404/i.test(error);

    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="py-12">
              <div role="alert" aria-live="assertive" className="text-center">
                <AlertCircle className="mx-auto h-12 w-12 text-error-400 mb-4" aria-hidden="true" />
                <h2 className="text-2xl font-semibold text-foreground mb-2">
                  {isNotFound ? 'Report Not Found' : 'Failed to load report'}
                </h2>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  {isNotFound
                    ? "We couldn't find a report for this month. It may not have been generated yet."
                    : error}
                </p>
                <div className="flex justify-center gap-3">
                  <Button onClick={handleBack} variant="outline" aria-label="Back to reports list">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Reports
                  </Button>
                  {!isNotFound && (
                    <Button onClick={loadReport} aria-label="Retry loading report">
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Try Again
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const { summary, subscriberGrowth, topLinks, issues, bestIssue, insights } = report.report;
  const growthPositive = subscriberGrowth.netChange >= 0;

  const maxSubscribers = subscriberGrowth.byIssue.reduce(
    (max, point) => Math.max(max, point.subscribers),
    0
  );

  const sortedInsights = [...insights].sort(
    (a, b) => SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity]
  );

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <main id="main-content" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back Button */}
        <div className="mb-6">
          <Button onClick={handleBack} variant="ghost" size="sm" aria-label="Back to reports list">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Reports
          </Button>
        </div>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {report.monthLabel} Report
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {formatDate(report.periodStart)} – {formatDate(report.periodEnd)} · Generated{' '}
            {formatDate(report.generatedAt)}
          </p>
        </div>

        {/* Summary stat grid */}
        <Section title="Summary" icon={<TrendingUp className="w-5 h-5" />}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <StatCard label="Issues Sent" value={formatNumber(summary.issuesSent)} />
            <StatCard label="Total Delivered" value={formatNumber(summary.totalDelivered)} />
            <StatCard label="Total Opens" value={formatNumber(summary.totalOpens)} />
            <StatCard label="Total Clicks" value={formatNumber(summary.totalClicks)} />
            <StatCard label="Avg Open Rate" value={formatPercent(summary.avgOpenRate)} />
            <StatCard label="Avg Click Rate" value={formatPercent(summary.avgClickRate)} />
            <StatCard label="Avg Click-to-Open" value={formatPercent(summary.avgClickToOpenRate)} />
            <StatCard label="Avg Bounce Rate" value={formatPercent(summary.avgBounceRate)} />
          </div>
        </Section>

        {/* Subscriber growth */}
        <Section title="Subscriber Growth" icon={<Users className="w-5 h-5" />}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <StatCard label="Start" value={formatNumber(subscriberGrowth.startCount)} />
            <StatCard label="End" value={formatNumber(subscriberGrowth.endCount)} />
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Net Change
              </div>
              <div
                className={cn(
                  'mt-1 flex items-center gap-1 text-2xl font-semibold',
                  growthPositive
                    ? 'text-success-600 dark:text-success-400'
                    : 'text-error-600 dark:text-error-400'
                )}
              >
                {growthPositive ? (
                  <ArrowUpRight className="w-5 h-5" aria-hidden="true" />
                ) : (
                  <ArrowDownRight className="w-5 h-5" aria-hidden="true" />
                )}
                {formatSignedNumber(subscriberGrowth.netChange)}
              </div>
            </div>
            <StatCard label="Growth Rate" value={formatPercent(subscriberGrowth.growthRate)} />
          </div>

          {subscriberGrowth.byIssue.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">Subscribers by issue</h4>
              <div className="space-y-2">
                {subscriberGrowth.byIssue.map((point) => {
                  const pct = maxSubscribers > 0 ? (point.subscribers / maxSubscribers) * 100 : 0;
                  return (
                    <div key={`${point.issue}-${point.date}`} className="flex items-center gap-3">
                      <div className="w-16 shrink-0 text-xs text-muted-foreground">
                        #{point.issue}
                      </div>
                      <div className="flex-1 h-6 rounded bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary-500 dark:bg-primary-600 rounded"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="w-20 shrink-0 text-right text-sm font-medium text-foreground tabular-nums">
                        {formatNumber(point.subscribers)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Section>

        {/* Top links */}
        <Section title="Top 5 Links" icon={<Link2 className="w-5 h-5" />}>
          {topLinks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No link clicks recorded this month.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-12">
                      #
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Link
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Clicks
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {topLinks.map((link, index) => (
                    <tr key={`${link.url}-${index}`}>
                      <td className="px-3 py-3 text-sm font-medium text-muted-foreground tabular-nums">
                        {index + 1}
                      </td>
                      <td className="px-3 py-3 max-w-md">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400 truncate"
                        >
                          <span className="truncate">{link.label || link.url}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                        </a>
                        {link.issues.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Issues: {link.issues.map((n) => `#${n}`).join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-sm font-medium text-foreground tabular-nums">
                        {formatNumber(link.clicks)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Best issue highlights */}
        {(bestIssue.byOpenRate || bestIssue.byClickRate || bestIssue.byClicks) && (
          <Section title="Best Issues" icon={<Award className="w-5 h-5" />}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {bestIssue.byOpenRate && (
                <div className="rounded-lg border border-border bg-surface p-4">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Highest Open Rate
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-foreground">
                    {formatPercent(bestIssue.byOpenRate.value)}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground truncate">
                    #{bestIssue.byOpenRate.issueNumber} · {bestIssue.byOpenRate.subject}
                  </div>
                </div>
              )}
              {bestIssue.byClickRate && (
                <div className="rounded-lg border border-border bg-surface p-4">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Highest Click Rate
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-foreground">
                    {formatPercent(bestIssue.byClickRate.value)}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground truncate">
                    #{bestIssue.byClickRate.issueNumber} · {bestIssue.byClickRate.subject}
                  </div>
                </div>
              )}
              {bestIssue.byClicks && (
                <div className="rounded-lg border border-border bg-surface p-4">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Most Clicks
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-foreground">
                    {formatNumber(bestIssue.byClicks.value)}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground truncate">
                    #{bestIssue.byClicks.issueNumber} · {bestIssue.byClicks.subject}
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Per-issue performance */}
        <Section title="Issue Performance" icon={<FileText className="w-5 h-5" />}>
          {issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No issues published this month.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Issue
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Delivered
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Open Rate
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Click Rate
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      CTOR
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Bounce Rate
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {issues.map((issue) => (
                    <tr key={issue.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-3 py-3">
                        <button
                          onClick={() => navigate(`/issues/${issue.id}`)}
                          className="text-left hover:text-primary-600 transition-colors rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                          aria-label={`View issue: ${issue.subject}`}
                        >
                          <div className="text-sm font-medium text-foreground">{issue.subject}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            #{issue.issueNumber} · {formatDate(issue.publishedAt)}
                          </div>
                        </button>
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-foreground tabular-nums">
                        {formatNumber(issue.delivered)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-foreground tabular-nums">
                        {formatPercent(issue.openRate)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-foreground tabular-nums">
                        {formatPercent(issue.clickRate)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-foreground tabular-nums">
                        {formatPercent(issue.clickToOpenRate)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-foreground tabular-nums">
                        {formatPercent(issue.bounceRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Insights */}
        {sortedInsights.length > 0 && (
          <Section title="Insights" icon={<TrendingUp className="w-5 h-5" />}>
            <div className="space-y-4">
              {sortedInsights.map((insight, index) => {
                const config = severityConfig[insight.severity];
                const Icon = config.icon;
                return (
                  <div
                    key={`${insight.type}-${index}`}
                    className={cn('rounded-lg border p-4', config.colorClasses)}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className={cn('w-5 h-5 shrink-0 mt-0.5', config.iconClasses)} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h4 className="text-sm font-semibold text-foreground">{insight.title}</h4>
                          <span
                            className={cn(
                              'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
                              config.badgeClasses
                            )}
                          >
                            {config.label}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">{insight.detail}</p>
                        {insight.recommendation && (
                          <p className="mt-2 text-sm text-foreground">
                            <span className="font-medium">Recommendation: </span>
                            {insight.recommendation}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}
      </main>
    </div>
  );
};
