import React from 'react';
import { cn } from '../../utils/cn';

export interface PageContainerProps {
  children: React.ReactNode;
  title?: string;
  action?: React.ReactNode;
  className?: string;
}

export const PageContainer: React.FC<PageContainerProps> = ({
  children,
  title,
  action,
  className,
}) => {
  return (
    <div className={cn('max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6', className)}>
      {(title || action) && (
        <div className="flex justify-between items-center mb-6">
          {title && (
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          )}
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
};
