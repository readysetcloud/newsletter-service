import React, { useState, useEffect, useCallback } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import { RefreshCw, DollarSign, ChevronDown, AlertCircle, Info, FileDown } from 'lucide-react';
import { reportService } from '../../services/reportService';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { pricingService } from '../../services/pricingService';
import { formatUtcToLocal } from '../../utils/pricingUtils';
import type {
  PricingData,
  PricingHistoryData,
  PricingRecord,
  Questionnaire,
  QuestionnaireQuestion,
} from '../../types';

// ---------------------------------------------------------------------------
// Skeleton loader shown while initial data is fetching
// ---------------------------------------------------------------------------
const PricingSkeleton: React.FC = () => (
  <div className="space-y-6 animate-pulse" role="status" aria-label="Loading pricing data">
    <span className="sr-only">Loading pricing data…</span>
    {/* Price card skeleton */}
    <div className="bg-surface rounded-lg border border-border p-6">
      <div className="h-4 w-40 bg-muted rounded mb-4" />
      <div className="h-10 w-32 bg-muted rounded mb-3" />
      <div className="flex gap-4">
        <div className="h-4 w-24 bg-muted rounded" />
        <div className="h-4 w-36 bg-muted rounded" />
      </div>
    </div>
    {/* Chart skeleton */}
    <div className="bg-surface rounded-lg border border-border p-6">
      <div className="h-4 w-32 bg-muted rounded mb-4" />
      <div className="h-64 bg-muted rounded" />
    </div>
    {/* Sections skeleton */}
    <div className="bg-surface rounded-lg border border-border p-6">
      <div className="h-4 w-48 bg-muted rounded" />
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Confidence badge
// ---------------------------------------------------------------------------
const confidenceColors: Record<string, string> = {
  high: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  low: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

const ConfidenceBadge: React.FC<{ level: string }> = ({ level }) => (
  <span
    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${confidenceColors[level] ?? confidenceColors.low}`}
    aria-label={`Confidence: ${level}`}
  >
    {level} confidence
  </span>
);

// ---------------------------------------------------------------------------
// Custom Recharts tooltip
// ---------------------------------------------------------------------------
interface ChartPoint {
  date: string;
  price: number;
  justification: string;
}

const CustomTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
}> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-surface border border-border rounded-lg shadow-lg p-3 max-w-xs text-sm">
      <p className="font-semibold text-foreground">${d.price.toFixed(2)}</p>
      <p className="text-muted-foreground text-xs mb-1">{d.date}</p>
      <p className="text-muted-foreground text-xs line-clamp-3">{d.justification}</p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Collapsible wrapper (lightweight, reuses project patterns)
// ---------------------------------------------------------------------------
const Collapsible: React.FC<{
  id: string;
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ id, title, icon, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      id={id}
      className="bg-surface rounded-lg border border-border shadow-sm"
      aria-labelledby={`${id}-title`}
    >
      <header
        className="flex items-center justify-between p-4 sm:p-6 cursor-pointer select-none hover:bg-muted/50 transition-colors rounded-t-lg min-h-[60px]"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={`${id}-content`}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${title} section`}
      >
        <div className="flex items-center gap-3">
          {icon && <span className="text-muted-foreground" aria-hidden="true">{icon}</span>}
          <h2 id={`${id}-title`} className="text-base sm:text-lg font-semibold text-foreground">
            {title}
          </h2>
        </div>
        <ChevronDown
          className={`h-5 w-5 text-muted-foreground transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </header>
      <div
        id={`${id}-content`}
        className={`overflow-hidden transition-all duration-300 ease-in-out ${open ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'}`}
        aria-hidden={!open}
        role="region"
        aria-labelledby={`${id}-title`}
      >
        <div className="px-4 sm:px-6 pb-4 sm:pb-6">{children}</div>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Questionnaire form
// ---------------------------------------------------------------------------
const QuestionnaireForm: React.FC<{
  questionnaire: Questionnaire;
  onSubmit: (version: string, responses: Array<{ questionId: string; answer: unknown }>) => void;
  isSubmitting: boolean;
}> = ({ questionnaire, onSubmit, isSubmitting }) => {
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => {
    // Pre-fill with existing responses if available
    return questionnaire.existingResponses
      ? { ...questionnaire.existingResponses }
      : {};
  });

  const handleChange = (questionId: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleMultiSelect = (questionId: string, option: string) => {
    setAnswers((prev) => {
      const current = (prev[questionId] as string[]) || [];
      const next = current.includes(option)
        ? current.filter((o) => o !== option)
        : [...current, option];
      return { ...prev, [questionId]: next };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const responses = Object.entries(answers)
      .filter(([, answer]) => answer !== undefined && answer !== '')
      .map(([questionId, answer]) => ({
        questionId,
        answer,
      }));
    onSubmit(questionnaire.version, responses);
  };

  const renderQuestion = (q: QuestionnaireQuestion) => {
    switch (q.type) {
      case 'single-select':
        return (
          <div className="space-y-2" role="radiogroup" aria-labelledby={`q-label-${q.id}`}>
            {q.options?.map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                <input
                  type="radio"
                  name={q.id}
                  value={opt}
                  checked={answers[q.id] === opt}
                  onChange={() => handleChange(q.id, opt)}
                  className="accent-primary-600"
                />
                {opt}
              </label>
            ))}
          </div>
        );
      case 'multi-select':
        return (
          <div className="space-y-2" role="group" aria-labelledby={`q-label-${q.id}`}>
            {q.options?.map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={((answers[q.id] as string[]) || []).includes(opt)}
                  onChange={() => handleMultiSelect(q.id, opt)}
                  className="accent-primary-600"
                />
                {opt}
              </label>
            ))}
          </div>
        );
      default:
        return (
          <input
            type="text"
            value={(answers[q.id] as string) ?? ''}
            onChange={(e) => handleChange(q.id, e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Type your answer…"
            aria-labelledby={`q-label-${q.id}`}
          />
        );
    }
  };

  const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const PUBLISHING_INTERVALS = ['Weekly', 'Biweekly', 'Monthly', 'Irregular'];

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {questionnaire.questions.map((q) => (
        <div key={q.id}>
          <label id={`q-label-${q.id}`} className="block text-sm font-medium text-foreground mb-2">
            {q.text}
          </label>
          {renderQuestion(q)}
        </div>
      ))}

      {/* Publishing Cadence fields */}
      <div className="border-t border-border pt-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">Publishing Cadence</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Set your publishing schedule to help generate accurate outreach emails with upcoming publication dates.
        </p>
        <div className="space-y-4">
          <div>
            <label htmlFor="publishingDayOfWeek" className="block text-sm font-medium text-foreground mb-2">
              Preferred publishing day of week
            </label>
            <select
              id="publishingDayOfWeek"
              value={(answers['publishingDayOfWeek'] as string) ?? ''}
              onChange={(e) => handleChange('publishingDayOfWeek', e.target.value || undefined)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select a day…</option>
              {DAYS_OF_WEEK.map((day) => (
                <option key={day} value={day}>{day}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="publishingInterval" className="block text-sm font-medium text-foreground mb-2">
              Publishing interval
            </label>
            <select
              id="publishingInterval"
              value={(answers['publishingInterval'] as string) ?? ''}
              onChange={(e) => handleChange('publishingInterval', e.target.value || undefined)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select an interval…</option>
              {PUBLISHING_INTERVALS.map((interval) => (
                <option key={interval} value={interval}>{interval}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <Button type="submit" isLoading={isSubmitting} disabled={isSubmitting}>
        Save &amp; Recalculate
      </Button>
    </form>
  );
};

// ---------------------------------------------------------------------------
// Polling interval for recalculation status (ms)
// ---------------------------------------------------------------------------
const POLL_INTERVAL = 3000;

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------
export const SponsorshipPricingPage: React.FC = () => {
  // Data state
  const [pricingData, setPricingData] = useState<PricingData | null>(null);
  const [historyData, setHistoryData] = useState<PricingHistoryData | null>(null);
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Recalculation state
  const [recalculating, setRecalculating] = useState(false);
  const [submittingQuestionnaire, setSubmittingQuestionnaire] = useState(false);

  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Track whether we already auto-triggered the first calculation
  const [autoTriggered, setAutoTriggered] = useState(false);

  // ------------------------------------------------------------------
  // Fetch pricing data
  // ------------------------------------------------------------------
  const fetchPricing = useCallback(async () => {
    try {
      const res = await pricingService.getPricing();
      if (res.success && res.data) {
        setPricingData(res.data);
        return res.data;
      } else {
        setError(res.error ?? 'Failed to load pricing data');
        return null;
      }
    } catch {
      setError('Failed to load pricing data');
      return null;
    }
  }, []);

  // ------------------------------------------------------------------
  // Fetch pricing history
  // ------------------------------------------------------------------
  const fetchHistory = useCallback(async () => {
    try {
      const res = await pricingService.getPricingHistory();
      if (res.success && res.data) {
        setHistoryData(res.data);
      }
    } catch {
      // Non-critical — history is for the trend chart
    }
  }, []);

  // ------------------------------------------------------------------
  // Fetch questionnaire
  // ------------------------------------------------------------------
  const fetchQuestionnaire = useCallback(async () => {
    try {
      const res = await pricingService.getQuestionnaire();
      if (res.success && res.data) {
        setQuestionnaire(res.data);
      }
    } catch {
      // Non-critical – questionnaire is optional
    }
  }, []);

  // ------------------------------------------------------------------
  // Poll recalculation job until done
  // ------------------------------------------------------------------
  const pollJob = useCallback(
    async (jobId: string) => {
      const poll = async () => {
        try {
          const res = await pricingService.pollRecalculationStatus(jobId);
          if (!res.success || !res.data) return;
          if (res.data.status === 'completed') {
            setRecalculating(false);
            // Refresh pricing data after completion
            await fetchPricing();
            await fetchHistory();
            return;
          }
          if (res.data.status === 'failed') {
            setRecalculating(false);
            setError(res.data.error ?? 'Recalculation failed');
            return;
          }
          // Still processing – schedule next poll
          setTimeout(poll, POLL_INTERVAL);
        } catch {
          setRecalculating(false);
          setError('Failed to check recalculation status');
        }
      };
      setTimeout(poll, POLL_INTERVAL);
    },
    [fetchPricing, fetchHistory],
  );

  // ------------------------------------------------------------------
  // Trigger recalculation
  // ------------------------------------------------------------------
  const handleRecalculate = useCallback(async () => {
    setRecalculating(true);
    setError(null);
    try {
      const res = await pricingService.triggerRecalculation();
      if (res.success && res.data?.jobId) {
        await pollJob(res.data.jobId);
      } else {
        setRecalculating(false);
        setError(res.error ?? 'Failed to start recalculation');
      }
    } catch {
      setRecalculating(false);
      setError('Failed to start recalculation');
    }
  }, [pollJob]);

  // ------------------------------------------------------------------
  // Submit questionnaire
  // ------------------------------------------------------------------
  const handleQuestionnaireSubmit = useCallback(
    async (version: string, responses: Array<{ questionId: string; answer: unknown }>) => {
      setSubmittingQuestionnaire(true);
      setRecalculating(true);
      setError(null);
      try {
        const res = await pricingService.submitQuestionnaire(version, responses);
        if (res.success && res.data?.jobId) {
          setSubmittingQuestionnaire(false);
          await pollJob(res.data.jobId);
          // Refresh questionnaire to get updated existing responses
          await fetchQuestionnaire();
        } else {
          setSubmittingQuestionnaire(false);
          setRecalculating(false);
          setError(res.error ?? 'Failed to submit questionnaire');
        }
      } catch {
        setSubmittingQuestionnaire(false);
        setRecalculating(false);
        setError('Failed to submit questionnaire');
      }
    },
    [pollJob, fetchQuestionnaire],
  );

  // ------------------------------------------------------------------
  // Export sponsor report
  // ------------------------------------------------------------------
  const handleExportReport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      await reportService.generateReport();
    } catch {
      setExportError('Report could not be generated. Please try again.');
    } finally {
      setExporting(false);
    }
  }, []);

  // ------------------------------------------------------------------
  // Initial load
  // ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setLoading(true);
      const data = await fetchPricing();
      if (!cancelled) {
        await Promise.all([fetchHistory(), fetchQuestionnaire()]);
        setLoading(false);

        // Auto-trigger first calculation if no pricing data exists (Req 7.6)
        if (data && !data.hasPricing && data.firstCalculationPending && !autoTriggered) {
          setAutoTriggered(true);
          handleRecalculate();
        }
      }
    };

    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Derived data
  // ------------------------------------------------------------------
  const current: PricingRecord | null = pricingData?.current ?? null;
  const history: PricingRecord[] = historyData?.history ?? [];

  // Build chart data from history (most recent 52 weeks, ascending order for chart)
  const chartData: ChartPoint[] = [...history]
    .slice(0, 52)
    .reverse()
    .map((r) => ({
      date: formatUtcToLocal(r.calculatedAt),
      price: r.recommendedPrice,
      justification: r.justification,
    }));

  // If current record exists and isn't already in history, prepend it
  if (current && (history.length === 0 || history[0].calculatedAt !== current.calculatedAt)) {
    chartData.push({
      date: formatUtcToLocal(current.calculatedAt),
      price: current.recommendedPrice,
      justification: current.justification,
    });
  }

  const showChart = chartData.length >= 2;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="space-y-6">
        {/* Error banner */}
        {error && (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 p-4 text-sm text-red-800 dark:text-red-300">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}

        {/* Export error banner */}
        {exportError && (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 p-4 text-sm text-red-800 dark:text-red-300">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p>{exportError}</p>
          </div>
        )}

        {loading ? (
          <PricingSkeleton />
        ) : !pricingData?.hasPricing ? (
          /* ---- Empty state (Req 7.5, 7.6) ---- */
          <EmptyState recalculating={recalculating} />
        ) : current ? (
          <>
            {/* ---- Price card (Req 7.3) ---- */}
            <PriceCard record={current} recalculating={recalculating} onRecalculate={handleRecalculate} />

            {/* ---- Export Sponsor Report button ---- */}
            <div className="flex items-center gap-3">
              <Button
                onClick={handleExportReport}
                variant="outline"
                size="sm"
                disabled={exporting}
                isLoading={exporting}
                aria-label={exporting ? 'Generating sponsor report' : 'Export sponsor report'}
              >
                <FileDown className="h-4 w-4 mr-2" aria-hidden="true" />
                {exporting ? 'Generating…' : 'Export Sponsor Report'}
              </Button>
            </div>

            {/* ---- Trend chart (Req 3.1–3.5) ---- */}
            {showChart ? (
              <Card padding="md">
                <h2 className="text-lg font-semibold text-foreground mb-4">Pricing Trend</h2>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tickFormatter={(v: number) => `$${v}`}
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        width={60}
                      />
                      <RechartsTooltip content={<CustomTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="#0b82e6"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            ) : (
              /* Fewer than 2 records (Req 3.5) */
              <Card padding="md">
                <div className="flex items-start gap-3 text-sm text-muted-foreground">
                  <Info className="h-5 w-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <p>
                    The pricing trend chart will appear after the next weekly calculation. Currently
                    there is only one data point.
                  </p>
                </div>
              </Card>
            )}

            {/* ---- Justification section (Req 5.1, 5.5) ---- */}
            <Collapsible id="justification" title="Pricing Justification" icon={<DollarSign className="w-5 h-5" />} defaultOpen>
              <div className="prose prose-sm dark:prose-invert max-w-none text-foreground whitespace-pre-line">
                {current.justification}
              </div>
            </Collapsible>

            {/* ---- Questionnaire section (Req 4.1, 4.2, 4.5, 4.6) ---- */}
            {questionnaire && (
              <Collapsible id="questionnaire" title="Pricing Questionnaire" icon={<Info className="w-5 h-5" />}>
                <p className="text-sm text-muted-foreground mb-4">
                  Answer these questions to help refine your pricing recommendation. Your responses
                  will be used in the next calculation.
                </p>
                <QuestionnaireForm
                  questionnaire={questionnaire}
                  onSubmit={handleQuestionnaireSubmit}
                  isSubmitting={submittingQuestionnaire}
                />
              </Collapsible>
            )}
          </>
        ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Price card sub-component
// ---------------------------------------------------------------------------
const PriceCard: React.FC<{
  record: PricingRecord;
  recalculating: boolean;
  onRecalculate: () => void;
}> = ({ record, recalculating, onRecalculate }) => (
  <Card padding="md">
    <CardContent>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground mb-1">Recommended Sponsorship Price</p>
          <p className="text-4xl font-bold text-foreground">
            ${record.recommendedPrice.toFixed(2)}
            <span className="text-base font-normal text-muted-foreground ml-1">USD</span>
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <ConfidenceBadge level={record.confidence} />
            <span className="text-xs text-muted-foreground">
              Calculated {formatUtcToLocal(record.calculatedAt)}
            </span>
            <span className="text-xs text-muted-foreground">
              Metrics as of {formatUtcToLocal(record.metricsAsOf)}
            </span>
          </div>
        </div>
        <Button
          onClick={onRecalculate}
          variant="outline"
          size="sm"
          disabled={recalculating}
          isLoading={recalculating}
          aria-label={recalculating ? 'Recalculation in progress' : 'Recalculate price'}
        >
          <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
          {recalculating ? 'Recalculating…' : 'Recalculate'}
        </Button>
      </div>
    </CardContent>
  </Card>
);

// ---------------------------------------------------------------------------
// Empty state sub-component
// ---------------------------------------------------------------------------
const EmptyState: React.FC<{ recalculating: boolean }> = ({ recalculating }) => (
  <Card padding="md">
    <CardContent>
      <div className="text-center py-12">
        <DollarSign className="mx-auto h-12 w-12 text-muted-foreground mb-4" aria-hidden="true" />
        <h2 className="text-xl font-semibold text-foreground mb-2">No Pricing Data Yet</h2>
        <p className="text-muted-foreground max-w-md mx-auto mb-2">
          The Sponsorship Pricing Calculator analyzes your newsletter metrics to recommend a
          per-issue sponsorship price. Pricing is recalculated automatically every Wednesday.
        </p>
        {recalculating ? (
          <p className="text-sm text-primary-600 dark:text-primary-400 flex items-center justify-center gap-2 mt-4">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            Running your first calculation…
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mt-4">
            Your first calculation will run automatically on the next scheduled Wednesday at 3:00 PM
            UTC, or you can trigger it manually once you have subscribers and at least one published
            issue with analytics.
          </p>
        )}
      </div>
    </CardContent>
  </Card>
);

export default SponsorshipPricingPage;
