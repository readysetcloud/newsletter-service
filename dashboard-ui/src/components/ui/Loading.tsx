import React from 'react';
import {
  Loading as RscLoading,
  LoadingPage as RscLoadingPage,
  Skeleton,
  type LoadingProps as RscLoadingProps,
} from '@readysetcloud/ui';
import { cn } from '../../utils/cn';

export interface LoadingProps extends RscLoadingProps {
  variant?: 'spinner' | 'dots' | 'pulse';
}

export interface LoadingSkeletonProps {
  className?: string;
  lines?: number;
  avatar?: boolean;
}

export const Loading: React.FC<LoadingProps> = ({
  variant: _variant = 'spinner',
  ...props
}) => <RscLoading {...props} />;

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  className,
  lines = 3,
  avatar = false
}) => {
  return (
    <div className={cn('animate-pulse', className)}>
      <div className="flex items-start space-x-4">
        {avatar && (
          <Skeleton className="rounded-full" width="2.5rem" height="2.5rem" />
        )}
        <div className="flex-1 space-y-2">
          {Array.from({ length: lines }).map((_, i) => (
            <Skeleton
              key={i}
              className={cn(
                i === lines - 1 ? 'w-3/4' : 'w-full'
              )}
              height="1rem"
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export const LoadingPage = RscLoadingPage;
