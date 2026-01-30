import { Card } from '../ui/Card';
import TrendIndicator from '../analytics/TrendIndicator';
import type { IssueMetrics } from '../../types/issues';
import { calculatePercentageDifference } from '../../utils/analyticsCalculations';

interface ComparisonData {
  openRate: number;
  clickRate: number;
  bounceRate: number;
}

interface IssueComparisonCardProps {
  current: IssueMetrics;
  average?: IssueMetrics;
  lastIssue?: IssueMetrics;
  bestIssue?: IssueMetrics;
}

interface MetricComparisonProps {
  label: string;
  current: number;
  comparison?: number;
  format: 'percentage' | 'number';
  inverse?: boolean;
}

function MetricComparison({ label, current, comparison, format, inverse = false }: MetricComparisonProps) {
  if (comparison === undefined) {
    return (
      <div className="flex justify-between items-center py-2">
        <span className="text-sm text-gray-600">{label}</span>
        <span className="text-sm font-medium">
          {format === 'percentage' ? `${current.toFixed(2)}%` : current.toLocaleString()}
        </span>
      </div>
    );
  }

  const percentDiff = calculatePercentageDifference(current, comparison);
  const isPositive = inverse ? percentDiff < 0 : percentDiff > 0;

  return (
    <div className="flex justify-between items-center py-2">
      <span className="text-sm text-gray-600">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">
          {format === 'percentage' ? `${current.toFixed(2)}%` : current.toLocaleString()}
        </span>
        <TrendIndicator
          current={current}
          previous={comparison}
          format={format}
          invertColors={inverse}
        />
      </div>
    </div>
  );
}

function ComparisonSection({
  title,
  current,
  comparison,
}: {
  title: string;
  current: IssueMetrics;
  comparison?: IssueMetrics;
}) {
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-semibold text-gray-700 mb-3">{title}</h4>
      <MetricComparison
        label="Open Rate"
        current={current.openRate}
        comparison={comparison?.openRate}
        format="percentage"
      />
      <MetricComparison
        label="Click Rate"
        current={current.clickRate}
        comparison={comparison?.clickRate}
        format="percentage"
      />
      <MetricComparison
        label="Bounce Rate"
        current={current.bounceRate}
        comparison={comparison?.bounceRate}
        format="percentage"
        inverse
      />
      <MetricComparison
        label="Delivered"
        current={current.delivered}
        comparison={comparison?.delivered}
        format="number"
      />
    </div>
  );
}

export function IssueComparisonCard({
  current,
  average,
  lastIssue,
  bestIssue,
}: IssueComparisonCardProps) {
  const hasComparisons = average || lastIssue || bestIssue;

  if (!hasComparisons) {
    return null;
  }

  return (
    <Card className="p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-4 sm:mb-6">Performance Comparison</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 divide-y md:divide-y-0 md:divide-x divide-gray-200">
        {average && (
          <div className="pt-3 md:pt-0 md:pr-4 sm:md:pr-6">
            <ComparisonSection
              title="This Issue vs Average"
              current={current}
              comparison={average}
            />
          </div>
        )}

        {lastIssue && (
          <div className="pt-3 md:pt-0 md:px-4 sm:md:px-6">
            <ComparisonSection
              title="This Issue vs Last Issue"
              current={current}
              comparison={lastIssue}
            />
          </div>
        )}

        {bestIssue && (
          <div className="pt-3 md:pt-0 md:pl-4 sm:md:pl-6">
            <ComparisonSection
              title="This Issue vs Best Issue"
              current={current}
              comparison={bestIssue}
            />
          </div>
        )}
      </div>
    </Card>
  );
}
