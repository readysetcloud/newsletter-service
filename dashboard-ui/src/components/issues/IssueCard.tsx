/* eslint-disable react/prop-types */
import React from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Eye, MousePointerClick } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../ui/Card';
import { IssueStatusBadge } from './IssueStatusBadge';
import type { IssueListItem } from '../../types/issues';

/**
 * Props for the IssueCard component
 */
export interface IssueCardProps {
  /** The issue data to display in the card */
  issue: IssueListItem;
  /** Optional callback function when the delete action is triggered */
  onDelete?: (id: string) => void;
}

/**
 * Mobile-optimized card component for displaying issue list items
 * Shows issue subject, status, dates, and engagement metrics in a compact format
 */
export const IssueCard: React.FC<IssueCardProps> = React.memo(({ issue }) => {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const displayDate = issue.publishedAt || issue.scheduledAt || issue.createdAt;
  const dateLabel = issue.publishedAt ? 'Published' : issue.scheduledAt ? 'Scheduled' : 'Created';

  return (
    <Card className="hover:shadow-lg hover:border-primary-200 transition-all duration-200">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base sm:text-lg flex-1 min-w-0">
            <Link
              to={`/issues/${issue.id}`}
              className="hover:text-primary-600 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded line-clamp-2"
              aria-label={`View issue: ${issue.subject}`}
            >
              {issue.subject}
            </Link>
          </CardTitle>
          <IssueStatusBadge status={issue.status} className="flex-shrink-0" />
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span className="truncate">{dateLabel}: {formatDate(displayDate)}</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground">Issue #{issue.issueNumber}</span>
          </div>
        </div>
      </CardContent>

      {issue.status === 'published' && (
        <CardFooter className="border-t border-border pt-3 bg-muted/30">
          <div className="flex gap-4 sm:gap-6 text-sm text-muted-foreground w-full">
            <div className="flex items-center gap-1.5">
              <Eye className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              <span>Opens</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MousePointerClick className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              <span>Clicks</span>
            </div>
          </div>
        </CardFooter>
      )}
    </Card>
  );
});

IssueCard.displayName = 'IssueCard';
