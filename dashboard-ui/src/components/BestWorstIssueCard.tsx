import { TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface BestWorstIssue {
  id: string;
  issueNumber: number;
  subject?: string;
  score: number;
}

export interface BestWorstIssueCardProps {
  bestIssue: BestWorstIssue | null;
  worstIssue: BestWorstIssue | null;
}

export default function BestWorstIssueCard({ bestIssue, worstIssue }: BestWorstIssueCardProps) {
  if (!bestIssue && !worstIssue) {
    return null;
  }

  return (
    <div className="bg-surface rounded-lg shadow p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-medium text-foreground mb-3 sm:mb-4">Performance Highlights</h3>

      <div className="space-y-3 sm:space-y-4">
        {bestIssue && (
          <Link
            to={`/issues/${bestIssue.id}`}
            className="border border-green-200 bg-green-50 rounded-lg p-3 sm:p-4 block hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={`View details for issue ${bestIssue.issueNumber}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 sm:gap-3 flex-1 min-w-0">
                <div className="p-1.5 sm:p-2 bg-green-100 rounded-full flex-shrink-0">
                  <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs sm:text-sm font-medium text-green-900 mb-1">Best Performing</div>
                  <div className="text-xs sm:text-sm text-green-700 truncate">
                    Issue #{bestIssue.issueNumber}
                    {bestIssue.subject && `: ${bestIssue.subject}`}
                  </div>
                  <div className="text-xs text-green-600 mt-1">
                    Score: {bestIssue.score.toFixed(2)}
                  </div>
                </div>
              </div>
              <span className="flex-shrink-0 text-green-600">
                <ExternalLink className="w-4 h-4" />
              </span>
            </div>
          </Link>
        )}

        {worstIssue && (
          <Link
            to={`/issues/${worstIssue.id}`}
            className="border border-red-200 bg-red-50 rounded-lg p-3 sm:p-4 block hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={`View details for issue ${worstIssue.issueNumber}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 sm:gap-3 flex-1 min-w-0">
                <div className="p-1.5 sm:p-2 bg-red-100 rounded-full flex-shrink-0">
                  <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5 text-red-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs sm:text-sm font-medium text-red-900 mb-1">Needs Attention</div>
                  <div className="text-xs sm:text-sm text-red-700 truncate">
                    Issue #{worstIssue.issueNumber}
                    {worstIssue.subject && `: ${worstIssue.subject}`}
                  </div>
                  <div className="text-xs text-red-600 mt-1">
                    Score: {worstIssue.score.toFixed(2)}
                  </div>
                </div>
              </div>
              <span className="flex-shrink-0 text-red-600">
                <ExternalLink className="w-4 h-4" />
              </span>
            </div>
          </Link>
        )}
      </div>
    </div>
  );
}
