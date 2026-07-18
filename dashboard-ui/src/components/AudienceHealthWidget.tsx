import React, { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { apiClient } from '@/services/api';
import { Loading } from '@/components/ui/Loading';
import { Users, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { churnService, CHURN_REASON_LABELS, type AtRiskResponse } from '@/services/churnService';

interface CohortData {
  count: number;
  percentage: number;
}

interface AudienceHealthResponse {
  bootstrap?: boolean;
  cohorts?: {
    highlyEngaged: CohortData;
    occasional: CohortData;
    dormant: CohortData;
    total: number;
  };
}

interface AudienceHealthWidgetProps {
  latestIssueNumber: number;
}

interface ChartTooltipEntry {
  name?: string | number;
  value?: number | string | readonly (string | number)[];
  payload?: {
    percentage?: number;
    [key: string]: unknown;
  };
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: readonly ChartTooltipEntry[];
}

const COHORT_COLORS = {
  highlyEngaged: '#14b8a6',
  occasional: '#f97316',
  dormant: '#c81e22',
};

const COHORT_LABELS: Record<string, string> = {
  highlyEngaged: 'Highly Engaged',
  occasional: 'Occasional',
  dormant: 'Dormant',
};

function CustomTooltip({ active, payload }: ChartTooltipProps) {
  if (active && payload && payload.length > 0) {
    const item = payload[0];
    const label = item?.name ?? 'Value';
    const count = typeof item?.value === 'number' ? item.value : 0;
    const percentage =
      item?.payload && typeof item.payload === 'object' && 'percentage' in item.payload
        ? Number(item.payload.percentage ?? 0)
        : 0;
    return (
      <div className="bg-surface p-3 border border-border rounded-lg shadow-lg">
        <p className="font-medium text-foreground">{label}</p>
        <p className="text-sm text-muted-foreground">
          {count} subscribers ({percentage.toFixed(1)}%)
        </p>
      </div>
    );
  }
  return null;
}

export const AudienceHealthWidget: React.FC<AudienceHealthWidgetProps> = ({ latestIssueNumber }) => {
  const [data, setData] = useState<AudienceHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [atRisk, setAtRisk] = useState<AtRiskResponse | null>(null);
  const [atRiskExpanded, setAtRiskExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchAudienceHealth() {
      setLoading(true);
      setError(null);

      const response = await apiClient.get<AudienceHealthResponse>(
        `/subscribers/health?latestIssueNumber=${latestIssueNumber}`
      );

      if (cancelled) return;

      if (response.success && response.data) {
        setData(response.data);
      } else {
        setError(response.error || 'Failed to load audience health data');
      }
      setLoading(false);
    }

    fetchAudienceHealth();

    return () => { cancelled = true; };
  }, [latestIssueNumber]);

  // At-risk churn data is a best-effort enhancement — on any failure we simply
  // hide the section rather than surfacing an error on the whole widget.
  useEffect(() => {
    let cancelled = false;

    async function fetchAtRisk() {
      const response = await churnService.getAtRisk(latestIssueNumber);
      if (cancelled) return;
      setAtRisk(response.success && response.data ? response.data : null);
    }

    fetchAtRisk();

    return () => { cancelled = true; };
  }, [latestIssueNumber]);

  if (loading) {
    return (
      <div className="bg-surface rounded-lg shadow p-4 sm:p-6">
        <h3 className="text-base sm:text-lg font-medium text-foreground mb-3">Audience Health</h3>
        <div className="flex items-center justify-center py-8">
          <Loading size="md" text="Loading audience health…" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface rounded-lg shadow p-4 sm:p-6">
        <h3 className="text-base sm:text-lg font-medium text-foreground mb-3">Audience Health</h3>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  // Bootstrap state
  if (data?.bootstrap) {
    return (
      <div className="bg-surface rounded-lg shadow p-4 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base sm:text-lg font-medium text-foreground">Audience Health</h3>
          <div className="p-1.5 rounded-full bg-primary-50">
            <Users className="w-4 h-4 text-primary-600" aria-hidden="true" />
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-6 text-center" role="status">
          <Users className="w-8 h-8 text-muted-foreground mb-2" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Engagement tracking data is being collected. Cohort distribution will appear here once subscribers start engaging with your issues.
          </p>
        </div>
      </div>
    );
  }

  if (!data?.cohorts) {
    return null;
  }

  const { cohorts } = data;

  const chartData = [
    { name: COHORT_LABELS.highlyEngaged, value: cohorts.highlyEngaged.count, percentage: cohorts.highlyEngaged.percentage, color: COHORT_COLORS.highlyEngaged },
    { name: COHORT_LABELS.occasional, value: cohorts.occasional.count, percentage: cohorts.occasional.percentage, color: COHORT_COLORS.occasional },
    { name: COHORT_LABELS.dormant, value: cohorts.dormant.count, percentage: cohorts.dormant.percentage, color: COHORT_COLORS.dormant },
  ].filter(item => item.value > 0);

  return (
    <div className="bg-surface rounded-lg shadow p-4 sm:p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base sm:text-lg font-medium text-foreground">Audience Health</h3>
        <div className="p-1.5 rounded-full bg-primary-50">
          <Users className="w-4 h-4 text-primary-600" aria-hidden="true" />
        </div>
      </div>

      {/* Donut chart */}
      <div
        className="h-48"
        role="img"
        aria-label={`Audience health: ${cohorts.highlyEngaged.count} highly engaged, ${cohorts.occasional.count} occasional, ${cohorts.dormant.count} dormant out of ${cohorts.total} total subscribers`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={35}
              outerRadius={65}
              paddingAngle={2}
              dataKey="value"
              nameKey="name"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={CustomTooltip} />
            <Legend
              verticalAlign="bottom"
              height={36}
              formatter={(value: string, entry: { color?: string }) => (
                <span style={{ color: entry.color }}>{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Cohort breakdown list */}
      <div className="space-y-2 mt-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COHORT_COLORS.highlyEngaged }} aria-hidden="true" />
            <span className="text-xs sm:text-sm text-muted-foreground">Highly Engaged</span>
          </div>
          <span className="text-xs sm:text-sm font-medium text-foreground">
            {cohorts.highlyEngaged.count} ({cohorts.highlyEngaged.percentage.toFixed(1)}%)
          </span>
        </div>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COHORT_COLORS.occasional }} aria-hidden="true" />
            <span className="text-xs sm:text-sm text-muted-foreground">Occasional</span>
          </div>
          <span className="text-xs sm:text-sm font-medium text-foreground">
            {cohorts.occasional.count} ({cohorts.occasional.percentage.toFixed(1)}%)
          </span>
        </div>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COHORT_COLORS.dormant }} aria-hidden="true" />
            <span className="text-xs sm:text-sm text-muted-foreground">Dormant</span>
          </div>
          <span className="text-xs sm:text-sm font-medium text-foreground">
            {cohorts.dormant.count} ({cohorts.dormant.percentage.toFixed(1)}%)
          </span>
        </div>
        <div className="flex justify-between items-center pt-2 border-t border-border">
          <span className="text-xs sm:text-sm font-medium text-muted-foreground">Total</span>
          <span className="text-xs sm:text-sm font-medium text-foreground">{cohorts.total}</span>
        </div>
      </div>

      {/* At Risk section — leading indicators of churn. Hidden when there is no
          at-risk data (endpoint error or nobody at risk). */}
      {atRisk && atRisk.summary.total > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <button
            type="button"
            onClick={() => setAtRiskExpanded((prev) => !prev)}
            aria-expanded={atRiskExpanded}
            className="w-full flex items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-2">
              {atRiskExpanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              )}
              <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />
              <span className="text-xs sm:text-sm font-medium text-foreground">At Risk</span>
            </span>
            <span className="inline-flex items-center justify-center min-w-[1.5rem] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
              {atRisk.summary.total}
            </span>
          </button>

          {atRiskExpanded && (
            <ul className="mt-3 space-y-2" aria-label="At-risk subscribers">
              {atRisk.atRisk.map((subscriber) => (
                <li key={subscriber.email} className="flex flex-col gap-1">
                  <span className="text-xs sm:text-sm text-foreground truncate" title={subscriber.email}>
                    {subscriber.email}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {subscriber.reasons.map((reason) => (
                      <span
                        key={reason}
                        className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] sm:text-xs font-medium"
                      >
                        {CHURN_REASON_LABELS[reason] ?? reason}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default AudienceHealthWidget;
