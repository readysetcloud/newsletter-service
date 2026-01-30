import React from 'react';
import { cn } from '@/utils/cn';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className, style }) => {
  return (
    <div
      className={cn('animate-pulse bg-muted rounded', className)}
      style={style}
      aria-hidden="true"
    />
  );
};

export const MetricsCardSkeleton: React.FC = () => {
  return (
    <div className="bg-surface rounded-lg shadow p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
      <Skeleton className="h-8 w-24 mb-2" />
      <Skeleton className="h-4 w-20" />
    </div>
  );
};

export const ChartSkeleton: React.FC = () => {
  return (
    <div className="bg-surface rounded-lg shadow p-6">
      <Skeleton className="h-6 w-48 mb-6" />
      <div className="space-y-4">
        <div className="flex items-end justify-between h-48">
          {[...Array(8)].map((_, i) => (
            <Skeleton
              key={i}
              className="w-12"
              style={{ height: `${Math.random() * 100 + 50}px` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => {
  return (
    <div className="bg-surface rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="divide-y divide-border">
        {[...Array(rows)].map((_, i) => (
          <div key={i} className="px-6 py-4 flex items-center gap-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
};

export const DashboardSkeleton: React.FC = () => {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricsCardSkeleton />
        <MetricsCardSkeleton />
        <MetricsCardSkeleton />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricsCardSkeleton />
        <MetricsCardSkeleton />
        <MetricsCardSkeleton />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ChartSkeleton />
        </div>
        <div>
          <MetricsCardSkeleton />
        </div>
      </div>
    </div>
  );
};

export const IssueDetailSkeleton: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Header Card Skeleton */}
      <div className="bg-surface rounded-lg shadow p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <Skeleton className="h-9 w-96" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <div className="flex flex-wrap gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </div>

      {/* Content Card Skeleton */}
      <div className="bg-surface rounded-lg shadow p-6">
        <Skeleton className="h-6 w-24 mb-4" />
        <div className="space-y-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>

      {/* Stats Card Skeleton */}
      <div className="bg-surface rounded-lg shadow p-6">
        <Skeleton className="h-6 w-48 mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="bg-muted rounded-lg p-4 space-y-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      </div>

      {/* Analytics Sections Skeleton */}
      <div className="bg-surface rounded-lg shadow p-6">
        <Skeleton className="h-6 w-48 mb-4" />
        <ChartSkeleton />
      </div>
    </div>
  );
};

