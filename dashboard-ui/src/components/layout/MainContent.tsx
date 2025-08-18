import React from 'react';
import { usePerformanceMetric } from '../../utils/performance';

interface MainContentProps {
  children: React.ReactNode;
  className?: string;
  pageTitle?: string;
}

export const MainContent: React.FC<MainContentProps> = ({
  children,
  className = '',
  pageTitle
}) => {
  // Track page render performance
  usePerformanceMetric(pageTitle || 'page');

  return (
    <main
      id="main-content"
      className={`flex-1 ${className}`}
      role="main"
      aria-label={pageTitle ? `${pageTitle} page content` : 'Main content'}
    >
      {children}
    </main>
  );
};
