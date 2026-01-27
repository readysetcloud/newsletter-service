import React, { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

interface LazyLoaderProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  minLoadingTime?: number;
}

const DefaultLoadingFallback: React.FC = () => (
  <div className="flex items-center justify-center min-h-[400px]" role="status" aria-label="Loading">
    <div className="flex flex-col items-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      <p className="text-sm text-muted-foreground">Loading...</p>
    </div>
  </div>
);

const PageLoadingFallback: React.FC = () => (
  <div className="min-h-screen bg-background flex items-center justify-center" role="status" aria-label="Loading page">
    <div className="flex flex-col items-center gap-4">
      <Loader2 className="h-12 w-12 animate-spin text-primary-600" />
      <div className="text-center">
        <p className="text-lg font-medium text-foreground">Loading page...</p>
        <p className="text-sm text-muted-foreground mt-1">Please wait a moment</p>
      </div>
    </div>
  </div>
);

export const LazyLoader: React.FC<LazyLoaderProps> = ({
  children,
  fallback = <DefaultLoadingFallback />,
  minLoadingTime = 0
}) => {
  const [showContent, setShowContent] = React.useState(minLoadingTime === 0);

  React.useEffect(() => {
    if (minLoadingTime > 0) {
      const timer = setTimeout(() => {
        setShowContent(true);
      }, minLoadingTime);

      return () => clearTimeout(timer);
    }
  }, [minLoadingTime]);

  if (!showContent) {
    return <>{fallback}</>;
  }

  return (
    <Suspense fallback={fallback}>
      {children}
    </Suspense>
  );
};

export const PageLoader: React.FC<LazyLoaderProps> = ({ children, ...props }) => (
  <LazyLoader fallback={<PageLoadingFallback />} {...props}>
    {children}
  </LazyLoader>
);
