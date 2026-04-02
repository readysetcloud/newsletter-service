import React from 'react';
import { Card } from './Card';
import { Button } from './Button';

export interface EmptyStateProps {
  icon: React.FC<{ className?: string }>;
  heading: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  heading,
  description,
  action,
}) => {
  return (
    <Card padding="md">
      <div className="text-center py-8">
        <Icon className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">{heading}</h3>
        <p className="text-sm text-muted-foreground mb-6">{description}</p>
        {action && (
          <Button variant="primary" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
    </Card>
  );
};
