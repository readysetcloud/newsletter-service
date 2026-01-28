import React from 'react';
import { FileText, Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import { useNavigate } from 'react-router-dom';

export interface IssuesEmptyStateProps {
  hasFilters?: boolean;
  onClearFilters?: () => void;
}

export const IssuesEmptyState: React.FC<IssuesEmptyStateProps> = ({
  hasFilters = false,
  onClearFilters
}) => {
  const navigate = useNavigate();

  if (hasFilters) {
    return (
      <div className="text-center py-12 px-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
          <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">No issues found</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
          No issues match your current filters. Try adjusting your search criteria.
        </p>
        {onClearFilters && (
          <Button variant="outline" onClick={onClearFilters} aria-label="Clear all filters">
            Clear Filters
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="text-center py-12 px-4">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-900/20 mb-4">
        <FileText className="h-8 w-8 text-primary-600 dark:text-primary-400" aria-hidden="true" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">No issues yet</h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
        Get started by creating your first newsletter issue.
      </p>
      <Button onClick={() => navigate('/issues/new')} aria-label="Create your first issue">
        <Plus className="w-4 h-4 mr-2" />
        Create Issue
      </Button>
    </div>
  );
};
