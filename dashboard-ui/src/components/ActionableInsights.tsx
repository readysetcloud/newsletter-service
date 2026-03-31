import React, { useMemo } from 'react';
import { Lightbulb, TrendingDown, TrendingUp, AlertTriangle, ThumbsUp } from 'lucide-react';
import type { TrendsData } from '@/types';

interface Insight {
  id: string;
  icon: React.ElementType;
  iconColor: string;
  message: string;
  severity: 'positive' | 'warning' | 'neutral';
}

interface ActionableInsightsProps {
  trendsData: TrendsData;
}

export const ActionableInsights: React.FC<ActionableInsightsProps> = ({ trendsData }) => {
  const insights = useMemo(() => {
    const result: Insight[] = [];
    const issues = trendsData.issues;
    const agg = trendsData.aggregates;
    const prev = trendsData.previousPeriodAggregates;

    if (issues.length < 2) {
      result.push({
        id: 'not-enough-data',
        icon: Lightbulb,
        iconColor: 'text-primary-500',
        message: 'Send a few more issues to unlock trend-based insights.',
        severity: 'neutral',
      });
      return result;
    }

    // Open rate trend
    if (prev) {
      const openDelta = agg.avgOpenRate - prev.avgOpenRate;
      if (openDelta < -3) {
        result.push({
          id: 'open-rate-drop',
          icon: TrendingDown,
          iconColor: 'text-error-500',
          message: `Open rate dropped ${Math.abs(openDelta).toFixed(1)}% vs. the previous period. Consider testing subject lines or send times.`,
          severity: 'warning',
        });
      } else if (openDelta > 3) {
        result.push({
          id: 'open-rate-up',
          icon: TrendingUp,
          iconColor: 'text-success-500',
          message: `Open rate is up ${openDelta.toFixed(1)}%. Whatever you changed recently is working.`,
          severity: 'positive',
        });
      }
    }

    // Click rate trend
    if (prev) {
      const clickDelta = agg.avgClickRate - prev.avgClickRate;
      if (clickDelta < -2) {
        result.push({
          id: 'click-rate-drop',
          icon: TrendingDown,
          iconColor: 'text-warning-500',
          message: `Click rate fell ${Math.abs(clickDelta).toFixed(1)}%. Try repositioning your CTA or making links more prominent.`,
          severity: 'warning',
        });
      } else if (clickDelta > 2) {
        result.push({
          id: 'click-rate-up',
          icon: TrendingUp,
          iconColor: 'text-success-500',
          message: `Click rate climbed ${clickDelta.toFixed(1)}%. Your content is resonating with readers.`,
          severity: 'positive',
        });
      }
    }

    // Bounce rate warning
    if (agg.avgBounceRate > 5) {
      result.push({
        id: 'high-bounce',
        icon: AlertTriangle,
        iconColor: 'text-error-500',
        message: `Bounce rate is ${agg.avgBounceRate.toFixed(1)}% — above the 5% threshold. Clean your list to protect sender reputation.`,
        severity: 'warning',
      });
    } else if (agg.avgBounceRate > 2) {
      result.push({
        id: 'moderate-bounce',
        icon: AlertTriangle,
        iconColor: 'text-warning-500',
        message: `Bounce rate is ${agg.avgBounceRate.toFixed(1)}%. Keep an eye on it — above 5% can hurt deliverability.`,
        severity: 'warning',
      });
    }

    // Subscriber growth/churn
    if (issues.length >= 2) {
      const latest = issues[0].metrics.subscribers;
      const oldest = issues[issues.length - 1].metrics.subscribers;
      const growthPct = oldest > 0 ? ((latest - oldest) / oldest) * 100 : 0;

      if (growthPct > 5) {
        result.push({
          id: 'sub-growth',
          icon: TrendingUp,
          iconColor: 'text-success-500',
          message: `Your list grew ${growthPct.toFixed(1)}% over the last ${issues.length} issues. Nice momentum.`,
          severity: 'positive',
        });
      } else if (growthPct < -2) {
        result.push({
          id: 'sub-churn',
          icon: TrendingDown,
          iconColor: 'text-warning-500',
          message: `List size shrank ${Math.abs(growthPct).toFixed(1)}%. Consider a re-engagement campaign for inactive subscribers.`,
          severity: 'warning',
        });
      }
    }

    // Complaint check
    const totalComplaints = issues.reduce((sum, i) => sum + (i.metrics.complaints || 0), 0);
    const complaintRate = agg.totalDelivered > 0 ? (totalComplaints / agg.totalDelivered) * 100 : 0;
    if (complaintRate > 0.1) {
      result.push({
        id: 'high-complaints',
        icon: AlertTriangle,
        iconColor: 'text-error-500',
        message: `Complaint rate is ${complaintRate.toFixed(2)}% — above the 0.1% safe zone. Review your content and unsubscribe flow.`,
        severity: 'warning',
      });
    }

    // All good fallback
    if (result.length === 0) {
      result.push({
        id: 'all-good',
        icon: ThumbsUp,
        iconColor: 'text-success-500',
        message: 'Everything looks healthy. Keep up the good work.',
        severity: 'positive',
      });
    }

    return result.slice(0, 4);
  }, [trendsData]);

  return (
    <div className="bg-surface rounded-lg shadow p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-medium text-foreground mb-3">Insights</h3>
      <div className="space-y-3">
        {insights.map((insight) => {
          const Icon = insight.icon;
          return (
            <div key={insight.id} className="flex items-start gap-2.5">
              <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${insight.iconColor}`} />
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                {insight.message}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ActionableInsights;

